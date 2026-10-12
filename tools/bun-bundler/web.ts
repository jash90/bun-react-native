// Web for the Bun bundler: CSS (Expo's lightningcss-based transform), web assets and the static
// export (`expo export --platform web` with `web.output: "static"`), replacing Metro for web.
//
// Static export = client bundle (Bun.build, browser) + server bundle of `@expo/router-server/node/render.js`
// (Bun.build, target bun, executed in this process) -> getManifest() + getStaticContent(url) per route ->
// HTML with the client JS/CSS injected, like Expo CLI's exportStaticAsync.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import type { BunPlugin } from 'bun';

import { getAssetData, type AssetData } from './assets';
import { ASSET_REGISTRY_VIRTUAL } from './resolver';
import { ASSET_REGISTRY_SRC, createProject, readAppJson, requireContextSource, type Project } from './shared';
import { REQUIRE_CONTEXT_PREFIX } from './transform-worker';

const md5 = (data: string | Uint8Array) => new Bun.CryptoHasher('md5').update(data).digest('hex');
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// ---------------------------------------------------------------- CSS

export interface CssResult {
  js: string; // module code (class map for CSS modules; dev: + style injection with HMR)
  css: string; // stylesheet text (empty for the server)
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
    return { js: r.output, css: mode.server ? '' : r.css };
  }
  // global stylesheet
  const { transform } = project.projectRequire('lightningcss');
  const out = transform({ filename, code: Buffer.from(src), minify: !mode.dev, errorRecovery: true, include: 1 });
  const css = out.code.toString();
  if (mode.server) return { js: '', css: '' };
  if (mode.dev) return { js: cssDev.wrapDevelopmentCSS({ filename, src: css, reactServer: false }), css: '' };
  return { js: '', css };
}

// ---------------------------------------------------------------- web assets (export)

/** Expo web export asset: hashed file name, module exports `{ uri, width, height }` (or the URL). */
export function webAssetModule(data: AssetData): { js: string; name: string } {
  // same as @expo/metro-config getMD5ForData: a single file keeps its own md5
  const hash = data.fileHashes.length === 1 ? data.fileHashes[0] : md5(data.fileHashes.join(''));
  const name = `${data.name}.${hash}`;
  const uri = `${data.httpServerLocation}/${name}.${data.type}`;
  const js =
    data.width != null || data.height != null
      ? `module.exports = { uri: ${JSON.stringify(uri)}, width: ${data.width}, height: ${data.height}, toString() { return this.uri } };`
      : `module.exports = ${JSON.stringify(uri)};`;
  return { js, name };
}

function copyWebAssets(assets: { data: AssetData; name: string }[], outDir: string) {
  let count = 0;
  for (const { data, name } of assets) {
    data.files.forEach((src, i) => {
      const scale = data.scales[i];
      const suffix = scale === 1 ? '' : `@${scale}x`;
      const dest = path.join(outDir, data.httpServerLocation.replace(/^\//, ''), `${name}${suffix}.${data.type}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      count++;
    });
  }
  return count;
}

// ---------------------------------------------------------------- Bun.build for web (client or server)

interface WebBuildResult {
  code: string;
  css: { file: string; css: string }[];
  assets: { data: AssetData; name: string }[];
}

async function buildWeb(project: Project, entries: string[], opts: { minify: boolean; outFile?: string }): Promise<WebBuildResult> {
  const { resolver, projectRoot, projectPkg } = project;
  const server = project.isServer;
  const ENTRY = '\0bun-rn:web-entry';
  const cssByFile = new Map<string, string>();
  const assets: { data: AssetData; name: string }[] = [];
  const assetFiles = new Map<string, string[]>();
  const missingExports = new Map<string, Set<string>>();

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
        const data = getAssetData(assetFiles.get(args.path)!, projectRoot);
        const { js, name } = webAssetModule(data);
        assets.push({ data, name });
        return { contents: js, loader: 'js' };
      });
      build.onLoad({ filter: /.*/, namespace: 'rn-context' }, (args) => {
        const spec = JSON.parse(args.path.slice(REQUIRE_CONTEXT_PREFIX.length));
        return { contents: requireContextSource(projectRoot, spec), loader: 'js', resolveDir: spec.dir };
      });
      build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        const file = args.path;
        const ext = path.extname(file).slice(1);
        if (ext === 'json') return { contents: fs.readFileSync(file, 'utf8'), loader: 'json' };
        if (ext === 'css') {
          const r = await transformCss(project, file, { dev: false, server });
          if (r.css) cssByFile.set(file, r.css);
          return { contents: r.js, loader: 'js' };
        }
        if (ext === 'scss' || ext === 'sass') throw new Error(`${file}: Sass is not supported by the Bun bundler`);
        const res = await project.transform(file, 'module', 'esm');
        const stubs = missingExports.get(file);
        const stubCode = stubs ? '\n' + [...stubs].map((n) => `export var ${n} = void 0;`).join('\n') : '';
        return { contents: (res.code ?? '') + stubCode, loader: 'js' };
      });
    },
  };

  let result: any;
  for (let attempt = 0; ; attempt++) {
    result = await Bun.build({
      // the server bundle keeps render.js's exports, so it is the entry itself
      entrypoints: server ? entries : [ENTRY],
      plugins: [plugin],
      target: server ? 'bun' : 'browser',
      format: server ? 'esm' : 'iife',
      minify: opts.minify,
      define: {
        __DEV__: 'false',
        'process.env.NODE_ENV': '"production"',
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
  if (!result.success) throw new Error(`Bun.build (${server ? 'web server' : 'web'}) failed:\n${result.logs.map(String).join('\n')}`);
  const js = await result.outputs.find((o: any) => o.kind === 'entry-point').text();
  const css = [...cssByFile.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, text]) => ({ file, css: text }));
  return { code: js, css, assets };
}

// ---------------------------------------------------------------- routes from the Expo Router manifest

function htmlRoutes(manifest: any): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (screens: Record<string, any>, prefix: string) => {
    for (const [name, value] of Object.entries(screens ?? {})) {
      const segment = typeof value === 'string' ? value : (value?.path ?? '');
      const full = [prefix, segment].filter(Boolean).join('/');
      if (value && typeof value === 'object' && !value._route && value.screens && Object.keys(value.screens).length) {
        walk(value.screens, full);
        continue;
      }
      if (/(^|\/)[:*][^/]*/.test(full) && !full.includes('*not-found')) continue; // dynamic segments need params
      const file = full.includes('*not-found') ? '+not-found' : full === '' ? 'index' : full.replace(/\*\w+/g, '');
      const route = full.includes('*not-found') ? '/+not-found' : '/' + full;
      if (!out.some((r) => r.file === file)) out.push({ route, file });
      void name;
    }
  };
  walk(manifest?.screens ?? {}, '');
  return out;
}

