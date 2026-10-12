# Plan: bundler na Bunie 1:1 z Expo CLI / Metro

Stan na 2026-10-12, gałąź `feat/bun-toolchain` (`6d37917`). Wersje: expo 57.0.27, @expo/cli 57.0.28, @expo/metro-config
57.0.13, metro 0.84.5, react-native 0.86, Bun 1.4.3.

Plan powstał z analizy kodu w `node_modules` (odwołania `plik:linia` poniżej) oraz źródeł z sieci: dokumentacji Expo
(Expo Updates v1, React Server Components, Testing RSC, EAS Update debug) i repozytoriów pluginów Metro (NativeWind,
Uniwind, react-native-svg-transformer, Sentry, Storybook, expo-atlas). Szacunki to dni pracy z weryfikacją na
urządzeniach; to oceny, nie pomiary. Skróty ścieżek: **CLI** = `node_modules/@expo/cli/build/src`,
**MC** = `node_modules/@expo/metro-config/build`, **M** = `node_modules/metro/src`.

## 1. Gdzie jesteśmy, a co znaczy „1:1”

Dziś zgodne z Expo jest wszystko, co wychodzi poza bundler: pliki eksportu (0 różnic w `compare:export`, bez treści
bundli JS), assety, `metadata.json`, HTML, mapy źródeł (kształt), `.env`, interfejs `expo start`, Expo Go, `export:embed`
(łącznie z prebundlem eager). Różnią się:

1. **Treść bundli produkcyjnych** — `Bun.build` łączy moduły w jedną przestrzeń; Metro opakowuje każdy w `__d(...)`.
   Inna kolejność wykonania przy cyklach importów, inne interopy `import`/`export`, brak zwijania stałych w
   transformacji, inne ID modułów, wspólny kod web w kilku plikach `__common`.
2. **`metro.config.js` nie jest czytany** — rozszerzenia, resolver, transformer, serializer, middleware z configu są
   ignorowane (`tools/bun-bundler/shared.ts:13-14,298,304`, `transform-worker.ts:74,254-268`).
3. **Serwer dev** — błędy i braki opisane w fazie 0 i 3.
4. **`expo-updates`** — przy tym pakiecie build Release generuje `app.manifest` przez prawdziwe Metro.
5. **React Server Components** — automatycznie przez Metro.

„1:1” w tym planie oznacza: **identyczne bajt w bajt bundle bez minifikacji** (`export:embed --minify false`, jedna
platforma na przebieg) i identyczne zachowanie wszystkich endpointów i komend Expo. Przy minifikacji wynik zależy od
minifikatora: terser = identyczny z Metro; minifikator Buna (`tools/bun/metro-minifier.js`) = ten sam kod, inne bajty.

## 2. Kluczowa decyzja architektoniczna

Wszystkie cztery analizy prowadzą do jednego wniosku: **zamiast odtwarzać Metro, wykonywać kod Expo/Metro w Bunie i
zastąpić tylko to, co jest wolne lub związane z serwerem Metro.**

- transformacja: prawdziwy worker Expo `MC/transform-worker/transform-worker.js:74` (`transform(config, projectRoot,
  filename, data, options)`) uruchamiany w workerach Buna — daje dokładnie kod Metro (`__d` z żywymi wiązaniami
  `_$$_IMPORT_DEFAULT`, zwijanie stałych w produkcji, `"use strict"`, mapy, `functionMap`, metadane RSC);
- graf: nasz resolver (port łańcucha Expo) + kolejność DFS jak `M/DeltaBundler/Graph.js:371-410`;
- serializacja: prawdziwy `graphToSerialAssetsAsync` Expo (`MC/serializer/serializeChunks.js:49`) na grafie w kształcie
  obiektów Metro — chunki, hashe nazw, `paths`, `debugId`, Hermes, HTML web jak w Expo;
- config: prawdziwy `loadUserConfig` (`MC/config/loadUserConfig.js`) + `withMetroMultiPlatformAsync`
  (`CLI/start/server/metro/withMetroMultiPlatform.js:782`), tak jak w `CLI/start/server/metro/instantiateMetro.js:198-260`.

