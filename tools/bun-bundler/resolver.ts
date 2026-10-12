// React Native module resolver for the Bun bundler.
//
// Re-implements the resolution Metro performs for an Expo app (metro-resolver `resolve.js`,
// `PackageResolve.js`, `PackageExportsResolve.js` + the Expo CLI resolver layers in
// `@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js`), so the Bun bundler picks
// exactly the files Metro would:
//   - platform extensions: `.ios.ts`, `.native.ts`, `.ts` per source extension (Metro order)
//   - main fields `react-native` > `browser` > `main`, including object replacement maps
//   - package `exports` with conditions `default` + `import|require` + `react-native`
//   - hierarchical `node_modules` lookup, directory `index` files, assets with `@Nx` scales
//   - Expo layers: tsconfig `paths`, `react-native-vector-icons` alias, virtual asset registry,
//     `HMRClient` -> `expo/src/async-require/hmr.ts`
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const NODE_BUILTINS = new Set(builtinModules);

export type Resolution =
  | { type: 'sourceFile'; filePath: string }
  | { type: 'assetFiles'; filePaths: string[] }
  | { type: 'empty' };

export interface ResolverOptions {
  projectRoot: string;
  platform: string;
  sourceExts: string[];
  assetExts: string[];
  mainFields?: string[];
  conditionsByPlatform?: Record<string, string[]>;
  preferNativePlatform?: boolean;
  tsconfigPaths?: { baseUrl: string; paths: Record<string, string[]> } | null;
  aliases?: [RegExp, string][];
  /** exact specifier aliases (Expo web: react-native -> react-native-web, ...) */
  exactAliases?: Record<string, string>;
  /** directory of Expo's node_modules shims (`@expo/cli/static/shims`), applied to resolved files */
  shimsDir?: string | null;
  /** browser bundles: Node.js built-ins resolve to a same-named package if installed, else an empty module (Expo) */
  browserNodeBuiltins?: boolean;
  virtualModules?: Record<string, string>;
}

interface PackageInfo {
  rootPath: string;
  packageJson: any;
}

export class ResolutionError extends Error {}

export const ASSET_REGISTRY_VIRTUAL = '\0polyfill:assets-registry';

export class Resolver {
  readonly opts: Required<Omit<ResolverOptions, 'tsconfigPaths' | 'virtualModules' | 'exactAliases' | 'shimsDir' | 'browserNodeBuiltins'>> &
    Pick<ResolverOptions, 'tsconfigPaths' | 'virtualModules' | 'exactAliases' | 'shimsDir' | 'browserNodeBuiltins'>;
  private assetExts: Set<string>;
  private statCache = new Map<string, 'f' | 'd' | null>();
  private realCache = new Map<string, string>();
  private pkgJsonCache = new Map<string, any>();
  private closestPkgCache = new Map<string, string | null>();

  constructor(options: ResolverOptions) {
    this.opts = {
      mainFields: ['react-native', 'browser', 'main'],
      conditionsByPlatform: { ios: ['react-native'], android: ['react-native'] },
      preferNativePlatform: true,
      aliases: [[/^react-native-vector-icons(\/.*)?/, '@expo/vector-icons$1']],
      ...options,
    };
    this.assetExts = new Set(options.assetExts);
  }

  // ---------------------------------------------------------------- file system (cached)

  private stat(p: string): 'f' | 'd' | null {
    let s = this.statCache.get(p);
    if (s === undefined) {
      try {
        const st = fs.statSync(p);
        s = st.isFile() ? 'f' : st.isDirectory() ? 'd' : null;
      } catch {
        s = null;
      }
      this.statCache.set(p, s);
    }
    return s;
  }

  private realPath(p: string): string {
    let r = this.realCache.get(p);
    if (r === undefined) {
      r = fs.realpathSync(p);
      this.realCache.set(p, r);
    }
    return r;
  }

