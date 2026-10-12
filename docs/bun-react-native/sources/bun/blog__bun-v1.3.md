---
source: https://bun.com/blog/bun-v1.3 (markdown: https://bun.com/blog/bun-v1.3.md)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504 (docs repo HEAD at fetch time; blog posts are not in oven-sh/bun, fetched from bun.com)
---

# Bun 1.3

> Bun 1.3 introduces zero-config frontend development, unified SQL API, built-in Redis client, security enhancements, package catalogs, async stack traces, VS Code test integration, and Node.js compatibility improvements.

_Excerpt: kept whole sections on Node.js compatibility, bun install, bun test, upgrading/breaking changes, developer experience/processes, plus any subsection mentioning install/linker/lockfile/trustedDependencies/node_modules/workers/fs.watch/argv/preload/bunfig/BUN_OPTIONS/child_process/jest/mocks. Full verbatim post: see blog-full/ in this directory._


{% raw %}

<iframe style="aspect-ratio:16/9;width:100%;" src="https://www.youtube.com/embed/tk7qTNW5g0c?si=WXAyNOHWd86hJqJb" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

{% /raw %}

Bun 1.3 is our biggest release yet.

{% codetabs %}

```sh#curl (Linux/MacOS)
$ curl -fsSL https://bun.sh/install | bash
```

```ps1#powershell (Windows)
> powershell -c "irm bun.sh/install.ps1 | iex"
```

```sh#npm
$ npm install -g bun
```

```sh#brew
$ brew tap oven-sh/bun
$ brew install bun
```

```sh#docker
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

{% /codetabs %}

## Full‑stack JavaScript runtime

_(parent section; only matching subsections kept)_

### PostgreSQL enhancements

Bun's built-in PostgreSQL client has received comprehensive enhancements that make it more powerful and production-ready.

**Simple query protocol for multi-statement queries.** You can now use the simple query protocol by calling `.simple()` on your query:

```ts
await sql`
  SELECT 1;
  SELECT 2;
`.simple();
```

This is particularly useful for database migrations:

```ts
await sql`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  );

  CREATE INDEX idx_users_email ON users(email);

  INSERT INTO users (name, email)
  VALUES ('Admin', 'admin@example.com');
`.simple();
```

**Disable prepared statements with `prepare: false`.** Useful for working with PGBouncer in transaction mode or debugging query execution plans:

```ts
const sql = new SQL({
  prepare: false, // Disable prepared statements
});
```

**Connect via Unix domain sockets.** For applications running on the same machine as your PostgreSQL server, Unix domain sockets provide better performance:

```ts
await using sql = new SQL({
  path: "/tmp/.s.PGSQL.5432",  // Full path to socket
  user: "postgres",
  password: "postgres",
  database: "mydb"
});
```

**Runtime configuration through connection options.** Set runtime parameters via the connection URL or options object:

```ts
// Via URL
await using db = new SQL(
  "postgres://user:pass@localhost:5432/mydb?search_path=information_schema",
  { max: 1 }
);

// Via connection object
await using db = new SQL("postgres://user:pass@localhost:5432/mydb", {
  connection: {
    search_path: "information_schema",
    statement_timeout: "30s",
    application_name: "my_app"
  },
  max: 1
});
```

**Dynamic column operations.** Building SQL queries dynamically is now easier with powerful helpers:

```ts
const user = { name: "Alice", email: "alice@example.com", age: 30 };

// Insert only specific columns
await sql`INSERT INTO users ${sql(user, "name", "email")}`;

// Update specific fields
const updates = { name: "Alice Smith", email: "alice.smith@example.com" };
await sql`UPDATE users SET ${sql(
  updates,
  "name",
  "email",
)} WHERE id = ${userId}`;

// WHERE IN with arrays
await sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;

// Extract field from array of objects
const users = [{ id: 1 }, { id: 2 }, { id: 3 }];
await sql`SELECT * FROM orders WHERE user_id IN ${sql(users, "id")}`;
```

**PostgreSQL array type support.** The `sql.array()` helper makes inserting and working with PostgreSQL arrays straightforward:

```ts
// Insert a text array
await sql`
  INSERT INTO users (name, roles)
  VALUES (${"Alice"}, ${sql.array(["admin", "user"], "TEXT")})
`;

// Supported types: INTEGER, REAL, TEXT, BLOB, BOOLEAN, TIMESTAMP, JSONB, UUID
await sql`SELECT ${sql.array([1, 2, 3], "INTEGER")} as numbers`;
```

**Proper null handling in array results.** Bun 1.3 now correctly preserves null values in array results:

```ts
const result = await sql`SELECT ARRAY[0, 1, 2, NULL]::integer[]`;
console.log(result[0].array); // [0, 1, 2, null]
```

Other improvements we've made to PostgreSQL:

- **Binary data types and custom OIDs** - Now handled correctly
- **Improved prepared statement lifecycle** - Better error messages for parameter mismatches
- **Pipelined query error handling** - No longer causes connection disconnection
- **TIME and TIMETZ column support** - Correctly decoded in binary protocol
- **All error classes exported** - `PostgresError`, `SQLiteError`, `MySQLError` for type-safe error handling
- **String arrays in WHERE IN clauses** - Now work correctly
- **Connection failure handling** - Throws catchable errors instead of crashing
- **Large batch inserts fixed** - No longer fail with "index out of bounds" errors
- **Process shutdown improvements** - No longer hangs with pending queries
- **NUMERIC value parsing** - Correctly handles values with many digits
- **`flush()` method** - Properly implemented
- **DATABASE_URL options precedence** - Handled correctly

### SQLite enhancements

**`Database.deserialize()` with configuration options.** When deserializing SQLite databases, you can now specify additional options:

```ts
import { Database } from "bun:sqlite";

const serialized = db.serialize();

