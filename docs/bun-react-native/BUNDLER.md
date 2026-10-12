# Bundler na Bunie (zamiast Metro)

Stan: **2026-10-12**. Kod: [`tools/bun-bundler/`](../../tools/bun-bundler/). Natywne buildy release (Xcode, Gradle),
dev server (`bun run start`: iOS, Android i web, z Fast Refresh i debuggerem) oraz eksport web
(`bun run export:web`) używają go zamiast Metro; Metro zostaje jako wyjście awaryjne (`RN_BUNDLER=metro`,
`bun run start:metro`, `bun run web:metro`) i do eksportu OTA (`expo export`).

## Architektura

| Plik | Odpowiada za | Zastępuje w Metro |
|---|---|---|
| `bundle.ts` | `Bun.build` (graf modułów, linkowanie ESM/CJS, IIFE, minifikacja, sourcemapa) + plugin RN, moduły wirtualne, prelude i polyfille jak w Metro, złożenie map Bun→Babel→źródło | `metro` (DeltaBundler, serializer, `metro-runtime` require) |
| `resolver.ts` | rozwiązywanie modułów 1:1 z Metro + warstwy Expo CLI (tsconfig `paths`, alias vector-icons, wirtualny rejestr assetów, `HMRClient` → `expo/src/async-require/hmr.ts`) | `metro-resolver`, `@expo/cli` resolver |
| `transform-worker.ts` | pula `Worker`ów Buna z tą samą transformacją Babel co Expo (`@expo/metro-config` babel-transformer, `caller` jak w Metro, `experimentalImportSupport`), przepisanie `require.context` | `metro-transform-worker` + `jest-worker` |
| `assets.ts` | metadane assetów jak w Metro (skale, md5, wymiary z nagłówków PNG/JPEG/GIF/WebP), moduł `registerAsset`, układ plików iOS (`assets/…@2x.png`) i Android (`drawable-*dpi`, `raw`) | `metro/src/Assets.js`, `@react-native/assets-registry/path-support` |
| `dev-graph.ts` | graf modułów dev w formacie Metro (`__d(factory, id, deps, name)` + runtime `require` Expo), serializacja z mapą sekcyjną, aktualizacje HMR (zmienione + nowe moduły, odwrotne zależności) | DeltaBundler + `metro-runtime` HMR |
| `dev-server.ts` | `Bun.serve`: `/status`, bundle, mapa, `/assets`, `/symbolicate`, WS `/message` i `/hot` (protokół HMR Metro → Fast Refresh, logi urządzenia/przeglądarki), `fs.watch` → aktualizacja HMR; web: dokument HTML (szablon Expo / `public/index.html`) + `/favicon.ico` | `metro` Server + `@expo/cli` dev server |
| `inspector.ts` | proxy inspektora: `/json`, `/json/list`, `/json/version`, WS `/inspector/device` i `/inspector/debug` (CDP przez `wrappedEvent`), `/open-debugger`, front-end React Native DevTools z `@react-native/debugger-frontend` | `@react-native/dev-middleware` InspectorProxy |
| `web.ts` | CSS (CSS Modules i globalne przez transformację Expo/lightningcss; dev: `<style>` z HMR), assety web (`nazwa.<md5>`), eksport statyczny: bundle klienta (`Bun.build`, browser) + bundle serwerowy `@expo/router-server/node/render.js` (target bun) → `getManifest` + `getStaticContent` dla każdej trasy | `expo export -p web` (Metro + `exportStaticAsync`) |
| `cli.ts` | `export:embed` (argumenty jak `expo export:embed`/`react-native bundle`), `export --platform web`, `start [--web]` | `@expo/cli` |
| `plugins/with-bun-bundler.js` | iOS: `CLI_PATH` w `ios/.xcode.env`; Android: `cliFile` w `app/build.gradle` | — |

Cache transformacji: `node_modules/.cache/bun-rn-bundler/<platforma>-<dev|prod>/<Bun.hash>.json`, klucz = treść pliku +
opcje + wersje `babel-preset-expo`/`@expo/metro-config` + `EXPO_PUBLIC_*`. `--reset-cache` ze skryptów natywnych jest
ignorowane (klucz po treści); wymuszenie: `BUN_BUNDLER_HONOR_RESET_CACHE=1`.

## Użycie

```bash
bun run start                 # dev server na :8081 (zamiast Metro): iOS, Android, web, Fast Refresh; DevTools: http://localhost:8081/open-debugger
bun run web                   # to samo + otwiera http://localhost:8081 w przeglądarce
bun run export:web            # eksport statyczny web (Expo Router, web.output "static") do dist/
bun run ios | bun run android # build Debug bez uruchamiania Metro (--no-bundler)
bun tools/bun-bundler/cli.ts export:embed --platform ios --dev false --minify false \
  --entry-file node_modules/expo-router/entry.js --bundle-output main.jsbundle --assets-dest out --sourcemap-output main.map
RN_BUNDLER=metro …             # ta sama komenda przez Metro (@expo/cli)
```
Release iOS/Android: bez zmian w komendach — config plugin kieruje fazę bundlowania Xcode i zadanie Gradle
`createBundle*JsAndAssets` do `cli.ts` (sprawdź po `prebuild`: `grep CLI_PATH ios/.xcode.env`, `grep cliFile android/app/build.gradle`).

