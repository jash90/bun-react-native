// Module resolver of the Bun bundler: the resolver chain of Expo CLI (`withMetroMultiPlatform` withExtendedResolver,
// createExpoAutolinkingResolver, createExpoFallbackResolver) on top of Metro's resolution (./metro-resolver.ts), so
// the Bun bundler picks exactly the files `expo start` / `expo export` pick:
//   dev mock of production React -> tsconfig `paths` -> Node.js built-ins -> aliases (web: react-native-web,
//   vector icons) -> asset registry / async require -> autolinking ("sticky") resolution -> Metro + post-resolution
//   rewrites (shims, HMRClient, react-navigation, native-only modules, server InitializeCore) -> fallback resolution
//   through `expo` / `expo-router` dependencies.
import path from 'node:path';
import { builtinModules } from 'node:module';

import { MetroResolver, ResolutionError } from './metro-resolver';

export { ResolutionError } from './metro-resolver';

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
  /** development bundle: production React builds resolve to empty modules (Expo requestDevMockProdReact) */
  dev?: boolean;
  /** server bundle (environment `node`): Node.js resolution (Expo widens it for server environments) */
  server?: boolean;
  /**
   * Expo autolinking module resolution ("sticky" dependencies resolved from the app's autolinked copies;
   * enabled for monorepos, tvOS/macOS or `experiments.autolinkingModuleResolution`), per platform
   */
  autolinking?: Record<string, { moduleTestRe: RegExp; resolvedModulePaths: Record<string, string>; moduleNameRewrites: Record<string, string> }> | null;
  /** package hosting React Native for the platform (`react-native`, `react-native-tvos`, `react-native-macos`) */
  reactNativeHostPackage?: string;
  /**
   * out-of-tree platforms (tvOS, macOS): platform-less resolution through these platform extensions in order, e.g.
   * ['tvos', 'ios', 'native'] (Expo `resolveWithPlatformExtensions`, @expo/config PLATFORM_EXTENSIONS)
   */
  platformExtensions?: string[];
  /** Expo CLI environment switches (EXPO_UNSTABLE_WEB_MODAL, EXPO_ROUTER_DISABLE_NATIVE_TABS_MD, ...) */
  env?: Record<string, string | undefined>;
}

type Layer = (specifier: string, origin: string, isESM: boolean) => Resolution | null;

const isFileSpecifier = (s: string) => /^[\\/]|^\.\.?(?:$|[\\/])/i.test(s);
const dependenciesToRegex = (deps: string[]) => new RegExp(`^(?:${deps.join('|')})(?:$|/)`);
/** @expo/cli createExpoFallbackResolver EXCLUDE_ORIGIN_MODULES */
const EXCLUDE_ORIGIN_MODULES = new Set(['@expo/config', '@expo/config-plugins', 'schema-utils', 'semver']);

export const ASSET_REGISTRY_VIRTUAL = '\0polyfill:assets-registry';

export class Resolver extends MetroResolver {
  // ---------------------------------------------------------------- public API

  /**
   * The resolver chain of Expo CLI (withMetroMultiPlatform `withExtendedResolver`), in its order. Each layer returns a
   * resolution or null; a layer failing to resolve passes on to the next one; the last resort is Metro itself.
   */
  resolve(specifier: string, originModulePath: string, isESMImport: boolean): Resolution {
    const { virtualModules } = this.opts;
    if (virtualModules && specifier in virtualModules) return { type: 'sourceFile', filePath: specifier };
    const layers: Layer[] = [
      (s, o) => this.requestDevMockProdReact(s, o),
      (s, o, e) => this.resolveTsconfigPaths(s, o, e),
      (s, o, e) => this.requestNodeExternals(s, o, e),
      (s, o, e) => this.requestAlias(s, o, e),
      (s, o) => this.requestStableConfigModules(s, o),
      (s, o, e) => this.requestStickyModule(s, o, e),
      (s, o, e) => this.requestPostRewrites(s, o, e),
      (s, o, e) => this.requestFallbackModule(s, o, e),
    ];
    for (const layer of layers) {
      try {
        const r = layer(specifier, originModulePath, isESMImport);
        if (r) return r;
      } catch (e) {
        if (!(e instanceof ResolutionError)) throw e;
      }
    }
    return this.resolveMetro(specifier, originModulePath, isESMImport);
  }

  private get env() {
    return this.opts.env ?? process.env;
  }

  private get hostPackage() {
    return this.opts.reactNativeHostPackage ?? 'react-native';
  }

