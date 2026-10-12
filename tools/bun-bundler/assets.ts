// Assets for the Bun bundler: Metro-compatible asset records and metadata and the `registerAsset(...)` module.
// Mirrors metro `src/Assets.js`; writing assets next to an embedded bundle is Expo CLI's persistMetroAssetsAsync.
import fs from 'node:fs';
import path from 'node:path';

export interface AssetData {
  __packager_asset: true;
  fileSystemLocation: string;
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

// ---- metro/src/node-haste/lib/parsePlatformFilePath.js + AssetPaths.js: `name@2x.ios.png` -> name, 2, ios
const PATH_RE = /^(.+?)(\.([^.]+))?\.([^.]+)$/;
const ASSET_BASE_NAME_RE = /(.+?)(@([\d.]+)x)?$/;

function parseAssetFileName(fileName: string, platforms: Set<string>) {
  const match = fileName.match(PATH_RE);
  if (!match || !match[4]) return null;
  let baseName = match[1];
  let platform: string | null = match[3] ?? null;
  if (platform != null && !platforms.has(platform)) {
    baseName = `${match[1]}.${platform}`;
    platform = null;
  }
  const m = baseName.match(ASSET_BASE_NAME_RE)!;
  const resolution = m[3] != null && !Number.isNaN(parseFloat(m[3])) ? parseFloat(m[3]) : 1;
  return { assetName: `${m[1]}.${match[4]}`, name: m[1], platform, resolution, type: match[4] };
}

/**
 * metro/src/Assets.js getAbsoluteAssetRecord: every file of the directory that is a variant of the asset, grouped
 * by platform; the platform's own variants (`img@2x.ios.png`) replace the generic ones. Directory entries are
 * sorted like Node's readdir, which decides the order of equal scales (`img.png` before `img@1x.png`).
 */
export function getAssetRecord(assetPath: string, platform: string | null): { scales: number[]; files: string[] } {
  const dir = path.dirname(assetPath);
  const platforms = new Set(platform != null ? [platform] : []);
  const target = parseAssetFileName(path.basename(assetPath), platforms);
  if (!target) throw new Error(`invalid asset file path: ${assetPath}`);
  const map = new Map<string, { scales: number[]; files: string[] }>();
  for (const file of fs.readdirSync(dir).sort()) {
    const asset = parseAssetFileName(file, platforms);
    if (!asset) continue;
    const key = asset.platform != null ? `${asset.assetName} : ${asset.platform}` : asset.assetName;
    let record = map.get(key);
    if (!record) map.set(key, (record = { scales: [], files: [] }));
    let i = 0;
    while (i < record.scales.length && !(asset.resolution < record.scales[i])) i++;
    record.scales.splice(i, 0, asset.resolution);
    record.files.splice(i, 0, path.join(dir, file));
  }
  const record = (platform != null ? map.get(`${target.assetName} : ${platform}`) : undefined) ?? map.get(target.assetName);
  if (!record) throw new Error(`Asset not found: ${assetPath} for platform: ${platform ?? '(unspecified)'}`);
  return record;
}

/** Metro-compatible asset data (metro getAssetData + Expo's `fileHashes`) for the asset resolved at `filePaths[0]`. */
export function getAssetData(filePaths: string[], projectRoot: string, publicPath = '/assets', platform: string | null = null): AssetData {
  const assetPath = filePaths[0];
  const parsed = parseAssetFileName(path.basename(assetPath), new Set(platform != null ? [platform] : []))!;
  const { scales, files } = getAssetRecord(assetPath, platform);
  const localPath = path.relative(projectRoot, assetPath);
  const relDir = path.dirname(localPath).split(path.sep).join('/');
  const httpServerLocation = localPath.startsWith('..') ? `${publicPath.replace(/\/$/, '')}/${relDir}` : path.posix.join(publicPath, relDir);
  const contents = files.map((f) => new Uint8Array(fs.readFileSync(f)));
  const all = new Bun.CryptoHasher('md5');
  for (const c of contents) all.update(c);
  const size = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(parsed.type) ? imageSize(contents[0]) : undefined;
  return {
    __packager_asset: true,
    fileSystemLocation: path.dirname(assetPath),
    httpServerLocation,
    ...(size ? { width: size.width / scales[0], height: size.height / scales[0] } : {}),
    scales,
    hash: all.digest('hex'),
    name: parsed.name,
    type: parsed.type,
    fileHashes: contents.map(md5),
    files,
  };
}

/** Source of the module a `require('./image.png')` turns into. */
export function assetModuleSource(data: AssetData, registryModule: string): string {
  // Metro's asset transformer drops `files` and `fileSystemLocation` from the registered descriptor
  const { files, fileSystemLocation, ...publicData } = data;
  return `module.exports = require(${JSON.stringify(registryModule)}).registerAsset(${JSON.stringify(publicData)});`;
}
