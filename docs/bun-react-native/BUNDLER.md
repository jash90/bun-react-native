# Bundler na Bunie (opcjonalny silnik zamiast Metro)

Stan: **2026-10-12**. Kod: [`tools/bun-bundler/`](../../tools/bun-bundler/). **Od paczki `bun-react-native` 0.1.0
domyślnym silnikiem jest Metro na runtime Buna** (bajt w bajt jak Metro na Node, mniej punktów zaczepienia w
wewnętrznych modułach Expo, w pomiarach nie wolniejsze — decyzja z analizy 2026-10-12, HISTORY etap 13). Bundler Buna
włącza `RN_BUNDLER=bun` dla zwykłych komend Expo (preload `tools/bun/expo-cli.preload.js`): natywne buildy release
(Xcode, Gradle, prebundle `expo run:* Release`), dev server (`expo start` / `run:*`: iOS, Android i web — Fast
Refresh, debugger, SSR i trasy API), eksport (`expo export`: OTA dla EAS Update, web `single`/`static`/`server`),
zasoby `expo-updates`. Projekty z RSC albo nieobsługiwanym `metro.config.js` zostają wtedy na Metro (na Bunie).

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
| `dev-graph.ts` | graf modułów dev w formacie Metro (`__d(factory, id, deps, name)` + runtime `require` Expo), aktualizacje HMR, leniwe bundle `modulesOnly` dla `import()`; iOS/Android: moduły z `metro-transformer.ts`, serializacja z `dev-graph-metro.ts` (bajt w bajt jak Metro), web: własna transformacja i mapa sekcyjna | DeltaBundler + `metro-runtime` HMR, `lazy=true` |
| `metro-transformer.ts` | `Transformer` Metro (cache Metro w `cacheStores`, worker z `transformerPath` na wątkach Buna) z configiem Expo; opcje per plik jak `transformHelpers` Metro, `pruneCustomTransformOptions` Expo, moduły wirtualne i szablony `require.context` | `metro/DeltaBundler/Transformer` |
| `dev-graph-metro.ts` | serializacja jak `metro/Server`: moduły wstępne (`getPrependedScripts`), wspólna fabryka ID serwera, kolejność `reorderGraph`, `customSerializer` z configu, mapa `sourceMapString`, HMR przez `hmrJSBundle` Expo, zdarzenia reportera (`bundle_build_*`) | `metro/Server`, `HmrServer` |
| `dev-server.ts` | `Bun.serve`: `/status`, bundle, mapa, `/assets` (jak `getAsset` Metro), `/symbolicate`, WS `/message` i `/hot` (protokół HMR Metro → Fast Refresh), `fs.watch` | `metro` Server + `@expo/cli` dev server |
| `inspector.ts` | proxy inspektora: `/json*`, WS `/inspector/device` i `/inspector/debug` (CDP), `/open-debugger`, front-end React Native DevTools | `@react-native/dev-middleware` |
| `web.ts` | CSS jak transform-worker Expo (PostCSS z konfiguracji projektu, Sass, CSS Modules, lightningcss z `targets` z browserslist, lokalne i zewnętrzne `@import`; dev: `<style>` z HMR; natywnie: `{ unstable_styles: {} }`), assety web, `Bun.build` dla web: `client` (przeglądarka; z `asyncRoutes` dzielony na chunki ES), `render` (render.js dla Buna), `function` (CommonJS: trasy API, middleware, loadery, moduł SSR) | serializer web Metro |
| `loaders.ts` | loadery expo-router (`unstable_useServerDataLoaders`): bundle loadera (`isLoaderBundle`) wykonywany przy eksporcie, w dev i w SSR; `_expo/loaders/*` | `executeServerDataLoaderAsync`, `exportLoadersAsync` |
| `dom.ts` | komponenty DOM (`"use dom"`): strona `/_expo/@dom/…` i osobny graf dev (z HMR), `www.bundle/` w `export:embed`, nazwy md5 + wpisy `metadata.json` w eksporcie OTA | `DomComponentsMiddleware`, `exportDomComponentAsync` |
| `web-dev.ts` | trasy web dev servera: `single` → szablon Expo; `static`/`server` → handler `expo-server` (adapter Bun) z SSR każdej strony, trasami API i middleware; `public/`, generowany `favicon.ico` | `createRouteHandlerMiddleware`, `getStaticPageAsync` |
| `web-export.ts` | eksport web: `single`, `static` (prerender każdej trasy, w tym `[param].html`, `generateStaticParams`, warianty grup), `server` (`dist/client` + `dist/server`, `_expo/functions/*.js`, `_expo/routes.json`, tryb SSR `unstable_useServerRendering`) | `exportFromServerAsync` |
| `export.ts` | `expo export`: natywne bundle → bytecode Hermes `_expo/static/js/<platforma>/entry-<md5>.hbc`, `assets/<md5>`, `metadata.json` (EAS Update), `assetmap.json`; orkiestracja platform | `exportAppAsync` |
| `cli.ts` | uruchamia binarkę Expo CLI (`start`, `export`, `export:embed`/`bundle`) po podmianie modułów bundlera Expo na Buna — argumenty, pomoc, walidacja i UI są Expo; projekty z RSC i z nieobsługiwanym `metro.config.js` zostają przy Metro | `@expo/cli` |
| `metro-on-bun.ts` | każdy proces Expo CLI na Bunie (preload, `cli.ts`), gdy działa Metro: `WorkerFarm` na wątkach Buna z shimami, `EXPO_PUBLIC_*` w `cacheVersion`, polyfill RSC w dev — przez `withMetroMultiPlatformAsync` Expo, więc także dla obcych `metro.config.js` | — |
| `updates.ts` | `expo-updates` w buildach Release/Debug: `createUpdatesResources.js` dostaje assety `app.manifest` z grafu bundlera Buna (ten sam wpis, platforma i tryb) zamiast z serwera Metro — `createMetroServerAndBundleRequestAsync`/`exportEmbedAssetsAsync` z `expoUpdatesExports` Expo podmienione przez preload | `createManifestForBuildAsync` + Metro |
| `metro-config-support.ts` | porównuje `metro.config.js` z `getDefaultConfig` Expo: `resolver.sourceExts`, `resolver.assetExts` i `transformer.babelTransformerPath` obsługuje bundler Buna, każda inna zmiana (oraz RSC, config jako funkcja/promise) przełącza komendę na Metro na runtime Buna z komunikatem o przyczynie | `loadConfig` Metro |
| `expo-dev-server.ts` | `RN_BUNDLER=bun bun expo start` = `expo start`: `BunBundlerDevServer` (podklasa `BundlerDevServer` Expo) zamiast `MetroBundlerDevServer` — QR, klawisze `s/a/i/w/r/j/m/o/c/?`, Expo Go (pobranie i uruchomienie) i development buildy, tunel, Bonjour, typy tras; middleware Expo (manifest Expo Go / dev clientów, `/_expo/loading`, `/_expo/link`, `/_expo/plugins`, `/_expo/open`, `/_expo/touch`, `/_expo/error-overlay-meta`, `/_expo/debugger`) na wewnętrznym `node:http` + `connect`, CORS Expo dla każdego żądania | `MetroBundlerDevServer`, `instantiateMetro` |
| `message-socket.ts` | `/message` w protokole Expo (`getid`, `getpeers`, żądania między klientami, broadcast tylko `reload`/`devMenu` od zaufanych klientów); `/expo-dev-plugins/broadcast` | `createMessageSocket`, `DevToolsPluginWebsocketEndpoint` |
| `embed.ts` | `export:embed`: moduł `exportEmbedAsync` Expo przepięty na Buna (`installBunExportEmbed`) — Expo parsuje argumenty i godzi bundle „eager”; Bun robi bundle, mapę, assety, `--bytecode`, eksport serwera (`web.output: "server"` → `.expo/server/<platform>`), komponenty DOM, błędy w formacie Xcode. `tools/bun/expo-cli.preload.js` zakłada to samo w procesach `expo run:*`/`export:embed`, więc prebundle „eager” robi Bun | `@expo/cli/build/src/export/embed` |
| `env.ts` | pliki `.env` jak Expo CLI (`.env.<tryb z --dev>`, zmienne z powłoki wygrywają, przeładowanie w dev); automatyczne wczytywanie Buna wyłączone (`bunfig.toml` `env = false`) | `@expo/cli` `utils/nodeEnv`, `@expo/env` |
| `sourcemap.ts` | mapy w kształcie Expo: prelude/polyfille/graf sklejone z mapowaniami, źródła `/` względem roota serwera, `?ctx=` dla `require.context`, `x_google_ignoreList`, `x_facebook_sources`, `debugId`; mapy dev jak w Metro (ścieżki bezwzględne) | `@expo/metro-config` `serializer/sourceMap`, `metro-source-map` Generator |
| `../bun/expo-cli.preload.js` (preload paczki) | kieruje `expo start|run:*|export|export:embed` i `createUpdatesResources.js` do bundlera Buna przy `RN_BUNDLER=bun`; kroki bundlowania Xcode/Gradle startują z katalogu aplikacji, więc działa bez zmian w plikach natywnych | — |

