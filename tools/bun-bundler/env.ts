// `.env` files the way Expo CLI loads them (`@expo/cli/build/src/utils/nodeEnv` + `@expo/env`): the mode comes from
// the command (`--dev`), so a release `export:embed` reads `.env.production`, not `.env.development`, and variables
// from the shell win over the files. Bun's own automatic `.env` loading picks the mode from NODE_ENV at process start
// and would make those values look like shell variables - it is disabled (`env = false` in bunfig.toml, and
// `--no-env-file` in tools/bin/node, the way native builds start the CLI).
import { expoHelpers } from './expo-helpers';

type Mode = 'development' | 'production';

function nodeEnv(projectRoot: string) {
  return expoHelpers(projectRoot).req('@expo/cli/build/src/utils/nodeEnv') as {
    setNodeEnv(mode: Mode): void;
    loadEnvFiles(projectRoot: string, options?: { silent?: boolean }): void;
    reloadEnvFiles(projectRoot: string): void;
    getEnvFiles(projectRoot: string): string[];
  };
}

/**
 * `expo start` / `expo export:embed`: NODE_ENV defaults to the mode (an existing NODE_ENV is kept, Expo's
 * setNodeEnv); `force` = `expo export`, which overrides NODE_ENV.
 */
export function loadProjectEnv(projectRoot: string, mode: Mode, opts: { force?: boolean } = {}) {
  const env = nodeEnv(projectRoot);
  if (opts.force) process.env.NODE_ENV = mode;
  env.setNodeEnv(mode);
  env.loadEnvFiles(projectRoot);
}

/** Absolute paths of the env files Expo reads for the current NODE_ENV (watched by the dev server). */
export function projectEnvFiles(projectRoot: string): string[] {
  return nodeEnv(projectRoot).getEnvFiles(projectRoot);
}

/** Dev server: re-read the files after one changed (Expo's watchEnvironmentVariables -> reloadEnvFiles). */
export function reloadProjectEnv(projectRoot: string) {
  nodeEnv(projectRoot).reloadEnvFiles(projectRoot);
}