  /** development: production React builds are never bundled (Expo requestDevMockProdReact) */
  private requestDevMockProdReact(specifier: string, origin: string): Resolution | null {
    if (!this.opts.dev) return null;
    const host = new RegExp(`[\\\\/]node_modules[\\\\/]${this.hostPackage}[\\\\/]`);
    if (
      (this.opts.platform !== 'web' && host.test(origin) && /([\\/]ReactFabric|ReactNativeRenderer)-prod/.test(specifier)) ||
      (/\.production(\.min)?\.js$/.test(specifier) && /[\\/]node_modules[\\/](react[-\\/]|scheduler[\\/])/.test(origin))
    ) {
      return { type: 'empty' };
    }
    return null;
  }

  /** Node.js built-ins: browsers get a same-named package or an empty module; servers keep them external */
  private requestNodeExternals(specifier: string, origin: string, isESM: boolean): Resolution | null {
    if (!this.opts.browserNodeBuiltins || !NODE_BUILTINS.has(specifier.replace(/^node:/, ''))) return null;
    try {
      return this.resolveMetro(specifier, origin, isESM);
    } catch {
      return { type: 'empty' };
    }
  }

  /** per-platform exact aliases (web: react-native -> react-native-web) and universal aliases (vector icons) */
  private requestAlias(specifier: string, origin: string, isESM: boolean): Resolution | null {
    const exact = this.opts.exactAliases?.[specifier];
    if (exact) return this.resolveMetro(exact, origin, isESM);
    for (const [matcher, alias] of this.opts.aliases) {
      const m = specifier.match(matcher);
      if (m) return this.resolveMetro(alias.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? ''), origin, isESM);
    }
    return null;
  }

  /** asset registry (virtual), Expo's async require module (from the project root) */
  private requestStableConfigModules(specifier: string, origin: string): Resolution | null {
    if (specifier === 'expo/internal/async-require-module') {
      return this.resolveMetro(specifier, path.join(this.opts.projectRoot, 'package.json'), false);
    }
    if (/^@react-native\/assets-registry\/registry(\.js)?$/.test(specifier)) return { type: 'sourceFile', filePath: ASSET_REGISTRY_VIRTUAL };
    if (this.opts.platform === 'web' && /node_modules[\\/]react-native-web[\\/]/.test(origin) && specifier.includes('/modules/AssetRegistry')) {
      return { type: 'sourceFile', filePath: ASSET_REGISTRY_VIRTUAL };
    }
    return null;
  }

  /** Expo autolinking module resolution: sticky dependencies from their autolinked location */
  private requestStickyModule(specifier: string, _origin: string, isESM: boolean): Resolution | null {
    const description = this.opts.autolinking?.[this.opts.platform];
    if (!description || isFileSpecifier(specifier)) return null;
    const m = description.moduleTestRe.exec(specifier);
    if (!m) return null;
    const rewrite = description.moduleNameRewrites?.[m[1]];
    const name = rewrite != null ? rewrite + m[2] : specifier;
    const from = description.resolvedModulePaths[rewrite ?? m[1]] || name;
    return this.resolveMetro(name, path.join(from, 'package.json'), isESM);
  }

  /** Metro's resolution + Expo's post-resolution rewrites */
  private requestPostRewrites(specifier: string, origin: string, isESM: boolean): Resolution | null {
    const result = this.resolveMetro(specifier, origin, isESM);
    if (result.type !== 'sourceFile') return result;
    const normalized = result.filePath.replaceAll('\\', '/');
    const fromRoot = (name: string) => this.resolveMetro(name, path.join(this.opts.projectRoot, 'package.json'), false);
    const replace = (from: string, to: string | undefined): Resolution | undefined => {
      if (!normalized.endsWith(from)) return undefined;
      if (to === undefined) return { type: 'empty' };
      try {
        return fromRoot(to);
      } catch {
        return undefined;
      }
    };
    const env = this.env;
    const truthy = (v?: string) => !!v && !/^(0|false)$/i.test(v);
    if (truthy(env.EXPO_UNSTABLE_WEB_MODAL)) {
      const r = replace('expo-router/build/layouts/_web-modal.js', 'expo-router/build/layouts/ExperimentalModalStack.js');
      if (r) return r;
    }
    if (truthy(env.EXPO_ROUTER_DISABLE_NATIVE_TABS_MD) && this.opts.platform === 'android') {
      const r = replace('expo-router/build/native-tabs/utils/materialIconConverter.android.js', 'expo-router/build/native-tabs/utils/materialIconConverter-not-implemented.js');
      if (r) return r;
    }
    if (!truthy(env.EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK) && this.expoRouterInstalled() && specifier.startsWith('@react-navigation/')) {
      if (!origin.includes('node_modules')) {
        throw new Error(
          specifier === '@react-navigation/native-stack' || specifier === '@react-navigation/drawer'
            ? `As of SDK 56, expo-router is no longer compatible with react-navigation.\n\nInstead of ${specifier}, use Stack or Drawer from expo-router instead:\n\n  import { Stack } from 'expo-router';\n  import { Drawer } from 'expo-router/drawer';\n\nFor more information, see https://docs.expo.dev/router/migrate/sdk-55-to-56/.\nYou can disable this check by setting the environment variable EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1.`
            : 'As of SDK 56, expo-router is no longer compatible with react-navigation. For more information, see https://docs.expo.dev/router/migrate/sdk-55-to-56/. You can disable this check by setting the environment variable EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1.'
        );
      }
      if (specifier === '@react-navigation/core') return fromRoot('expo-router/react-navigation');
    }
    if (this.opts.platform === 'web') {
      if (result.filePath.includes('node_modules')) {
        const nativeOnly = ['react-native/Libraries/ReactPrivate/ReactNativePrivateInitializeCore', 'react-native/Libraries/Utilities/codegenNativeCommands', 'react-native/Libraries/Utilities/codegenNativeComponent'];
        if (nativeOnly.some((m) => specifier.includes(m))) {
          throw new Error(`Importing native-only module "${specifier}" on web from: ${path.relative(this.opts.projectRoot, origin)}`);
        }
        if (this.opts.shimsDir) {
          const shim = path.join(this.opts.shimsDir, normalized.replace(/.*node_modules\//, ''));
          if (this.stat(shim) === 'f') return { type: 'sourceFile', filePath: shim };
        }
      }
    } else {
      const host = this.hostPackage;
      if (this.opts.server) {
        const r = replace(`${host}/Libraries/Core/InitializeCore.js`, undefined);
        if (r) return r;
      }
      if (normalized.endsWith(`${host}/Libraries/Utilities/HMRClient.js`)) return fromRoot('expo/src/async-require/hmr.ts');
      if (truthy(env.EXPO_UNSTABLE_LOG_BOX)) {
        const r =
          replace(`${host}/Libraries/LogBox/LogBoxInspectorContainer.js`, '@expo/log-box/swap-rn-logbox.js') ??
          replace(`${host}/Libraries/LogBox/Data/parseLogBoxLog.js`, '@expo/log-box/swap-rn-logbox-parser.js');
        if (r) return r;
      }
    }
    return result;
  }

  private fallbackDescriptions = new Map<string, { originModulePath: string; moduleTestRe: RegExp } | null>();

  /** Expo createFallbackModuleResolver: dependencies of `expo` / `expo-router` resolve from those packages */
  private requestFallbackModule(specifier: string, origin: string, isESM: boolean): Resolution | null {
    const root = this.opts.projectRoot;
    if (specifier === '../../App') {
      if (!/[/\\]node_modules[/\\]expo[/\\]AppEntry\.js$/.test(origin)) return null;
      return this.resolveMetro('./App', path.join(root, 'index.js'), isESM);
    }
    if (isFileSpecifier(specifier)) return null;
    for (const originModule of ['expo', 'expo-router']) {
      let d = this.fallbackDescriptions.get(originModule);
      if (d === undefined) {
        d = null;
        try {
          const r = this.resolveMetro(`${originModule}/package.json`, path.join(root, 'package.json'), false);
          if (r.type === 'sourceFile') {
            const pkg = this.readPackageJson(r.filePath);
            const peers = Object.keys(pkg.peerDependencies ?? {}).filter((n) => {
              const meta = pkg.peerDependenciesMeta;
              return !meta || (meta[n] && typeof meta[n] === 'object' && meta[n].optional === true);
            });
            const deps = [...Object.keys(pkg.dependencies ?? {}), ...(pkg.peerDependenciesMeta ? peers : Object.keys(pkg.peerDependencies ?? {}))].filter(
              (n, i, all) => !EXCLUDE_ORIGIN_MODULES.has(n) && all.indexOf(n) === i
            );
            if (deps.length) d = { originModulePath: path.dirname(r.filePath), moduleTestRe: dependenciesToRegex(deps) };
          }
        } catch {}
        this.fallbackDescriptions.set(originModule, d);
      }
      if (d && d.moduleTestRe.test(specifier)) return this.resolveMetro(specifier, path.join(d.originModulePath, 'index.js'), isESM);
    }
    return null;
  }

  private _expoRouter: boolean | undefined;
  private expoRouterInstalled() {
    if (this._expoRouter === undefined) {
      try {
        this.resolveMetro('expo-router/package.json', path.join(this.opts.projectRoot, 'package.json'), false);
        this._expoRouter = true;
      } catch {
        this._expoRouter = false;
      }
    }
    return this._expoRouter;
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
}
