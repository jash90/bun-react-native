// Repo only (CI bundle-determinism reference): `node --require ./scripts/node-export-order.cjs …/expo/bin/cli export`
// gives Expo on Node the same fixed web bundling order the package preload gives it on Bun
// (tools/bun/expo-export-order.js, KNOWN-ISSUES #21) - without it Node's own web export output varies between runs.
require('../tools/bun/expo-export-order.js').install(process.cwd());