Cache transformacji: `node_modules/.cache/bun-rn-bundler/<platforma>[-server]-<dev|prod>/<Bun.hash>.json`, klucz =
treść pliku + opcje + wersje `babel-preset-expo`/`@expo/metro-config` + `EXPO_PUBLIC_*`. `--reset-cache` ze skryptów
natywnych jest ignorowane (klucz po treści); wymuszenie: `BUN_BUNDLER_HONOR_RESET_CACHE=1`.

## Użycie

```bash
RN_BUNDLER=bun bun expo start     # serwer Buna: QR, Expo Go / development build, klawisze s/a/i/w/r/j/m/o/?, web SSR + trasy API
RN_BUNDLER=bun bun expo start --web
RN_BUNDLER=bun bun expo export    # platformy z configu Expo (iOS + Android + web) -> dist/; te same flagi co expo export
RN_BUNDLER=bun bun expo export --platform web
RN_BUNDLER=bun bun expo run:ios   # dev server Buna; z --configuration Release prebundle i faza Xcode przez Buna
bun expo start                    # bez RN_BUNDLER: Metro na runtime Buna (domyślny silnik)
bunx bun-react-native compare dist-metro dist-bun   # porównanie eksportów Metro vs bundler Buna
```
`RN_BUNDLER=bun` musi być ustawione także dla buildów natywnych uruchamianych poza `bun expo run:*` (Xcode, Gradle
czytają je ze środowiska procesu budującego). `tools/bun-bundler/cli.ts` (`bun …/cli.ts start|export|export:embed`)
robi to samo co preload i zostaje dla uruchomień bez `bunfig.toml`.

