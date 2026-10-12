// React Server Components in `expo start` (Expo SDK 57): react-server-dom-webpack's development client calls
// `__webpack_get_script_filename__` for client-reference chunks, which Expo's RSC runtime
// (@expo/metro-runtime/rsc/runtime.js) does not define - every Server Function call failed with a ReferenceError
// (docs/bun-react-native/KNOWN-ISSUES.md #17). Added as a Metro polyfill by tools/bun-bundler/rsc-dev.ts.
if (typeof globalThis.__webpack_get_script_filename__ !== 'function') {
  globalThis.__webpack_get_script_filename__ = function (chunkId) {
    return chunkId;
  };
}
