// Assets for the Bun bundler: Metro-compatible asset metadata, the `registerAsset(...)` module and the
// on-disk layout React Native expects next to an embedded bundle.
//
// Mirrors metro `src/Assets.js` (getAssetData) and `@react-native/assets-registry/path-support.js`.
import fs from 'node:fs';
import path from 'node:path';

export interface AssetData {
  __packager_asset: true;
  httpServerLocation: string;
  width?: number;
  height?: number;
  scales: number[];
  hash: string;
  name: string;
  type: string;
  fileHashes: string[];
  files: string[];
}

const SCALE_RE = /@(\d+(?:\.\d+)?)x$/;

function parseScale(fileBase: string): number {
  const m = fileBase.match(SCALE_RE);
  return m ? Number(m[1]) : 1;
}

/** Width/height from the image header (PNG, JPEG, GIF, WebP). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: IHDR right after the signature
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  // WebP (RIFF....WEBP)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
  }
  // JPEG: walk segments to the first SOFn
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return undefined;
}

const md5 = (data: Uint8Array) => new Bun.CryptoHasher('md5').update(data).digest('hex');

/** Metro-compatible asset data for one asset (all its scale variants). */
export function getAssetData(filePaths: string[], projectRoot: string, publicPath = '/assets'): AssetData {
  const sorted = [...filePaths].sort((a, b) => parseScale(path.parse(a).name) - parseScale(path.parse(b).name) || a.localeCompare(b));
  const first = path.parse(sorted[0]);
  const name = first.name.replace(SCALE_RE, '').replace(/\.(ios|android|native|web)$/, '');
  const type = first.ext.slice(1);
  const relDir = path.relative(projectRoot, first.dir).split(path.sep).join('/');
  const contents = sorted.map((f) => new Uint8Array(fs.readFileSync(f)));
  const all = new Bun.CryptoHasher('md5');
  for (const c of contents) all.update(c);
  const size = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(type) ? imageSize(contents[0]) : undefined;
  return {
    __packager_asset: true,
    httpServerLocation: relDir ? `${publicPath}/${relDir}` : publicPath,
    ...(size ? { width: size.width, height: size.height } : {}),
    scales: sorted.map((f) => parseScale(path.parse(f).name)),
    hash: all.digest('hex'),
    name,
    type,
    fileHashes: contents.map(md5),
    files: sorted,
  };
}

/** Source of the module a `require('./image.png')` turns into. */
export function assetModuleSource(data: AssetData, registryModule: string): string {
  const { files, ...publicData } = data;
  return `module.exports = require(${JSON.stringify(registryModule)}).registerAsset(${JSON.stringify(publicData)});`;
}

// ---------------------------------------------------------------- embedded asset layout

const ANDROID_DRAWABLE_TYPES = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp', 'xml']);
const ANDROID_DENSITY: Record<string, string> = { '0.75': 'ldpi', '1': 'mdpi', '1.5': 'hdpi', '2': 'xhdpi', '3': 'xxhdpi', '4': 'xxxhdpi' };

function androidResourceName(data: AssetData): string {
  const base = (data.httpServerLocation.slice(1) + '/' + data.name)
    .toLowerCase()
    .replace(/\//g, '_')
    .replace(/([^a-z0-9_])/g, '')
    .replace(/^assets_/, '');
  return base;
}

/** Copy every scale variant where React Native looks for it next to the embedded bundle. */
export function saveAssets(assets: AssetData[], platform: string, assetsDest: string) {
  let count = 0;
  for (const data of assets) {
    data.files.forEach((src, i) => {
      const scale = data.scales[i];
      let dest: string;
      if (platform === 'android') {
        const drawable = ANDROID_DRAWABLE_TYPES.has(data.type);
        const folder = drawable ? `drawable-${ANDROID_DENSITY[String(scale)] ?? 'mdpi'}` : 'raw';
        dest = path.join(assetsDest, folder, `${androidResourceName(data)}.${data.type}`);
      } else {
        const suffix = scale === 1 ? '' : `@${scale}x`;
        dest = path.join(assetsDest, data.httpServerLocation.replace(/^\//, ''), `${data.name}${suffix}.${data.type}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      count++;
    });
  }
  return count;
}
