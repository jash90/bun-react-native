// Expo DOM components (`"use dom"`) for the Bun bundler.
//
// On native, babel-preset-expo replaces a `"use dom"` file with a proxy that renders `expo/dom/internal`'s WebView
// with `filePath` = `<file name>?file=<file URL>` (development) or `<md5(file URL)>.html` (production). The web side
// is a separate web bundle of `expo/dom/entry.js` whose source registers the component (transform option `dom`):
//   development - the dev server answers `/_expo/@dom/<name>?file=<url>` with Expo's DOM component HTML loading that
//                 bundle (a dev graph per component, ./dev-server.ts)
//   export:embed - `www.bundle/<md5(file URL)>.html` + its JS/CSS/assets next to the native assets (iOS: the
//                 assets destination; Android: the bundle output directory), like Expo's exportDomComponentAsync
//   expo export  - content-addressed names (`useMd5Filename`) listed in metadata.json for EAS Update
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { expoHelpers, type ExportFiles } from './expo-helpers';
import { createProject, getExpoConfig } from './shared';
import { buildWeb, md5, webAssetFiles } from './web';
import { clientArtifacts, loadPolyfills } from './web-export';

export const DOM_COMPONENTS_BUNDLE_DIR = 'www.bundle';

/** `./<path>` of a DOM component file relative to expo/dom/entry.js (Expo's `domRoot`, URI-encoded) */
export function domRoot(projectRoot: string, fileUrlOrPath: string) {
  const req = expoHelpers(projectRoot).req;
  const virtualEntry = req.resolve('expo/dom/entry.js');
  const file = path.resolve(fileUrlOrPath.startsWith('file://') ? url.fileURLToPath(fileUrlOrPath) : fileUrlOrPath);
  const relativeImport = './' + path.relative(path.dirname(virtualEntry), file).split(path.sep).join('/');
  return { virtualEntry, dom: encodeURI(relativeImport) };
}

/** Expo's DOM component HTML page (dev: loading `bundleUrl`; export: the serializer injects the scripts) */
export function domComponentHtml(projectRoot: string, bundleUrl?: string, title?: string): string {
  return expoHelpers(projectRoot).req('@expo/cli/build/src/start/server/middleware/DomComponentsMiddleware').getDomComponentHtml(bundleUrl, { title });
}

export interface DomExport {
  reference: string;
  /** `www.bundle/<name>.html` */
  htmlName: string;
  /** EAS Update metadata entries of this component's files (md5 mode) */
  metadata: { path: string; ext: string }[];
  /** the native bundle string to replace (`<md5(file URL)>.html` -> `<md5(html)>.html`, md5 mode) */
  replace?: [string, string];
}

/**
 * Export the web side of DOM components into `files` (paths relative to the output directory).
 * `md5Filenames`: EAS Update layout (Expo `useMd5Filename` + transformDomEntryForMd5Filename).
 */
export async function exportDomComponents(opts: { projectRoot: string; references: string[]; dev: boolean; md5Filenames: boolean; files: ExportFiles }): Promise<DomExport[]> {
  const { projectRoot, files } = opts;
  const h = expoHelpers(projectRoot);
  const exp = getExpoConfig(projectRoot);
  const out: DomExport[] = [];
  for (const reference of [...new Set(opts.references)]) {
    const { virtualEntry, dom } = domRoot(projectRoot, reference);
    const project = createProject({ projectRoot, platform: 'web', dev: opts.dev, exp, dom, minify: true });
    let build;
    try {
      build = await buildWeb(project, [...project.runBeforeMain, virtualEntry], { kind: 'client', minify: true, baseUrl: './' });
      await loadPolyfills(project);
    } finally {
      project.close();
    }
    // don't ship source maps in the www.bundle (Expo: includeSourceMaps false)
    const artifacts = clientArtifacts(project, build, { dev: opts.dev, baseUrl: '.', sourceMaps: false, entry: virtualEntry });
    if (opts.md5Filenames) for (const a of artifacts) if (a.type !== 'css-external') a.filename = `${md5(a.source)}.${a.type}`;
    const html: string = h.serializeHtmlWithAssets({ isExporting: true, resources: artifacts, template: domComponentHtml(projectRoot), baseUrl: './' });
    const metadata: DomExport['metadata'] = [];
    for (const a of artifacts) {
      if (a.type === 'css-external' || a.type === 'map') continue;
      files.set(`${DOM_COMPONENTS_BUNDLE_DIR}/${a.filename}`, { contents: a.source, originFilename: a.originFilename });
      metadata.push({ path: `${DOM_COMPONENTS_BUNDLE_DIR}/${a.filename}`, ext: a.type });
    }
    // web assets like a web export, below www.bundle/ (Expo persists them with platform 'web')
    for (const [dest, src] of webAssetFiles(build.assets)) {
      files.set(`${DOM_COMPONENTS_BUNDLE_DIR}/${dest}`, { contents: fs.readFileSync(src), assetId: path.relative(projectRoot, src) });
    }
    const hash = md5(reference);
    let htmlName = `${DOM_COMPONENTS_BUNDLE_DIR}/${hash}.html`;
    let replace: DomExport['replace'];
    if (opts.md5Filenames) {
      const htmlMd5 = md5(html);
      htmlName = `${DOM_COMPONENTS_BUNDLE_DIR}/${htmlMd5}.html`;
      replace = [`${hash}.html`, `${htmlMd5}.html`];
      metadata.push({ path: htmlName, ext: 'html' });
    }
    files.set(htmlName, { contents: html });
    out.push({ reference, htmlName, metadata, replace });
  }
  return out;
}

/** export:embed: write DOM components next to the native bundle/assets (+ the public folder into www.bundle). */
export async function persistDomComponentsForEmbed(opts: { projectRoot: string; references: string[]; dev: boolean; platform: string; bundleOutput: string; assetsDest?: string }) {
  if (!opts.references.length) return 0;
  const h = expoHelpers(opts.projectRoot);
  const outDir = opts.platform === 'android' ? path.dirname(opts.bundleOutput) : opts.assetsDest;
  if (!outDir) return 0;
  const files: ExportFiles = new Map();
  const exported = await exportDomComponents({ projectRoot: opts.projectRoot, references: opts.references, dev: opts.dev, md5Filenames: false, files });
  await h.persistMetroFilesAsync(files, outDir);
  await h.copyPublicFolderAsync(h.getPublicFolderPath(opts.projectRoot), path.join(outDir, DOM_COMPONENTS_BUNDLE_DIR));
  return exported.length;
}