// ---------------------------------------------------------------- static export

export interface WebExportOptions {
  projectRoot: string;
  outputDir: string;
  minify?: boolean;
  log?: (msg: string) => void;
}

export async function exportWeb(opts: WebExportOptions) {
  const t0 = performance.now();
  const log = opts.log ?? (() => {});
  const { projectRoot } = opts;
  const outDir = path.resolve(opts.outputDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const appJson = readAppJson(projectRoot)?.expo ?? {};
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const entry = require.resolve(pkg.main ?? './index.js', { paths: [projectRoot] });

  // ---- client
  const client = createProject({ projectRoot, platform: 'web', dev: false });
  let clientBuild: WebBuildResult;
  let polyfills: string[];
  try {
    clientBuild = await buildWeb(client, [...client.runBeforeMain, entry], { minify: opts.minify ?? true });
    polyfills = await client.polyfillSources();
  } finally {
    client.close();
  }
  const clientJs = [client.prelude(), ...polyfills, clientBuild.code].join('\n');
  const jsName = `_expo/static/js/web/entry-${md5(clientJs)}.js`;
  fs.mkdirSync(path.join(outDir, path.dirname(jsName)), { recursive: true });
  fs.writeFileSync(path.join(outDir, jsName), clientJs);
  const cssNames = clientBuild.css.map(({ file, css }) => {
    const name = `_expo/static/css/${path.basename(file, '.css')}-${md5(css)}.css`;
    fs.mkdirSync(path.join(outDir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(outDir, name), css);
    return name;
  });
  const assetCount = copyWebAssets(clientBuild.assets, outDir);

  // ---- server (static rendering), executed here
  const server = createProject({ projectRoot, platform: 'web', dev: false, environment: 'node' });
  let serverBuild: WebBuildResult;
  try {
    const renderEntry = server.projectRequire.resolve('@expo/router-server/node/render.js');
    serverBuild = await buildWeb(server, [renderEntry], { minify: false });
  } finally {
    server.close();
  }
  const serverDir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', 'web-server');
  fs.mkdirSync(serverDir, { recursive: true });
  const serverFile = path.join(serverDir, `render-${md5(serverBuild.code)}.mjs`);
  // the server bundle is an ES module whose entry re-exports nothing: expose render.js's exports
  fs.writeFileSync(serverFile, serverBuild.code);
  const renderModule = await loadRenderModule(server, serverFile);

  const manifest = await renderModule.getManifest({ preserveApiRoutes: false, ...(appJson.extra?.router ?? {}) });
  const routes = htmlRoutes(manifest);
  // same order as `expo export -p web`: favicon, hydration flag, CSS in <head>; the script ends <body>
  const favicon = appJson.web?.favicon ? path.resolve(projectRoot, appJson.web.favicon) : null;
  const head =
    (favicon ? '<link rel="icon" href="/favicon.ico"/>' : '') +
    `<script type="module">globalThis.__EXPO_ROUTER_HYDRATE__=true;</script>` +
    cssNames.map((n) => `<link rel="preload" href="/${n}" as="style"><link rel="stylesheet" href="/${n}">`).join('');
  const script = `<script src="/${jsName}" defer></script>`;
  for (const { route, file } of routes) {
    let html: string = await renderModule.getStaticContent(new URL(route, 'http://localhost:8081'));
    html = html.includes('</head>') ? html.replace('</head>', `${head}</head>`) : head + html;
    html = html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script;
    const dest = path.join(outDir, `${file}.html`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html);
  }
  if (favicon) fs.copyFileSync(favicon, path.join(outDir, 'favicon.ico'));
  fs.mkdirSync(path.join(outDir, '_expo'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '_expo', '.routes.json'), JSON.stringify({ redirects: [] }, null, 2));

  const ms = Math.round(performance.now() - t0);
  log(`Web exported ${routes.length} routes, ${cssNames.length} CSS, ${assetCount} assets in ${ms}ms with Bun -> ${outDir}`);
  return { routes, jsName, cssNames, ms };
}

/** Load the server bundle; render.js's exports are reachable through the bundled module registry. */
async function loadRenderModule(server: Project, file: string): Promise<any> {
  void server;
  const mod = await import(file);
  if (typeof mod.getStaticContent === 'function') return mod;
  if (mod.default && typeof mod.default.getStaticContent === 'function') return mod.default;
  throw new Error(`Static render bundle ${file} does not export getStaticContent`);
}
