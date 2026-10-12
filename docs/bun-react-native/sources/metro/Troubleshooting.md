---
source: https://metrobundler.dev/docs/troubleshooting (GitHub: https://github.com/react/metro/blob/4fc75654ea66c973688a76a9ffc512ecf9b9e7ff/docs/Troubleshooting.md)
fetched: 2026-10-12
repo_sha: 4fc75654ea66c973688a76a9ffc512ecf9b9e7ff
---

---
id: troubleshooting
title: Troubleshooting
---

Uh oh, something went wrong? Use this guide to resolve issues with Metro.

 1. Clear Watchman watches: `watchman watch-del-all`
 2. Delete `node_modules` and run `yarn install`
 3. Reset Metro's cache by passing the `--reset-cache` flag, or adding `resetCache: true` to your Metro configuration file.
 4. Remove the cache: `rm -rf ${TMPDIR:-/tmp}/metro-*`
 5. Update Metro to the [latest version](https://www.npmjs.com/package/metro)

### Still unresolved?

See the [Help](/help) pages.
