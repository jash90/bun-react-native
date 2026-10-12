---
source: https://bun.com/docs/guides/test/coverage-threshold | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/guides/test/coverage-threshold.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/guides/test/coverage-threshold.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Set a code coverage threshold with the Bun test runner

Bun's test runner has built-in code coverage reporting. Enable it with the `--coverage` flag.

```sh terminal icon="terminal"
bun test --coverage
```

```txt
test.test.ts:
✓ math > add [0.71ms]
✓ math > multiply [0.03ms]
✓ random [0.13ms]
-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   50.00 |   66.67 |
 math.ts     |   50.00 |   66.67 |
 random.ts   |   50.00 |   66.67 |
-------------|---------|---------|-------------------

 3 pass
 0 fail
 3 expect() calls
```

---

To set a minimum coverage threshold, add the following to your `bunfig.toml`. A threshold of `0.9` requires that tests cover 90% of the lines and 90% of the functions of every file in the coverage report. Bun checks the threshold against each file, not against the `All files` average.

```toml bunfig.toml icon="settings"
[test]
# to require 90% line-level and function-level coverage
coverageThreshold = 0.9
```

---

If your test suite does not meet this threshold, `bun test` exits with a non-zero exit code to signal a failure.

```sh terminal icon="terminal"
bun test --coverage
```

```txt
<test output>
$ echo $?
1 # this is the exit code of the previous command
```

---

You can set different thresholds for line-level and function-level coverage.

```toml bunfig.toml icon="settings"
[test]
# to set different thresholds for lines and functions
coverageThreshold = { lines = 0.5, functions = 0.7 }
```

---

See [Code coverage](/test/code-coverage).
