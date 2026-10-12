---
source: https://bun.com/docs/guides/install/cicd | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/install/cicd.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/install/cicd.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Install dependencies with Bun in GitHub Actions

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
          bun-version: "latest" # or "canary" # [!code ++]
```

---

See the [`setup-bun` README](https://github.com/oven-sh/setup-bun).
