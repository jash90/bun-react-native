// Source maps of exported bundles in the shape Expo's serializer writes them (@expo/metro-config serializeChunks +
// sourceMap.js, Metro's Generator):
//   - the bundle is prelude + polyfills + module graph; each piece keeps its own mappings (`concatPieces`), the
//     prelude is listed as `__prelude__` without mappings, polyfills map through their Babel output
//   - sources are `/`-prefixed paths relative to the server root ("to prevent the entire user filesystem from being
//     exposed"); Bun plugin namespaces are dropped, `require.context` modules get Metro's `<dir>?ctx=<sha1>` ids
//   - `x_google_ignoreList`: prelude, virtual modules, `?ctx=` modules, node_modules (except expo-router/entry and
//     expo/AppEntry) - Metro Server._shouldAddModuleToIgnoreList + ExpoMetroConfig isThirdPartyModule
//   - `x_facebook_sources`: per-source function maps (Metro functionMapBabelPlugin), used by Hermes symbolication
//   - `debugId` (+ the `//# debugId=` comment, see `debugIdFor`) for exports with external maps
import path from 'node:path';

export interface RawMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
  [key: string]: any;
}

export interface FunctionMap {
  names: string[];
  mappings: string;
}

/** A piece of the bundle: code with its map, or a named source without mappings (the prelude). */
export interface MapPiece {
  code: string;
  map?: RawMap | null;
  /** list `source` (with `code` as its content) although nothing maps to it, like Metro's `__prelude__` */
  source?: string;
}

export const PRELUDE_SOURCE = '__prelude__';
const REQUIRE_CONTEXT_PREFIX = '\0require-context:';

/** Join pieces with `\n` and their maps into one (sources and names deduplicated). */
export function concatPieces(pieces: MapPiece[], projectRequire: NodeRequire): { code: string; map: RawMap } {
  const { decode, encode } = projectRequire('@jridgewell/sourcemap-codec');
  const sources: string[] = [];
  const sourcesContent: (string | null)[] = [];
  const names: string[] = [];
  const sourceIndex = new Map<string, number>();
  const nameIndex = new Map<string, number>();
  const addSource = (s: string, content: string | null) => {
    let i = sourceIndex.get(s);
    if (i === undefined) {
      i = sources.push(s) - 1;
      sourceIndex.set(s, i);
      sourcesContent.push(content);
    }
    return i;
  };
  const addName = (n: string) => {
    let i = nameIndex.get(n);
    if (i === undefined) nameIndex.set(n, (i = names.push(n) - 1));
    return i;
  };
  const lines: number[][][] = [];
  for (const piece of pieces) {
    const lineCount = piece.code.split('\n').length;
    if (piece.source) addSource(piece.source, piece.code);
    const decoded: number[][][] = piece.map?.mappings ? decode(piece.map.mappings) : [];
    const srcMap = (piece.map?.sources ?? []).map((s, i) => addSource(s, piece.map!.sourcesContent?.[i] ?? null));
    const nameMap = (piece.map?.names ?? []).map(addName);
    for (let l = 0; l < lineCount; l++) {
      lines.push((decoded[l] ?? []).map((seg) => (seg.length === 1 ? seg : seg.length === 4 ? [seg[0], srcMap[seg[1]], seg[2], seg[3]] : [seg[0], srcMap[seg[1]], seg[2], seg[3], nameMap[seg[4]]])));
    }
  }
  return { code: pieces.map((p) => p.code).join('\n'), map: { version: 3, sources, sourcesContent, names, mappings: encode(lines) } };
}

/** Metro's id of a require.context module: `<dir>?ctx=<sha1(mode recursive filter)>` */
function contextModuleId(spec: string, projectRequire: NodeRequire): string {
  const ctx = JSON.parse(spec.slice(REQUIRE_CONTEXT_PREFIX.length));
  const { deriveAbsolutePathFromContext } = projectRequire('metro/private/lib/contextModule');
  return deriveAbsolutePathFromContext(ctx.dir, { mode: ctx.mode, recursive: ctx.recursive, filter: ctx.filter });
}

