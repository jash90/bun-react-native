// Web building blocks of the Bun bundler: CSS (Expo's lightningcss-based transform), web assets and
// Bun.build for the three web targets Expo bundles with Metro:
//
//   client   - browser script (IIFE) loaded by the HTML (export) or used by the dev server for SSR resources
//   render   - `@expo/router-server/node/render.js` as an ES module for Bun (static rendering: export + dev SSR)
//   function - CommonJS module for Node-compatible servers (API routes, middleware, SSR render module), like
//              Metro's `_expo/functions/*.js` that `expo-server` loads with `require()`
//
// Exports and the dev SSR are in ./web-export.ts and ./web-dev.ts.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import type { BunPlugin } from 'bun';

import { getAssetData, type AssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, MISSING_MODULE_NAMESPACE, metafileOrder, missingModuleSource, requireContextSource, type Project } from './shared';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';

export const md5 = (data: string | Uint8Array) => new Bun.CryptoHasher('md5').update(data).digest('hex');
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// ---------------------------------------------------------------- CSS

export interface CssResult {
  /** module code: CSS Modules class map (+ dev `<style>` injection); global CSS: dev injection or '' */
  js: string;
  /** stylesheet text (static extraction for exports and dev SSR) */
  css: string;
  /** local `@import`s: specifiers of other stylesheets (graph dependencies, like Metro's) */
  imports: string[];
  /** `@import url(https://...)`: rendered as `<link>` tags by Expo's HTML serializer */
  externalImports: { url: string; media?: string; supports?: string }[];
}

/**
 * @expo/metro-config transform-worker `transformCss`, step by step: native platforms get an empty module
 * (CSS Modules: `{ unstable_styles: {} }`); web runs PostCSS (project config), Sass (`sass` package), then CSS
 * Modules (Expo's lightningcss transform) or global CSS (lightningcss with browserslist targets and `@import`
 * analysis). Development modules inject `<style data-expo-css-hmr>` (guarded for server bundles).
 */
export async function transformCss(project: Project, file: string): Promise<CssResult> {
  const mc = (m: string) => project.projectRequire(`@expo/metro-config/build/transform-worker/${m}`);
  const cssModules = mc('css-modules');
  const filename = path.relative(project.projectRoot, file).split(path.sep).join('/');
  if (!project.isWeb) {
    return { js: cssModules.matchCssModule(filename) ? 'module.exports={ unstable_styles: {} };' : '', css: '', imports: [], externalImports: [] };
  }
  const { projectRoot, dev, minify } = project;
  let code = fs.readFileSync(file, 'utf8');
  const postcss = await mc('postcss').transformPostCssModule(projectRoot, { src: code, filename });
  if (postcss.hasPostcss) code = postcss.src;
  const sass = mc('sass');
  const syntax = sass.matchSass(filename);
  if (syntax) code = sass.compileSass(projectRoot, { filename, src: code }, { syntax }).src;
  if (cssModules.matchCssModule(filename)) {
    const r = await cssModules.transformCssModuleWeb({
      filename,
      src: code,
      options: { reactServer: false, projectRoot, dev, minify, sourceMap: false },
    });
    return { js: r.output, css: r.css, imports: r.dependencies.map((d: any) => d.name), externalImports: r.externalImports };
  }
  const { transform } = project.projectRequire('lightningcss');
  const out = transform({
    filename,
    code: Buffer.from(code),
    errorRecovery: true,
    sourceMap: false,
    cssModules: false,
    projectRoot,
    minify,
    analyzeDependencies: true,
    targets: await mc('browserslist').getBrowserslistTargets(projectRoot),
    include: 1, // nesting
  });
  cssModules.printCssWarnings(filename, code, out.warnings);
  const imports = cssModules.collectCssImports(filename, code, out.code.toString(), out);
  const js = dev ? mc('css').wrapDevelopmentCSS({ src: imports.code, filename, reactServer: false }) : '';
  return { js, css: imports.code, imports: imports.dependencies.map((d: any) => d.name), externalImports: imports.externalImports };
}

/** `data-expo-css-hmr` id of a stylesheet (Expo's pathToHtmlSafeName of the project-relative path). */
export const cssHmrId = (originFilename: string) => originFilename.replace(/[^a-zA-Z0-9_]/g, '_');

