---
source: https://bun.com/docs/guides/runtime/cicd | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/cicd.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/runtime/cicd.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Install and run Bun in GitHub Actions

Use the official [`setup-bun`](https://github.com/oven-sh/setup-bun) GitHub Action to install `bun` in your GitHub Actions runner.

```yaml workflow.yml icon="file-code"
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2 # [!code ++]

      # run any `bun` or `bunx` command
      - run: bun install # [!code ++]
      - run: bun index.ts # [!code ++]
      - run: bun run build # [!code ++]
```

---

To specify a version of Bun to install:

```yaml workflow.yml icon="file-code"
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: oven-sh/setup-bun@v2
        with: # [!code ++]
          bun-version: 1.3.3 # or "latest", "canary", "1.3.x" # [!code ++]
```

---

To type check your project, run [`bun check`](/runtime/check#run-in-ci). GitHub shows each type error as an annotation on the pull request diff.

```yaml workflow.yml icon="file-code"
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun check # [!code ++]
```

---

See the [`setup-bun` README](https://github.com/oven-sh/setup-bun) for all options.