/** absolute file / virtual module behind a map source (Bun: `namespace:path`, project-relative paths) */
function resolveSource(source: string, projectRoot: string, projectRequire: NodeRequire): string {
  const ns = source.match(/^(rn-[a-z]+):([\s\S]*)$/);
  // Expo's empty module and unresolvable optional dependencies are generated code: virtual modules
  if (ns?.[1] === 'rn-empty' || ns?.[1] === 'rn-missing') return `\0${ns[1] === 'rn-empty' ? '' : 'missing:'}${ns[2]}`;
  let s = ns ? ns[2] : source;
  if (s.startsWith(REQUIRE_CONTEXT_PREFIX)) s = contextModuleId(s, projectRequire);
  if (s.startsWith('\0') || s === PRELUDE_SOURCE) return s;
  return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function isIgnored(source: string): boolean {
  if (source === PRELUDE_SOURCE || source.startsWith('\0') || source.includes('?ctx=')) return true;
  if (/(?:^|[/\\])node_modules[/\\]/.test(source)) return !/[/\\](expo-router[/\\]entry|expo[/\\]AppEntry)/.test(source);
  return false;
}

/**
 * Expo's export map: `/`-relative sources, ignore list, function maps (keyed by absolute path) and `debugId`.
 * `serverRoot`: Metro's server root (the monorepo root, else the project).
 */
export function finalizeMap(
  map: RawMap,
  opts: { projectRoot: string; serverRoot: string; projectRequire: NodeRequire; functionMaps?: Map<string, FunctionMap | null>; debugId?: string }
): RawMap {
  const absolute = map.sources.map((s) => resolveSource(s, opts.projectRoot, opts.projectRequire));
  const sources = absolute.map((s) => (path.isAbsolute(s) ? '/' + path.relative(opts.serverRoot, s).split(path.sep).join('/') : s));
  const out: RawMap = { version: 3, sources, sourcesContent: map.sourcesContent ?? sources.map(() => null), names: map.names, mappings: map.mappings };
  if (opts.functionMaps) out.x_facebook_sources = absolute.map((s) => (opts.functionMaps!.get(s) ? [opts.functionMaps!.get(s)] : null));
  out.x_google_ignoreList = absolute.flatMap((s, i) => (isIgnored(s) ? [i] : []));
  if (opts.debugId) out.debugId = opts.debugId;
  return out;
}

/**
 * Server functions (API routes, middleware, loaders): Expo writes project-relative sources without the `/` and
 * without ignore list / function maps; only plugin namespaces and absolute paths are normalized here.
 */
export function relativeSources(map: RawMap, opts: { projectRoot: string; projectRequire: NodeRequire }): RawMap {
  const sources = map.sources.map((s) => {
    const r = resolveSource(s, opts.projectRoot, opts.projectRequire);
    return path.isAbsolute(r) ? path.relative(opts.projectRoot, r).split(path.sep).join('/') : r;
  });
  return { ...map, sources };
}

/**
 * A development map as Metro's dev server serves it: absolute source paths, `x_facebook_sources` and
 * `x_google_ignoreList` (React Native DevTools hides ignore-listed frames).
 */
export function devClientMap(map: RawMap, opts: { projectRoot: string; projectRequire: NodeRequire; functionMapOf: (file: string) => FunctionMap | null }): RawMap {
  const sources = map.sources.map((s) => resolveSource(s, opts.projectRoot, opts.projectRequire));
  const { ignoreList: _standard, ...rest } = map;
  return {
    ...rest,
    sources,
    x_facebook_sources: sources.map((s) => {
      const fm = path.isAbsolute(s) ? opts.functionMapOf(s) : null;
      return fm ? [fm] : null;
    }),
    x_google_ignoreList: sources.flatMap((s, i) => (isIgnored(s) ? [i] : [])),
  };
}

/** Metro's server root (watch root of a monorepo, else the project root). */
export function serverRootOf(projectRoot: string, projectRequire: NodeRequire): string {
  return projectRequire('@expo/config/paths').getMetroServerRoot(projectRoot);
}

/**
 * Expo: the debug id is derived from the output file name, `<entry>-<md5 of the code without map comments>`
 * (serializeChunks `stringToUUID(basename(outputFile))`).
 */
export function debugIdFor(fileStem: string, projectRequire: NodeRequire): string {
  return projectRequire('@expo/metro-config/build/serializer/debugId').stringToUUID(fileStem);
}

/** Splice `"debugId"` into a finished map JSON (Expo appendDebugIdToSourceMap, for Hermes output). */
export function appendDebugId(mapJson: string, debugId: string): string {
  return mapJson.slice(0, -1) + `,"debugId":${JSON.stringify(debugId)}}`;
}

/**
 * Replace strings in generated code and shift the map's generated columns behind each replacement (renamed chunk
 * file names inside minified one-line chunks).
 */
export function replaceInGenerated(code: string, map: RawMap | null, replacements: Map<string, string>, projectRequire: NodeRequire): { code: string; map: RawMap | null } {
  if (!replacements.size) return { code, map };
  const pattern = new RegExp([...replacements.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g');
  const lines = code.split('\n');
  // per line: [end column of the replaced text in the original line, length delta]
  const shifts: [number, number][][] = [];
  const out = lines.map((line, i) =>
    line.replace(pattern, (match, offset: number) => {
      const next = replacements.get(match)!;
      (shifts[i] ??= []).push([offset + match.length, next.length - match.length]);
      return next;
    })
  );
  if (!map?.mappings || !shifts.length) return { code: out.join('\n'), map };
  const { decode, encode } = projectRequire('@jridgewell/sourcemap-codec');
  const decoded: number[][][] = decode(map.mappings);
  decoded.forEach((segments, i) => {
    const lineShifts = shifts[i];
    if (!lineShifts) return;
    for (const seg of segments) seg[0] += lineShifts.reduce((sum, [end, delta]) => (seg[0] >= end ? sum + delta : sum), 0);
  });
  return { code: out.join('\n'), map: { ...map, mappings: encode(decoded) } };
}
