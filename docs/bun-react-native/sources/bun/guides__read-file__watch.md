---
source: https://bun.com/docs/guides/read-file/watch | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/read-file/watch.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/read-file/watch.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Watch a directory for changes

Bun implements the `node:fs` module, including the `fs.watch` function for listening for file system changes.

The following code listens for changes to files in the current directory. By default the watch is _shallow_: it does not detect changes to files in subdirectories.

```ts
import { watch } from "fs";

const watcher = watch(import.meta.dir, (event, filename) => {
  console.log(`Detected ${event} in ${filename}`);
});
```

---

To listen for changes in subdirectories, pass the `recursive: true` option to `fs.watch`.

```ts
import { watch } from "fs";

const watcher = watch(import.meta.dir, { recursive: true }, (event, relativePath) => {
  console.log(`Detected ${event} in ${relativePath}`);
});
```

---

With the `node:fs/promises` module, you can listen for changes with `for await...of` instead of a callback.

```ts
import { watch } from "fs/promises";

const watcher = watch(import.meta.dir);
for await (const event of watcher) {
  console.log(`Detected ${event.eventType} in ${event.filename}`);
}
```

---

To stop listening for changes, call `watcher.close()`. It's common to do this when the process receives a `SIGINT` signal, such as when the user presses Ctrl-C.

```ts
import { watch } from "fs";

const watcher = watch(import.meta.dir, (event, filename) => {
  console.log(`Detected ${event} in ${filename}`);
});

process.on("SIGINT", () => {
  // close watcher when Ctrl-C is pressed
  console.log("Closing watcher...");
  watcher.close();

  process.exit(0);
});
```

---

See the [Node.js documentation](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) for `fs.watch`.
