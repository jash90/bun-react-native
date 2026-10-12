# Bundler na Bunie (zamiast Metro)

Stan: **2026-10-12**. Kod: [`tools/bun-bundler/`](../../tools/bun-bundler/). Zastępuje Metro we wszystkich ścieżkach:
natywne buildy release (Xcode, Gradle), dev server (`bun run start`: iOS, Android i web — Fast Refresh, debugger,
SSR i trasy API), eksport (`bun run export`: OTA dla EAS Update, web `single`/`static`/`server`). Metro zostaje
wyłącznie jako wyjście awaryjne: `RN_BUNDLER=metro`, `bun run start:metro`, `bun run web:metro`, `bun run export:metro`.

Zasada: **bundlowanie robi Bun** (`Bun.build`, `Bun.serve`, `Worker`, `Bun.hash`), a funkcje Expo CLI, które nie
uruchamiają Metro (manifesty tras, serializacja HTML, favicon, folder `public/`, zapis plików, `metadata.json`,
Hermes, nakładka błędów, `expo-server`), są używane bez zmian ([`expo-helpers.ts`](../../tools/bun-bundler/expo-helpers.ts)).
Dzięki temu wynik ma ten sam układ co `expo export` — sprawdzone plik po pliku (niżej).

## Architektura

| Plik | Odpowiada za | Zastępuje w Metro |
|---|---|---|
| `bundle.ts` | `Bun.build` (graf modułów, linkowanie ESM/CJS, IIFE, minifikacja, sourcemapa) + plugin RN, moduły wirtualne, prelude i polyfille jak w Metro, złożenie map Bun→Babel→źródło, kolejność assetów jak graf Metro | `metro` (DeltaBundler, serializer, `metro-runtime` require) |
| `metro-resolver.ts` | rozwiązywanie Metro: rozszerzenia platform, pola `main`, `exports`/warunki, `node_modules`, `index`, assety (`assetResolutions`) | `metro-resolver` |
| `resolver.ts` | łańcuch resolverów Expo CLI w tej samej kolejności: mock produkcyjnego Reacta w dev, tsconfig `paths`, moduły Node, aliasy (web, vector-icons), rejestr assetów / async require, autolinking „sticky” (monorepo, tvOS/macOS), przepisania po rozwiązaniu (shimy, `HMRClient`, `@react-navigation/core`, moduły tylko natywne, `InitializeCore` na serwerze), resolver zapasowy przez zależności `expo`/`expo-router`; rozszerzenia tvOS/macOS | `withMetroMultiPlatform`, `createExpoAutolinkingResolver`, `createExpoFallbackResolver` |
| `transform-worker.ts` | pula `Worker`ów Buna z transformacją Babel Expo (`@expo/metro-config` babel-transformer z opcjami jak w Metro) poprzedzoną krokami transform-workera Expo (pliki `+api`/`+html`/`+middleware` wycinane z klienta, `.env`, `expo/virtual/env`, `expo/virtual/streams`, wejście komponentu DOM); dev: `import()` jako async require Metro (leniwe bundle); zależności opcjonalne (`try`/`.catch`) jak `allowOptionalDependencies`; metadane `loaderReference`/`expoDomComponentReference` | `metro-transform-worker` + `jest-worker` |
| `assets.ts` | rekord assetu jak `metro/src/Assets.js` (warianty `img@2x.ios.png` zastępują ogólne, kolejność skal jak `readdir` Node, wymiary / skala), `fileHashes` Expo, moduł `registerAsset` | `metro/src/Assets.js` |
| `shared.ts` | projekt (config Expo przez `@expo/config`, `routerRoot`, `baseUrl`), pula transformacji + cache, prelude/polyfille, moduł `require.context` 1:1 z szablonem Metro, kolejność grafu z `metafile` Buna | `metro-config`, `contextModuleTemplates` |
| `dev-graph.ts` | graf modułów dev w formacie Metro (`__d(factory, id, deps, name)` + runtime `require` Expo), mapa sekcyjna, aktualizacje HMR, leniwe bundle `modulesOnly` dla `import()` (mapa `paths` jak `getModuleParams` Metro) | DeltaBundler + `metro-runtime` HMR, `lazy=true` |
| `dev-server.ts` | `Bun.serve`: `/status`, bundle, mapa, `/assets` (jak `getAsset` Metro), `/symbolicate`, WS `/message` i `/hot` (protokół HMR Metro → Fast Refresh), `fs.watch` | `metro` Server + `@expo/cli` dev server |
| `inspector.ts` | proxy inspektora: `/json*`, WS `/inspector/device` i `/inspector/debug` (CDP), `/open-debugger`, front-end React Native DevTools | `@react-native/dev-middleware` |
| `web.ts` | CSS jak transform-worker Expo (PostCSS z konfiguracji projektu, Sass, CSS Modules, lightningcss z `targets` z browserslist, lokalne i zewnętrzne `@import`; dev: `<style>` z HMR; natywnie: `{ unstable_styles: {} }`), assety web, `Bun.build` dla web: `client` (przeglądarka; z `asyncRoutes` dzielony na chunki ES), `render` (render.js dla Buna), `function` (CommonJS: trasy API, middleware, loadery, moduł SSR) | serializer web Metro |
| `loaders.ts` | loadery expo-router (`unstable_useServerDataLoaders`): bundle loadera (`isLoaderBundle`) wykonywany przy eksporcie, w dev i w SSR; `_expo/loaders/*` | `executeServerDataLoaderAsync`, `exportLoadersAsync` |
| `dom.ts` | komponenty DOM (`"use dom"`): strona `/_expo/@dom/…` i osobny graf dev (z HMR), `www.bundle/` w `export:embed`, nazwy md5 + wpisy `metadata.json` w eksporcie OTA | `DomComponentsMiddleware`, `exportDomComponentAsync` |
| `web-dev.ts` | trasy web dev servera: `single` → szablon Expo; `static`/`server` → handler `expo-server` (adapter Bun) z SSR każdej strony, trasami API i middleware; `public/`, generowany `favicon.ico` | `createRouteHandlerMiddleware`, `getStaticPageAsync` |
| `web-export.ts` | eksport web: `single`, `static` (prerender każdej trasy, w tym `[param].html`, `generateStaticParams`, warianty grup), `server` (`dist/client` + `dist/server`, `_expo/functions/*.js`, `_expo/routes.json`, tryb SSR `unstable_useServerRendering`) | `exportFromServerAsync` |
| `export.ts` | `expo export`: natywne bundle → bytecode Hermes `_expo/static/js/<platforma>/entry-<md5>.hbc`, `assets/<md5>`, `metadata.json` (EAS Update), `assetmap.json`; orkiestracja platform | `exportAppAsync` |
| `cli.ts` | `export:embed` (argumenty `react-native bundle`, w tym `--asset-catalog-dest`), `export` (flagi i domyślne platformy z `resolveOptionsAsync` Expo), `start [--web]` | `@expo/cli` |
| `plugins/with-bun-bundler.js` | iOS: `CLI_PATH` w `ios/.xcode.env`; Android: `cliFile` w `app/build.gradle` | — |

