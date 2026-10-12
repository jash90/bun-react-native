# Weryfikacja: React Native / Expo w 100% na Bun

Data: **2026-10-12**. Maszyna: Apple M1 Pro, 32 GB, macOS, Xcode 26.6, JDK 17 (Zulu), Android SDK 36.
Projekt: `app/` na gałęzi `poc/bun-toolchain` — Expo SDK 57.0.27 (szablon `default@sdk-57`: expo-router, Reanimated 4.5.1,
Worklets 0.10.1, Gesture Handler, Screens, expo-image, …), React Native 0.86.3, Metro 0.84.5, Bun 1.4.3.
Konfiguracja = [RUNBOOK.md](RUNBOOK.md). Narzędzia PoC (`poc-tools/`) są na gałęzi `poc/bun-toolchain`.

## 1. Metoda

- **Brak prawdziwego Node.** PATH bez katalogu nvm; `which -a node` → wyłącznie shim. Shim (wersja PoC:
  `poc-tools/node-shim.sh`) loguje każde wywołanie `node` (argumenty, cwd, rodzic) i wykonuje Buna.
- **Pułapka** (`poc-tools/node-trap.sh`) — `node` kończy się kodem 127 i logiem: służy do znalezienia miejsc,
  które wołają `node` (sekcja 5).
- **Determinizm:** artefakty z Buna porównywane z artefaktami z prawdziwego Node (`cmp`, `diff -r`), te same argumenty.
- **Urządzenia:** symulator iPhone 17 Pro (iOS 26.5), emulator Android API 36, sterowane przez Argent.

## 2. Przebieg end-to-end bez Node (`poc-tools/e2e-100.sh`)

`node resolves to: <shim>; real node on PATH: 0`

| Krok | Wynik | Czas |
|---|---|---|
| `rm -rf node_modules && bun install --frozen-lockfile` | OK | 17 s |
| `expo prebuild --clean --no-install` | OK | 5 s |
| `pod install` | OK; `ios/.xcode.env.local` → `NODE_BINARY=<bun>` | 31 s |
| `tsc --noEmit` | ten sam wynik co na Node (błędy szablonu Expo, diff = 0) | 1 s |
| `eslint .` | ten sam wynik co na Node (diff = 0) | 3 s |
| `jest --ci` (runtime Bun) | 8/8, 2/2 snapshoty | 3 s |
| `expo export --platform web` | OK, **36 plików identycznych bajt w bajt z Node** | 14 s |
| `xcodebuild` Release (symulator) | `BUILD SUCCEEDED`, bundle Hermes przez `$NODE_BINARY` (= Bun) | 264 s |
| `gradlew assembleRelease` (arm64) | `BUILD SUCCESSFUL`, bundle Hermes przez shim | 149 s |
| `export:embed` iOS i Android (shim, `bun expo …`) | **bundle + sourcemap + assety identyczne bajt w bajt z Node** | 9–11 s |

Wywołań `node` przechwyconych przez shim w całym przebiegu: **81** (wszystkie wykonał Bun; 0 wywołań prawdziwego Node).
Najczęstsze: `node --print require.resolve('react-native/package.json')` (23), skrypty codegen / walidacji (22),
`node --no-warnings --eval require('expo/bin/autolinking') …` (8).

Po przebiegu (konfiguracja docelowa, Metro przez `bun expo start` z shimem):
- Release iOS (z przebiegu) uruchomiony na symulatorze bez Metro → ekran startowy OK.
- Debug iOS + Metro na Bun → **Fast Refresh** (zmiana tekstu widoczna w < 1 s), wcześniej także: zachowanie stanu
  (rozwinięta sekcja i zakładka przetrwały edycję), debugger CDP (`Runtime.evaluate` → Hermes, Static Hermes, bytecode 98),
  `/symbolicate` → `src/app/index.tsx:37`.
- Release Android (APK z bundlem z Buna) uruchomiony na emulatorze API 36 → ekran startowy OK.

## 3. Determinizm — co było źle przed obejściami

