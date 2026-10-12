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
import { ASSET_REGISTRY_SRC, metafileOrder, requireContextSource, type Project } from './shared';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';

export const md5 = (data: string | Uint8Array) => new Bun.CryptoHasher('md5').update(data).digest('hex');
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// ---------------------------------------------------------------- CSS

export interface CssResult {
  js: string; // module code: class map for CSS modules; dev client: + `<style>` injection with HMR
  css: string; // stylesheet text (minified unless dev)
}

export async function transformCss(project: Project, file: string, mode: { dev: boolean; server: boolean }): Promise<CssResult> {
  const src = fs.readFileSync(file, 'utf8');
  const filename = path.relative(project.projectRoot, file);
  const cssModules = project.projectRequire('@expo/metro-config/build/transform-worker/css-modules');
  const cssDev = project.projectRequire('@expo/metro-config/build/transform-worker/css');
  if (/\.module\.css$/.test(file)) {
    const r = await cssModules.transformCssModuleWeb({
      filename,
      src,
      options: { projectRoot: project.projectRoot, minify: !mode.dev, dev: mode.dev && !mode.server, sourceMap: false, reactServer: false },
    });
    return { js: r.output, css: r.css };
  }
  // global stylesheet
  const { transform } = project.projectRequire('lightningcss');
  const out = transform({ filename, code: Buffer.from(src), minify: !mode.dev, errorRecovery: true, include: 1 });
  const css = out.code.toString();
  if (mode.dev && !mode.server) return { js: cssDev.wrapDevelopmentCSS({ filename, src: css, reactServer: false }), css };
  return { js: '', css };
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
      const dir = data.httpServerLocation.replace(/^\//, '').replace(/\.\.\//g, '_');
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
  /** URL prefix of exported assets (`experiments.baseUrl`); assets are served from `${baseUrl}/assets/...` */
  baseUrl?: string;
}

export interface WebBuildResult {
  code: string;
  map: any | null; // bundle -> original sources (composed with the Babel maps)
  /** stylesheets in Metro's order (post-order walk of the import graph from the entry) */
  css: { originFilename: string; css: string }[];
  assets: WebAsset[];
  modules: string[];
}

export async function buildWeb(project: Project, entries: string[], opts: WebBuildOptions): Promise<WebBuildResult> {
  const { resolver, projectRoot, projectPkg, dev } = project;
  const server = opts.kind !== 'client';
  if (server !== project.isServer) throw new Error(`buildWeb(${opts.kind}) needs a ${server ? 'server' : 'client'} project`);
  const ENTRY = '\0bun-rn:web-entry';
  const cssByFile = new Map<string, string>();
  const assetByPath = new Map<string, WebAsset>();
  const assetFiles = new Map<string, string[]>();
  const missingExports = new Map<string, Set<string>>();
  const babelMaps = new Map<string, any>();
  const modules = new Set<string>();
  const publicPath = `${opts.baseUrl ?? ''}/assets`;

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
        const r = resolver.resolve(args.path, importer, args.kind === 'import-statement' || args.kind === 'dynamic-import');
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
        if (ext === 'css') {
          const r = await transformCss(project, file, { dev, server });
          cssByFile.set(file, r.css);
          return { contents: r.js, loader: 'js' };
        }
        if (ext === 'scss' || ext === 'sass') throw new Error(`${file}: Sass is not supported by the Bun bundler`);
        const res = await project.transform(file, 'module', 'esm');
        if (res.map) babelMaps.set(file, res.map);
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
      format: opts.kind === 'client' ? 'iife' : opts.kind === 'render' ? 'esm' : 'cjs',
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
    css: cssByFile.get(file)!,
  }));
  const { pre } = metafileOrder(result.metafile, server ? entries[0] : ENTRY);
  const assets = pre.filter((p) => assetByPath.has(p)).map((p) => assetByPath.get(p)!);
  return { code, map, css, assets, modules: [...modules] };
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