Cache transformacji: `node_modules/.cache/bun-rn-bundler/<platforma>[-server]-<dev|prod>/<Bun.hash>.json`, klucz =
treść pliku + opcje + wersje `babel-preset-expo`/`@expo/metro-config` + `EXPO_PUBLIC_*`. `--reset-cache` ze skryptów
natywnych jest ignorowane (klucz po treści); wymuszenie: `BUN_BUNDLER_HONOR_RESET_CACHE=1`.

## Użycie

```bash
bun run start                 # dev server :8081: iOS, Android, web (SSR + trasy API), Fast Refresh; DevTools: http://localhost:8081/open-debugger
bun run web                   # to samo + otwiera przeglądarkę
bun run export                # expo export na Bunie: platformy z configu Expo (iOS + Android + web) -> dist/
bun run export --platform ios --platform android --dump-assetmap --source-maps   # te same flagi co expo export
bun run export:web            # tylko web (wg web.output: single / static / server)
bun run ios | bun run android # build Debug bez uruchamiania Metro (--no-bundler)
RN_BUNDLER=metro …             # ta sama komenda przez Metro (@expo/cli)
```

- **EAS Update** (wymaga skonfigurowanego `expo-updates`, `bunx eas-cli update:configure`): `bun run export --platform ios
  --platform android`, potem `bunx eas-cli update --skip-bundler --channel <kanał> --message "<opis>"` — `eas update`
  publikuje gotowy `dist/` (`--input-dir`, domyślnie `dist`) zamiast uruchamiać Metro.
