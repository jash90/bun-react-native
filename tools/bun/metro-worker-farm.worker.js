// A transform thread of tools/bun/metro-worker-farm.js: Node-compat shims (bunfig preload does not reach worker
// threads), then Metro's own DeltaBundler/Worker.js `transform`.
'use strict';
require('./node-compat.preload.js');
const { parentPort } = require('node:worker_threads');

let worker;

parentPort.on('message', async ({ id, args }) => {
  try {
    worker ??= require(require.resolve('metro/private/DeltaBundler/Worker', { paths: [args[2]] }));
    parentPort.postMessage({ id, result: await worker.transform(...args) });
  } catch (err) {
    // like jest-worker's processChild.reportError: constructor name, message, stack and own properties (loc,
    // codeFrame, ...), which structured clone of an Error would drop
    const error = err ?? new Error('"null" or "undefined" thrown');
    const extra = {};
    if (typeof error === 'object') {
      for (const key of Object.keys(error)) {
        try {
          extra[key] = structuredClone(error[key]);
        } catch {}
      }
    }
    parentPort.postMessage({ id, error: { ctor: error.constructor?.name, message: error.message, stack: error.stack, extra } });
  }
});
