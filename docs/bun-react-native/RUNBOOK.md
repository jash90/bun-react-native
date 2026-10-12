# Runbook: React Native / Expo w 100% na Bun

Stan na **2026-10-12**. Zweryfikowano na: Expo SDK 57.0.27, React Native 0.86.3, Metro 0.84.5,
Hermes (bytecode v98), Bun 1.4.3, Xcode 26.6, JDK 17, macOS (Apple Silicon).
Dowody i liczby: [VERIFICATION.md](VERIFICATION.md). Znane bugi i kiedy usunąć obejścia: [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

> **Granica.** Na urządzeniu JS wykonuje Hermes (albo JSC), nigdy Node ani Bun. „100% Bun” znaczy:
> na maszynie deweloperskiej i w CI żaden krok toolchainu nie uruchamia prawdziwego Node.js.

## 0. Co jest potrzebne i dlaczego (mapa obejść)

| Problem | Skąd | Obejście | Plik |
|---|---|---|---|
| Gradle, CocoaPods, Podfile, pluginy Expo/RN wołają literalnie `node` (ok. 40 miejsc) | kod RN/Expo/bibliotek, szablony prebuild | `node` na PATH = shim do Buna | `tools/bin/node` |
| Bun wywołany jako symlink `node` gubi 1. argument po `--eval` → autolinking Expo pada | oven-sh/bun#40482 | shim uruchamia Buna „pod własną nazwą” (`bun "$@"`) | `tools/bin/node` |
| Alias `node` w Bunie nie zna `node -v` | Bun 1.4.3 | shim obsługuje `-v/--version` | `tools/bin/node` |
| `fs.readdir*` w Bunie zwraca kolejność systemu plików (Node sortuje) → inne assety w bundlu | oven-sh/bun#44947 | preload sortujący | `bun-node-compat.preload.js`, `bunfig.toml` |
| Bun nie aplikuje `preload` w `worker_threads`, a Expo uruchamia transformery Metro w wątkach | Bun + `@expo/metro-config` (`unstable_workerThreads: true`) | pod Bunem workery Metro jako procesy | `metro.config.js` |
| Jest widzi `vm.SyntheticModule` (Bun ma je zawsze) i włącza tryb ESM → `Must use import to load ES Module` | Jest 29 `jest-resolve/build/shouldLoadAsEsm.js` | preload ukrywa `vm.SyntheticModule` w procesach Jesta | `jest.bun-preload.js` |
| Linker `isolated` (domyślny dla nowych workspace'ów) duplikuje moduły natywne Expo | oven-sh/bun#29343 | `linker = "hoisted"` | `bunfig.toml` |
| Świeży `bun install` rozwiązuje peer `"*"` do najnowszej wersji (`@react-native/metro-config` 0.87 przy RN 0.86) | zachowanie Buna | migracja z istniejącego lockfile'a + pin | `package.json` |
| `bun --bun` / `[run] bun = true` wstawia alias `node` przed shim → dzieci trafiają w #40482 | Bun `run` | z shimem nie używać `--bun` | `package.json` |
| `bun test` nie przetwarza Flow (`react-native/index.js`) ani presetów Jest | oven-sh/bun#16945 | **Jest na runtime Bun** zamiast `bun test` | — |

W tym repo wszystkie pliki są już na miejscu (ścieżki w § 3).

## 1. Narzędzia

```bash
curl -fsSL https://bun.com/install | bash      # albo: brew install oven-sh/bun/bun
bun --version                                  # >= 1.4.3
```
Xcode + CocoaPods (iOS), JDK 17 + Android SDK (Android) — bez zmian względem Node.

## 2. Menedżer pakietów

1. **Migracja (zachowuje wersje):** przy istniejącym `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` uruchom
   `bun install` — Bun automatycznie zmigruje lockfile (npm/yarn → `configVersion: 0`, linker hoisted).
   W PoC drzewo po migracji było identyczne z npm (poza opcjonalnym `fsevents`).
2. Usuń stary lockfile, commituj `bun.lock` (format tekstowy). Dwa lockfile'e mylą EAS.
3. **Pin peerów RN**, które biblioteki deklarują jako `"*"` (np. `react-native-worklets` → `@react-native/metro-config`):
   ```jsonc
   // package.json
   "devDependencies": { "@react-native/metro-config": "<ta sama wersja co react-native>" }
   ```
   Sprawdzanie: `bun pm ls --all | grep -E "@react-native/(metro-config|babel-preset)|metro@"` — wersje muszą pasować do RN.
4. **Skrypty postinstall:** `bun pm untrusted` → dla potrzebnych `bun pm trust <pkg>` (dopisuje do `trustedDependencies`).
   Uwaga: własna lista `trustedDependencies` **zastępuje** domyślną allowlistę Buna. Typowy kandydat: `@sentry/cli`.
5. **Patche:** `bun patch <pkg>` → edycja w `node_modules/<pkg>` → `bun patch --commit node_modules/<pkg>`
   (zapis w `patchedDependencies` + `patches/`). Zamiennik `patch-package`.
6. **Monorepo / workspace'y:** zawsze `linker = "hoisted"` (patrz `bunfig.toml`). `bunfig.toml` jest czytany
   z bieżącego katalogu — w monorepo umieść kopię w katalogu każdej aplikacji (tam, skąd startują Metro/Gradle/Xcode).

## 3. Pliki w projekcie

| Plik | Gdzie | Rola |
|---|---|---|
| `bunfig.toml` | katalog aplikacji | `preload` dla każdego procesu Buna, `env = false`; w monorepo dodaj `[install] linker = "hoisted"` |
| `tools/bun/node-compat.preload.js` | repo | sortowanie `fs.readdir*` jak w Node |
| `tools/bun/jest.preload.js` | repo | Jest pod Bunem zachowuje się jak pod Node |
| `tools/bun/expo-cli.preload.js` | repo | `bun expo run:*` / `export:embed`: bundlowanie (także prebundle „eager” Release) przez Buna |
| `metro.config.js` | katalog aplikacji | pod Bunem `transformer.unstable_workerThreads = false` |
| `tools/bin/node` (chmod +x) | repo | shim `node` → Bun |
| `plugins/with-bun-xcode-env.js` | katalog aplikacji + `app.json` → `"plugins": ["./plugins/with-bun-xcode-env"]` | `ios/.xcode.env` → `NODE_BINARY=$(command -v bun)` (przeżywa `prebuild --clean`) |

`bunfig.toml` (aplikacja):
```toml
preload = ["./tools/bun/node-compat.preload.js", "./tools/bun/jest.preload.js", "./tools/bun/expo-cli.preload.js"]
# .env ładują Expo CLI i bundler dla trybu polecenia; Bun wziąłby .env.development także do release (KNOWN-ISSUES #12)
env = false

[install]
linker = "hoisted"
```

Jeżeli masz już `metro.config.js`, dopisz tylko:
```js
if (process.versions.bun) {
  config.transformer.unstable_workerThreads = false;
}
```
Nie podmieniaj `transformerPath` — Expo CLI owija niestandardowy transformer „supervising workerem”, co pod Bunem
psuje `expo export --platform web` (`this._transformer.transformFile` undefined; sprawdzone w PoC).

## 4. Shim `node` na PATH

```bash
export PATH="$PWD/tools/bin:$PATH"   # w ~/.zshrc użyj ścieżki absolutnej do repo
command -v node                      # → .../tools/bin/node
node -p "process.versions.bun"       # → 1.4.3 (na prawdziwym Node: undefined)
```
- Terminal, CI: wystarczy PATH.
- **Xcode (GUI):** fazy skryptowe nie wołają `node`, tylko `$NODE_BINARY` z `ios/.xcode.env(.local)`.
  `pod install` z shimem generuje `ios/.xcode.env.local` z `NODE_BINARY=<ścieżka do bun>` (expo-modules-autolinking
  `xcode_env_generator.rb`). Na stałe (commitowane): w `ios/.xcode.env` ustaw `export NODE_BINARY=$(command -v bun)`
  — przy CNG użyj config pluginu [`plugins/with-bun-xcode-env.js`](../../plugins/with-bun-xcode-env.js)
  (sprawdzony: po `prebuild --clean` + `pod install` Xcode dostaje `NODE_BINARY=<bun>`).
- **Android Studio (GUI):** Gradle sync wykonuje `node` → shim musi być na PATH procesu Android Studio.
  *Hipoteza do weryfikacji:* IntelliJ/Android Studio na macOS ładuje środowisko powłoki logowania, więc wpis w
  `~/.zshrc` wystarcza; w razie problemów uruchamiaj `open -a "Android Studio"` z terminala z ustawionym PATH.
- Nie twórz symlinku `ln -s $(which bun) node` — to dokładnie przypadek oven-sh/bun#40482.

## 5. Skrypty (`package.json`) — BEZ `--bun`

Z shimem na PATH każde `#!/usr/bin/env node` trafia do shima, czyli do Buna. Flaga `--bun` jest zbędna
**i szkodliwa**: `bun --bun run …`, `bun --bun <bin>` oraz `[run] bun = true` w `bunfig.toml` wstawiają na początek
PATH symlink `/tmp/bun-node-<rev>/node` (alias Buna z bugiem oven-sh/bun#40482) — **także gdy shim jest na PATH**.
Procesy potomne (Gradle, `pod install` uruchamiane przez `expo run:*`) dostają wtedy alias i autolinking pada.
Sprawdzone w PoC: dziecko `bun --bun <bin>` widzi `node = /private/tmp/bun-node-c6da4a4d3/node` i argv `["b","c"]`
zamiast `["a","b","c"]`; dziecko `bun <bin>` widzi shim i poprawny argv.

```jsonc
"scripts": {
  "start": "expo start",
  "ios": "expo run:ios",
  "android": "expo run:android",
  "prebuild": "expo prebuild --clean",
  "lint": "expo lint",
  "typecheck": "tsc --noEmit",
  "test": "jest"
}
```
Uruchamiaj przez `bun run <script>` / `bun <bin>` (np. `bun expo start`). Kontrola, że Metro działa na Bunie:
`ps -o command= -p $(lsof -ti :8081)` → `…/bun --no-env-file …/node_modules/.bin/expo start`.

- Bez shima na PATH `bun run` uruchomi prawdziwy Node (shebang) — wtedy, jeśli chcesz Buna dla pojedynczego narzędzia
  bez dzieci wołających `node --eval`, `bun --bun <bin>` jest OK (tak mierzono `tsc`/ESLint/Jest w PoC).
- Jest: coverage tylko `coverageProvider: "babel"` (domyślny). `v8` pod Bunem zwraca
  `Inspector error -32000: Precise coverage has not been started`.
- Zmienne `NODE_OPTIONS` (np. `--max-old-space-size`, `--require`) **nie działają** pod Bunem — przenieś
  preloady do `bunfig.toml`. `BUN_OPTIONS` jest ignorowane, gdy `bunfig.toml` ma własny `preload`.

## 5a. Metro na natywnych API Buna — minifier

`tools/bun/metro-minifier.js` zastępuje terser (`transformer.minifierPath`, tylko gdy Metro działa na Bunie;
wyłącznik: `METRO_BUN_MINIFIER=0`). Minifikuje każdy moduł przez `Bun.build` na pliku w pamięci i składa sourcemapę
(`@jridgewell/remapping`). Do tersera wraca per moduł, gdy wynik mógłby mieć inną semantykę:

| Przypadek | Powód | Co robi |
|---|---|---|
| `"use strict"` na początku wrappera `__d(function…)` | Bun usuwa dyrektywy funkcji (traktuje wejście jak ESM) → moduł przestałby być w trybie ścisłym | dyrektywa wstawiana z powrotem, kolumny sourcemapy przesuwane o 13 |
| `"use strict"` gdzie indziej (zagnieżdżona dyrektywa / string) | nie da się bezpiecznie odtworzyć | terser |
| polyfille / prelude (nie `__d(...)`) | Bun dokłada `export` → Hermes: „'export' statement requires module mode” | terser |
| wynik z `import`/`export` albo w innym kształcie niż jedno wywołanie `__d(...)` | kontrola `Bun.Transpiler.scan` | terser |

**Gdzie to działa:** tylko tam, gdzie Metro minifikuje — eksport web (`expo export --platform web`). Natywne buildy
release z Hermesem (Xcode `react-native-xcode.sh`, Gradle `BundleHermesCTask`) i `expo export` dla OTA wywołują
bundlowanie z `--minify false`, więc minifier nie bierze w nich udziału.

**Czego nie przenosić na Buna:** transformacja Babel (~80% czasu bundlowania) — Bun nie wykonuje pluginów Babela
(worklets/Reanimated, React Compiler, expo-router, codegen); resolver (rozszerzenia platform `.ios.js`, pole
`react-native`), serializer, HMR i dev server — brak natywnego odpowiednika w Bunie; cache Metro z ciepłym cache to już ~0,45 s.

## 6. Prebuild, buildy natywne

```bash
# shim na PATH (sekcja 4), bez --bun (sekcja 5)
bun expo prebuild --clean                # działa bez Node (PoC); dokumentacja Expo twierdzi inaczej
cd ios && pod install && cd ..
bun expo run:ios --configuration Release
bun expo run:android --variant release
```
Bundlowanie release: Xcode → `$NODE_BINARY …/@expo/cli export:embed` (cwd = katalog aplikacji, więc `bunfig.toml`
działa); Gradle → `node …/@expo/cli export:embed` (shim; cwd = katalog aplikacji). Hermes (`hermesc`) — natywna binarka.

Opcjonalnie (zamiast shima w Gradle): `android/app/build.gradle` → `react { nodeExecutableAndArgs = ["bun"] }`.
**Nie wystarcza samo** — `settings.gradle`, `app/build.gradle` (`["node", ...].execute()`), RNGP `PathUtils.kt`,
pluginy autolinkingu Expo, `expo-constants`, `react-native-screens`, `react-native-gesture-handler` wołają `node`
bezpośrednio. Lista miejsc: [VERIFICATION.md § Wywołania node](VERIFICATION.md#wywołania-node-w-toolchainie).

## 7. CI (GitHub Actions)

Workflow: [`.github/workflows/mobile-bun.yml`](../../.github/workflows/mobile-bun.yml)
(`oven-sh/setup-bun@v2` + shim na `$GITHUB_PATH` + krok `assert-no-node` + job porównujący bundle Node vs Bun).

## 8. EAS Build

- Bun jako menedżer pakietów: EAS wykrywa `bun.lock`/`bun.lockb`. Wersję przypnij w `eas.json`:
  ```json
  { "build": { "production": { "bun": "1.4.3" } } }
  ```
- Obrazy EAS (SDK 57) zawierają Node 22 i Bun 1.3.14 — natywne kroki EAS wołają `node` z obrazu.
  „100% Bun” na EAS wymaga shima na PATH na workerze — patrz [CI-EAS.md](CI-EAS.md) (opcje i ich status weryfikacji).

## 9. Weryfikacja po wdrożeniu (obowiązkowa)

1. **Pułapka na Node** — PATH bez prawdziwego Node; `node` = shim logujący wywołania (wersja logująca: gałąź `poc/bun-toolchain`, `poc-tools/node-shim.sh`)
   albo pułapka kończąca się błędem (`poc/bun-toolchain`: `poc-tools/node-trap.sh`) dla kroków, które nie powinny wołać `node`.
2. **Determinizm** — bundle Node vs Bun bajt w bajt (`cmp`) dla `export:embed` iOS i Android oraz `expo export --platform web`.
3. **Urządzenia** — Debug: Fast Refresh z zachowaniem stanu, debugger, symbolikacja; Release: start bez Metro.
4. Jest: ten sam wynik i snapshoty na `bun run test` (Node) i `bun --bun jest` (Bun).

Skrypt całości: gałąź `poc/bun-toolchain`, `poc-tools/e2e-100.sh` (opis w VERIFICATION.md); w CI: joby `checks`, `android`, `ios`, `bundle-determinism`.

## 10. Wycofanie

Usuń `tools/bin` z PATH i `--bun` ze skryptów → toolchain wraca na Node; `bun.lock` może zostać (Bun jako PM).
Preloady i `metro.config.js` są no-op pod Node (`if (process.versions.bun)`).
