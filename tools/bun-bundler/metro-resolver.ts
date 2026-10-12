// Metro's module resolution for the Bun bundler (metro-resolver `resolve.js`, `PackageResolve.js`,
// `PackageExportsResolve.js`, `resolveAsset.js`): platform extensions per source extension (`.ios.ts`, `.native.ts`,
// `.ts`), main fields with object replacement maps (`react-native` > `browser` > `main`), package `exports` /
// conditions, hierarchical `node_modules` lookup, directory `index` files and assets with `@Nx` scales.
// The Expo CLI layers on top of it are ./resolver.ts.
import fs from 'node:fs';
import path from 'node:path';

import type { ResolverOptions, Resolution } from './resolver';

/** metro-config defaults: `resolver.assetResolutions` */
const ASSET_RESOLUTIONS = ['1', '1.5', '2', '3', '4'];

export class ResolutionError extends Error {}

export interface PackageInfo {
  rootPath: string;
  packageJson: any;
}

export type OptionalOpts = 'tsconfigPaths' | 'virtualModules' | 'exactAliases' | 'shimsDir' | 'browserNodeBuiltins' | 'dev' | 'server' | 'autolinking' | 'reactNativeHostPackage' | 'platformExtensions' | 'env';

export class MetroResolver {
  readonly opts: Required<Omit<ResolverOptions, OptionalOpts>> & Pick<ResolverOptions, OptionalOpts>;
  protected assetExts: Set<string>;
  protected statCache = new Map<string, 'f' | 'd' | null>();
  protected realCache = new Map<string, string>();
  protected pkgJsonCache = new Map<string, any>();
  protected closestPkgCache = new Map<string, string | null>();

  constructor(options: ResolverOptions) {
    this.opts = {
      mainFields: ['react-native', 'browser', 'main'],
      conditionsByPlatform: { ios: ['react-native'], android: ['react-native'], tvos: ['react-native'], macos: ['react-native'] },
      preferNativePlatform: true,
      aliases: [[/^react-native-vector-icons(\/.*)?/, '@expo/vector-icons$1']],
      ...options,
    };
    this.assetExts = new Set(options.assetExts);
  }

  // ---------------------------------------------------------------- file system (cached)

  protected stat(p: string): 'f' | 'd' | null {
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

  protected realPath(p: string): string {
    let r = this.realCache.get(p);
    if (r === undefined) {
      r = fs.realpathSync(p);
      this.realCache.set(p, r);
    }
    return r;
  }

  protected readPackageJson(pkgJsonPath: string): any {
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
  protected getPackageForModule(absPath: string): (PackageInfo & { packageRelativePath: string }) | null {
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

  // ---------------------------------------------------------------- Metro core

  protected resolveMetro(specifier: string, origin: string, isESMImport: boolean): Resolution {
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

  protected resolveFromNodeModulesPath(parsed: ParsedSpecifier, nodeModulesPath: string, ctx: Ctx): Resolution | null {
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

  protected resolvePackage(absoluteCandidatePath: string, ctx: Ctx): Resolution | null {
    const pkg = this.getPackageForModule(absoluteCandidatePath);
    const exportsField = pkg?.packageJson.exports;
    if (pkg && exportsField != null) {
      const r = this.resolveFromExports(pkg, absoluteCandidatePath, exportsField, ctx);
      if (r) return r;
    }
    return this.resolveModulePath(absoluteCandidatePath, ctx.origin, ctx);
  }

  protected resolveFromExports(
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

  protected resolveModulePath(toModuleName: string, origin: string, ctx?: Ctx): Resolution | null {
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

  protected resolvePackageEntryPoint(packagePath: string, ctx: Ctx): Resolution | null {
    if (this.stat(packagePath) !== 'd') return null;
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (this.stat(packageJsonPath) !== 'f') return this.resolveFile(packagePath, 'index', ctx.origin);
    const packageInfo = { rootPath: packagePath, packageJson: this.readPackageJson(packageJsonPath) ?? {} };
    const mainModulePath = path.join(packageInfo.rootPath, this.getPackageEntryPoint(packageInfo));
    const fileResult = this.resolveFile(path.dirname(mainModulePath), path.basename(mainModulePath), ctx.origin);
    if (fileResult) return fileResult;
    return this.resolveFile(mainModulePath, 'index', ctx.origin);
  }

  protected getPackageEntryPoint(packageInfo: PackageInfo): string {
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

  protected resolveFile(dirPath: string, fileName: string, origin: string): Resolution | null {
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
    const platformExts = this.opts.platformExtensions;
    if (!r && platformExts) {
      // @expo/config getExtensions: every `.<platform>.<ext>` per platform in order, then the plain extensions
      for (const ext of [...platformExts.flatMap((p) => this.opts.sourceExts.map((e) => `.${p}.${e}`)), ...this.opts.sourceExts.map((e) => `.${e}`)]) {
        r = tryExt(ext);
        if (r) break;
      }
    } else if (!r) {
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

  /**
   * metro-resolver resolveAsset + DependencyGraph.resolveAsset: the asset exists when `img.png` or one of the
   * `img@<assetResolutions>x.png` variants exists (a scaled specifier itself does not resolve). Which files and
   * scales belong to it (platform variants `img@2x.ios.png` included) is decided by getAssetData (./assets.ts).
   */
  protected resolveAsset(filePath: string): Resolution | null {
    const ext = path.extname(filePath);
    const base = path.join(path.dirname(filePath), path.basename(filePath, ext));
    if (/@\d+(?:\.\d+)?x$/.test(base)) return null;
    const files = [base + ext, ...ASSET_RESOLUTIONS.map((r) => `${base}@${r}x${ext}`)].filter((f) => this.stat(f) === 'f').map((f) => this.realPath(f));
    if (!files.length) return null;
    return { type: 'assetFiles', filePaths: files };
  }

  // ---------------------------------------------------------------- package.json redirects (browser / react-native maps)

  protected redirectModulePath(modulePath: string, origin: string): string | false {
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

  protected matchSubpathFromMainFields(subpath: string | string[], pkg: any): string | false | null {
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