`export:embed` na Metro (domyślnie) pomija `--reset-cache` z Xcode/Gradle, tak jak Expo robi to w CI
(`exportEmbedAsync.js:202-207`), więc ciepły bundle release trwa ~1,5 s zamiast ~8 s. Klucze cache Metro obejmują
treść plików, config transformera i Babel, a `metro-on-bun.ts` dopisuje do `cacheVersion` hash zmiennych
`EXPO_PUBLIC_*` i `BABEL_ENV` (w produkcji wstawianych przy transformacji; Expo ich w kluczu nie ma). Wynik ciepły jest
bajt w bajt równy zimnemu, a zmiana zmiennej unieważnia cache. `RN_BUNDLER_RESET_CACHE=1` przywraca reset.

- **EAS Update** (wymaga skonfigurowanego `expo-updates`, `bunx eas-cli update:configure`): `bun expo export --platform ios
  --platform android` (z `RN_BUNDLER=bun` albo bez), potem `bunx eas-cli update --skip-bundler --channel <kanał> --message "<opis>"` — `eas update`
  publikuje gotowy `dist/` (`--input-dir`, domyślnie `dist`) zamiast uruchamiać Metro.
- **Hosting `server`**: `dist/server` obsługuje `expo-server` (np. adapter Bun: `createRequestHandler({ build: 'dist/server' })`
  z `expo-server/adapter/bun`), `dist/client` to pliki statyczne; EAS Hosting przyjmuje ten sam układ.
- **Release iOS/Android**: bez zmian w natywnych plikach — faza bundlowania Xcode i zadanie Gradle
  `createBundle*JsAndAssets` uruchamiają `@expo/cli export:embed` z katalogu aplikacji, więc preload z `bunfig.toml`
  wybiera silnik (Metro na Bunie albo `RN_BUNDLER=bun`).
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