const deserialized = Database.deserialize(serialized, {
  readonly: true, // Open in read-only mode
  strict: true, // Enable strict mode
  safeIntegers: true, // Return BigInt for large integers
});
```

**Column type introspection with `columnTypes` and `declaredTypes`.** Statement objects now expose type information about result columns:

```ts
import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
db.run("INSERT INTO users VALUES (1, 'Alice', 30)");

const stmt = db.query("SELECT * FROM users");

// Get declared types from the schema
console.log(stmt.declaredTypes); // ["INTEGER", "TEXT", "INTEGER"]

// Get actual types from values
console.log(stmt.columnTypes); // ["integer", "text", "integer"]

const row = stmt.get();
```

The `declaredTypes` array shows the types as defined in your `CREATE TABLE` statement, while `columnTypes` shows the actual SQLite storage class of the values returned.

## Bundler & Build

_(parent section; only matching subsections kept)_

### Other bundler improvements

- **`jsxSideEffects` option**: Preserve JSX with side effects during tree-shaking
- **`onEnd` hook**: Plugin hook that runs after build completion
- **Glob patterns in sideEffects**: `package.json` supports glob patterns like `"sideEffects": ["*.css"]`
- **Top-level await improvements**: Better handling of cyclic dependencies
- **`-compile-exec-argv`**: Embed runtime flags into executables

## Package Management

Bun's package manager gets more powerful with isolated installs, interactive updates, dependency catalogs, and security auditing.

### Catalogs synchronize dependency versions

Bun 1.3 makes it easier to work with monorepos.

Bun centralizes version management across monorepo packages with dependency `catalogs`. Define versions once in your root `package.json` and reference them in workspace packages.

```json#package.json
{
  "name": "monorepo",
  "workspaces": ["packages/*"],
  "catalog": {
    "react": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

Reference catalog versions in workspace packages:

```json#package.json
{
  "name": "@company/ui",
  "dependencies": {
    "react": "catalog:"
  }
}
```

Now all packages use the same version of React. Update the catalog once to update everywhere. This is inspired by [pnpm's catalog feature](https://pnpm.io/catalogs).

### Isolated installs are now the default for workspaces

Bun 1.3 introduces [isolated installs](/docs/install/isolated). This prevents packages from accessing dependencies they don't declare in their `package.json`, addressing the #1 issue users faced with Bun in large monorepos. Unlike hoisted installs (npm/Yarn's flat structure where all dependencies live in a single `node_modules`), isolated installs ensure each package only has access to its own declared dependencies.

And if you use `"workspaces"` in your `package.json`, we're making it the default behavior.

To opt out do one of the folowing:

```sh
$ bun install --linker=hoisted
```

```toml#bunfig.toml
[install]
linker = "hoisted"
```

### pnpm.lock & yarn.lock migration support

In Bun 1.3, we’ve expanded automatic lockfile conversion to support migrating from yarn (`yarn.lock`) and pnpm (`pnpm-lock.yaml`) to Bun’s lockfile. Your dependency tree stays the same, and Bun preserves the resolved versions from your original lockfile. You can commit the new lockfile to your repository without any surprises. This makes it easy to try `bun install` at work without asking your team to upgrade to Bun.

### Security Scanner API

Bun 1.3 introduces the Security Scanner API, enabling you to scan packages for vulnerabilities before installation. Security scanners analyze packages during `bun install`, `bun add`, and other package operations to detect known CVEs, malicious packages, and license compliance issues. We're excited to be working with [Socket](https://socket.dev/) to launch with their [official security scanner: `@socketsecurity/bun-security-scanner`](https://www.npmjs.com/package/@socketsecurity/bun-security-scanner).

> _“We’re excited to see the Bun team moving so quickly to protect developers at the package manager level. By opening up the Security Scanner API, they’ve made it possible for tools like Socket to deliver real-time threat detection directly in the install process. It’s a great step forward for making open source development safer by default.”_
>
> — Ahmad Nassri, CTO of Socket

**Configure a security scanner in `bunfig.toml`:**

Many security companies publish Bun security scanners as npm packages.

```sh
$ bun add -d @acme/bun-security-scanner # This is an example
```

Next, configure in your `bunfig.toml`:

```toml#bunfig.toml
[install.security]
scanner = "@acme/bun-security-scanner"
```

Now, Bun will scan all packages before installation, display security warnings, and cancel installation if critical advisories are found.

**Scanners report issues at two severity levels:**

- `fatal` : Installation stops immediately, exits with non-zero code
- `warn` — In interactive terminals, prompts to continue; in CI, exits immediately

Enterprise scanners may support authentication through environment variables:

```sh
$ export SECURITY_API_KEY="your-api-key"
$ bun install # Scanner uses credentials automatically
```

For teams with specific security requirements, you can build custom security scanners. See the [official template](https://github.com/oven-sh/security-scanner-template) for a complete example with tests and CI setup.

### Minimum release age

In Bun 1.3, you can protect yourself against supply chain attacks by requiring packages to be published for a minimum time before installation.

```toml#bunfig.toml
[install]
minimumReleaseAge = 604800 # 7 days in seconds
```

This prevents installing packages that were just published, giving the community time to identify malicious packages before they reach your codebase.

### Platform-specific dependencies

Control which platform-specific `optionalDependencies` install with `--cpu` and `--os` flags:

```bash
# Linux ARM64
$ bun install --os linux --cpu arm64

# Multiple platforms
$ bun install --os darwin --os linux --cpu x64

# All platforms
$ bun install --os '*' --cpu '*'

```

### Workspace configuration

Control workspace package linking behavior with `linkWorkspacePackages`:

```toml#bunfig.toml
[install]
linkWorkspacePackages = false
```

When `false`, Bun installs workspace dependencies from the registry instead of linking locally—useful in CI where pre-built packages are faster than building from source.

### New commands

Bun 1.3 adds several commands that make package management easier:

**`bun why`** explains why a package is installed:

```bash
$ bun why tailwindcss
[0.05ms] ".env"
tailwindcss@3.4.17
  └─ peer @tailwindcss/typography@0.5.16 (requires >=3.0.0 || insiders || >=4.0.0-alpha.20 || >=4.0.0-beta.1)

tailwindcss@3.3.2
  └─ tw-to-css@0.0.12 (requires 3.3.2)
```

It shows you the full dependency chain: _which_ of your dependencies depends on tailwindcss, and _why_ it's in your `node_modules`. This is especially useful when you're trying to figure out why a package you didn't explicitly install is showing up in your project.

**`bun update --interactive`** lets you choose which dependencies to update:

```bash
$ bun update --interactive
  dependencies                             Current        Target   Latest
  ❯ □ @tailwindcss/typography              0.5.16         0.5.19   0.5.19
    □ lucide-react                         0.473.0        0.473.0  0.544.0
    □ prettier                             2.8.8          2.8.8    3.6.2
    □ prettier-plugin-tailwindcss          0.2.8          0.2.8    0.6.14
    □ react                                18.3.1         18.3.1   19.1.1
    □ react-dom                            18.3.1         18.3.1   19.1.1
    □ satori                               0.12.2         0.12.2   0.18.3
    □ semver                               7.7.0          7.7.2    7.7.2
    □ shiki                                0.10.1         0.10.1   3.13.0
    □ tailwindcss                          3.4.17         3.4.18   4.1.14
    □ zod                                  3.24.1         3.25.76  4.1.11
```

Instead of updating everything at once, you can scroll through your dependencies and select which ones to update. This gives you control over breaking changes. You can update your test framework separately from your production dependencies, or update one major version at a time.

In monorepos, you can scope updates to specific workspaces with the `--filter` flag:

```bash
# Update dependencies only in the @myapp/frontend workspace
$ bun update -i --filter @myapp/frontend

# Update multiple workspaces
$ bun update -i --filter @myapp/frontend --filter @myapp/backend
```

You can also run commands recursively across all workspace packages:

```bash
$ bun outdated --recursive    # Check all workspaces
┌─────────────────────────────┬─────────┬─────────┬─────────┬───────────┐
│ Package                     │ Current │ Update  │ Latest  │ Workspace │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ @tailwindcss/typography     │ 0.5.16  │ 0.5.19  │ 0.5.19  │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ lucide-react                │ 0.473.0 │ 0.473.0 │ 0.544.0 │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ prettier                    │ 2.8.8   │ 2.8.8   │ 3.6.2   │ catalog:  │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ prettier-plugin-tailwindcss │ 0.2.8   │ 0.2.8   │ 0.6.14  │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ react                       │ 18.3.1  │ 18.3.1  │ 19.1.1  │ my-app    │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ react-dom                   │ 18.3.1  │ 18.3.1  │ 19.1.1  │ my-app    │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ satori                      │ 0.12.2  │ 0.12.2  │ 0.18.3  │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ semver                      │ 7.7.0   │ 7.7.2   │ 7.7.2   │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ shiki                       │ 0.10.1  │ 0.10.1  │ 3.13.0  │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ tailwindcss                 │ 3.4.17  │ 3.4.18  │ 4.1.14  │           │
├─────────────────────────────┼─────────┼─────────┼─────────┼───────────┤
│ zod                         │ 3.24.1  │ 3.25.76 │ 4.1.11  │           │
└─────────────────────────────┴─────────┴─────────┴─────────┴───────────┘
```

The **Workspace** column shows which workspace package each dependency belongs to, making it easy to track dependencies across your monorepo. When using `bun update -i`, this column helps you understand the scope of your updates.

Both `bun outdated` and `bun update -i` now fully support catalog dependencies defined in your root `package.json`, so you can see and update catalog versions just like regular dependencies.

```bash
$ bun update -i --recursive  # Update all workspaces
```

`bun info` lets you view package metadata

```bash
bun info react
react@19.2.0 | MIT | deps: 0 | versions: 2536
React is a JavaScript library for building user interfaces.
https://react.dev/
keywords: react

dist
 .tarball: https://registry.npmjs.org/react/-/react-19.2.0.tgz
 .shasum: d33dd1721698f4376ae57a54098cb47fc75d93a5
 .integrity: sha512-tmbWg6W31tQLeB5cdIBOicJDJRR2KzXsV7uSK9iNfLWQ5bIZfxuPEHp7M8wiHyHnn0DD1i7w3Zmin0FtkrwoCQ==
 .unpackedSize: 171.60 KB

dist-tags:
beta: 19.0.0-beta-26f2496093-20240514
rc: 19.0.0-rc.1
latest: 19.2.0
next: 19.3.0-canary-4fdf7cf2-20251003
canary: 19.3.0-canary-4fdf7cf2-20251003
experimental: 0.0.0-experimental-4fdf7cf2-20251003

maintainers:
- fb <opensource+npm@fb.com>
- react-bot <react-core@meta.com>

Published: 2025-10-01T21:38:32.757Z
```

This shows package versions, dependencies, dist-tags, and more. This is useful for quickly checking what's available before installing.

`bun install --analyze` lets you scans your code for imports that aren't in `package.json` and installs them. This is useful when you've added imports but forgot to install the packages.

```bash
bun install --analyze
```

`bun audit` scans dependencies for known vulnerabilities using the same database as `npm audit`

```bash
$ bun audit
$ bun audit --severity=high
$ bun audit --json > report.json
```

### Other package manager improvements

- **`bun pm version`**: Bump package.json versions with pre/post version scripts
- **`bun pm pkg`**: Edit package.json with `get`, `set`, `delete`, and `fix` commands
- **Platform filtering**: Use `--cpu` and `--os` flags to filter optional dependencies by platform
- **Quiet pack mode**: Use `bun pm pack --quiet` for scripting
- **Custom pack output**: Use `bun pm pack --filename <path>` to specify the output tarball name and location
- `bun install --lockfile-only` has been optimized to only fetch package manifests, not tarballs

```bash
# Create tarball with custom name and location
bun pm pack --filename ./dist/my-package-1.0.0.tgz
```

## Testing and Debugging Improvements

Bun's test runner gets more powerful with VS Code integration, concurrent tests, type testing, and better output.

### Async Stack Traces

We've worked closely with WebKit to add support for richer async stack traces in JavaScriptCore. Previously, errors in async functions failed to preserve the async call trace. For example:

```ts
async function foo() {
  return await bar();
}

async function bar() {
  return await baz();
}

async function baz() {
  await 1; // ensure it's a real async function
  throw new Error("oops");
}

try {
  await foo();
} catch (e) {
  console.log(e);
}
```

In Bun 1.3, this now outputs:

```bash-diff
❯ bun async.js
 6 |   return await baz();
 7 | }
 8 |
 9 | async function baz() {
10 |   await 1; // ensure it's a real async function
11 |   throw new Error("oops");
             ^
error: oops
      at baz (async.js:11:9)
+     at async bar (async.js:6:16)
+     at async foo (async.js:2:16)
```

This feature also benefits Safari and other JavaScriptCore-based runtimes.

> 💡 Read more about the [technical challenges of implementing async stack traces](https://docs.google.com/document/d/13Sy_kBIJGP0XT34V1CV3nkWya4TwYx9L3Yv45LdGB6Q/edit?usp=sharing).

### VS Code Test Explorer integration

Bun's test runner now integrates with VS Code's Test Explorer UI. Tests appear in the sidebar, and you can run, debug, and view results without leaving your editor. Run individual tests with one click and see inline error messages directly in your code.

Install the [Bun for Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) to get started.

### Concurrent testing with bun:test

`bun test` now supports running multiple asynchronous tests concurrently within the same file, using `test.concurrent`. This can significantly speed up test suites that are I/O-bound, such as those making network requests or interacting with a database.

```ts
import { test } from "bun:test";

test.concurrent("fetch user 1", async () => {
  const res = await fetch("https://api.example.com/users/1");
  expect(res.status).toBe(200);
});

describe.concurrent("server tests", () => {
  test("sends a request to server 1", async () => {
    const response = await fetch("https://example.com/server-1");
    expect(response.status).toBe(200);
  });
});

test("serial test", () => {
  expect(1 + 1).toBe(2);
});
```

By default, a maximum of 20 tests will run concurrently. You can change this with the `--max-concurrency` flag.

To make specific files run concurrently, you can use the `concurrentTestGlob` option in `bunfig.toml`.

```toml#bunfig.toml
[test]
concurrentTestGlob = "**/integration/**/*.test.ts"

# You can also provide an array of patterns.
# concurrentTestGlob = [
#   "**/integration/**/*.test.ts",
#   "**/*-concurrent.test.ts",
# ]
```

When using `concurrentTestGlob`, all tests in the files matching the glob will run concurrently.

### `test.serial` to make specific tests sequential

When you use `describe.concurrent`, `--concurrent`, or `concurrentTestGlob`, you might still want to leave some tests sequential. You can do this by using the new `test.serial` modifier.

```ts
import { test, expect } from "bun:test";

describe.concurrent("concurrent tests", () => {
  test("async test", async () => {
    await fetch("<https://example.com/server-1>");
    expect(1 + 1).toBe(2);
  });

  test("async test #2", async () => {
    await fetch("<https://example.com/server-2>");
    expect(1 + 1).toBe(2);
  });

  test.serial("serial test", () => {
    expect(1 + 1).toBe(2);
  });
});
```

### Randomize test order with `--randomize`

Concurrent tests sometimes expose unexpected test dependencies on execution order or shared state. You can use the `--randomize` flag to run tests in a random order to make it easier to find these dependencies.

When you use `--randomize`, Bun will output the seed for that specific run. To reproduce the exact same test order for debugging, you can use the `--seed` flag with the printed value. Using `--seed` automatically enables randomization.

```bash
# Run tests in a random order
$ bun test --randomize

# The seed is printed in the test summary
# ... test output ...
#  --seed=12345
# 2 pass
# 8 fail
# Ran 10 tests across 2 files. [50.00ms]

# Reproduce the same run order using the seed
$ bun test --seed 12345
```

### Chain qualifiers

You can now chain qualifiers like `.failing`, `.skip`, `.only`, and `.each` on `test` and `describe`. Previously, this would result in an error.

```ts
import { test, expect } from "bun:test";

// This test is expected to fail, and it runs for each item in the array.
test.failing.each([1, 2, 3])("each %i", (i) => {
  if (i > 0) {
    throw new Error("This test is expected to fail.");
  }
});
```

### Test execution order improvements

The test runner's execution logic has been rewritten for improved reliability and predictability. This resolves a large number of issues where `describe` blocks and hooks (`beforeAll`, `afterAll`, etc.) would execute in a slightly unexpected order. The new behavior is more consistent with test runners like Vitest.

### Concurrent test limitations

- `expect.assertions()` and `expect.hasAssertions()` are not supported when using `test.concurrent` or `describe.concurrent`.
- `toMatchSnapshot()` is not supported, but `toMatchInlineSnapshot()` is.
- `beforeAll` and `afterAll` hooks are not executed concurrently.

### Stricter `bun test` in CI environments

To prevent accidental commits, `bun test` will now throw an error in CI environments in two new scenarios:

- If a test file contains `test.only()`.
- If a snapshot test (`.toMatchSnapshot()` or `.toMatchInlineSnapshot()`) tries to create a new snapshot without the `--update-snapshots` flag.

This helps prevent temporarily focused tests or unintentional snapshot changes from being merged. To disable this behavior, you can set the environment variable `CI=false`.

### Mark tests as expected to fail

Use `test.failing()` to mark tests that are expected to fail. This is useful for documenting known bugs or practicing Test-Driven Development (TDD) where you write the test before the implementation:

```ts
import { test, expect } from "bun:test";

test.failing("known bug: division by zero", () => {
  expect(divide(10, 0)).toBe(Infinity);
  // This test currently fails but is expected to fail
  // Remove .failing when the bug is fixed
});

test.failing("TDD: feature not yet implemented", () => {
  expect(newFeature()).toBe("working");
  // Remove .failing once you implement newFeature()
});
```

When a `test.failing()` test passes, Bun reports it as a failure (since you expected it to fail). This helps you remember to remove the `.failing` modifier once you fix the bug or implement the feature.

### Type testing with `expectTypeOf()`

Test TypeScript types alongside unit tests using `expectTypeOf()`. These assertions can be checked by the TypeScript compiler:

```ts
import { expectTypeOf, test } from "bun:test";

test("types are correct", () => {
  expectTypeOf<string>().toEqualTypeOf<string>();
  expectTypeOf({ foo: 1 }).toHaveProperty("foo");
  expectTypeOf<Promise<number>>().resolves.toBeNumber();
});
```

Verify type tests by running `bunx tsc --noEmit`.

### New matchers

Bun 1.3 adds new matchers for testing return values:

- `toHaveReturnedWith(value)`: Check if a mock returned a specific value
- `toHaveLastReturnedWith(value)`: Check the last return value
- `toHaveNthReturnedWith(n, value)`: Check the nth return value

```ts
import { test, expect, mock } from "bun:test";

test("mock return values", () => {
  const fn = mock(() => 42);
  fn();
  fn();

  expect(fn).toHaveReturnedWith(42);
  expect(fn).toHaveLastReturnedWith(42);
  expect(fn).toHaveNthReturnedWith(1, 42);
});
```

### Indented inline snapshots

Inline snapshots now support automatic indentation detection and preservation, matching Jest's behavior. When you use `.toMatchInlineSnapshot()`, Bun automatically formats the snapshot to match your code's indentation level:

```ts
import { test, expect } from "bun:test";

test("formats user data", () => {
  const user = { name: "Alice", age: 30, email: "alice@example.com" };

  expect(user).toMatchInlineSnapshot(`
    {
      "name": "Alice",
      "age": 30,
      "email": "alice@example.com",
    }
  `);
});
```

The snapshot content is automatically indented to align with your test code, making snapshots more readable and easier to maintain.

### Other testing improvements

- **`mock.clearAllMocks()`**: Clear all mocks at once
- **Coverage filtering**: Use `test.coveragePathIgnorePatterns` to exclude paths from coverage
- **Variable substitution**: Use `$variable` and `$object.property` in `test.each` titles
- **Improved diffs** Better visualization with whitespace highlighting
- **Stricter CI mode**: Errors on `test.only()` and new snapshots without `--update-snapshots`
- **Compact AI output**: Condensed output for AI coding assistants

## Node.js compatibility

Bun now runs 800 more tests from the Node.js test suite on every commit of Bun. We're continuing making progress toward full Node.js compatibility. In Bun 1.3, we've added support for the VM module, `node:test`, performance monitoring, and more.

### Worker enhancements

We made Bun's `worker_threads` implementation more compatible with Node.js. You can use the `getEnvironmentData` and `setEnvironmentData` methods to share data between parent threads and workers with the `environmentData` API:

```ts
// Share data between workers with environmentData
import {
  Worker,
  getEnvironmentData,
  setEnvironmentData,
} from "node:worker_threads";

// Set data in parent thread
setEnvironmentData("config", { timeout: 1000 });

// Create a worker
const worker = new Worker("./worker.js");

// In worker.js:
import { getEnvironmentData } from "node:worker_threads";
const config = getEnvironmentData("config");
console.log(config.timeout); // 1000
```

```ts
import { Worker, setEnvironmentData, getEnvironmentData } from "worker_threads";

setEnvironmentData("config", { debug: true });

const worker = new Worker("./worker.js");

// In worker.js
import { getEnvironmentData } from "worker_threads";
const config = getEnvironmentData("config");
console.log(config.debug); // true
```

### `node:test` support

Bun now includes initial support for the `node:test` module, leveraging `bun:test` under the hood to provide a unified testing experience. This implementation allows you to run Node.js tests with the same performance benefits of Bun's native test runner.

```ts
import { test, describe } from "node:test";
import assert from "node:assert";

describe("Math", () => {
  test("addition", () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### `node:vm` improvements

The `node:vm` module gets major improvements in Bun 1.3:

- **`vm.SourceTextModule`**: Evaluate ECMAScript modules
- **`vm.SyntheticModule`**: Create synthetic modules
- **`vm.compileFunction`**: Compile JavaScript into functions
- **`vm.Script` bytecode caching**: Use `cachedData` for faster compilation
- **`vm.constants.DONT_CONTEXTIFY`**: Support for non-contextified values

```ts
import vm from "node:vm";

const script = new vm.Script('console.log("Hello from VM")');
script.runInThisContext();
```

These APIs enable advanced use cases like code evaluation sandboxes, plugin systems, and custom module loaders.

### `require.extensions`

Bun now supports Node.js's [`require.extensions`](https://nodejs.org/api/modules.html#requireextensions) API, allowing packages that rely on custom file loaders to work in Bun.

```ts
require.extensions[".txt"] = (module, filename) => {
  const content = require("fs").readFileSync(filename, "utf8");
  module.exports = content;
};

const text = require("./file.txt");
console.log(text); // File contents as string
```

This is a legacy Node.js API that enables loading non-JavaScript files with `require()`. While we don't recommend using it in new code (use import attributes or loaders instead), supporting it ensures compatibility with existing packages in the npm ecosystem.

### Disable Native Addons

Use the `--no-addons` flag to disable Node.js native addons at runtime:

```bash
$ bun --no-addons ./app.ts
```

When disabled, attempts to load native addons will throw an `ERR_DLOPEN_DISABLED` error. This is useful for security-sensitive environments where you want to ensure no native code can be loaded.

Bun also supports the `"node-addons"` export condition in `package.json` for conditional package resolution:

```json#package.json
{
  "exports": {
    ".": {
      "node-addons": "./native.node",
      "default": "./fallback.js"
    }
  }
}
```

### Other Node.js compatibility improvements

#### Core Module Improvements

**`node:fs`**:

- `fs.glob()`, `fs.globSync()`, and `fs.promises.glob()` with array patterns and exclude options
- Support for embedded files in Single-File Executables
- `fs.Stats` constructor matches Node.js behavior (undefined values instead of zeros)
- `fs.fstatSync` bigint option support
- EINTR handling in `fs.writeFile` and `fs.readFile` for interrupted system calls
- `fs.watchFile` emits 'stop' event and ignores access time changes
- `fs.mkdirSync` Windows NT prefix support
- `fs.Dir` validation improvements
- `process.binding('fs')` implementation

**`node:http` and `node:http2`**:

- `http.Server.closeIdleConnections()` for graceful shutdown
- `http.ClientRequest#flushHeaders` correctly sends request body
- Array-based `Set-Cookie` header format in `writeHead()`
- CONNECT method support for HTTP proxies
- Numeric header names support
- WebSocket, CloseEvent, and MessageEvent exports from `node:http`
- HTTP/2 stream management, response handling, and window size configuration improvements
- `maxSendHeaderBlockLength` option
- `setNextStreamID` support
- `remoteSettings` event for default settings
- Type validation for client request options
- `util.promisify(http2.connect)` support

**`node:net`**:

- `net.BlockList` class for IP address blocking
- `net.SocketAddress` class with `parse()` method
- `AbortSignal` support in `net.createServer()` and `server.listen()`
- `resetAndDestroy()` method
- `server.maxConnections` support
- Port as string support in `listen()`
- Improved validation for `localAddress`, `localPort`, `keepAlive` options
- Major rework adding 43 new passing tests
- Handle leak and connection management fixes
- `socket.write()` accepts Uint8Array

**`node:crypto`**:

- X25519 curve support in `crypto.generateKeyPair()`
- Native C++ implementation of Sign and Verify classes (34x faster)
- Native C++ implementation of Hash and Hmac classes
- `hkdf` and `hkdfSync` for key derivation
- `generatePrime`, `generatePrimeSync`, `checkPrime`, `checkPrimeSync`
- Native implementations: Cipheriv, Decipheriv, DiffieHellman, DiffieHellmanGroup, ECDH, randomFill(Sync), randomBytes
- Full KeyObject class hierarchy with structuredClone support
- Lowercase algorithm names support
- `crypto.verify()` defaults to SHA256 for RSA keys
- `crypto.randomInt` callback support

**`node:buffer`**:

- Resizable and growable shared ArrayBuffers
- `--zero-fill-buffers` flag support
- `Buffer.prototype.toLocaleString` alias
- `Buffer.prototype.inspect()` hexadecimal output
- `Buffer.isAscii()` fix
- `process.binding('buffer')` implementation

**`node:process`**:

- `process.stdin.ref()` and `process.stdin.unref()` fixes
- `process.stdout.write` preventing process exit fix
- `process.ref()` and `process.unref()` for event loop control
- `process.emit('worker')` event for worker creation
- `process._eval` property for `-e`/`--eval` code
- `process.on('rejectionHandled')` event support
- `--unhandled-rejections` flag (throw, strict, warn, none modes)
- `process.report.getReport()` on Windows
- `process.features.typescript`, `process.features.require_module`, `process.features.openssl_is_boringssl`
- `process.versions.llhttp`

**`node:child_process`**:

- `execArgv` option in `child_process.fork()`
- Race condition fixes for multiple sockets
- Empty IPC message handling
- Inherited stdin returns null instead of process.stdin
- `spawnSync` RangeError fix
- stdin, stdout, stderr, stdio properties now enumerable
- `execFile` stdout/stderr fixes
- stdio streams fix for quick destruction

**`node:timers`**:

- Unref'd `setImmediate` no longer keeps event loop alive
- Edge cases for millisecond values fixed
- Stringified timer IDs support in `clearTimeout`
- `clearImmediate` no longer clears timeouts and intervals
- AbortController support in `timers/promises`
- 98.4% of Node's timers test suite passes

**`node:dgram`**:

- `reuseAddr` and `reusePort` options fixes
- `addMembership()` and `dropMembership()` work without interface address

**`node:util`**:

- `parseArgs()` allowNegative option and default to `process.argv`
- `util.promisify` preserves function name and emits warnings
- `Buffer.prototype.inspect()` improvements

**`node:tls`**:

- `tls.getCACertificates()` returns bundled CA certificates
- Full certificate bundle support from `NODE_EXTRA_CA_CERTS`
- `translatePeerCertificate` function
- ERR_TLS_INVALID_PROTOCOL_VERSION and ERR_TLS_PROTOCOL_VERSION_CONFLICT errors
- TLSSocket allowHalfOpen behavior fix
- Windows TTY raw mode VT control sequences

**`node:worker_threads`**:

- Worker emits Error objects instead of stringified messages
- `Worker.getHeapSnapshot()` for heap tracking
- MessagePort communication after transfer fixes

**`node:readline/promises`**:

- `readline.createInterface()` implements `[Symbol.dispose]`
- Error handling promise rejection fixes

**`node:stream`**:

- `[Symbol.asyncIterator]` for `process.stdout` and `process.stderr`

**`node:perf_hooks`**:

- `monitorEventLoopDelay()` creates IntervalHistogram
- `createHistogram()` for statistical distributions

**`node:dns`**:

- `dns.resolve` callback fix (removed extra hostname argument)
- `dns.promises.resolve` returns array of strings for A/AAAA records

**`node:os`**:

- `os.networkInterfaces()` correctly returns scopeid for IPv6

**`node:cluster`**:

- IPC race condition fixes

**`node:module`**:

- `module.children` array tracking
- `require.resolve` paths option
- `require.extensions` support
- `module._compile` correctly assigned
- `--preserve-symlinks` flag and NODE_PRESERVE_SYMLINKS=1
- `node:module.SourceMap` class and `findSourceMap()` function

**`node:zlib`**:

- Zstandard (zstd) compression/decompression with sync, async, and streaming APIs

**`node:ws`**:

- WebSocket upgrade abort/fail TypeError fixes

**Low-level APIs**:

- HTTPParser binding via `process.binding('http_parser')` using llhttp
- libuv functions: `uv_mutex_*`, `uv_hrtime`, `uv_once`
- v8 C++ API: `v8::Array::New`, `v8::Object::Get/Set`, `v8::Value::StrictEquals`

**N-API improvements**:

- `napi_async_work` creation and cancellation improvements
- `napi_cancel_async_work` support after queueing
- Correct ArrayBuffer and TypedArray handling in `napi_is_buffer()` and `napi_is_typedarray()`
- `process.exit()` notification in Workers
- `napi_create_buffer` ~30% faster, uses uninitialized memory
- `napi_create_buffer_from_arraybuffer` shares memory instead of cloning
- Assertion failure fixes with node-sqlite3 and lmdb
- IPC error handling improvements
- 98%+ of Node.js N-API tests now pass

**DOMException**:

- name and cause properties through options object

## Developer experience

Bun 1.3 includes several improvements to make daily development easier and more productive.

### Better TypeScript defaults

Bun's default TypeScript configuration now uses `"module": "Preserve"` instead of `"module": "ESNext"`. This preserves the exact module syntax you write rather than transforming it, which true to Bun's design as a runtime that natively supports ES modules.

```json#tsconfig.json
{
  "compilerOptions": {
    "module": "Preserve"
  }
}
```

### Console depth control

Control how deeply `console.log()` inspects objects with the `--console-depth` flag or `bunfig.toml` config.

```bash
$ bun --console-depth=5 ./app.ts
```

```toml#bunfig.toml
[console]
depth = 5
```

### Smarter TypeScript types

`@types/bun` now auto-detects whether to use Node.js or DOM types based on your project. This prevents type conflicts when using browser APIs or Node.js APIs. Note that enabling TypeScript's DOM types alongside Bun will always prefer DOM types, which makes usage of some Bun-specific APIs show errors (for example, Bun's `WebSocket` class supports extra options not in the DOM spec).

We now run [an integration test](https://github.com/oven-sh/bun/tree/6e3359dd16aced2f6fca2a8e2de71f09e0bcb3cb/test/integration/bun-types) on every commit of Bun, to detect regressions and conflicts in Bun's type definitions.

### `BUN_OPTIONS`

Set default CLI arguments with the `BUN_OPTIONS` environment variable.

```bash
$ export BUN_OPTIONS="--watch --hot"
$ bun run ./app.ts
# Equivalent to: bun --watch --hot run ./app.ts
```

### Custom User-Agent

Set a custom User-Agent for `fetch()` requests with the `--user-agent` flag.

```bash
$ bun --user-agent="MyApp/1.0" ./app.ts
```

### Preload Scripts and SQL Optimization

**`BUN_INSPECT_PRELOAD` environment variable.** An alternative to the `--preload` flag for specifying files to load before running your script:

```bash
$ export BUN_INSPECT_PRELOAD="./setup.ts"
$ bun run ./app.ts
# Equivalent to: bun --preload ./setup.ts run ./app.ts
```

**`--sql-preconnect` flag.** Establish a PostgreSQL connection at startup using `DATABASE_URL` to reduce first-query latency:

```bash
$ export DATABASE_URL="postgres://localhost/mydb"
$ bun --sql-preconnect ./app.ts
```

The connection is established immediately when Bun starts, so your first database query doesn't need to wait for connection handshake and authentication.

### Standalone Executable Control

**`BUN_BE_BUN` environment variable.** When running a single-file executable created with `bun build --compile`, set this variable to run the Bun binary itself instead of the embedded entry point:

```bash
# Build an executable
$ bun build --compile ./app.ts --outfile myapp

# Run the embedded app (default)
$ ./myapp

# Run Bun itself, ignoring the embedded app
$ BUN_BE_BUN=1 ./myapp --version
  1.3.0
```

This is useful for debugging compiled executables or accessing Bun's built-in commands.

### Run binaries from packages with different names

You can now use the `--package` (or `-p`) flag with `bunx` to run a binary from a package where the binary's name differs from the package's name. This is useful for packages that ship multiple binaries or for scoped packages. This brings `bunx`'s functionality in line with `npx` and `yarn dlx`.

```bash
# Run the 'eslint' binary from the '@typescript-eslint/parser' package
$ bunx --package=@typescript-eslint/parser eslint ./src

# Run a specific version
$ bunx --package=typescript@5.0.0 tsc --version
```

If you have feedback, `bun feedback` sends feedback directly to the Bun team. This opens a form to report bugs, request features, or share suggestions.

## Utilities

_(parent section; only matching subsections kept)_

### `postMessage` gets up to 500x faster

[**`postMessage`**](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) is the most common way to send data between multiple worker threads in JavaScript. In Bun 1.3, we’re making `postMessage` significantly faster:

- **Strings**: 500x faster
- **Simple objects**: 240x faster

This improves performance for worker communication and deep object cloning.

{% image src="/bun-postmessage.webp" alt="postMessage benchmark showing more than 500X for postMessage in Bun 1.3" /%}

By avoiding serialization for strings we know are safe to share across threads, it's **up to 500x faster** and uses **~22x less peak memory** in [**this benchmark**](https://github.com/oven-sh/bun/blob/b1417f494d389f4c75c21cfc6303d2a7a08a66d1/bench/postMessage/postMessage-string.mjs).

| **String Size** | **Bun 1.2.21** | **Bun 1.2.20** | **Node 24.6.0** |
| --------------- | -------------- | -------------- | --------------- |
| 11 chars        | 543 ns         | 598 ns         | 806 ns          |
| 14 KB           | 460 ns         | 1,350 ns       | 1,220 ns        |
| 3 MB            | 593 ns         | 326,290 ns     | 242,110 ns      |

The optimization kicks in automatically when you send strings between workers:

```ts
// Common pattern: sending JSON between workers
const response = await fetch("https://api.example.com/data");
const json = await response.text();
postMessage(json); // Now 500x faster for large strings
```

This is particularly useful for applications that pass large JSON payloads between workers, like API servers, data processing pipelines, and real-time applications.

## Processes & Shell

Bun 1.3 improves process spawning and shell scripting.

### Timeout option

Kill spawned processes after a timeout with the `timeout` option.

```ts
import { spawn } from "bun";

const proc = spawn({
  cmd: ["sleep", "10"],
  timeout: 1000, // 1 second
});

await proc.exited; // Killed after 1 second
```

### Limit process output with `maxBuffer`

The `maxBuffer` option in `Bun.spawn`, `spawnSync`, and `node:child_process` methods automatically kills the spawned process if its output exceeds the specified byte limit. This prevents runaway processes from consuming excessive memory:

```ts
import { spawn } from "bun";

const proc = spawn({
  cmd: ["yes"],
  maxBuffer: 1024 * 1024, // 1 MB limit
  stdout: "pipe",
});

await proc.exited; // Killed after 1 MB of output
```

This is particularly useful when running untrusted commands or processing user input where output size is unpredictable.

### Enhanced Socket Information

`Bun.connect()` sockets now expose additional network information through new properties:

```ts
import { connect } from "bun";

const socket = await connect({
  hostname: "example.com",
  port: 80,
});

console.log({
  localAddress: socket.localAddress, // Local IP address
  localPort: socket.localPort, // Local port number
  localFamily: socket.localFamily, // 'IPv4' or 'IPv6'
  remoteAddress: socket.remoteAddress, // Remote IP address (previously available)
  remotePort: socket.remotePort, // Remote port number
  remoteFamily: socket.remoteFamily, // 'IPv4' or 'IPv6'
});
```

These properties provide complete visibility into both ends of a socket connection, useful for debugging, logging, and network diagnostics.

Pipe streams to spawned processes with ReadableStream `stdin`

```ts
import { spawn } from "bun";

const response = await fetch("https://example.com/data.json");

const proc = spawn({
  cmd: ["jq", "."],
  stdin: response.body,
});
```

### Other process improvements

- **`execArgv` in `child_process.fork()`**: Pass runtime arguments to forked processes
- **`process.ref()` / `process.unref()`**: Control event loop references
- **Bun Shell reliability improvements**: More robust shell implementation

## Breaking changes

- **Bun.serve() TypeScript types were reworked**:
  - **Defining the WebSocket data in `Bun.serve()` has changed** to using a pattern popularised by XState. See the [new docs here](https://bun.sh/docs/api/websockets#contextual-data). This is due to a [limitation in TypeScript](https://github.com/microsoft/TypeScript/issues/26242).
  - `Bun.Server<T>` is now generic, with the one type parameter representing the WebSocket `.data` type (use `undefined` or `unknown` if not using WebSockets)
  - `Bun.ServeOptions` is now deprecated in favor of `Bun.Serve.Options`
- **TypeScript default**: `"module": "Preserve"` (was auto-detected)
- **GC signal**: SIGPWR instead of SIGUSR1 on Linux
- **`require('./file.unknown-extension')`**: requiring files with unknown extensions defaults to the JavaScript loader instead of file loader for Node.js compatibility
- **`bun info` aliased to `bun pm view`**
- **`Bun.serve()` routes**: The `static` option has been renamed to `routes`
- **SQL client**: Now throws error if called as function instead of tagged template literal (use `` sql`query` `` or `sql.unsafe()`)
- **SQL client**: `undefined` values in the object helper (e.g. `sql({ value: undefined })`) are now filtered out instead of being treated as `NULL`. If all values are `undefined`, this throws a `SyntaxError`
- **`Bun.build` errors**: Now throws `AggregateError` by default on build failures (set `{ throw: false }` to revert)
- **Minifier**: Removes unused function and class expression names by default (use `--keep-names` to preserve)
- TypeScript types for `bun:test`'s expect matchers were made stricter. Some matchers support relaxing the strictness by passing a type parameter. For example `expect(null).toBe<string | null>("hello")`
- **`bun test` filter**: Now fails with error when no tests match the `-t <filter>` regex (previously succeeded silently)
- **`os.networkInterfaces()`**: Returns `scopeid` instead of `scope_id` for IPv6 interfaces (matches Node.js)
- **Namespace imports**: Objects from `import * as ns` no longer inherit from `Object.prototype`
- **`bun test` nesting**: `test()` and `afterAll()` inside another `test()` callback now throw error instead of being silently ignored
- **Node.js version**: Bun now reports as Node.js v24.3.0 instead of v22.6.0 (affects `process.version`, `process.versions.node`, and N-API version)

---

Bun 1.3 is the biggest release yet. Try it today:

```bash
bun upgrade
```

Or install Bun for the first time:

```bash
curl -fsSL https://bun.sh/install | bash
```

We're excited to see what you build with Bun 1.3. Join us on [Discord](https://bun.sh/discord) and share your projects!