- **Hosting `server`**: `dist/server` obsługuje `expo-server` (np. adapter Bun: `createRequestHandler({ build: 'dist/server' })`
  z `expo-server/adapter/bun`), `dist/client` to pliki statyczne; EAS Hosting przyjmuje ten sam układ.
- **Release iOS/Android**: bez zmian w komendach — config plugin kieruje fazę bundlowania Xcode i zadanie Gradle
  `createBundle*JsAndAssets` do `cli.ts` (po `prebuild`: `grep CLI_PATH ios/.xcode.env`, `grep cliFile android/app/build.gradle`).
- Dev SSR bez hydratacji, jak w Expo; `EXPO_WEB_DEV_HYDRATE=1` włącza hydratację w dev.

## Pomiary (M1 Pro)

| Bundle release (`--minify false` jak w buildach Hermes) | Metro (na Bunie, zimny) | Bun, zimny cache | Bun, ciepły cache |
|---|---|---|---|
| iOS | 7,82 / 6,87 s | 4,94 / 4,49 s | 0,92 / 0,93 / 0,93 s |
| Android | 7,89 / 7,35 s | 5,19 / 5,35 s | 1,14 / 1,12 / 1,30 s |

| Rozmiar | Metro | Bun |
|---|---|---|
| iOS JS / bytecode Hermes | 5 637 142 / 3 463 154 B | 4 363 281 / 3 136 351 B (−9,4%) |
| Android JS / bytecode Hermes | 5 975 060 / 3 668 076 B | 4 588 098 / 3 321 659 B (−9,4%) |
| JS klienta web (eksport) | 2 137 763 B | 1 655 363 B |

| `export` (iOS + Android + web `static`, ta sama maszyna, obie z cache) | Metro | Bun |
|---|---|---|
| Czas całkowity | 37,7 s | 13,1 s |

Natywne buildy przekazują `--reset-cache`, więc Metro bundluje w nich zawsze na zimno (~7–8 s); bundler Bun korzysta
z cache po treści — faza bundlowania w buildzie Xcode: **1,04 s**. Dev server: pierwszy bundle na zimno 7,2 s
(web 6,6 s), z cache 0,7–2 s; pierwszy SSR po zmianie pliku: przebudowa render.js (~1–5 s), potem ms.

## Weryfikacja (porównanie z Metro plik po pliku)

- **Eksport web**, fikstura z trasami `[id]`, `[slug]` + `generateStaticParams`, grupą `(marketing)` i trasami API
  (`/tmp/bunpoc/wt-web`): `single`, `static` i `server` — identyczny zbiór plików i identyczna treść każdego pliku
  (HTML po normalizacji hasha JS; `routes.json`, `.routes.json`, CSS, assety, `favicon.ico` bajt w bajt). Tryb SSR
  (`unstable_useServerRendering`): identyczny `routes.json`, strona 404 tej samej długości co z Metro.
- **Eksport natywny (OTA)**: ten sam zbiór `assets/<md5>` bajt w bajt, `metadata.json` o tej samej treści (inna jest
  tylko kolejność kluczy `ios`/`android` — Metro bundluje platformy równolegle), `assetmap.json` z identycznymi polami;
  `.hbc` z eksportu uruchomiony w aplikacji Release na symulatorze iOS (render, nawigacja).
- **`export:embed`**: te same pliki assetów co `expo export:embed` (iOS: 34, filtr skal @1x–@3x; Android: 42 z
  `raw/keep.xml`), `hermesc` 0 błędów; aplikacja Release iOS z nowym bundlem — OK.
- **Uruchomienie**: `expo-server` (adapter Bun) serwuje eksport `server`: trasy API (GET/POST, `[id]`), strony
  statyczne, 404; SSR. Playwright: hydratacja (strony z `generateStaticParams` bez ostrzeżeń), dev SSR z
  `EXPO_WEB_DEV_HYDRATE=1` hydratuje bez rozbieżności, Fast Refresh na stronie SSR.
- **Urządzenia (dev)**: iOS i Android — Fast Refresh z zachowaniem stanu (rozwinięta sekcja przetrwała edycję),
  `Runtime.evaluate` przez proxy inspektora (Hermes, Fabric), symbolikacja.