| Artefakt | Bun bez obejść | Bun z obejściami |
|---|---|---|
| bundle dev (Metro HTTP) | różnica w metadanych 2 assetów (`width/height 64→16`, inne `fileHashes`) | identyczny |
| bundle release iOS/Android | jw. + inny `debugId` | identyczny (+ sourcemap) |
| assety release | 2 PNG różne (`clear-icon.png`, `close-icon.png`: 16 px vs 64 px) | identyczne |
| eksport web | — | identyczny (36 plików) |
| autolinking Expo (`resolve`, `react-native-config`) | identyczny (sortuje sam) | identyczny |

Przyczyna: `fs.readdir*` (oven-sh/bun#44947); pakiet `expo-router` zawiera `x.png` i `x@1x.png` o tej samej skali.

## 4. Pomiary (M1 Pro, średnie)

| Operacja | Node / npm | Bun bez obejść | Bun z obejściami (docelowo) |
|---|---|---|---|
| instalacja, zimny cache | 46,2 s (npm) | 13,4 s | 13,4 s |
| instalacja, ciepły cache, bez `node_modules` | 14,2 s (`npm ci`) | 2,2 s | 2,2 s |
| instalacja no-op | 1,19 s | 0,15 s | 0,15 s |
| Metro: pierwszy bundle iOS, zimny cache | 5,58 s | 5,40 s | 4,9–6,4 s |
| Metro: pierwszy bundle, ciepły cache | 0,64 s | 0,45 s | — |
| `export:embed` iOS (reset cache) | 8,8 s | 9,97 s | 9,3–13,2 s |
| `export:embed` Android | 9,05 s | 9,9 s | 10,4–10,5 s |
| `tsc --noEmit` | 1,04 s | 0,87 s | 0,87 s |
| `eslint .` | 1,33 s | 0,93 s | 0,93 s |
| Jest (8 testów) | 2,48 s | nie działa | 1,93 s |
| start CLI `expo --version` | 50 ms | 29 ms | — |

Wnioski: duży zysk w instalacji; umiarkowany w Jest/tsc/ESLint; brak zysku w Metro; bundlowanie z obejściem
(workery-procesy) do ~50% wolniejsze w najgorszym pomiarze. Buildy natywne — czas zdominowany przez Xcode/Gradle.

## 5. Wywołania `node` w toolchainie

Literalne `node` (nie `NODE_BINARY`) — dlatego potrzebny jest shim na PATH:

| Gdzie | Plik:linia (RN 0.86.3 / Expo SDK 57) |
|---|---|
| Szablon `ios/Podfile` | linie 3–4 (`node --print require.resolve(...)`), 33–36 (`config_command`) |
| Szablon `android/settings.gradle` | linie 5, 13 |
| Szablon `android/app/build.gradle` | linie 12–20 (`["node", ...].execute()`) |
| react-native | `scripts/cocoapods/autolinking.rb:203`, `scripts/cocoapods/codegen_utils.rb:56`, `scripts/cocoapods/utils.rb:248`, `sdks/hermes-engine/hermes-engine.podspec:11,92`, `third-party-podspecs/ReactNativeDependencies.podspec:9` |
| @react-native/gradle-plugin | `utils/PathUtils.kt:90` |
| expo | `scripts/autolinking.rb:5-6` |
| expo-modules-autolinking | `scripts/ios/autolinking_manager.rb:233`, `xcode_env_generator.rb:39`, `project_integrator.rb:187`, `precompiled_modules.rb:1758`; Gradle: `AutolinkingCommandBuilder.kt:11`, `ExpoAutolinkingPlugin.kt:56`, `ExpoAutolinkingSettingsPlugin.kt:54`, `ExpoAutolinkingSettingsExtension.kt:55,67` |
| expo-constants | `scripts/get-app-config-android.gradle:8` |
| react-native-reanimated | `scripts/reanimated_utils.rb:20,34,53` |
| react-native-worklets | `scripts/worklets_utils.rb:22,53` |
| react-native-screens | `android/build.gradle:62` |
| react-native-gesture-handler | `android/build.gradle:45` |

Przez `NODE_BINARY`: fazy skryptowe Xcode (`react-native-xcode.sh`, `script_phases.sh`, `with-environment.sh`,
`expo-constants/scripts/with-node.sh`). Przez `nodeExecutableAndArgs`: zadania RNGP bundle/codegen, `expo-constants` (linia 12).
W buildzie Xcode z PoC: **0** wywołań `node` — wszystko przez `NODE_BINARY`.

## 6. Zachowania Buna potwierdzone testami (do cytowania)

| Zachowanie | Test | Wynik |
|---|---|---|
| alias `node` gubi argument po `--eval` | `<symlink node> --eval 'console.log(process.argv)' a b c` | `[bun, "b", "c"]` (Node: `[node, "a","b","c"]`); 1.4.0, 1.4.3, 1.4.4-canary.1 |
| alias `node -v` | `<symlink node> -v` | `error: Invalid Argument '-v'` |
| `bun --bun <bin>` i `[run] bun = true` przy shimie | dziecko: `command -v node` | `/private/tmp/bun-node-c6da4a4d3/node` (alias), argv uszkodzony |
| `bun <bin>` przy shimie | dziecko: `command -v node` | shim, argv poprawny |
| `readdirSync` | katalog `expo-router/.../elements` | Bun: `@4x,@3x,@2x,@1x,base`; Node: alfabetycznie |
| `preload` z `bunfig.toml` | proces główny / `fork` / `worker_threads` | ładuje się / ładuje się / **nie ładuje się** |
| `BUN_OPTIONS=--preload` | proces i `fork` | działa, ale **ignorowane**, gdy `bunfig.toml` ma `preload` |
| `NODE_OPTIONS=--require` | proces i `fork` | ignorowane |
| `bunfig.toml` z podkatalogu | `bun` uruchomiony w podkatalogu | nie jest czytany |
| `vm.SyntheticModule` | `typeof require('vm').SyntheticModule` | `function` (Node bez flagi: `undefined`); da się usunąć (`configurable: true`) |
| `process.argv[0]` przez alias | `node --print process.argv[0]` | ścieżka do binarki `bun` (stąd `NODE_BINARY=<bun>` w `.xcode.env.local`) |

## 7. Jak powtórzyć

```bash
git switch poc/bun-toolchain        # worktree ../bun-react-native-poc
# referencje z prawdziwym Node (raz), potem:
poc-tools/e2e-100.sh                 # wymaga /tmp/bunpoc-tools (shim, env) — patrz nagłówek skryptu
poc-tools/bench.sh                   # pomiary Node vs Bun
```

## 8. Weryfikacja wdrożenia (gałąź `feat/bun-toolchain`, 2026-10-12)

Repo docelowe (aplikacja w katalogu głównym, pliki wg RUNBOOK). PATH bez prawdziwego Node; `node` = `tools/bin/node`.

| Krok | Wynik |
|---|---|
| `bun install --frozen-lockfile` (lockfile z rejestrem domyślnym `""`) | OK, 11 s |
| `bun run typecheck` / `lint` / `test --ci` | 0 błędów / 0 problemów / 8/8 + 2 snapshoty (ten sam wynik pod prawdziwym Node) |
| `bun expo prebuild --clean` | OK; plugin → `ios/.xcode.env`: `export NODE_BINARY=$(command -v bun)` |
| `pod install` | OK; `ios/.xcode.env.local` → `NODE_BINARY=<bun>` |
| Release iOS (`xcodebuild`) | `BUILD SUCCEEDED` (290 s); `main.jsbundle` = bytecode Hermes; aplikacja `dev.bunreactnative.app` startuje na symulatorze bez Metro |
| Release Android (`assembleRelease`) | `BUILD SUCCESSFUL` (145 s); `index.android.bundle` = bytecode Hermes |
| Determinizm na **zimnym cache** (osobny `TMPDIR` na każdy przebieg, pusty `.expo/cache`) | iOS: bundle + sourcemap + assety **identyczne**; Android: **identyczne**; web: **36 plików identycznych**; każdy bundle budowany od zera (~8 s) |
| Kontrola: Bun bez `bunfig.toml` (bez preloadu), zimny cache | **różni się** (`clear-icon.png`, `close-icon.png`) — zgodność wynika z obejścia, nie z cache |

**Pułapka metodologiczna:** cache dyskowy Metro (`$TMPDIR/metro-cache`) jest wspólny dla Node i Buna i bywa
używany mimo `--reset-cache` (`export:embed` Android zaraz po iOS: „Bundled 697ms”). Porównanie Node vs Bun bez
izolacji cache może więc dać fałszywą zgodność. Job `bundle-determinism` w CI używa osobnego `TMPDIR` dla każdego runtime'u.
