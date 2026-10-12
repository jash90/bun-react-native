# Znane problemy: React Native / Expo na Bun

Stan na **2026-10-12** (Bun 1.4.3 = najnowszy stabilny, 1.4.4-canary.1 sprawdzony lokalnie).
„Usuń obejście, gdy…” = warunek, po którym obejście z [RUNBOOK.md](RUNBOOK.md) jest zbędne.
Jak sprawdzić, czy poprawka już jest: `bun upgrade --canary` w osobnym środowisku albo pobranie binarki
`gh release download canary --repo oven-sh/bun -p 'bun-darwin-aarch64.zip'`, potem testy z kolumny „Test”.

## Blokery z obejściem (działa dziś)

| # | Problem | Status upstream | Obejście | Test (powinien przejść bez obejścia) | Usuń obejście, gdy… |
|---|---|---|---|---|---|
| 1 | Bun jako symlink `node` gubi 1. argument po `--eval`/`-p` → `expo-modules-autolinking` w Podfile/Gradle zwraca help zamiast JSON („Couldn't parse JSON coming from expo-modules-autolinking”) | [oven-sh/bun#40482](https://github.com/oven-sh/bun/issues/40482) otwarte (od 2026-08-25). Fix [PR #43270](https://github.com/oven-sh/bun/pull/43270): 1 commit, brak review człowieka, Buildkite „blocked”, ostatnia zmiana 2026-09-18. Nie ma w 1.4.3 ani 1.4.4-canary.1 | `tools/bin/node` (Bun w trybie „bun”) | `ln -s $(which bun) /tmp/x/node; /tmp/x/node --eval 'console.log(process.argv.slice(1))' a b` → `[ 'a', 'b' ]` | release z #43270 **i** test zielony |
| 2 | Alias `node` nie obsługuje `node -v` / `--version` | brak osobnego issue (stan 1.4.3) | shim | `/tmp/x/node -v` → `v26.x` | test zielony |
| 3 | `bun --bun`, `bunx --bun`, `[run] bun = true` wstawiają alias `node` przed PATH (także przed shim) → dzieci trafiają w #1 | zachowanie udokumentowane („symlinking node to Bun in a temporary PATH directory”); szkodliwe tylko przez #1 | nie używać `--bun` przy shimie | jak #1 | razem z #1 |
| 4 | `fs.readdirSync/readdir/promises.readdir` zwracają kolejność systemu plików; Node (libuv) sortuje. Metro wybiera inny plik assetu (`x.png` vs `x@1x.png`) → inne wymiary w bundlu i inne PNG w release | [oven-sh/bun#44947](https://github.com/oven-sh/bun/issues/44947) otwarte od 2026-10-10, `needs triage`, brak PR | `bun-node-compat.preload.js` + `bunfig.toml` `preload` + `unstable_workerThreads=false` | `bun -p 'require("fs").readdirSync("node_modules/expo-router/assets/react-navigation/elements").filter(f=>f.startsWith("clear")).join()'` → kolejność alfabetyczna; job `bundle-determinism` zielony bez preloadu | release z poprawką + `cmp` bundli Node/Bun zielony bez preloadu |
| 5 | Bun nie aplikuje `bunfig.toml` `preload` w `worker_threads`; Expo włącza `transformer.unstable_workerThreads: true` | brak issue (zachowanie Buna) | `metro.config.js`: pod Bunem `unstable_workerThreads = false` (wolniejsze bundlowanie o ~30–50%) | — | razem z #4 |
| 6 | Jest pod Bunem: `Must use import to load ES Module` dla pakietów `"type": "module"` (np. `react-native-worklets/lib/module`) — Jest włącza ścieżkę ESM, bo Bun zawsze ma `vm.SyntheticModule` | brak issue w jestjs/jest i oven-sh/bun | `jest.bun-preload.js` | `bun --bun jest` bez preloadu | Jest/Bun zmienią wykrywanie (nie planowane) |
| 7 | Jest coverage `v8`: `Inspector error -32000: Precise coverage has not been started` | inspector Buna częściowy (docs: Runtime.evaluate/HeapProfiler/Network niekompletne) | `coverageProvider: "babel"` | `bun --bun jest --coverage --coverageProvider=v8` | — |
| 8 | Linker `isolated` (domyślny dla **nowych** workspace'ów, `configVersion: 1`) duplikuje moduły natywne Expo przez cykliczne peer deps (`expo-doctor`: 6 duplikatów) | [oven-sh/bun#29343](https://github.com/oven-sh/bun/issues/29343) otwarte; [PR #29345](https://github.com/oven-sh/bun/pull/29345) zielony, od 6 mies. bez review | `[install] linker = "hoisted"` | `expo-doctor` czysty przy isolated | merge #29345 |
| 9 | Świeży `bun install` rozwiązuje peer `"*"` do najnowszej wersji (`@react-native/metro-config` 0.87.1 przy RN 0.86.3; npm daje 0.86.3) | zachowanie Buna | migracja z lockfile'a npm/yarn + pin w `devDependencies` | `bun pm ls --all \| grep metro-config` | — (stała praktyka) |
| 10 | `NODE_OPTIONS=--require …` ignorowane przez Buna; `BUN_OPTIONS` ignorowane, gdy `bunfig.toml` ma `preload` | zachowanie Buna | preloady tylko w `bunfig.toml` | — | — |
| 11 | `bunfig.toml` czytany tylko z cwd (nie z katalogów nadrzędnych) | zachowanie Buna | `bunfig.toml` w katalogu każdej aplikacji | — | — |

## Minifikacja Bunem (tools/bun/metro-minifier.js)

| # | Problem | Obejście w minifierze |
|---|---|---|
| 12 | `Bun.build` / `Bun.Transpiler` usuwają funkcyjne `"use strict"` (we wszystkich formatach: esm, cjs, iife) | dyrektywa odtwarzana na początku wrappera, sourcemapa przesunięta; inne wystąpienia → terser |
| 13 | `Bun.build` traktuje wejście jak moduł ES i dla skryptów (polyfille Metro) dokłada `export` | tylko moduły `__d(function…)`, kontrola wyniku `Bun.Transpiler.scan` |
| 14 | brak odpowiednika `mangle.reserved` w Bunie | zmiana nazw parametrów wrappera jest lokalna dla funkcji modułu (bez wpływu na zachowanie); `unstable_dependencyMapReservedName` = `null` w Expo |
| 15 | Bundle z Bunem przy minifikacji różni się od bundla z Node (inny minifier) | porównania determinizmu robić z `--minify false` (tak bundlują natywne buildy z Hermesem) |

## Nie do obejścia rozsądnym kosztem

| Problem | Status | Decyzja |
|---|---|---|
| `bun test` + React Native: `Unexpected typeof` (Flow w `react-native/index.js`), brak presetów Jest (`jest-expo`, `@react-native/jest-preset`), mocki natywne | [oven-sh/bun#16945](https://github.com/oven-sh/bun/issues/16945) otwarte, brak PR/planu; wsparcie Flow zamknięte ([#191](https://github.com/oven-sh/bun/issues/191)). Spike PoC: plugin Babel → Flow OK, ale interop ESM/CJS (`RN.View === undefined`) i brak mocków | Jest na runtime Bun (#6) zamiast `bun test` |
| Bundler Buna „z pudełka” zamiast Metro | `Bun.build` nie ma formatu modułów Metro, HMR RN, pipeline Hermes, rejestru assetów; [oven-sh/bun#123](https://github.com/oven-sh/bun/issues/123) („react-native support”) otwarte | rozwiązane własnym bundlerem na API Buna: [`tools/bun-bundler/`](../../tools/bun-bundler/) ([BUNDLER.md](BUNDLER.md)) — także eksport OTA i web; Metro tylko jako wyjście awaryjne |
| Node na obrazach EAS / runnerach GitHub | obrazy zawierają Node; `oven-sh/setup-bun` działa na runtime Actions `node24` | Node obecny, ale nieużywany przez toolchain (shim) |

## Ryzyka niezweryfikowane w PoC

| Ryzyko | Źródło | Jak sprawdzić |
|---|---|---|
| Expo Router **server output** pod Bunem (`First argument must be an Error object`) | [oven-sh/bun#16418](https://github.com/oven-sh/bun/issues/16418) otwarte; expo#49843 zamknięte jako upstream | **Sprawdzone 2026-10-12**: `bun expo export --platform web` z `web.output: "server"` (Metro na Bunie, fikstura z trasami API i `unstable_useServerRendering`) kończy się bez błędu; `bun run export` (bundler Buna) daje ten sam wynik plik po pliku, obsłużony przez `expo-server` |
| Zawieszanie `expo export` (brak `process.getActiveResourcesInfo`) | [oven-sh/bun#24538](https://github.com/oven-sh/bun/issues/24538), PR #34658 w konflikcie; Expo obeszło w SDK 56 (expo#39266). W PoC eksporty kończyły się normalnie | obserwować czasy w CI |
| Fast Refresh gubi zmiany w workspace Buna | [expo#46429](https://github.com/expo/expo/issues/46429) otwarte | edycja pliku w pakiecie workspace podczas `expo start` |
| Patche nieaplikowane na EAS przy ciepłym cache | [oven-sh/bun#33520](https://github.com/oven-sh/bun/issues/33520) otwarte; draft #44621 częściowy | asercja w `eas-build-post-install` (np. `grep` znacznika z patcha) |
| EAS: monorepo z lokalnymi modułami | [expo/eas-cli#3126](https://github.com/expo/eas-cli/issues/3126) zamknięte „not planned” | build EAS monorepo |
| Android Studio (GUI) nie widzi shima | hipoteza | Gradle sync z Android Studio uruchomionego z Docka |
| Różnice `readdir` poza Metro (codegen, inne narzędzia) | wynik PoC: autolinking Expo identyczny także bez preloadu | `cmp` artefaktów codegen Node vs Bun |

## Tempo poprawek w Bun (dane, nie gwarancja)

- Wydania: 1.3.0 (2025-10-10) → 1.4.3 (2026-10-10): 18 wydań, mediana odstępu 15 dni. Następne (1.4.4) prawdopodobnie 2026-10-25…11-15.
- PR-y zmergowane od 2026-07-12: mediana 0,7 dnia od otwarcia; tylko 2,1% merge'y od 2026-08-12 dotyczyło PR-ów starszych niż miesiąc.
  Wniosek: PR otwarty > 30 dni (wszystkie powyższe) ma niskie szanse na szybki merge.
