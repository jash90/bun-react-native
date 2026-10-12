// Metro Server endpoints of the Bun dev server, after metro/src/Server.js:
//   /assets/<path> and /assets?unstable_path=<path>[?query]  -> _processSingleAssetRequest (Metro's getAsset: scale
//        selection, assetExts check, project root / watch folders, Range requests, mime type)
//   /[metro-project]/<file>, /[metro-watchFolders]/<i>/<file> -> _processSourceRequest (source files with a
//        source/asset extension; Metro serves them for the debugger's source tab)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { metroRequire } from '../bun/metro-require';

export function createMetroEndpoints(projectRoot: string, config: any) {
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const mreq = metroRequire(projectRoot);
  const { getAsset } = mreq('metro/private/Assets');
  const mime = mreq('mime-types');
  const watchFolders: string[] = config.watchFolders ?? [];
  const blockList: RegExp | RegExp[] | undefined = config.resolver?.blockList;
  const blocked = (file: string) => (Array.isArray(blockList) ? blockList.some((r) => r.test(file)) : !!blockList?.test(file));
  const roots = [projectRoot, ...watchFolders].map((r) => path.resolve(r));
  /** Metro: the file is in the file map (watched roots, not block-listed) */
  const inFileMap = (file: string) => roots.some((r) => file.startsWith(r + path.sep)) && !blocked(file) && fs.existsSync(file);
  const sourceSuffixes = [...new Set([...config.resolver.sourceExts, ...(config.watcher?.additionalExts ?? []), ...config.resolver.assetExts].map((e: string) => '.' + e))];
  const sourceRoutes: [string, string][] = [['/[metro-project]/', path.resolve(projectRoot)], ...watchFolders.map((w, i): [string, string] => [`/[metro-watchFolders]/${i}/`, path.resolve(w)])];

  return {
    isAssetRequest: (pathname: string) => pathname.startsWith('/assets/') || pathname === '/assets',

    async asset(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let assetPath = url.pathname
        .split('/')
        .map((s) => decodeURIComponent(s))
        .join('/')
        .match(/^\/assets\/(.+)$/)?.[1];
      if (!assetPath && url.searchParams.get('unstable_path')) {
        const [, actualPath, secondaryQuery] = url.searchParams.get('unstable_path')!.match(/^([^?]*)\??(.*)$/)!;
        if (secondaryQuery) for (const [k, v] of new URLSearchParams(secondaryQuery)) url.searchParams.set(k, v);
        assetPath = actualPath;
      }
      try {
        if (!assetPath) throw new Error('Could not extract asset path from URL');
        const data: Buffer = await getAsset(assetPath, projectRoot, watchFolders, url.searchParams.get('platform'), config.resolver.assetExts, inFileMap);
        const headers: Record<string, string> = { 'Content-Type': mime.lookup(path.basename(assetPath)) || 'application/octet-stream' };
        if (process.env.REACT_NATIVE_ENABLE_ASSET_CACHING === (true as any)) headers['Cache-Control'] = 'max-age=31536000';
        const range = request.headers.get('range');
        if (range) {
          const [start, end] = range.replace(/bytes=/, '').split('-');
          const dataStart = parseInt(start, 10);
          const dataEnd = end ? parseInt(end, 10) : data.length - 1;
          return new Response(new Uint8Array(data.subarray(dataStart, dataEnd + 1)), {
            status: 206,
            headers: { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': String(dataEnd - dataStart + 1), 'Content-Range': `bytes ${dataStart}-${dataEnd}/${data.length}` },
          });
        }
        return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } });
      } catch (error: any) {
        console.error(error?.stack ?? error);
        // a stream body: Bun adds no default Content-Type (Metro sends none here)
        const body = new TextEncoder().encode('Asset not found');
        return new Response(new ReadableStream({ start: (c) => (c.enqueue(body), c.close()) }), { status: 404, headers: { 'Content-Length': String(body.length) } });
      }
    },

    /** null when the path is not a Metro source route */
    source(rawPathname: string): Response | null {
      const pathname = decodeURIComponent(rawPathname);
      const route = sourceRoutes.find(([prefix]) => pathname.startsWith(prefix));
      if (!route) return null;
      const rel = pathname.slice(route[0].length);
      const file = path.join(route[1], rel);
      if (!sourceSuffixes.some((s) => rel.endsWith(s)) || !inFileMap(file)) return new Response(null, { status: 404 });
      // Metro sets the lookup result as is (`false` for unknown types such as .tsx)
      return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { 'Content-Type': String(mime.lookup(path.basename(rel))) } });
    },
  };
}
