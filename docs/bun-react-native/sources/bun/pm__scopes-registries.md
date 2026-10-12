---
source: https://bun.com/docs/pm/scopes-registries | https://github.com/oven-sh/bun/blob/c39c718b44107075481f80a9267259059565d504/docs/pm/scopes-registries.mdx (raw: https://raw.githubusercontent.com/oven-sh/bun/c39c718b44107075481f80a9267259059565d504/docs/pm/scopes-registries.mdx)
fetched: 2026-10-12
bun_main_sha: c39c718b44107075481f80a9267259059565d504
---

# Scopes and registries

> Configure private registries and scoped packages

The default registry is `registry.npmjs.org`. To change it globally, set it in `bunfig.toml`:

```toml bunfig.toml icon="settings"
[install]
# set default registry as a string
registry = "https://registry.npmjs.org"
# set a token
registry = { url = "https://registry.npmjs.org", token = "123456" }
# set a username/password
registry = "https://username:password@registry.npmjs.org"
```

To configure a private registry scoped to a particular organization:

```toml bunfig.toml icon="settings"
[install.scopes]
# registry as string
"@myorg1" = "https://username:password@registry.myorg.com/"

# registry with username/password
# you can reference environment variables
"@myorg2" = { username = "myusername", password = "$NPM_PASS", url = "https://registry.myorg.com/" }

# registry with token
"@myorg3" = { token = "$npm_token", url = "https://registry.myorg.com/" }
```

### `.npmrc`

Bun also reads [`.npmrc`](/pm/npmrc) files.
