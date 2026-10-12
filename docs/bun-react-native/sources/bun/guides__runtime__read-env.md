---
source: https://bun.com/docs/guides/runtime/read-env | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/read-env.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/read-env.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Read environment variables

Access the current environment variables with `process.env`.

```ts index.ts icon="/icons/typescript.svg"
process.env.API_TOKEN; // => "secret"
```

---

Bun also exposes these variables as `Bun.env`, an alias of `process.env`.

```ts index.ts icon="/icons/typescript.svg"
Bun.env.API_TOKEN; // => "secret"
```

---

To print all currently-set environment variables, run `bun --print process.env`.

```sh terminal icon="terminal"
bun --print process.env
```

```txt
ProcessEnv {
  BAZ: "stuff",
  FOOBAR: "aaaaaa",
  <lots more lines>
}
```

---

See [Environment variables](/runtime/environment-variables).
