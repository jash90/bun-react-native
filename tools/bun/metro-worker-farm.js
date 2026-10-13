// Metro's transform WorkerFarm on Bun worker threads (metro/src/DeltaBundler/WorkerFarm.js, same interface).
// Metro forks jest-worker child processes (each a full Bun process loading Babel and the Expo transformer);
// worker_threads share one process, start faster and pass results by structured clone. Bun does not apply
// bunfig `preload` to worker threads (oven-sh/bun#44947), so each thread loads tools/bun/node-compat.preload.js
// itself, then runs Metro's own Worker.js - transforms, cache keys and results are Metro's.
//
// Installed by tools/bun-bundler/metro-on-bun.ts: Transformer.js reads `require('./WorkerFarm').default` when Metro creates the
// bundler, so replacing that export before then is enough. Opt-in: METRO_BUN_WORKERS=threads (the default is Metro's
// jest-worker processes, which load the bunfig preload - tools/bun-bundler/metro-on-bun.ts).
'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER = path.join(__dirname, 'metro-worker-farm.worker.js');
/** transforms queued in a thread at once: one running, one ready to start */
const MAX_IN_FLIGHT = 2;

/** Replace Metro's WorkerFarm in Expo CLI's Metro and in the project's `metro`, when they are different copies */
function install(projectRoot) {
  const { expoMetroDir } = require('./metro-require');
  const appMetro = path.dirname(require.resolve('metro/package.json', { paths: [projectRoot] }));
  for (const dir of new Set([expoMetroDir(projectRoot), appMetro])) installIn(dir);
}

function installIn(metroDir) {
  const metroFarm = require(path.join(metroDir, 'src', 'DeltaBundler', 'WorkerFarm.js'));
  if (metroFarm.default.isBunWorkerFarm) return;
  const MetroWorkerFarm = metroFarm.default;
  // the thread runs the Worker.js of the same Metro copy
  const workerPath = path.join(metroDir, 'src', 'DeltaBundler', 'Worker.js');

  // Not `extends`: Metro's constructor resolves and requires its Worker.js in this thread (maxWorkers 1) or forks
  // jest-worker - neither is used here. The prototype still provides Metro's error formatting (_formatBabelError,
  // _formatGenericError).
  class BunWorkerFarm {
    static isBunWorkerFarm = true;

    constructor(config, transformerConfig) {
      this._config = config;
      this._transformerConfig = transformerConfig;
      this._threads = [];
      this._queue = [];
      this._calls = new Map();
      this._nextId = 0;
      this._sticky = new Map();
      this._size = Math.max(1, config.maxWorkers);
    }

    _start() {
      for (let i = 0; i < this._size; i++) {
        const thread = new Worker(WORKER, { env: { ...process.env, FORCE_COLOR: '1' } });
        thread.unref();
        thread.busy = 0;
        thread.on('message', ({ id, result, error }) => {
          const call = this._calls.get(id);
          this._calls.delete(id);
          thread.busy--;
          if (!thread.busy) thread.unref();
          this._drain();
          if (error) call.reject(toError(error));
          else call.resolve(result);
        });
        thread.on('error', (error) => {
          for (const [id, call] of this._calls) if (call.thread === thread) (this._calls.delete(id), call.reject(error));
        });
        this._threads.push(thread);
      }
    }

    _drain() {
      while (this._queue.length) {
        // like jest-worker's computeWorkerKey (stickyWorkers, Metro's default): a file goes back to the thread that
        // transformed it before (warm Babel caches) unless that thread is saturated; otherwise the least busy one
        const job = this._queue[0];
        const sticky = this._config.stickyWorkers ? this._sticky.get(job.filename) : undefined;
        const thread = sticky && sticky.busy < MAX_IN_FLIGHT ? sticky : this._threads.reduce((a, b) => (b.busy < a.busy ? b : a));
        if (thread.busy >= MAX_IN_FLIGHT) return;
        this._queue.shift();
        if (this._config.stickyWorkers) this._sticky.set(job.filename, thread);
        thread.busy++;
        thread.ref();
        this._calls.set(job.id, { ...job, thread });
        thread.postMessage({ id: job.id, args: job.args, workerPath });
      }
    }

    async transform(filename, options, fileBuffer) {
      if (!this._threads.length) this._start();
      try {
        const data = await new Promise((resolve, reject) => {
          this._queue.push({ id: this._nextId++, filename, resolve, reject, args: [filename, options, this._config.projectRoot, this._transformerConfig, fileBuffer] });
          this._drain();
        });
        return { result: data.result, sha1: data.sha1 };
      } catch (err) {
        throw err.loc ? this._formatBabelError(err, filename) : this._formatGenericError(err, filename);
      }
    }

    async kill() {
      await Promise.all(this._threads.map((t) => t.terminate()));
      this._threads = [];
    }
  }

  Object.setPrototypeOf(BunWorkerFarm.prototype, MetroWorkerFarm.prototype);
  metroFarm.default = BunWorkerFarm;
}

/** jest-worker's ChildProcessWorker: the native constructor of that name, `type` = its name, stack, own properties */
function toError({ ctor, message, stack, extra }) {
  const Ctor = typeof globalThis[ctor] === 'function' ? globalThis[ctor] : Error;
  const error = new Ctor(message);
  error.type = ctor;
  error.stack = stack;
  Object.assign(error, extra);
  return error;
}

module.exports = { install };