**Pomiar powtórzony 2026-10-12** (ta sama maszyna, 10 rdzeni; Metro na Bunie z `WorkerFarm` na wątkach Buna
i z procesami jest-worker; zimny = świeży `TMPDIR` + `--reset-cache`/`--clear`, u nas pusty `node_modules/.cache/bun-rn-bundler`):

| | Metro, wątki Buna | Metro, jest-worker | Bun |
|---|---|---|---|
| `export:embed` iOS, zimny / ciepły | 7,65 / 1,85 s | 7,76 / 1,82 s | 6,11 s / — |
| `export:embed` Android, zimny | 8,43 s | 10,23 s | — |
| `export` iOS + Android + web, zimny | 29,0 s | 28,1 s | 28,8 s |
| `export` iOS + Android + web, ciepły | 10,7 s | — | 12,5 s |
| pierwszy bundle dev iOS (`expo start`), zimny | 5,3 s | 6,5 s | — |

Wynik z tabeli wyżej (`export` 37,7 s vs 13,1 s) **nie powtarza się**: dziś Metro na Bunie eksportuje tak samo szybko
na zimno i szybciej na ciepło niż bundler Buna. W obu potokach dominuje transformacja Babel (~30–35 s CPU na zimno).
Przewaga bundlera Buna to cache przeżywający `--reset-cache` buildów natywnych (~1 s zamiast ~8 s) i mniejsze bundle.
Wnioski: [PLAN-1TO1.md § 2a](PLAN-1TO1.md#2a-ponowna-ocena-po-pomiarach-2026-10-12).

Natywne buildy przekazują `--reset-cache`, więc Metro bundluje w nich zawsze na zimno (~7–8 s); bundler Bun korzysta
z cache po treści — faza bundlowania w buildzie Xcode: **1,04 s**. Dev server (iOS/Android po fazie 3: transformacja Metro): pierwszy bundle na zimno ~7 s jak Metro, z cache Metro
~1,5 s; wcześniej (własna transformacja): pierwszy bundle na zimno 7,2 s
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
- **Strict mode, `--unstable-hosted-native`, `--source-maps inline`** (trzecia runda): porównanie
  `bun run compare:export <metro> <bun>` daje 0 różnic dla `-p ios --unstable-hosted-native` (± `--no-bytecode`;
  assety `assets/<ścieżka>/<nazwa>.<md5>@Nx.png`, identyczne obiekty `registerAsset`), `--source-maps inline` (iOS
  z Hermesem: sam `.hbc`; bez bytecode: mapa jako `data:` URL; web: jak Expo — zewnętrzny `.map`) i pełnego eksportu
  projektu. Bundle z `"use strict"`: `hermesc` 0 błędów, aplikacje Release iOS i Android, eksport web w przeglądarce.
- **`.env`, `export:embed`, mapy źródeł** (czwarta runda): `EXPO_PUBLIC_*` z `.env.production` w `export:embed --dev
  false` (bezpośrednio i przez shim) i OTA, z `.env.development` w dev (z przeładowaniem) — jak Metro; `--bytecode` jak
  Metro; mapy embed/OTA/web z tymi samymi kluczami co Metro (`debugId`, `x_google_ignoreList`, `x_facebook_sources`,
  prelude/polyfille), bez bezwzględnych ścieżek dysku, te same pozycje źródłowe co Metro; mapy dev jak Metro.
- **`expo start` / Expo Go / eager / nazwy chunków** (piąta runda): Expo Go SDK 57 na symulatorze ładuje aplikację z
  serwera Buna (manifest, bundle, menu Expo Go, reload, Fast Refresh); manifesty i odpowiedzi `/_expo/*` jak z Metro;
  `expo run:ios --configuration Release` — prebundle i faza Xcode przez Buna, aplikacja uruchomiona; Gradle
  `createBundleReleaseJsAndAssets` przez komendę Expo; eksport web z `asyncRoutes` z nazwami Metro ładuje się w
  przeglądarce bez błędów; projekt z `reactServerFunctions` eksportuje się przez Metro z naszego CLI.
- Testy: `bun run test:tools` — 39 testów (resolver i warstwy Expo, rekordy assetów Metro, szablon `require.context`,
  kolejność grafu, minifier).

## Ograniczenia (stan obecny)

| Ograniczenie | Skutek | Obejście |
|---|---|---|
| React Server Components / server functions (`experiments.reactServerComponentRoutes`, `reactServerFunctions`, beta w Expo) | implementacja Expo jest związana z runtime i ID modułów Metro (moduły `react-server` wykonywane jako bundle Metro w Node, granice klienta jako leniwe bundle `xRSC`); `start`, `export` i `export:embed` same przełączają takie projekty na Metro (na runtime Buna) | — (automatycznie) |
| `metro.config.js` poza rozszerzeniami i `babelTransformerPath` (własny `transformerPath` — NativeWind/Uniwind, `customSerializer` — Sentry/Atlas, `resolveRequest`, `getPolyfills`, `createModuleIdFactory`, middleware serwera…) | bundler Buna by je pominął; komendy same przechodzą na Metro na runtime Buna (komunikat: `Bun bundler: export:embed runs on Metro (Bun runtime) - metro.config: serializer.customSerializer`), wynik = Metro na Node bajt w bajt | — (automatycznie) |
| Tryb ścisły: Bun łączy moduły w jedną funkcję IIFE, więc bundler wstawia na jej początek `"use strict"` (Metro dodaje go do każdego modułu ES) | moduły czysto CommonJS, które w Metro działają w trybie nieścisłym, u nas są ścisłe (np. przypisanie do niezadeklarowanej zmiennej rzuca wyjątek) | kod modułu poprawić albo przenieść do ES |
| tvOS/macOS: rozwiązywanie, rozszerzenia, autolinking i pakiet hosta są przeniesione z Expo, ale bez `react-native-tvos`/`react-native-macos` w projekcie niesprawdzone na urządzeniu | — | — |
| Z `asyncRoutes` eksport web ładuje wejście jako `<script type="module">` (chunki ES Buna), Metro — klasyczne skrypty | nazwy jak w Metro (`<trasa>-<md5>.js`, `__common-<md5>.js`, `__expo-metro-runtime-<md5>.js`, każdy z mapą), ale Bun dzieli wspólny kod na kilka plików `__common-*` (Metro na jeden); z `unstable_useServerRendering` bez dzielenia (lista skryptów expo-server to klasyczne skrypty) | — |
| Arkusz atomowych stylów react-native-web w HTML przy loaderach | Expo renderuje strony równolegle przy wspólnym rejestrze stylów; przy loaderach przeplot różni się od Metro, więc lista klas `r-…` w `<style>` strony bywa inna (bez wpływu na działanie, wynik deterministyczny) | — |
| Brak `inlineRequires`, inlinowania `Platform.OS`, constant folding Metro w produkcji | inny (mniejszy) kod; semantyka bez zmian | — |
| Importy nazw, których moduł nie eksportuje (typy TS re-eksportowane bez `export type`) | Bun przerywa linkowanie | bundler dopisuje `export var X = void 0` (semantyka Metro: `undefined`) i linkuje ponownie |
| Błąd Expo SDK 57: klucz prebundla „eager” `expo run:* Release` nie zawiera `skipServer`, a klucz fazy Xcode/Gradle tak (`"skipServer":false`) | prebundle nigdy nie pasuje i faza natywna bundluje drugi raz — tak samo jak z Metro; u nas oba bundle robi Bun (~2 s) | — |
| Proces CLI kończy się przez `process.exit` | zakończone `Worker`y / `Bun.build` potrafią trzymać pętlę zdarzeń (bez tego Xcode czekał bez końca) | — |

Zachowania Expo (nie różnice Buna): trasa dynamiczna bez `generateStaticParams` przy `web.output: "static"` jest
prerenderowana jako `[id].html` z dosłownym `[id]`; serwowana dla `/users/42` daje rozbieżność hydratacji React #418 —
identycznie w eksporcie Metro, zgodnie z dokumentacją Expo („dynamic routes will not work out of the box”). `bun run
export` wypisuje wtedy ostrzeżenie z listą takich plików; rozwiązania: `generateStaticParams` albo `web.output: "server"`
z `unstable_useServerRendering` (sprawdzone: `/users/42` hydratuje się bez błędu). Dev SSR nie hydratuje bez
`EXPO_WEB_DEV_HYDRATE=1` (jak `expo start`); przy `server` + `unstable_useServerRendering` dev renderuje strumieniowo
(`getStreamingContent`) z danymi loaderów, jak Expo.
