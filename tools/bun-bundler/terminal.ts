// Interactive terminal of `bun run start`, after Expo CLI's start interface (@expo/cli start/interface): key presses
// reload the apps, toggle the dev menu, open React Native DevTools, open the app on a booted iOS simulator / Android
// device, open web or the editor. Messages go to the apps over the `/message` socket like Expo's broadcastMessage.
//
// Opening the app differs from Expo where the project has no expo-dev-client: Expo would open Expo Go (whose manifest
// endpoint this server does not serve); here the installed development build is launched instead (it loads
// http://localhost:<port>, so Android gets `adb reverse`).
import path from 'node:path';

import { expoHelpers } from './expo-helpers';
import { getExpoConfig } from './shared';

const BLT = '›';
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

interface TerminalOptions {
  projectRoot: string;
  port: number;
  /** send `{ version: 2, method, params }` to the apps' `/message` sockets */
  broadcast: (method: string, params?: object) => void;
  close: () => void;
}

function run(cmd: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
    return { ok: p.exitCode === 0, out: p.stdout.toString() + p.stderr.toString() };
  } catch (e: any) {
    return { ok: false, out: String(e?.message ?? e) };
  }
}

function usage(verbose: boolean) {
  const rows = verbose
    ? [
        ['a', 'open Android'],
        ['i', 'open iOS simulator'],
        ['w', 'open web'],
        [],
        ['r', 'reload app'],
        ['j', 'open debugger'],
        ['m', 'toggle menu'],
        ['shift+m', 'toggle element inspector'],
        ['o', 'open project code in your editor'],
        ['c', 'show server URLs'],
        [],
      ]
    : [['?', 'show all commands']];
  for (const [key, msg] of rows) console.log(key ? `${BLT} ${key.length === 1 ? 'Press ' : ''}${bold(key)} ${dim('│')} ${msg}` : '');
}

export function startTerminalInterface(opts: TerminalOptions) {
  const { projectRoot, port } = opts;
  const h = expoHelpers(projectRoot);
  const exp = getExpoConfig(projectRoot);
  const origin = `http://localhost:${port}`;
  const devClient = (() => {
    try {
      h.req.resolve('expo-dev-client/package.json');
      return true;
    } catch {
      return false;
    }
  })();
  const scheme = [exp.scheme].flat()[0] ?? `exp+${exp.slug}`;
  const devClientUrl = (host: string) => `${scheme}://expo-development-client/?url=${encodeURIComponent(`http://${host}:${port}`)}`;

  const printInfo = () => {
    console.log(`${BLT} Bundler (Bun): ${origin}`);
    console.log(`${BLT} Web: ${origin}`);
    console.log(`${BLT} Using ${devClient ? 'development build (expo-dev-client)' : 'development build (installed app)'}`);
    console.log('');
    usage(false);
  };

  async function openIos() {
    console.log(`${BLT} Opening on iOS...`);
    const list = run(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j']);
    const booted = list.ok ? Object.values<any[]>(JSON.parse(list.out.slice(list.out.indexOf('{'))).devices).flat().filter((d) => d.state === 'Booted') : [];
    if (!booted.length) return console.log(`${BLT} No booted iOS simulator. Boot one, or build and install the app with ${bold('bun run ios')}.`);
    const udid = booted[0].udid;
    run(['open', '-a', 'Simulator']);
    const r = devClient ? run(['xcrun', 'simctl', 'openurl', udid, devClientUrl('localhost')]) : run(['xcrun', 'simctl', 'launch', udid, exp.ios?.bundleIdentifier ?? '']);
    if (!r.ok) console.log(`${BLT} Could not open the app on ${booted[0].name}: ${r.out.trim().split('\n').pop()} (install it with ${bold('bun run ios')})`);
  }

  async function openAndroid() {
    console.log(`${BLT} Opening on Android...`);
    const adb = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
    const devices = run([adb, 'devices']);
    const serial = devices.out.split('\n').slice(1).map((l) => l.split('\t')).find((c) => c[1]?.trim() === 'device')?.[0];
    if (!serial) return console.log(`${BLT} No Android device or emulator connected (${bold('adb devices')}).`);
    // the development build loads http://localhost:<port>
    run([adb, '-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    const pkg = exp.android?.package ?? '';
    const r = devClient
      ? run([adb, '-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', devClientUrl('localhost')])
      : run([adb, '-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    if (!r.ok || /No activities found|Error/.test(r.out)) console.log(`${BLT} Could not open ${pkg} on ${serial} (install it with ${bold('bun run android')})`);
  }

  async function openDebugger() {
    const inspector = h.req('@expo/cli/build/src/start/server/middleware/inspector/JsInspector');
    try {
      const apps = await inspector.queryAllInspectorAppsAsync(origin);
      if (!apps.length) return console.log(`${BLT} ${bold('Debug:')} No compatible apps connected, React Native DevTools can only be used with Hermes.`);
      // newest runtime first (Expo prompts when there are several)
      if (apps.length > 1) console.log(`${BLT} ${bold('Debug:')} ${apps.length} targets, opening ${apps[0].deviceName ?? apps[0].id}`);
      if (!(await inspector.openJsInspector(origin, apps[0]))) console.log(`${BLT} ${bold('Debug:')} Failed to open the React Native DevTools.`);
    } catch (e: any) {
      console.log(`${BLT} ${bold('Debug:')} ${e?.message ?? e}`);
    }
  }

  const onKey = async (key: string) => {
    switch (key) {
      case '\u0003': // Ctrl+C
      case '\u0004': // Ctrl+D
        console.log(`${BLT} Stopping server`);
        opts.close();
        process.exit(0);
      case '\u000C': // Ctrl+L
        return console.clear();
      case '?':
        return usage(true);
      case 'r':
        console.log(`${BLT} Reloading apps`);
        return opts.broadcast('reload');
      case 'm':
        console.log(`${BLT} Toggling dev menu`);
        return opts.broadcast('devMenu');
      case 'M':
        // Expo's "more tools" items that only need the dev command channel
        console.log(`${BLT} Toggling element inspector ${dim('(sendDevCommand toggleElementInspector)')}`);
        return opts.broadcast('sendDevCommand', { name: 'toggleElementInspector' });
      case 'j':
        return openDebugger();
      case 'i':
      case 'I':
        return process.platform === 'darwin' ? openIos() : undefined;
      case 'a':
      case 'A':
        return openAndroid();
      case 'w':
        console.log(`${BLT} Open in the web browser...`);
        run([process.platform === 'darwin' ? 'open' : 'xdg-open', origin]);
        return;
      case 'o':
        console.log(`${BLT} Opening the editor...`);
        return h.req('@expo/cli/build/src/utils/editor').openInEditorAsync(projectRoot);
      case 'c':
        return printInfo();
    }
  };

  printInfo();
  if (process.stdin.isTTY && !process.env.CI) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data: string) => {
      onKey(data).catch((e) => console.error(e));
    });
  }
  return { press: onKey };
}