// ---------------------------------------------------------------- web assets

export interface WebAsset {
  data: AssetData;
  name: string; // file name without scale suffix and extension
}

/**
 * Module of a web asset, like @expo/metro-config's asset transformer for web: `{ uri, width, height }` (or the URL).
 * Exports name the file `name.<md5>` (@expo/metro-config getMD5ForData: a single file keeps its own md5).
 */
export function webAssetModule(data: AssetData, opts: { hashed: boolean }): { js: string; name: string } {
  const hash = data.fileHashes.length === 1 ? data.fileHashes[0] : md5(data.fileHashes.join(''));
  const name = opts.hashed ? `${data.name}.${hash}` : data.name;
  // exports flatten `../` (assets outside the project root) like Expo's asset transformer
  const location = opts.hashed ? data.httpServerLocation.replace(/\.\.\//g, '_') : data.httpServerLocation;
  const uri = `${location}/${name}.${data.type}`;
  const js =
    data.width != null || data.height != null
      ? `module.exports = { uri: ${JSON.stringify(uri)}, width: ${data.width}, height: ${data.height}, toString() { return this.uri } };`
      : `module.exports = ${JSON.stringify(uri)};`;
  return { js, name };
}

/** Output files (path relative to the export root) of web assets, every scale variant. */
export function webAssetFiles(assets: WebAsset[]): Map<string, string> {
  const out = new Map<string, string>(); // relative destination -> source file
  for (const { data, name } of assets) {
    data.files.forEach((src, i) => {
      const scale = data.scales[i];
      const suffix = scale === 1 ? '' : `@${scale}x`;
      const dir = data.httpServerLocation.replace(/^\.?\//, '').replace(/\.\.\//g, '_');
      out.set(`${dir}/${name}${suffix}.${data.type}`, src);
    });
  }
  return out;
}

// ---------------------------------------------------------------- Bun.build for web

export type WebBuildKind = 'client' | 'render' | 'function';

export interface WebBuildOptions {
  kind: WebBuildKind;
  minify: boolean;
  sourcemap?: boolean;
  /**
   * client only: split `import()`ed modules (expo-router `asyncRoutes`) into ES module chunks served from
   * `${baseUrl}/_expo/static/js/web/` (Bun.build `splitting`, format esm)
   */
  splitting?: boolean;
  /** URL prefix of exported assets (`experiments.baseUrl`); assets are served from `${baseUrl}/assets/...` */
  baseUrl?: string;
}

export interface WebBuildResult {
  code: string;
  map: any | null; // bundle -> original sources (composed with the Babel maps)
  /** stylesheets in Metro's order (post-order walk of the import graph from the entry) */
  css: { originFilename: string; css: string; externalImports: CssResult['externalImports'] }[];
  assets: WebAsset[];
  modules: string[];
  /** files exporting an expo-router `loader` (Metro artifact metadata `loaderReferences`) */
  loaderFiles: string[];
  /** split chunks: file name (in _expo/static/js/web/), code, and the source files each contains / imports */
  chunks: { name: string; code: string; inputs: string[]; imports: string[] }[];
}

export async function buildWeb(project: Project, entries: string[], opts: WebBuildOptions): Promise<WebBuildResult> {
  const { resolver, projectRoot, projectPkg, dev } = project;
  const server = opts.kind !== 'client';
  const split = opts.kind === 'client' && !!opts.splitting;
  if (server !== project.isServer) throw new Error(`buildWeb(${opts.kind}) needs a ${server ? 'server' : 'client'} project`);
  // virtual entry (namespace rn-virtual); a plain name, as split chunks are named after it
  const ENTRY = '/expo-web-entry';
  const cssByFile = new Map<string, CssResult>();
  const assetByPath = new Map<string, WebAsset>();
  const assetFiles = new Map<string, string[]>();
  const missingExports = new Map<string, Set<string>>();
  const babelMaps = new Map<string, any>();
  const modules = new Set<string>();
  const loaderFiles = new Set<string>();
  const optionalByFile = new Map<string, Set<string>>();
  // DOM component exports use the relative base './' (Expo: `baseUrl: './'`)
  const publicPath = opts.baseUrl === './' ? './assets' : `${opts.baseUrl ?? ''}/assets`;

  const plugin: BunPlugin = {
    name: 'react-native-web',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === ENTRY) return { path: ENTRY, namespace: 'rn-virtual' };
        if (server && NODE_BUILTINS.has(args.path)) return { path: args.path, external: true };
        if (args.path.startsWith(REQUIRE_CONTEXT_PREFIX)) {
          const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
          spec.dir = path.resolve(path.dirname(args.importer), spec.dir);
          return { path: REQUIRE_CONTEXT_PREFIX + JSON.stringify(spec), namespace: 'rn-context' };
        }
        const importer = args.importer && args.namespace === 'file' ? args.importer : projectPkg;
        let r;
        try {
          r = resolver.resolve(args.path, importer, args.kind === 'import-statement' || args.kind === 'dynamic-import');
        } catch (e) {
          // Metro allowOptionalDependencies: unresolved requires inside try blocks throw only when they run
          if (!optionalByFile.get(importer)?.has(args.path)) throw e;
          return { path: args.path, namespace: MISSING_MODULE_NAMESPACE };
        }
        if (r.type === 'empty') return { path: `empty:${args.path}`, namespace: 'rn-empty' };
        if (r.type === 'assetFiles') {
          assetFiles.set(r.filePaths[0], r.filePaths);
          return { path: r.filePaths[0], namespace: 'rn-asset' };
        }
        if (r.filePath === ASSET_REGISTRY_VIRTUAL) return { path: ASSET_REGISTRY_VIRTUAL, namespace: 'rn-virtual' };
        return { path: r.filePath, namespace: 'file' };
      });
      build.onLoad({ filter: /.*/, namespace: 'rn-virtual' }, (args) => {
        if (args.path === ENTRY) return { contents: entries.map((f) => `import ${JSON.stringify(f)};`).join('\n'), loader: 'js' };
        return { contents: ASSET_REGISTRY_SRC, loader: 'js' };
      });
      build.onLoad({ filter: /.*/, namespace: MISSING_MODULE_NAMESPACE }, (args) => ({ contents: missingModuleSource(args.path), loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'rn-empty' }, () => ({ contents: 'module.exports = {};', loader: 'js' })); // CommonJS like Metro's empty module: named imports are undefined
      build.onLoad({ filter: /.*/, namespace: 'rn-asset' }, (args) => {
        const data = getAssetData(assetFiles.get(args.path)!, projectRoot, publicPath, 'web');
        const { js, name } = webAssetModule(data, { hashed: !dev });
        assetByPath.set(args.path, { data, name });
        for (const f of data.files) modules.add(f);
        return { contents: js, loader: 'js' };
      });
      build.onLoad({ filter: /.*/, namespace: 'rn-context' }, (args) => {
        const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
        return { contents: requireContextSource(projectRoot, spec), loader: 'js', resolveDir: spec.dir };
      });
      build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        const file = args.path;
        modules.add(file);
        const ext = path.extname(file).slice(1);
        if (ext === 'json') return { contents: fs.readFileSync(file, 'utf8'), loader: 'json' };
        if (ext === 'css' || ext === 'scss' || ext === 'sass') {
          const r = await transformCss(project, file);
          cssByFile.set(file, r);
          // `@import`ed stylesheets are graph dependencies (Metro adds them to the module's dependencies)
          return { contents: r.imports.map((i) => `require(${JSON.stringify(i)});\n`).join('') + r.js, loader: 'js' };
        }
        const res = await project.transform(file, 'module', 'esm');
        if (res.map) babelMaps.set(file, res.map);
        if (res.loaderReference) loaderFiles.add(file);
        if (res.optionalDeps?.length) optionalByFile.set(file, new Set(res.optionalDeps));
        const stubs = missingExports.get(file);
        const stubCode = stubs ? '\n' + [...stubs].map((n) => `export var ${n} = void 0;`).join('\n') : '';
        return { contents: (res.code ?? '') + stubCode, loader: 'js' };
      });
    },
  };

  let result: any;
  for (let attempt = 0; ; attempt++) {
    result = await Bun.build({
      // server targets keep the entry's exports, so the entry is built directly
      entrypoints: server ? entries : [ENTRY],
      plugins: [plugin],
      target: opts.kind === 'client' ? 'browser' : opts.kind === 'render' ? 'bun' : 'node',
      format: opts.kind === 'client' ? (split ? 'esm' : 'iife') : opts.kind === 'render' ? 'esm' : 'cjs',
      ...(split
        ? { splitting: true, naming: { entry: '[name].[ext]', chunk: '[name]-[hash].[ext]' }, publicPath: `${opts.baseUrl ?? ''}/_expo/static/js/web/` }
        : {}),
      minify: opts.minify,
      sourcemap: opts.sourcemap ? 'external' : 'none',
      metafile: true,
      define: {
        __DEV__: String(dev),
        'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
        ...(server ? {} : { global: 'globalThis' }),
      },
      throw: false,
    } as any);
    if (result.success || attempt >= 5) break;
    let added = 0;
    for (const l of result.logs) {
      const m = String(l).match(/No matching export in "(.+?)" for import "(.+?)"/);
      if (!m) continue;
      const file = path.resolve(projectRoot, m[1]);
      if (!missingExports.has(file)) missingExports.set(file, new Set());
      if (!missingExports.get(file)!.has(m[2])) {
        missingExports.get(file)!.add(m[2]);
        added++;
      }
    }
    if (!added) break;
  }
  if (!result.success) throw new Error(`Bun.build (web ${opts.kind}) failed:\n${result.logs.map(String).join('\n')}`);
  const code = (await result.outputs.find((o: any) => o.kind === 'entry-point').text()).replace(/\n?\/\/# (sourceMappingURL|debugId)=.*$/gm, '');

  let map: any = null;
  if (opts.sourcemap) {
    const smOut = result.outputs.find((o: any) => o.kind === 'sourcemap');
    const bunMap = smOut ? JSON.parse(await smOut.text()) : { version: 3, sources: [], names: [], mappings: '' };
    map = composeBabelMaps(project, bunMap, babelMaps);
  }

  // stylesheets in Metro's order (@expo/metro-config getCssSerialAssets): post-order walk from the entry
  const css = metafileOrder(result.metafile, entries[entries.length - 1]).post.filter((f) => cssByFile.has(f)).map((file) => ({
    originFilename: path.relative(projectRoot, file).split(path.sep).join('/'),
    css: cssByFile.get(file)!.css,
    externalImports: cssByFile.get(file)!.externalImports,
  }));
  const { pre } = metafileOrder(result.metafile, server ? entries[0] : ENTRY);
  const assets = pre.filter((p) => assetByPath.has(p)).map((p) => assetByPath.get(p)!);
  const chunks: WebBuildResult['chunks'] = [];
  for (const out of result.outputs.filter((o: any) => o.kind === 'chunk')) {
    const name = path.basename(out.path);
    const meta = Object.entries<any>(result.metafile?.outputs ?? {}).find(([k]) => path.basename(k) === name)?.[1];
    chunks.push({
      name,
      code: (await out.text()).replace(/\n?\/\/# (sourceMappingURL|debugId)=.*$/gm, ''),
      inputs: Object.keys(meta?.inputs ?? {}).map((k) => path.resolve(k.replace(/^[a-z][a-z-]*:(?=\/)/, ''))),
      imports: (meta?.imports ?? []).map((i: any) => path.basename(i.path)),
    });
  }
  return { code, map, css, assets, modules: [...modules], chunks, loaderFiles: [...loaderFiles] };
}

/** Compose Bun's map (bundle -> Babel output) with the per-file Babel maps (Babel output -> source). */
export function composeBabelMaps(project: Project, bunMap: any, babelMaps: Map<string, any>) {
  const remapping = project.projectRequire('@jridgewell/remapping');
  const map: any = remapping(bunMap, (source: string) => {
    if (path.isAbsolute(source)) return null;
    return babelMaps.get(path.resolve(project.projectRoot, source)) ?? null;
  });
  map.sources = map.sources.map((s: string) => (path.isAbsolute(s) ? path.relative(project.projectRoot, s) : s));
  return map;
}