Ten sam „graf w kształcie Metro” jest potrzebny w czterech miejscach naraz: serializer produkcyjny, `customSerializer`
z `metro.config.js` (Sentry, Expo Atlas), RSC (ID modułów, `ssrLoadModule`) i Expo Atlas. Dlatego to faza 1, a reszta
na niej stoi.

**Konsekwencje (do akceptacji):**

| | Format Metro (1:1) | `Bun.build` (dziś) |
|---|---|---|
| Semantyka wykonania | jak Metro (moduł wykonuje się przy pierwszym `require`, ta sama kolejność cykli) | hoisting ES, inna kolejność przy cyklach |
| Rozmiar bundla | większy: każdy moduł z wrapperem i tablicą zależności, bez usuwania nieużywanego kodu (tree shaking Expo SDK 57 jest domyślnie wyłączony: `CLI/utils/env.js:209-213`, `CLI/start/server/middleware/metroOptions.js:78-84`) | mniejszy (scope hoisting, DCE) |
| Szybkość | transformacja Babel i tak dominuje; minifikacja per moduł wolniejsza niż jedna Buna | najszybszy |

Propozycja: format Metro jako domyślny (cel 1:1), `Bun.build` zostaje jako opcja (`BUN_BUNDLER_FORMAT=bun`).

## 2a. Ponowna ocena po pomiarach (2026-10-12)

