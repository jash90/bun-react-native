---
source: https://bun.com/docs/guides/runtime/set-env | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/set-env.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/set-env.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Set environment variables

Access the current environment variables with `process.env` or `Bun.env`.

```ts index.ts icon="/icons/typescript.svg"
Bun.env.API_TOKEN; // => "secret"
process.env.API_TOKEN; // => "secret"
```

---

Set these variables in a `.env` file.

Bun reads the following files automatically (listed in order of increasing precedence).

- `.env`
- `.env.production`, `.env.development`, `.env.test` (depending on value of `NODE_ENV`)
- `.env.local` (not loaded when `NODE_ENV=test`)
- `.env.production.local`, `.env.development.local`, `.env.test.local` (depending on value of `NODE_ENV`)

```ini .env icon="settings"
FOO=hello
BAR=world
```

---

You can also set variables on the command line.

<CodeGroup>

```sh Linux/macOS icon="terminal"
FOO=helloworld bun run dev
```

```sh Windows icon="windows"
# Using CMD
set FOO=helloworld && bun run dev

# Using PowerShell
$env:FOO="helloworld"; bun run dev
```

</CodeGroup>

---

See [Environment variables](/runtime/environment-variables).