## Pomiary (M1 Pro, nieobciążona maszyna, `--minify false` jak w buildach Hermes)

| Bundle release | Metro (na Bunie, zimny) | Bun, zimny cache | Bun, ciepły cache |
|---|---|---|---|
| iOS | 7,82 / 6,87 s | 4,94 / 4,49 s | 0,92 / 0,93 / 0,93 s |
| Android | 7,89 / 7,35 s | 5,19 / 5,35 s | 1,14 / 1,12 / 1,30 s |

| Rozmiar | Metro | Bun |
|---|---|---|
| iOS JS / bytecode Hermes | 5 637 142 / 3 463 154 B | 4 363 281 / 3 136 351 B (−9,4%) |
| Android JS / bytecode Hermes | 5 975 060 / 3 668 076 B | 4 588 098 / 3 321 659 B (−9,4%) |

Natywne buildy przekazują `--reset-cache`, więc Metro bundluje w nich zawsze na zimno (~7–8 s); bundler Bun
korzysta z cache po treści — faza bundlowania w buildzie Xcode: **1,04 s**.
Dev server: pierwszy bundle dev na zimno 7,2 s (web: 6,6 s, 1274 moduły), z cache 0,7–1,2 s; aktualizacja HMR po
edycji dotyczy tylko zmienionych modułów.

| Eksport web (`web.output: "static"`) | Metro | Bun |
|---|---|---|
| Trasy HTML / CSS / assety | 4 / 2 / 36 plików | identyczne nazwy plików (te same hashe CSS i assetów) |
| JS klienta | 2 137 763 B | 1 655 363 B |
| Czas | — | 1,8–1,9 s |

## Weryfikacja

- Zbiór modułów identyczny z Metro (1524 pliki; różnica: polyfill `require` Metro — niepotrzebny, oraz pliki skal
  assetów, które Metro trzyma w metadanych zamiast na liście modułów).
- `hermesc`: 0 błędów (iOS, Android, release i dev).
- Urządzenia: release iOS (Xcode → `cli.ts`) i release Android (Gradle → `cli.ts`, APK na emulatorze API 36):
  routing expo-router (`require.context`), obrazy z `@2x/@3x` (`drawable-*dpi`), animacje Reanimated/worklets — OK.
- Debug iOS i Android + `bun run start`: Fast Refresh z zachowaniem stanu, nakładka błędu składni i powrót po
  poprawce, nowa trasa aktualizuje `require.context`, `Runtime.evaluate` przez nasze proxy inspektora na obu urządzeniach.
- Web (Playwright): eksport statyczny — hydratacja, nawigacja klienta, CSS Modules, obrazy, interakcje (Reanimated),
  0 ostrzeżeń w konsoli; HTML różni się od Metro tylko białymi znakami. Dev — renderowanie, głębokie linki (`/explore`),
  Fast Refresh (stan strony zachowany), HMR CSS (tag `<style>` podmieniony w miejscu), logi przeglądarki w terminalu.
- Symbolikacja: `POST /symbolicate` → `src/app/explore.tsx:14` (`export default function TabTwoScreen()`); sourcemapa
  release: 91,5% segmentów z nazwą trafia w ten sam identyfikator w źródle (Metro: 80,4%).
- Testy: `bun run test:tools` — 11 testów resolvera (rozszerzenia platform, pola `react-native`/`browser`, web,
  `exports` z warunkami i wzorcami, assety ze skalami, tsconfig, warstwy Expo) + 5 testów minifiera.

## Ograniczenia (stan obecny)

| Ograniczenie | Skutek | Obejście |
|---|---|---|
| Web dev renderuje po stronie klienta (bez SSR w dev) | pierwszy HTML w dev jest pusty do załadowania JS; eksport statyczny ma pełny SSR | — |
| Eksport web: tylko `web.output: "static"` bez tras API i dynamicznych segmentów `[param]` (pomijane w HTML) | trasy dynamiczne działają po stronie klienta | `bun run web:metro` / `expo export` dla `server` output |
| Eksport OTA (`expo export` dla iOS/Android, `eas update`) | nadal Metro | — |
| Bundle dev zawiera oba warianty `react-dom` (production + development), bo `require` warunkowy nie jest eliminowany w dev | większy bundle dev web | — |
| Brak `inlineRequires`, inlinowania `Platform.OS`, constant folding Metro | inny (mniejszy) kod; semantyka bez zmian | — |
| Importy nazw, których moduł nie eksportuje (typy TS re-eksportowane bez `export type`) | Bun przerywa linkowanie | bundler dopisuje `export var X = void 0` (semantyka Metro: `undefined`) i linkuje ponownie |
| Prelude i polyfille bez mapowania w sourcemapie | ramki stosu z polyfilli bez źródła | — |
| `require.context` tylko w trybie `sync` | brak `asyncRoutes` expo-router | — |
| „Sticky” rozwiązywanie autolinkingu Expo nie jest zaimplementowane | bez znaczenia przy linkerze `hoisted` (jedna kopia pakietu) | `linker = "hoisted"` |
| Proces CLI kończy się przez `process.exit` | zakończone `Worker`y / `Bun.build` potrafią trzymać pętlę zdarzeń (bez tego Xcode czekał bez końca) | — |
