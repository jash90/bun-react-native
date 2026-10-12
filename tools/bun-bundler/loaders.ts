// expo-router server data loaders (`unstable_useServerDataLoaders`) for the Bun bundler.
//
// A route's `loader` export runs on the server: Expo bundles the route file as a "loader bundle"
// (babel-preset-expo keeps only the `loader` export, `isLoaderBundle`) for Node and calls
// `loader(request, params)` - at export time for static rendering (data written to `_expo/loaders/...`), per
// request in development and with server rendering (`_expo/loaders/<page>.js` modules for expo-server).
import fs from 'node:fs';
import path from 'node:path';

import { createProject } from './shared';
import { md5 } from './web';
import { buildServerFunction } from './web-export';

export function createLoaderRunner(opts: { projectRoot: string; exp: any; routerRoot: string; dev: boolean; minify: boolean }) {
  const { projectRoot } = opts;
  const modules = new Map<string, Promise<any>>();
  /** files of each loader bundle's graph (Expo listens to the loader graph to broadcast `loader-invalidate`) */
  const graphFiles = new Map<string, Set<string>>();
  const dir = path.join(projectRoot, 'node_modules', '.cache', 'bun-rn-bundler', 'web-loaders');

  /** the loader bundle of a route file (CommonJS for Node, like Metro's `isLoaderBundle` bundles) */
  function bundle(file: string) {
    const project = createProject({ projectRoot, platform: 'web', dev: opts.dev, environment: 'node', exp: opts.exp, routerRoot: opts.routerRoot, minify: opts.minify, loaderBundle: true });
    return buildServerFunction(project, file, { minify: opts.minify }).finally(() => project.close());
  }

  function load(file: string): Promise<any> {
    let p = modules.get(file);
    if (!p) {
      p = (async () => {
        const { src, modules: files } = await bundle(file);
        graphFiles.set(file, new Set(files));
        fs.mkdirSync(dir, { recursive: true });
        const out = path.join(dir, `${path.basename(file).replace(/\W+/g, '_')}-${md5(src)}.cjs`);
        if (!fs.existsSync(out)) fs.writeFileSync(out, src);
        delete require.cache[out];
        return require(out);
      })();
      p.catch(() => modules.delete(file));
      modules.set(file, p);
    }
    return p;
  }

  return {
    bundle,
    /** build and load the loader bundles up front, so rendering does not interleave with bundling */
    async preload(files: string[]) {
      await Promise.all([...new Set(files)].map((f) => load(f).catch(() => undefined)));
    },
    /** run the route's loader; `undefined` when the route has none (Expo: no loader -> no data) */
    async run(file: string, request: Request | undefined, params: Record<string, any>): Promise<{ value: any } | undefined> {
      const mod = await load(file);
      if (typeof mod?.loader !== 'function') return undefined;
      try {
        return { value: await mod.loader(request, params) };
      } catch (e: any) {
        throw new Error(`Failed to execute loader for route "${path.relative(projectRoot, file)}": ${e?.message ?? e}`);
      }
    },
    /** whether a changed file belongs to a loaded loader's graph (Expo: setupLoaderGraphListener) */
    affectedBy(changed: string[]) {
      return [...graphFiles.values()].some((files) => changed.some((f) => files.has(f)));
    },
    invalidate() {
      modules.clear();
    },
  };
}

export type LoaderRunner = ReturnType<typeof createLoaderRunner>;