- **Funkcje dodane w drugiej rundzie** (fikstura `/tmp/bunpoc/wt-web`, porównanie z `expo export`/`export:embed` Metro):
  Sass + PostCSS + zewnętrzny `@import` (identyczne pliki CSS i HTML), loadery (`static`: dane i HTML poza arkuszem RNW
  identyczne; `server` + SSR: identyczny `routes.json` i odpowiedzi `expo-server`, dev SSR ze strumieniem), `asyncRoutes`
  (dev: trasy jako leniwe bundle na web i iOS, Fast Refresh w leniwym module; eksport: chunki + `modulepreload`,
  hydratacja i nawigacja w przeglądarce), komponent DOM (dev z HMR w WebView na iOS, `www.bundle` identyczny z Metro i
  działający w aplikacji Release, OTA: bytecode wskazuje HTML po md5), zależności opcjonalne (`react-native-webview`).
- **Release po zmianach**: pełny build Xcode (bundle Bun 12,6 s w fazie Xcode, bytecode Hermes, warianty
  `back-icon@2x/@3x.ios`) uruchomiony na symulatorze; Gradle `createBundleReleaseJsAndAssets` przez Buna.
- Testy: `bun run test:tools` — 28 testów (resolver i warstwy Expo, rekordy assetów Metro, szablon `require.context`,
  kolejność grafu, minifier).

## Ograniczenia (stan obecny)

| Ograniczenie | Skutek | Obejście |
|---|---|---|
| React Server Components / server functions (`experiments.reactServerComponentRoutes`, `reactServerFunctions`, beta w Expo) | `export` kończy się czytelnym błędem; wymagają `react-server-dom-webpack` (nie ma go w projekcie) | `bun run export:metro`, `bun run start:metro` |
| `--unstable-hosted-native`, mapy `inline` (`--source-maps inline`) | nieobsługiwane | Metro |
| tvOS/macOS: rozwiązywanie, rozszerzenia, autolinking i pakiet hosta są przeniesione z Expo, ale bez `react-native-tvos`/`react-native-macos` w projekcie niesprawdzone na urządzeniu | — | — |
| Z `asyncRoutes` eksport web ładuje wejście jako `<script type="module">` (chunki ES Buna), Metro — klasyczne skrypty | te same trasy i pliki statyczne, inne nazwy chunków JS; z `unstable_useServerRendering` bez dzielenia (lista skryptów expo-server to klasyczne skrypty) | — |
| Arkusz atomowych stylów react-native-web w HTML przy loaderach | Expo renderuje strony równolegle przy wspólnym rejestrze stylów; przy loaderach przeplot różni się od Metro, więc lista klas `r-…` w `<style>` strony bywa inna (bez wpływu na działanie, wynik deterministyczny) | — |
| Brak `inlineRequires`, inlinowania `Platform.OS`, constant folding Metro w produkcji | inny (mniejszy) kod; semantyka bez zmian | — |
| Importy nazw, których moduł nie eksportuje (typy TS re-eksportowane bez `export type`) | Bun przerywa linkowanie | bundler dopisuje `export var X = void 0` (semantyka Metro: `undefined`) i linkuje ponownie |
| Prelude i polyfille bez mapowania w sourcemapie | ramki stosu z polyfilli bez źródła | — |
| Proces CLI kończy się przez `process.exit` | zakończone `Worker`y / `Bun.build` potrafią trzymać pętlę zdarzeń (bez tego Xcode czekał bez końca) | — |

Zachowania Expo (nie różnice Buna): trasa dynamiczna bez `generateStaticParams` przy `web.output: "static"` jest
prerenderowana jako `[id].html` z dosłownym `[id]`; serwowana dla `/users/42` daje rozbieżność hydratacji React #418 —
identycznie w eksporcie Metro, zgodnie z dokumentacją Expo („dynamic routes will not work out of the box”). `bun run
export` wypisuje wtedy ostrzeżenie z listą takich plików; rozwiązania: `generateStaticParams` albo `web.output: "server"`
z `unstable_useServerRendering` (sprawdzone: `/users/42` hydratuje się bez błędu). Dev SSR nie hydratuje bez
`EXPO_WEB_DEV_HYDRATE=1` (jak `expo start`); przy `server` + `unstable_useServerRendering` dev renderuje strumieniowo
(`getStreamingContent`) z danymi loaderów, jak Expo.