  private readPackageJson(pkgJsonPath: string): any {
    let pkg = this.pkgJsonCache.get(pkgJsonPath);
    if (pkg === undefined) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      } catch {
        pkg = null;
      }
      this.pkgJsonCache.set(pkgJsonPath, pkg);
    }
    return pkg;
  }

  /**
   * Closest package.json for `absPath` (Metro: getPackageForModule -> TreeFS.hierarchicalLookup):
   * starts at `absPath` itself, walks up, and stops at a `node_modules` segment.
   */
  private getPackageForModule(absPath: string): (PackageInfo & { packageRelativePath: string }) | null {
    let found = this.closestPkgCache.get(absPath);
    if (found === undefined) {
      found = null;
      let dir = absPath;
      for (;;) {
        if (path.basename(dir) === 'node_modules') break;
        const candidate = path.join(dir, 'package.json');
        if (this.stat(candidate) === 'f') {
          found = candidate;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      this.closestPkgCache.set(absPath, found);
    }
    if (!found) return null;
    const rootPath = path.dirname(found);
    return {
      rootPath,
      packageJson: this.readPackageJson(found) ?? {},
      packageRelativePath: path.relative(rootPath, absPath),
    };
  }

  // ---------------------------------------------------------------- public API

  resolve(specifier: string, originModulePath: string, isESMImport: boolean): Resolution {
    const { virtualModules } = this.opts;
    if (virtualModules && specifier in virtualModules) return { type: 'sourceFile', filePath: specifier };

    // Expo: stable config modules
    if (/^@react-native\/assets-registry\/registry(\.js)?$/.test(specifier)) {
      return { type: 'sourceFile', filePath: ASSET_REGISTRY_VIRTUAL };
    }
    if (
      this.opts.platform === 'web' &&
      /node_modules[\\/]react-native-web[\\/]/.test(originModulePath) &&
      specifier.includes('/modules/AssetRegistry')
    ) {
      return { type: 'sourceFile', filePath: ASSET_REGISTRY_VIRTUAL };
    }
    // Expo: Node.js built-ins in browser bundles
    if (this.opts.browserNodeBuiltins && NODE_BUILTINS.has(specifier.replace(/^node:/, ''))) {
      try {
        return this.resolveMetro(specifier, originModulePath, isESMImport);
      } catch {
        return { type: 'empty' };
      }
    }
    // Expo: per-platform exact aliases
    const exact = this.opts.exactAliases?.[specifier];
    if (exact) return this.postRewrite(this.resolveMetro(exact, originModulePath, isESMImport));
    // Expo: tsconfig paths
    const tsResult = this.resolveTsconfigPaths(specifier, originModulePath, isESMImport);
    if (tsResult) return this.postRewrite(tsResult);
    // Expo: universal aliases
    for (const [matcher, alias] of this.opts.aliases) {
      const m = specifier.match(matcher);
      if (m) {
        const aliased = alias.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');
        return this.postRewrite(this.resolveMetro(aliased, originModulePath, isESMImport));
      }
    }
    return this.postRewrite(this.resolveMetro(specifier, originModulePath, isESMImport));
  }

  private postRewrite(result: Resolution): Resolution {
    if (result.type !== 'sourceFile') return result;
    const normalized = result.filePath.replaceAll('\\', '/');
    if (this.opts.shimsDir && normalized.includes('/node_modules/')) {
      const shim = path.join(this.opts.shimsDir, normalized.replace(/.*node_modules\//, ''));
      if (this.stat(shim) === 'f') return { type: 'sourceFile', filePath: shim };
    }
    if (this.opts.platform !== 'web' && normalized.endsWith('/react-native/Libraries/Utilities/HMRClient.js')) {
      return this.resolveMetro('expo/src/async-require/hmr.ts', path.join(this.opts.projectRoot, 'package.json'), false);
    }
    return result;
  }

  private resolveTsconfigPaths(specifier: string, origin: string, isESM: boolean): Resolution | null {
    const ts = this.opts.tsconfigPaths;
    if (!ts || specifier.startsWith('.') || path.isAbsolute(specifier)) return null;
    for (const [pattern, targets] of Object.entries(ts.paths)) {
      const star = pattern.indexOf('*');
      let wildcard: string | null = null;
      if (star === -1) {
        if (pattern !== specifier) continue;
        wildcard = '';
      } else {
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
        wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
      for (const target of targets) {
        const abs = path.resolve(ts.baseUrl, target.replace('*', wildcard));
        const r = this.resolveModulePath(abs, origin);
        if (r) return r;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Metro core

  private resolveMetro(specifier: string, origin: string, isESMImport: boolean): Resolution {
    const ctx = { origin, isESMImport };
    if (isRelativeImport(specifier) || path.isAbsolute(specifier)) {
      const r = this.resolveModulePath(specifier, origin, ctx);
      if (!r) throw new ResolutionError(`Unable to resolve "${specifier}" from "${origin}"`);
      return r;
    }
    const redirected = this.redirectModulePath(specifier, origin);
    if (redirected === false) return { type: 'empty' };
    if (isRelativeImport(redirected) || path.isAbsolute(redirected)) {
      const idx = origin.lastIndexOf('node_modules' + path.sep) + 13;
      const originModuleDir = origin.slice(0, origin.indexOf(path.sep, idx));
      const r = this.resolveModulePath(path.join(originModuleDir, redirected), origin, ctx);
      if (!r) throw new ResolutionError(`Unable to resolve "${specifier}" from "${origin}"`);
      return r;
    }
    const parsed = parseBareSpecifier(redirected);
    let next = path.dirname(origin);
    let candidate: string;
    do {
      candidate = next;
      const nodeModulesPath = candidate.endsWith(path.sep) ? candidate + 'node_modules' : candidate + path.sep + 'node_modules';
      const r = this.resolveFromNodeModulesPath(parsed, nodeModulesPath, ctx);
      if (r) return r;
      next = path.dirname(candidate);
    } while (candidate !== next);
    throw new ResolutionError(`Unable to resolve module "${specifier}" from "${origin}"`);
  }

  private resolveFromNodeModulesPath(parsed: ParsedSpecifier, nodeModulesPath: string, ctx: Ctx): Resolution | null {
    const mustBeDirectory =
      parsed.posixSubpath !== '.' || parsed.packageName.length > parsed.firstPart.length
        ? nodeModulesPath + path.sep + parsed.firstPart
        : nodeModulesPath;
    if (this.stat(mustBeDirectory) !== 'd') return null;
    const targetPath = nodeModulesPath + path.sep + parsed.normalizedSpecifier;
    const candidate = this.redirectModulePath(targetPath, ctx.origin);
    if (candidate === false) return { type: 'empty' };
    return this.resolvePackage(candidate, ctx);
  }

  private resolvePackage(absoluteCandidatePath: string, ctx: Ctx): Resolution | null {
    const pkg = this.getPackageForModule(absoluteCandidatePath);
    const exportsField = pkg?.packageJson.exports;
    if (pkg && exportsField != null) {
      const r = this.resolveFromExports(pkg, absoluteCandidatePath, exportsField, ctx);
      if (r) return r;
    }
    return this.resolveModulePath(absoluteCandidatePath, ctx.origin, ctx);
  }

  private resolveFromExports(
    pkg: PackageInfo & { packageRelativePath: string },
    modulePath: string,
    exportsField: any,
    ctx: Ctx
  ): Resolution | null {
    const subpath = pkg.packageRelativePath === '' ? '.' : './' + pkg.packageRelativePath.split(path.sep).join('/');
    const exportMap = normalizeExportsField(exportsField);
    if (!exportMap) return null;
    // Metro: subpath not listed -> warning + fall back to file-based resolution
    const conditions = new Set([
      'default',
      ctx.isESMImport ? 'import' : 'require',
      ...(this.opts.conditionsByPlatform[this.opts.platform] ?? []),
    ]);
    const reduced = new Map<string, string | null>();
    for (const [key, value] of exportMap) {
      const v = reduceConditionalExport(value, conditions);
      if (v !== 'no-match') reduced.set(key, v);
    }
    let target = reduced.get(subpath);
    let patternMatch: string | null = null;
    if (target == null) {
      const expansionKeys = [...reduced.keys()]
        .map((key) => ({ key, baseLength: key.indexOf('*') }))
        .filter((d) => d.baseLength !== -1)
        .sort((a, b) => (a.baseLength === b.baseLength ? b.key.length - a.key.length : b.baseLength - a.baseLength));
      for (const { key } of expansionKeys) {
        const m = matchSubpathPattern(key, subpath);
        if (m != null) {
          target = reduced.get(key);
          patternMatch = m;
          break;
        }
      }
    }
    if (target == null) {
      // listed but no match for these conditions (or not exported) -> Metro falls back to file resolution
      return null;
    }
    const filePath = path.join(pkg.rootPath, patternMatch != null ? target.replaceAll('*', patternMatch) : target);
    if (this.isAssetFile(filePath)) {
      const asset = this.resolveAsset(filePath);
      if (asset) return asset;
    }
    if (this.stat(filePath) === 'f') return { type: 'sourceFile', filePath: this.realPath(filePath) };
    return null;
  }

  private resolveModulePath(toModuleName: string, origin: string, ctx?: Ctx): Resolution | null {
    const c = ctx ?? { origin, isESMImport: true };
    const modulePath = path.isAbsolute(toModuleName) ? toModuleName : path.join(path.dirname(origin), toModuleName);
    const redirectedPath = this.redirectModulePath(modulePath, origin);
    if (redirectedPath === false) return { type: 'empty' };
    const dirPath = path.dirname(redirectedPath);
    const fileName = path.basename(redirectedPath);
    if (!redirectedPath.endsWith(path.sep)) {
      const fileResult = this.resolveFile(dirPath, fileName, origin);
      if (fileResult) return fileResult;
    }
    return this.resolvePackageEntryPoint(redirectedPath, c);
  }

  private resolvePackageEntryPoint(packagePath: string, ctx: Ctx): Resolution | null {
    if (this.stat(packagePath) !== 'd') return null;
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (this.stat(packageJsonPath) !== 'f') return this.resolveFile(packagePath, 'index', ctx.origin);
    const packageInfo = { rootPath: packagePath, packageJson: this.readPackageJson(packageJsonPath) ?? {} };
    const mainModulePath = path.join(packageInfo.rootPath, this.getPackageEntryPoint(packageInfo));
    const fileResult = this.resolveFile(path.dirname(mainModulePath), path.basename(mainModulePath), ctx.origin);
    if (fileResult) return fileResult;
    return this.resolveFile(mainModulePath, 'index', ctx.origin);
  }

  private getPackageEntryPoint(packageInfo: PackageInfo): string {
    const pkg = packageInfo.packageJson;
    let main = 'index';
    for (const name of this.opts.mainFields) {
      if (typeof pkg[name] === 'string' && pkg[name].length) {
        main = pkg[name];
        break;
      }
    }
    const variants = [main, main.slice(0, 2) === './' ? main.slice(2) : './' + main].flatMap((v) => [
      v,
      v + '.js',
      v + '.json',
      v.replace(/(\.js|\.json)$/, ''),
    ]);
    const replacement = this.matchSubpathFromMainFields(variants, pkg);
    return typeof replacement === 'string' ? replacement : main;
  }

  private resolveFile(dirPath: string, fileName: string, origin: string): Resolution | null {
    const full = path.join(dirPath, fileName);
    if (this.isAssetFile(fileName)) return this.resolveAsset(full);
    const prefix = full;
    const tryExt = (ext: string): Resolution | string | null => {
      const filePath = prefix + ext;
      const redirected = ext !== '' ? this.redirectModulePath(filePath, origin) : filePath;
      if (redirected === false) return { type: 'empty' };
      if (this.stat(redirected) === 'f') return this.realPath(redirected);
      return null;
    };
    const forAllExts = (sourceExt: string, withPlatform: boolean) => {
      if (withPlatform) {
        const r = tryExt(`.${this.opts.platform}${sourceExt}`);
        if (r) return r;
      }
      if (this.opts.preferNativePlatform && sourceExt !== '') {
        const r = tryExt(`.native${sourceExt}`);
        if (r) return r;
      }
      return tryExt(sourceExt);
    };
    let r = forAllExts('', false);
    if (!r) {
      for (const ext of this.opts.sourceExts) {
        r = forAllExts('.' + ext, true);
        if (r) break;
      }
    }
    if (!r) return null;
    return typeof r === 'string' ? { type: 'sourceFile', filePath: r } : r;
  }

  isAssetFile(fileName: string): boolean {
    const ext = path.extname(fileName).slice(1);
    return ext !== '' && this.assetExts.has(ext);
  }

  /** All scale variants of an asset (`img.png`, `img@2x.png`, `img.ios@3x.png`, ...) - Metro: resolveAsset. */
  private resolveAsset(filePath: string): Resolution | null {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext).replace(/@\d+(\.\d+)?x$/, '');
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch {
      return null;
    }
    const re = new RegExp(`^${escapeRe(base)}(\\.(${escapeRe(this.opts.platform)}|native))?(@\\d+(\\.\\d+)?x)?${escapeRe(ext)}$`);
    const files = entries.filter((e) => re.test(e)).map((e) => path.join(dir, e));
    if (!files.length) return null;
    return { type: 'assetFiles', filePaths: files };
  }

  // ---------------------------------------------------------------- package.json redirects (browser / react-native maps)

  private redirectModulePath(modulePath: string, origin: string): string | false {
    const isAbs = path.isAbsolute(modulePath);
    const containing = this.getPackageForModule(isAbs ? modulePath : origin);
    if (!containing) return modulePath;
    let redirected: string | false | null;
    if (modulePath.startsWith('.') || isAbs) {
      const rel = isAbs
        ? containing.packageRelativePath
        : path.join(path.dirname(containing.packageRelativePath), modulePath);
      redirected = this.matchSubpathFromMainFields('./' + rel.split(path.sep).join('/'), containing.packageJson);
      if (typeof redirected === 'string') {
        redirected = path.isAbsolute(redirected) ? path.normalize(redirected) : path.join(containing.rootPath, redirected);
      }
    } else {
      redirected = this.matchSubpathFromMainFields(modulePath, containing.packageJson);
    }
    return redirected != null ? redirected : modulePath;
  }

  private matchSubpathFromMainFields(subpath: string | string[], pkg: any): string | false | null {
    const fieldValues = this.opts.mainFields.map((n) => pkg[n]).filter((v) => v != null && typeof v !== 'string');
    if (!fieldValues.length) return null;
    const replacements = Object.assign({}, ...fieldValues.reverse());
    const variants = Array.isArray(subpath) ? subpath : [subpath, subpath + '.js', subpath + '.json'];
    for (const v of variants) {
      const replacement = replacements[v];
      if (replacement != null) return replacement;
    }
    return null;
  }
}

// ---------------------------------------------------------------- helpers

interface Ctx {
  origin: string;
  isESMImport: boolean;
}

interface ParsedSpecifier {
  firstPart: string;
  normalizedSpecifier: string;
  packageName: string;
  posixSubpath: string;
}

function isRelativeImport(p: string) {
  return /^[.][.]?(?:[/]|$)/.test(p);
}

function parseBareSpecifier(specifier: string): ParsedSpecifier {
  const normalized = path.sep === '/' ? specifier : specifier.replaceAll('\\', '/');
  if (normalized.startsWith('@')) {
    const firstSlash = normalized.indexOf('/');
    const secondSlash = normalized.indexOf('/', firstSlash + 1);
    if (secondSlash === -1) {
      return { firstPart: normalized.slice(0, firstSlash), normalizedSpecifier: normalized, packageName: normalized, posixSubpath: '.' };
    }
    return {
      firstPart: normalized.slice(0, firstSlash),
      normalizedSpecifier: normalized,
      packageName: normalized.slice(0, secondSlash),
      posixSubpath: '.' + normalized.slice(secondSlash),
    };
  }
  const firstSlash = normalized.indexOf('/');
  if (firstSlash === -1) {
    return { firstPart: normalized, normalizedSpecifier: normalized, packageName: normalized, posixSubpath: '.' };
  }
  const packageName = normalized.slice(0, firstSlash);
  return { firstPart: packageName, normalizedSpecifier: normalized, packageName, posixSubpath: '.' + normalized.slice(firstSlash) };
}

const exportsCache = new WeakMap<object, Map<string, any>>();
function normalizeExportsField(exportsField: any): Map<string, any> | null {
  if (typeof exportsField === 'string') return new Map([['.', exportsField]]);
  if (exportsField && typeof exportsField === 'object' && exportsCache.has(exportsField)) return exportsCache.get(exportsField)!;
  let rootValue: any;
  if (Array.isArray(exportsField)) {
    rootValue = exportsField.every((v) => typeof v === 'string') ? exportsField.find((v: string) => v.startsWith('./')) : exportsField[0];
  } else rootValue = exportsField;
  if (rootValue == null || Array.isArray(rootValue)) return null;
  if (typeof rootValue === 'string') return new Map([['.', rootValue]]);
  const keys = Object.keys(rootValue);
  const subpathKeys = keys.filter((k) => k.startsWith('.'));
  const importKeys = keys.filter((k) => k.startsWith('#'));
  let result: Map<string, any>;
  if (importKeys.length + subpathKeys.length === keys.length) {
    result = new Map(
      Object.entries(rootValue).map(([k, v]) => [k, Array.isArray(v) ? v.find((x) => typeof x === 'string' && x.startsWith('./')) ?? null : v])
    );
  } else if (subpathKeys.length !== 0) {
    return null;
  } else {
    result = new Map([['.', rootValue]]);
  }
  exportsCache.set(exportsField, result);
  return result;
}

function reduceConditionalExport(value: any, conditions: Set<string>): string | null | 'no-match' {
  let reduced = value;
  while (reduced != null && typeof reduced !== 'string') {
    let match: any = 'default' in reduced ? 'no-match' : null;
    for (const name in reduced) {
      if (conditions.has(name)) {
        match = reduced[name];
        break;
      }
    }
    reduced = match;
  }
  return reduced;
}

function matchSubpathPattern(pattern: string, subpath: string): string | null {
  const [base, trailer] = pattern.split('*');
  if (subpath.startsWith(base) && (trailer.length === 0 || (subpath.endsWith(trailer) && subpath.length >= pattern.length))) {
    return subpath.substring(base.length, subpath.length - trailer.length);
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
