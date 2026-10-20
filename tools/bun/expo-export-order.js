// Deterministic `expo export` (KNOWN-ISSUES #21): Expo bundles the platforms at once (`Promise.all` over the platforms
// in export/exportApp.js) and, for static web, the server render function together with the client bundle
// (`Promise.all` in export/exportStaticAsync.js). All of them take module IDs from the one numeric ID factory of the
// export's Metro server as modules are resolved and serialized, so the IDs - and with them every bundle and its
// hash - depend on which graph gets there first. That race is Expo's, on Node too. Here the platform bundles and the
// DOM component bundles run one after another in call order (the platforms of the command / app config, then each
// platform's DOM components), and the web client resources wait for the render function of the same export. The
// Hermes engine checks before the platform bundles run in call order too, so a project with ios/ and android/ does not
// reorder the platforms by which native file read finishes first. Runtime-independent: tools/bun/expo-cli.preload.js
// installs it for `expo export` / `export:embed` on Bun; scripts/node-export-order.cjs does the same on Node (the CI
// reference).
// BUN_RN_EXPORT_ORDER=0 keeps Expo's parallel bundling.
'use strict';
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');

/** set while a queued bundle runs: nested bundle calls (nativeExportBundleAsync -> legacySinglePageExportBundleAsync)
 * already hold the queue and run directly - queueing them behind their own caller would deadlock */
const inQueue = new AsyncLocalStorage();

function install(projectRoot) {
  if (process.env.BUN_RN_EXPORT_ORDER === '0') return;
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const { MetroBundlerDevServer } = req('@expo/cli/build/src/start/server/metro/MetroBundlerDevServer');
  if (MetroBundlerDevServer?.prototype) applyExportOrder(MetroBundlerDevServer.prototype);
  // exportApp.js takes the module object when it loads (after this preload); Expo's exports are getters, so the cache
  // entry gets an ordered copy (like tools/bun-bundler/expo-dev-server.ts). A later Expo without the module: skipped.
  let hermesId;
  try {
    hermesId = req.resolve('@expo/cli/build/src/export/exportHermes');
  } catch {
    return;
  }
  const hermes = req(hermesId);
  if (typeof hermes.assertEngineMismatchAsync === 'function' && !hermes.__bunRnOrdered && require.cache[hermesId]) {
    require.cache[hermesId].exports = orderedEngineChecks(hermes);
  }
}

/** export/exportHermes.js with assertEngineMismatchAsync in call order: exportApp awaits it before each Hermes
 * platform's bundle, and it reads android/gradle.properties / ios/Podfile when they exist - in parallel, the
 * platforms would reach the bundle queue in the order those reads finish */
function orderedEngineChecks(hermes) {
  const copy = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(hermes))) {
    if (key !== 'assertEngineMismatchAsync') Object.defineProperty(copy, key, descriptor);
  }
  const check = hermes.assertEngineMismatchAsync;
  let previous = Promise.resolve();
  copy.assertEngineMismatchAsync = function (...args) {
    // the caller's continuation (its bundle call) is registered on `result` before the next check starts
    const result = previous.then(() => check.apply(this, args));
    previous = result.catch(() => {});
    return result;
  };
  Object.defineProperty(copy, '__bunRnOrdered', { value: true });
  return copy;
}

/** Expo's MetroBundlerDevServer prototype: platform and DOM bundles in call order, web client after the render */
function applyExportOrder(proto) {
  if (proto.__bunRnExportOrder) return;
  Object.defineProperty(proto, '__bunRnExportOrder', { value: true });
  // platform bundles and DOM component bundles (`"use dom"`, exported per platform after its bundle): one queue,
  // in call order
  for (const name of ['nativeExportBundleAsync', 'legacySinglePageExportBundleAsync']) {
    const bundle = proto[name];
    if (typeof bundle !== 'function') continue;
    proto[name] = function (...args) {
      if (inQueue.getStore()) return bundle.apply(this, args);
      const run = () => inQueue.run(true, () => bundle.apply(this, args));
      const result = (this.__bunRnBundleQueue ?? Promise.resolve()).then(run, run);
      this.__bunRnBundleQueue = result.catch(() => {});
      return result;
    };
  }
  const render = proto.getStaticRenderFunctionAsync;
  const resources = proto.getStaticResourcesAsync;
  proto.getStaticRenderFunctionAsync = function (...args) {
    const pending = render.apply(this, args);
    this.__bunRnRender = pending;
    return pending;
  };
  proto.getStaticResourcesAsync = async function (...args) {
    // exportStaticAsync calls this first, then the render function in the same array literal: one tick later the
    // render promise exists
    await null;
    const pending = this.__bunRnRender;
    if (pending) await pending.catch(() => {});
    return resources.apply(this, args);
  };
}

module.exports = { install, applyExportOrder, orderedEngineChecks };

