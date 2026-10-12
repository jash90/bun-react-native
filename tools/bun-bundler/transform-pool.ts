// Pool of Bun Workers running the Expo Babel transform (./transform-worker.ts); Metro uses jest-worker for this.
import type { TransformRequest, TransformResponse } from './transform-worker';

export class TransformPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { req: Omit<TransformRequest, 'id'>; resolve: (r: TransformResponse) => void }[] = [];
  private pending = new Map<number, (r: TransformResponse) => void>();
  private owner = new Map<number, Worker>();
  private nextId = 1;
  private size: number;

  constructor(size: number) {
    this.size = size;
  }

  private start() {
    for (let i = 0; i < this.size; i++) {
      // Bun Workers see the process environment from startup, not later process.env changes (Node workers copy the
      // current process.env): pass it, so production transforms inline EXPO_PUBLIC_* from the loaded .env files
      const w = new Worker(new URL('./transform-worker.ts', import.meta.url).href, { env: { ...process.env } as Record<string, string> });
      const failOwned = (error: string) => {
        // a crashed/exited worker must not leave callers waiting forever
        for (const [id, done] of this.pending) {
          if (this.owner.get(id) === w) {
            this.pending.delete(id);
            this.owner.delete(id);
            done({ id, error });
          }
        }
      };
      w.onerror = (e: ErrorEvent) => failOwned(`transform worker crashed: ${e.message}`);
      w.addEventListener('close', () => {
        failOwned('transform worker exited unexpectedly');
        this.idle = this.idle.filter((x) => x !== w);
      });
      w.onmessage = (e: MessageEvent<TransformResponse>) => {
        this.owner.delete(e.data.id);
        const done = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        done?.(e.data);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  run(req: Omit<TransformRequest, 'id'>): Promise<TransformResponse> {
    if (!this.workers.length) this.start(); // lazily: a fully cached build never spawns workers
    return new Promise((resolve) => {
      this.queue.push({ req, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, job.resolve);
      this.owner.set(id, w);
      w.postMessage({ ...job.req, id });
    }
  }

  close() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}
