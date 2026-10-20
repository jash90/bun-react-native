// bun test - the fixed bundling order of `expo export` (KNOWN-ISSUES #21), on a stand-in for Expo's dev server
import { expect, test } from 'bun:test';

const { applyExportOrder, orderedEngineChecks } = require('./expo-export-order.js');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function server(log: string[]) {
  class DevServer {
    // like Expo: each call bundles for a while; the slow platform is first
    async nativeExportBundleAsync(_exp: unknown, { platform }: { platform: string }) {
      log.push(`start ${platform}`);
      await sleep(platform === 'ios' ? 30 : 5);
      log.push(`end ${platform}`);
      return platform;
    }
    async getStaticResourcesAsync() {
      log.push('start client');
      await sleep(5);
      log.push('end client');
      return 'resources';
    }
    async getStaticRenderFunctionAsync() {
      log.push('start render');
      await sleep(30);
      log.push('end render');
      return 'render';
    }
  }
  applyExportOrder(DevServer.prototype);
  return new DevServer();
}

test('platform bundles run one after another in call order', async () => {
  const log: string[] = [];
  const dev = server(log);
  const results = await Promise.all(['ios', 'android', 'web'].map((platform) => dev.nativeExportBundleAsync({}, { platform })));
  expect(results).toEqual(['ios', 'android', 'web']);
  expect(log).toEqual(['start ios', 'end ios', 'start android', 'end android', 'start web', 'end web']);
});

test('DOM component bundles share the queue with the platform bundles', async () => {
  const log: string[] = [];
  class DevServer {
    async nativeExportBundleAsync(_exp: unknown, { platform }: { platform: string }) {
      log.push(`start ${platform}`);
      await sleep(platform === 'ios' ? 20 : 5);
      log.push(`end ${platform}`);
    }
    async legacySinglePageExportBundleAsync({ dom }: { dom: string }) {
      log.push(`start ${dom}`);
      await sleep(dom === 'dom-a' ? 20 : 5);
      log.push(`end ${dom}`);
    }
    getStaticResourcesAsync() {}
    getStaticRenderFunctionAsync() {}
  }
  applyExportOrder(DevServer.prototype);
  const dev = new DevServer();
  // like exportApp: each platform bundles, then exports its DOM components with Promise.all
  await Promise.all(
    ['ios', 'android'].map(async (platform) => {
      await dev.nativeExportBundleAsync({}, { platform });
      await Promise.all(['dom-a', 'dom-b'].map((dom) => dev.legacySinglePageExportBundleAsync({ dom: `${dom}` })));
    }),
  );
  expect(log).toEqual([
    'start ios', 'end ios', 'start android', 'end android',
    'start dom-a', 'end dom-a', 'start dom-b', 'end dom-b',
    'start dom-a', 'end dom-a', 'start dom-b', 'end dom-b',
  ]);
});

test('a bundle that calls another queued bundle method runs it directly (Expo: native -> legacySinglePage)', async () => {
  const log: string[] = [];
  class DevServer {
    async nativeExportBundleAsync(_exp: unknown, { platform }: { platform: string }) {
      log.push(`start ${platform}`);
      const inner = await this.legacySinglePageExportBundleAsync({ dom: `${platform}-inner` });
      log.push(`end ${platform}`);
      return inner;
    }
    async legacySinglePageExportBundleAsync({ dom }: { dom: string }) {
      await sleep(5);
      log.push(dom);
      return dom;
    }
    getStaticResourcesAsync() {}
    getStaticRenderFunctionAsync() {}
  }
  applyExportOrder(DevServer.prototype);
  const dev = new DevServer();
  const timeout = sleep(1000).then(() => 'deadlock');
  const result = await Promise.race([Promise.all(['ios', 'android'].map((platform) => dev.nativeExportBundleAsync({}, { platform }))), timeout]);
  expect(result).toEqual(['ios-inner', 'android-inner']);
  expect(log).toEqual(['start ios', 'ios-inner', 'end ios', 'start android', 'android-inner', 'end android']);
});

test('a failing platform bundle does not stop the next one', async () => {
  const log: string[] = [];
  class DevServer {
    async nativeExportBundleAsync(_exp: unknown, { platform }: { platform: string }) {
      log.push(`start ${platform}`);
      await sleep(5);
      if (platform === 'ios') throw new Error('ios failed');
      log.push(`end ${platform}`);
      return platform;
    }
    getStaticResourcesAsync() {}
    getStaticRenderFunctionAsync() {}
  }
  applyExportOrder(DevServer.prototype);
  const dev = new DevServer();
  const [ios, android] = await Promise.allSettled([dev.nativeExportBundleAsync({}, { platform: 'ios' }), dev.nativeExportBundleAsync({}, { platform: 'android' })]);
  expect(ios.status).toBe('rejected');
  expect(android).toEqual({ status: 'fulfilled', value: 'android' });
  expect(log).toEqual(['start ios', 'start android', 'end android']);
});

test('the web client bundle waits for the render function started in the same tick (exportStaticAsync order)', async () => {
  const log: string[] = [];
  const dev = server(log);
  const [resources, render] = await Promise.all([dev.getStaticResourcesAsync(), dev.getStaticRenderFunctionAsync()]);
  expect([resources, render]).toEqual(['resources', 'render']);
  expect(log).toEqual(['start render', 'end render', 'start client', 'end client']);
});

test('installing twice does not wrap twice', () => {
  class DevServer {
    nativeExportBundleAsync() {}
    getStaticResourcesAsync() {}
    getStaticRenderFunctionAsync() {}
  }
  applyExportOrder(DevServer.prototype);
  const wrapped = DevServer.prototype.nativeExportBundleAsync;
  applyExportOrder(DevServer.prototype);
  expect(DevServer.prototype.nativeExportBundleAsync).toBe(wrapped);
});

test('Hermes engine checks in call order: the platforms reach the bundle queue in platform order', async () => {
  const log: string[] = [];
  const dev = server(log);
  // with ios/ and android/ the checks read a native file each; here the first platform's read is the slow one
  const hermes = orderedEngineChecks({
    async assertEngineMismatchAsync(_root: string, _exp: unknown, platform: string) {
      await sleep(platform === 'ios' ? 30 : 1);
    },
    get isEnableHermesManaged() {
      return () => true;
    },
  });
  // like export/exportApp.js
  await Promise.all(
    ['ios', 'android'].map(async (platform) => {
      await hermes.assertEngineMismatchAsync('/app', {}, platform);
      return dev.nativeExportBundleAsync({}, { platform });
    }),
  );
  expect(log).toEqual(['start ios', 'end ios', 'start android', 'end android']);
  expect(hermes.isEnableHermesManaged()).toBe(true);
});

test('a failing engine check rejects its own caller only', async () => {
  const hermes = orderedEngineChecks({
    async assertEngineMismatchAsync(_root: string, _exp: unknown, platform: string) {
      if (platform === 'ios') throw new Error('mismatch');
    },
  });
  const ios = hermes.assertEngineMismatchAsync('/app', {}, 'ios');
  const android = hermes.assertEngineMismatchAsync('/app', {}, 'android');
  await expect(ios).rejects.toThrow('mismatch');
  await expect(android).resolves.toBeUndefined();
});