Test wykonalności przed fazą 1 zmienił obraz. **Fakty** (pomiary w [BUNDLER.md](BUNDLER.md#pomiary-m1-pro)):

1. Prawdziwe Metro działa na Bunie (`RN_BUNDLER=metro`, `start:metro`, `export:metro`) i daje bajty Metro: bundle i
   mapy `export:embed` iOS/Android identyczne niezależnie od rodzaju workerów, `export` identyczny poza `.hbc`
   (losowa ścieżka w Expo, KNOWN-ISSUES #16), bundle dev różni się tylko portem w `sourceMappingURL`, błędy
   transformacji mają ten sam kształt.
2. `WorkerFarm` Metro można podmienić na wątki Buna (`tools/bun/metro-worker-farm.js`) bez zmiany wyniku; czas równy
   lub krótszy (Android zimny 8,4 s vs 10,2 s, pierwszy bundle dev 5,3 s vs 6,5 s).
3. Bundler Buna nie jest szybszy przy `export` (zimny ~29 s w obu, ciepły 12,5 s vs Metro 10,7 s); przy
   `export:embed` zimny 6,1 s vs 7,7 s. Czas w obu potokach to głównie Babel.
4. Realne przewagi bundlera Buna: cache po treści przeżywający `--reset-cache` buildów natywnych (~1 s vs ~8 s) i
   bundle mniejsze o ~9,4% — ta druga wynika z formatu `Bun.build`, więc znika w trybie 1:1 (format Metro).

**Wniosek:** fazy 1–5 tego planu odtwarzają w bundlerze Buna to, co Metro na Bunie robi już dziś bajt w bajt, kosztem
33,5–50 dni i bez zysku szybkości w trybie 1:1. Tańsza droga do 1:1: **Metro jako silnik na Bunie**, a z Buna to, co
nie zmienia wyniku — `WorkerFarm` na wątkach (zrobione), opcjonalnie minifikator Buna, ewentualnie trwały cache
transformacji dla buildów natywnych (wymaga kluczy uwzględniających `babel.config.js` i `.env`, bo właśnie dlatego
buildy wołają `--reset-cache`). Bundler Buna zostaje jako tryb „szybszy/mniejszy” z opisanymi różnicami. Wybór
domyślnego silnika należy do właściciela projektu (§ 5, pkt 0).

Postęp tej drogi: `WorkerFarm` na wątkach Buna (`ff9e15a`); cache transformacji Metro przeżywający `--reset-cache`
buildów natywnych z `EXPO_PUBLIC_*` w kluczu (ciepły `export:embed` 1,85 s, bajty jak na zimno; BUNDLER.md). Dalej:
macierz weryfikacji (faza 6) na silniku Metro — zrobiona w fiksturze (HISTORY etap 12, faza 1 pkt 6): plugin
`metro.config.js` (SVG), `expo-updates`, Atlas i RSC dają na Bunie to samo co Metro na Node (bajt w bajt, RSC web
przy terserze), RSC działa w `expo serve` na Bunie. RSC w `expo start` ma błąd Expo (KNOWN-ISSUES #17, ten sam na Node).
Zostaje: prawdziwe buildy Release z `expo-updates` na urządzeniach.

## 3. Fazy

### Faza 0 — poprawki serwera dev (1,5–2 dni)

Znalezione błędy, nie tylko braki:

| Krok | Co | Źródło Expo/Metro | Szacunek |
|---|---|---|---|
| 0.1 | **`/symbolicate`: kolumny przesunięte o 1** — RN wysyła kolumny liczone od 0 (`react-native/Libraries/Core/Devtools/parseErrorStack.js:32-35,55`), Metro zwraca od 0; nasz `dev-server.ts:401-404` odejmuje i dodaje 1. Do tego `codeFrame` (dziś zawsze `null`): pierwsza nie-zwinięta ramka z pliku w grafie, `@babel/code-frame` z `forceColor`; `symbolicator.customizeFrame`/`customizeStack` (Expo zwija ramki wewnętrzne, `MC/customizeFrame.js:90-143`); błędy 400/500 jako `{error}` | `M/Server.js:1122-1290` | 3–4 h |
| 0.2 | **`loader-invalidate`** — Expo po zmianie w grafie loadera wysyła `sendDevCommand {name:'loader-invalidate', data:{scope:'all'}}` (`CLI/start/server/metro/MetroBundlerDevServer.js:1475-1495`); my tylko czyścimy cache serwera (`web-dev.ts:210-213`), więc `useLoaderData` w otwartej aplikacji zostaje ze starymi danymi | jw. | 1–2 h |
| 0.3 | `/open-stack-frame` przez middleware Expo (`CLI/start/server/metro/dev-server/createMetroMiddleware.js:92-131`: realpath w obrębie roota serwera, limit 1/2 s, `openInEditorAsync`) na wewnętrznym `connect`; `/open-url` → 404 jak w Expo | jw. | 1–2 h |
| 0.4 | `/events`: przyjąć websocket i nic nie wysyłać — w Expo ten socket jest zepsuty (handler na innym `WebSocketServer` niż zwracany, `createEventSocket.js:32,43,61`; to samo na `main` upstream) | jw. | 0,5 h |
| 0.5 | Drobne endpointy Metro: `*.assets`, `/[metro-project]/…`, puste mapy dla modułów `?ctx=` (`ContextModuleSourceMapsMiddleware`) | `M/Server.js:540-570` | 2 h |

Weryfikacja: test jednostkowy symbolikacji (kolumny, `codeFrame`); ekran błędu LogBox na symulatorze z ramką kodu i
działającym „Open in editor”; strona z loaderem odświeża dane po edycji loadera.

### Faza 1 — potok zgodny z Metro: config, transformacja, graf, serializer (8–12 dni)

| Krok | Co | Pliki | Szacunek |
|---|---|---|---|
| 1.1 | **Ładowanie configu jak Expo**: `loadUserConfig` → nadpisania CLI → `publicPath` (dev: `/assets/?unstable_path=.`, eksport: `/assets?export_path=<baseUrl>/assets`, `instantiateMetro.js:254-260` — dziś zawsze `/assets`) → `withMetroMultiPlatformAsync`; config ładowany przed startem workerów (przekazania przez zmienne środowiska, np. Sentry) | nowy `metro-config.ts` | 1 d |
| 1.2 | **Transformacja Expo w workerach Buna**: `format: 'metro'` = wywołanie `transform-worker.js` Expo z opcjami jak `metroOptions.js:144-162` (customTransformOptions), `Transformer.js:27-43` (część configu transformera przekazywana do workerów) i `transformHelpers.js:77-97` (`getTransformOptions`); rozpakowanie spakowanych map (`patchTransformFileForPackedMaps`); klucz cache = wersje + config | `transform-worker.ts`, `transform-pool.ts` | 1,5–2 d |
| 1.3 | **Graf produkcyjny**: zależności z wyniku transformacji → nasz resolver; kolejność DFS pre-order od wejścia; assety, `require.context` (`M/lib/contextModuleTemplates.js`), pusty moduł, brakujące zależności opcjonalne, moduły wirtualne Expo; pre-moduły: `getPreludeCode` (`M/lib/getPreludeCode.js:14-29`), runtime `@expo/cli/build/metro-require/require`, polyfille jako `type:'script'` | nowy `prod-graph.ts` | 2–3 d |
| 1.4 | **Serializer Expo**: obiekty w kształcie Metro (`{path, dependencies: Map, inverseDependencies, getSource(), output:[{type, data:{code, lineCount, map, functionMap}}]}`, `graph.transformOptions`), świeża fabryka ID numerycznych (`MC/ExpoMetroConfig.js:84-95`), `runBeforeMainModule` (`:269-292`), `getRunModuleStatement`, `serializerOptions {output:'static', splitChunks, includeSourceMaps, exporting}` → `graphToSerialAssetsAsync` | nowy `metro-serializer.ts` | 1,5–2 d |
| 1.5 | Podpięcie w `embed.ts`, `export.ts`, `web-export.ts` za flagą; Hermes przez ścieżkę Expo (`serializeChunks.js:378-431`), dla `export:embed` bez bytecode jak Expo (`exportEmbedAsync.js:311`) | te pliki | 1 d |
| 1.6 | **Weryfikacja bajt w bajt** i przełączenie domyślnego formatu | `compare-exports.ts` (tryb ścisły) | 1–2 d |

Weryfikacja 1.6:
- Wzorzec Metro: `expo export:embed --platform <p> --dev false --minify false` oraz `expo export -p <p>`, **jedna
  platforma na przebieg** (przy kilku platformach Expo bundluje równolegle ze wspólną fabryką ID, `exportApp.js:200`,
  `M/Server.js:135` — ID są wtedy niedeterministyczne), świeży `TMPDIR`, ten sam `.env`.
- `cmp` bundla i mapy. Przy różnicy: podział na `\n__d(` i porównanie modułu po module przez mapę ID→ścieżka
  (różnica w jednym rozwiązaniu przesuwa wszystkie dalsze ID).
- Minifikacja: `METRO_BUN_MINIFIER=0` po obu stronach (terser); `hermesc` z obu bundli; web: nazwy chunków (md5 = treść).
- Urządzenia: Release iOS i Android (Xcode, Gradle), eksport web w przeglądarce, OTA.

Ryzyka: każda różnica resolvera przesuwa ID; dryf kluczy cache Babel; format spakowanych map; komponenty DOM i CSS
wymagają osobnej ścieżki w serializerze.

### Faza 2 — pełne `metro.config.js` (3–5 dni)

**Stan (2026-10-12, po § 2a):** zrealizowane inaczej niż w tabeli niżej — bundler Buna obsługuje `sourceExts`,
`assetExts` i `babelTransformerPath` (pluginy typu SVG/MDX), a każdą inną zmianę wykrywa
(`tools/bun-bundler/metro-config-support.ts`) i przełącza komendę na Metro na runtime Buna, które daje wynik Metro z
konstrukcji (sprawdzone: owinięty `customSerializer` = Metro na Node bajt w bajt). Pełne odtworzenie pozostałych pól w
bundlerze Buna nie jest potrzebne do 1:1. Tabela niżej opisuje pierwotny zakres.

Na fundamencie z fazy 1. Pola i miejsca odczytu w Metro/Expo (z analizy):

| Grupa | Pola | Odczyt | Sposób |
|---|---|---|---|
| resolver | `sourceExts`, `assetExts`, `platforms`, `extraNodeModules`, `nodeModulesPaths`, `blockList`, `disableHierarchicalLookup`, `emptyModulePath`, `resolverMainFields`, `unstable_conditionNames`, `unstable_conditionsByPlatform`, `unstable_enablePackageExports`, `requireCycleIgnorePatterns`, `assetResolutions` | `M/node-haste/DependencyGraph.js:123-176`, `createFileMap.js:40-125`, `getPrependedScripts.js:92` | wprost do `resolver.ts` zamiast stałych |
| `resolveRequest` | własny resolver użytkownika jako pierwszy, z `context.resolveRequest` = nasz łańcuch Expo | `CLI/start/server/metro/withMetroResolvers.js:41-91`, kształt kontekstu `M/…/ModuleResolution.js:108-132` | adapter kontekstu Metro |
| transformer | `babelTransformerPath`, `getTransformOptions`, `minifierPath`/`minifierConfig`, `assetPlugins`, `assetRegistryPath`, `unstable_allowRequireContext`, `dynamicDepsInPackages`, `unstable_disableModuleWrapping` i in. | `MC/transform-worker/metro-transform-worker.js:100-569` | przekazanie do workera z 1.2 (już daje to wywołanie workera Expo) |
| `transformerPath` | własne workery (NativeWind v4/v5, Uniwind) przez worker nadzorujący Expo | `CLI/…/withMetroSupervisingTransformWorker.js`, `MC/transform-worker/supervising-transform-worker.js` | uruchomienie workera nadzorującego w workerach Buna |
| serializer | `customSerializer` (Sentry `withSentryConfig`, expo-atlas), `getPolyfills`, `getModulesRunBeforeMainModule`, `createModuleIdFactory` (Worklets bundle mode), `processModuleFilter`, `isThirdPartyModule` | `M/Server.js:135,172-197,898,1452` | wywołanie łańcucha na grafie z 1.4 |
| server | `enhanceMiddleware`, `rewriteRequestUrl`, `unstable_serverRoot` | `M/Server.js:189,481`, `instantiateMetro.js:355-361` | middleware na wewnętrznym `connect` |
| symbolicator | `customizeFrame` (Reanimated, Sentry) | `MC/ExpoMetroConfig.js:309` | w 0.1 |

Ograniczenia wykryte w analizie (do udokumentowania lub osobnego obejścia): `unstable_beforeAssetSerializationPlugins`
(ścieżka Expo w Sentry) siedzą w domknięciu `getDefaultConfig` — rozwiązane przez zawsze wywoływany `customSerializer`;
Uniwind łata `Graph.prototype` Metro (`patches.ts`); NativeWind v4 łata wewnętrzne obiekty serwera Metro w
`enhanceMiddleware` (ma ścieżkę zapasową przez zapis plików w `getTransformOptions`); Storybook przy ładowaniu configu
startuje własny serwer websocket.

Weryfikacja: fikstura per plugin (instalacja w fiksturze w `/tmp`, nie w aplikacji): react-native-svg-transformer,
NativeWind v4 i v5, Uniwind, Sentry (`getSentryExpoConfig`), Storybook; każda: eksport porównany z Metro + uruchomienie
na symulatorze.

### Faza 3 — pełna zgodność serwera dev (3–4,5 dni)

**Stan (2026-10-12):** iOS/Android zrobione — serwer dev Buna transformuje moduły `Transformer`em Metro (worker Expo
na wątkach Buna, cache Metro) i serializuje jak `metro/Server` (moduły wstępne, fabryka ID, `customSerializer`,
`sourceMapString`, `hmrJSBundle`): bundle, mapy, bundle leniwe, `dev=false&minify=true` i aktualizacje HMR bajt w bajt
jak Metro; terminal jak Expo (zdarzenia reportera Metro); Atlas → Metro. Zostaje web (resolver: helpery
`@babel/runtime/helpers/esm`, shimy `\0shim:react-native-web/...`; HTML z zasobów serializera `static`) i odpowiedź
multipart z postępem bundlowania (`Accept: multipart/mixed`).

| Krok | Co | Źródło | Szacunek |
|---|---|---|---|
| 3.1 | Graf dev na transformacji Expo z 1.2 (dziś nasza: CommonJS Babela zamiast żywych wiązań, bez komentarzy, ID nadawane przy współbieżnym ładowaniu — `dev-graph.ts:113,249,283`) — bundle dev 1:1 z Metro | `MC/transform-worker/metro-transform-worker.js:246-460` | 1–1,5 d |
| 3.2 | Reporter terminala Expo: `MetroTerminalReporter` z eventami Metro (`bundle_build_started/done/failed`, `bundle_transform_progressed[_throttled]`, `bundling_error`, `client_log`, `hmr_client_error`) — format `iOS Bundled 123ms node_modules/expo-router/entry.js (1234 modules)`, pasek postępu, logi klienta z plakietkami, symbolikacja WARN/ERROR | `CLI/start/server/metro/MetroTerminalReporter.js:147-230`, `serverLogLikeMetro.js:126-156` | 0,5–1 d |
| 3.3 | `--no-dev` / `--minify`: `dev`/`minify` w kluczu grafu, `__DEV__=false`, bez kodu HMR, minifikacja per moduł; tryb do SSR web | `CLI/start/server/middleware/metroOptions.js:217-292`, `ManifestMiddleware.js:178-213` | 1–1,5 d |
| 3.4 | Expo Atlas (`EXPO_ATLAS=1`): `createExpoAtlasMiddleware` / `withExpoAtlas` z udawanym configiem, wywołanie ich `customSerializer` na grafie dev/eksportu, `/_expo/atlas` na wewnętrznym `connect` | `CLI/start/server/metro/debugging/attachAtlas.js`, expo/atlas `packages/expo-atlas/src/{cli,metro}.ts`, `MetroGraphSource.ts` | 1–1,5 d |

### Faza 4 — `expo-updates` (1–1,5 dnia)

**Stan (2026-10-12):** zrobione — `tools/bun-bundler/updates.ts` przez preload (`createUpdatesResources.js` biegnie z
katalogiem projektu jako roboczym: iOS `cd "$PROJECT_ROOT"`, Android `workingDir(projectRoot)`). `app.manifest` =
Metro (poza losowymi `id`/`commitTime`) dla iOS i Androida, Release i Debug; szczegóły i build na symulatorze w
HISTORY (etap 12, faza 4).

- Fakty: w Release (iOS: faza „Generate updates resources for expo-updates”, `expo-updates/ios/EXUpdates.podspec:141-152`,
  `scripts/create-updates-resources-ios.sh`; Android: `create<Variant>UpdatesResources`, `ExpoUpdatesPlugin.kt:31-86`)
  `utils/build/createUpdatesResources.js` woła `createMetroServerAndBundleRequestAsync` i `exportEmbedAssetsAsync`
  (`CLI/export/embed/exportEmbedAsync.js:387-485`) — prawdziwy `new Metro.Server` i przejście grafu, żeby zapisać
  `app.manifest` z hashami assetów. Działa w osobnym procesie (`with-node.sh` → `$NODE_BINARY`).
- Plan: podmiana `CLI/expoUpdatesExports.js` (preload / `require.cache`) na wersję zwracającą assety z grafu Buna
  (`tools/bun-bundler/assets.ts` liczy już md5 `fileHashes`); najpierw sprawdzić, czy preload z `bunfig.toml` obejmuje
  ten proces (katalog roboczy skryptu) — jeśli nie, preload przez `--preload` w `NODE_BINARY`/shimie.
- Weryfikacja: projekt z `expo-updates` w fiksturze, `app.manifest` z Metro vs Bun (iOS, Android, Release i
  `EX_UPDATES_NATIVE_DEBUG=1`), aplikacja Release ładuje embedded update.

### Faza 5 — React Server Components na bundlerze Buna (15–22 dni po fazach 1 i 3; 22–30 bez nich)

**Stan (2026-10-12, decyzja wg § 2a):** nie realizowana. Projekty z RSC idą automatycznie przez Metro na runtime
Buna (`metro-config-support.ts`), co daje wynik Metro z konstrukcji — sprawdzone w macierzy fazy 1: eksport web bajt w
bajt z Node (terser), `expo serve` na Bunie z działającą Server Function, natywne `export:embed` bajt w bajt. RSC w
`expo start` ma błąd Expo (KNOWN-ISSUES #17), ten sam na Node. Odtwarzanie RSC w bundlerze Buna (kroki niżej) nie
daje 1:1 lepszego niż Metro, a kosztuje 15–22 dni.

Kontrakty, które musi spełnić nasz serwer, żeby działał niezmieniony kod Expo (`createServerComponentsMiddleware.js:81`,
renderer `@expo/router-server/build/rsc/rsc-renderer.js`, eksport `MetroBundlerDevServer.js:718-829`):
`ssrLoadModule`, `ssrLoadModuleArtifacts` (`metroImportAsArtifactsAsync`), `createModuleId` i format modułów Metro.

| Krok | Co | Szacunek |
|---|---|---|
| 5.0 | Fikstura RSC (oba flagi, trasa serwerowa, licznik `'use client'`, akcja `'use server'`, import CSS) z `react-server-dom-webpack ~19.2.4`; wzorzec z Metro (web + iOS) | 1 d |
| 5.1 | **Tekstowe ID modułów** przy RSC: Expo ustawia `EXPO_USE_METRO_REQUIRE=1` (`instantiateMetro.js:210-218`) → `createStableModuleIdFactory` (`MC/ExpoMetroConfig.js:111-148`): klient = ścieżka względem roota, serwer = ścieżka + `?platform=…&env=…` | 1,5–2 d |
| 5.2 | Metadane transformacji `reactClientReference`/`reactServerReference`/`proxyExports` (babel-preset-expo `client-module-proxy-plugin`, `server-actions-plugin`); `expo/virtual/rsc` z `clientBoundaries` (`MC/transform-worker/transform-worker.js:84-103`); assety jako proxy klienta — w dużej mierze dane przez 1.2 | 1 d |
| 5.3 | Resolver: warunki `node, react-server, workerd`, `mainFields` serwera, aliasy `expo-router` → `expo-router/rsc`, zewnętrzne moduły dev `$$require_external`, wirtualne `\0weak:<id>` dla `clientboundary` (`withMetroMultiPlatform.js:258-380,465-484,686-748`) | 2–2,5 d |
| 5.4 | Graf `react-server` + wykonanie w Node przez `evalMetroAndWrapFunctions` Expo (`getStaticRenderFunctions.js:109-157`), `wrapBundle`, zawsze świeży graf (`MetroBundlerDevServer.js:1567`); sprawdzić `AsyncLocalStorage` i `react-server-dom-webpack/server.node` pod Bunem | 3–4 d |
| 5.5 | Serwer dev: middleware Expo, `/_flight`, `createRouteHandlerMiddleware` z `rsc`, `__expo_rsc_inject_module` → `module-import`, usunięcie delegacji do Metro | 1,5–2 d |
| 5.6 | Leniwe bundle granic klienta: `<rel>.bundle?…&resolver.clientboundary=true&xRSC=1&modulesOnly=true&runModule=false` (`createServerComponentsMiddleware.js:282-347`) | 2 d |
| 5.7 | Akcje serwerowe w dev (`loadServerModuleRsc`, CSRF, `EXPO_UNSTABLE_SERVER_FUNCTIONS`) | 1–1,5 d |
| 5.8 | HMR RSC: `onReloadRscEvent` + `rsc-reload` | 1,5–2 d |
| 5.9 | Eksport web przez `singlePageReactServerComponentExportAsync` Expo na serializerze z fazy 1 (`_expo/rsc/<p>/{router,ssr-manifest,action-manifest}.js`, `_flight/<p>/*.txt`) | 2–3 d |
| 5.10 | Natywnie: `export:embed` bez dzielenia, `exportStandaloneServerAsync`, `hermesc`; aplikacja Release rozmawia z `.expo/server/<p>` | 2–3 d |
| 5.11 | Testy (porównanie payloadów Flight z Metro), dokumentacja | 1,5–2 d |

Ryzyka: wspólny runtime Metro w procesie Node dla wielu środowisk (ID muszą być rozdzielone); zgodność
`react-server-dom-webpack` z Bunem; RSC w Expo to beta (komentarze „TICKLE”, „HACK” w kodzie) — SDK 58 może zmienić
kontrakty; zagnieżdżone akcje serwerowe nie działają na Hermesie (ograniczenie Expo).

### Faza 6 — macierz weryfikacji (2–3 dni)

**Stan (2026-10-12):** monorepo zrobione (2 błędy naprawione, HISTORY etap 12 faza 6). Fizyczny iPhone pominięty
(zasada projektu), EAS Build i CI wymagają konta / zdalnego repo — poza zakresem lokalnym.

Expo Go i dev na emulatorze Androida; fizyczny iPhone i Android; tvOS/macOS (projekty z `react-native-tvos` /
`react-native-macos`); monorepo (workspace, `watchFolders`, `unstable_serverRoot`); EAS Build w chmurze z planem
bundlowania przez Buna; CI. Bez znanych braków w kodzie, ale nic z tego nie było uruchomione.

## 4. Kolejność, zależności, łączny szacunek

```
Faza 0 (1,5–2 d)  ──────────────────────────────────────────────┐
Faza 1 (8–12 d) ──► Faza 2 (3–5 d) ──► Faza 4 (1–1,5 d)          ├─► Faza 6 (2–3 d)
               └──► Faza 3 (3–4,5 d) ──► Faza 5 RSC (15–22 d) ───┘
```

| Zakres | Szacunek |
|---|---|
| Fazy 0–4 + 6 (wszystko poza RSC) | 18,5–28 dni |
| + RSC (faza 5) | **33,5–50 dni** |

Wcześniejszy szacunek (12–20 dni) był zaniżony. Analiza wykazała, że bundle bajt w bajt wymagają transformacji i
serializera Expo, a nie przeróbki obecnego wyjścia. Druga przyczyna: RSC wymaga tekstowych ID, osobnego grafu
`react-server` wykonywanego w Node i osobnego eksportu.

## 5. Decyzje potrzebne przed startem

0. **(po § 2a)** Domyślny silnik: Metro na Bunie (1:1 z definicji; fazy 1–5 zbędne) czy bundler Buna (dzisiejszy
   domyślny; 1:1 wymaga faz 1–5).
1. **Domyślny format bundli**: Metro (1:1, większe bundle, bez tree shakingu jak w Expo SDK 57) czy `Bun.build`
   (mniejsze, szybsze, semantyka inna). Propozycja: Metro domyślnie, `Bun.build` jako opcja.
2. **Minifikacja**: terser (bajty jak w Metro) czy minifikator Buna (szybciej, ten sam kod, inne bajty).
3. **Instalacje do weryfikacji** (tylko w fiksturach w `/tmp`, nie w aplikacji): `react-server-dom-webpack`, pluginy
   z fazy 2, `expo-updates`, `expo-atlas`.
4. **Zakres RSC**: pełne (faza 5) czy na razie zostawić automatyczne przełączanie na Metro.

## 6. Znalezione przy okazji (fakty, do zgłoszenia upstream lub opisu)

- `/symbolicate` w naszym serwerze przesuwa kolumny o 1 (faza 0.1) — nasz błąd.
- Brak `loader-invalidate` — stare dane loaderów w otwartej aplikacji (faza 0.2) — nasz błąd.
- `/events` w Expo CLI nigdy nic nie wysyła (`createEventSocket.js:32,43,61`) — błąd Expo.
- Klucz prebundla eager bez `skipServer` — błąd Expo (KNOWN-ISSUES #15).
- `process.getActiveResourcesInfo()` w Bunie zwraca `[]` (KNOWN-ISSUES #14).
- `.hbc` z `expo export` niedeterministyczne przez losową ścieżkę tymczasową (KNOWN-ISSUES #16) — Expo.
- RSC w dev: brak `__webpack_get_script_filename__` w runtime Expo (KNOWN-ISSUES #17) — Expo.
- `EXPO_PUBLIC_*` wstawiane w produkcji nie są w kluczu cache Metro/Expo, a Expo w CI pomija `--reset-cache` — Expo.

## Źródła

- Expo Updates v1: https://docs.expo.dev/technical-specs/expo-updates-1.md
- React Server Components: https://docs.expo.dev/guides/server-components/ , https://docs.expo.dev/guides/testing-rsc/ ,
  https://expo.dev/blog/universal-react-server-components-developer-preview
- EAS Update debug (`EX_UPDATES_NATIVE_DEBUG`): https://docs.expo.dev/eas-update/debug/
- expo-updates (build scripts, `createUpdatesResources`): https://github.com/expo/expo/tree/main/packages/expo-updates
- NativeWind v5 `metro.tsx`: https://github.com/nativewind/nativewind/blob/main/src/metro.tsx ; react-native-css:
  https://github.com/nativewind/react-native-css/blob/main/src/metro/index.ts
- Uniwind: https://github.com/uni-stack/uniwind
- react-native-svg-transformer: https://github.com/kristerkari/react-native-svg-transformer
- Sentry React Native (`metroconfig.ts`): https://github.com/getsentry/sentry-react-native
- Storybook React Native (`withStorybook.ts`): https://github.com/storybookjs/react-native
- Expo Atlas: https://github.com/expo/expo-atlas
