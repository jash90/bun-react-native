# Historia: paczka `bun-react-native` (ciąg dalszy [HISTORY.md](HISTORY.md))

## Etap 13 — paczka `bun-react-native` (2026-10-12)

**Analiza** (prototypy w `/tmp/bunpoc`, pomiary przy obciążonym Macu — pojedyncze próby):
1. Preload z paczki działa (`preload = ["<paczka>/preload"]`); `bin` `node` z paczki ląduje w `node_modules/.bin`, ale
   bez Node na PATH `bun run` wstawia przed nim alias `node` Buna (oven-sh/bun#40482: `node --eval … first second` →
   `["second"]`); preload wstawiający katalog shima na początek `process.env.PATH` naprawia to dla dzieci.
2. Preload może przejąć zwykłe `expo start` / `expo export` (to, co robił `cli.ts`): wynik bajt w bajt jak `cli.ts`.
3. Pomiary silników (przykładowa aplikacja): `export:embed` Android zimny/ciepły Node+Metro 8,4/1,7 s, Bun+Metro
   7,9/1,5 s, bundler Buna 7,8/1,6 s; `expo export` iOS+Android zimny 18,7 / 19,4 / 25,4 s; pierwszy bundle dev iOS
   zimny 7,5 / 5,7 / 6,3 s, ciepły 0,63 / 0,44 / 1,01 s. Bundler Buna nie jest szybszy, a wpina się w ~30 modułów
   Expo CLI, 16 ścieżek `metro/private` i 8 modułów `@expo/metro-config` (Metro na Bunie: 2 punkty — `WorkerFarm` i
   `withMetroMultiPlatformAsync`).
4. SDK 54–58 (statycznie, `sdkcompat.py`): Expo CLI 58 ma wszystkie punkty zaczepienia; `@expo/metro-config` 58 nie
   ma `serializer/packedMap` (tryb dev bundlera Buna); 56: brak `favicon.generateFaviconAssetAsync`; 54–55: dodatkowo
   `resolveLoader` (54) i `packedMap`.
5. Gołe RN 0.86 (`@react-native-community/cli`): z preloadem bajt w bajt jak Node (bundle, dev, HMR, codegen); bez
   niego inna kolejność assetów i codegenu oraz zawieszony `react-native start` — nowy błąd Buna (KNOWN-ISSUES #19,
   zgłoszony jako oven-sh/bun#45090; do #44947 dopisany komentarz o skutkach w RN).
6. Rozbieżność trybu dev bundlera Buna: React Compiler brany z `app.json`, Metro bierze `transform.reactCompiler` z URL
   (klienci wysyłają go z manifestu, więc w praktyce wynik ten sam; ręczny URL bez parametru → +2 moduły).

**Decyzje użytkownika:** domyślnie Metro na Bunie, bundler Buna jako opcja; v1 = Expo 57 + 58, gołe RN w v1.1;
npm po v1 (do tego czasu `github:jash90/bun-react-native`); zgłoszenie błędów Bunowi.

**Implementacja:**
1. Układ repo: paczka w katalogu głównym (`preload.js`, `app.plugin.js`, `tools/`, `files` w `package.json`, tarball
   ~110 KB), aplikacja w `example/` (członek workspace'u; jej postinstall linkuje `node_modules/bun-react-native` → repo).
   Wersje zależności po przeniesieniu identyczne (`bun pm ls --all`, 1017 pakietów).
2. `RN_BUNDLER=bun` wybiera bundler Buna (wcześniej `RN_BUNDLER=metro` wybierał Metro); `usesMetroEngine` /
   `bunBundlerRequested` w `metro-config-support.ts`.
3. Preload: `path.preload.js` (shim na PATH), `expo-cli.preload.js` przejmuje `start`/`run:*`/`export`/`export:embed`
   przy `RN_BUNDLER=bun` i pomija `--reset-cache` dla `export:embed` na Metro; minifier Buna i `unstable_workerThreads`
   ustawia `metro-on-bun.ts` (puste `metro.config.js`); shim `net.Server#listen` w `node-compat.preload.js`.
4. Config plugin tylko dla Xcode (`NODE_BINARY`, z zapasową ścieżką Buna dla Xcode z Docka); przekierowanie `CLI_PATH` /
   `cliFile` usunięte — kroki bundlowania Xcode/Gradle startują z katalogu aplikacji, więc wybiera preload.
5. CLI `bun-react-native`: `init` (bunfig, plugin, `eas.json`, hook `eas-build-post-install`, podpowiedzi), `doctor`
   (Bun, SDK, preload, plugin, `node` w dzieciach z testem aliasu #40482, pin `@react-native/metro-config`, lockfile'e,
   zbędne linie `metro.config.js`, silnik), `compare`.
6. `typecheck` = `bun check` (type checker Buna 1.4.3: te same błędy co `tsc --noEmit`, 0,16 s zamiast 2,7 s).
7. Weryfikacja lokalna (bez Node na PATH): `bun test` 48/48, Jest 8/8, `bun check`, `tsc`, ESLint; `export:embed`
   Android Metro na Bunie = Node bajt w bajt + `hermesc`; `expo export` iOS/Android = Node (poza ścieżką `.hbc`, #16),
   web różni się tylko minifikatorem Buna, z terserem (`METRO_BUN_MINIFIER=0`) 4/4 przebiegi = Node; dev (URL z
   manifestu) identyczny dla Node+Metro, Bun+Metro i bundlera Buna; `RN_BUNDLER=bun expo export` vs Metro: 0 różnic.
   Projekt spoza repo z paczką z tarballa + `init`: Jest, typecheck, lint, export (= Node), `RN_BUNDLER=bun` export
   (0 różnic), `prebuild` iOS z `NODE_BINARY` = Bun. Jeden pojedynczy eksport web na Bunie (terser, czysty cache) wyszedł
   inny (1212 zamiast 1213 modułów) i nie dał się powtórzyć w 5 kolejnych przebiegach — obserwacja otwarta, CI porównuje
   web Node vs Bun przy każdej zmianie.

**Po pierwszym CI (PR #1) i SDK 58:**
1. Buildy Release iOS/Android w nowym układzie zielone w CI (`android`, `ios`), job `consumer` zielony.
2. `bundle-determinism` (linux x64, Node 22 na PATH): eksport web na Bunie padał z `Cannot find module './Worker.js'`
   (KNOWN-ISSUES #22) — odtworzone w kontenerze amd64 z Node (losowe: ten sam wariant raz pada, raz nie); poprawka:
   farma wątków bez konstruktora `WorkerFarm` Metro (który dodatkowo ładował transformer do głównego wątku).
3. SDK 58 (`expo@next` 58.0.7, RN 0.88.0-rc.4, Metro 0.87.1, kopia przykładu po `expo install --fix`): Metro na Bunie
   — `export:embed` Android i bundle dev = Node bajt w bajt, `expo export` natywne = Node (poza `.hbc`, #16); web:
   te same moduły, inne ID (#21). Bundler Buna na SDK 58: poprawione `packedMap` (usunięty w SDK 58) i tryb `.env`
   (Expo CLI 58 bierze `mode` jawnie); natywna część eksportu zgodna (assety identyczne, `metadata.json` różni się
   tylko kolejnością platform — niedeterminizm Expo, `compare` porównuje ją teraz semantycznie), ale web SDK 58 ma
   inny podział na chunki i `_expo/.routes.json` → przy `RN_BUNDLER=bun` SDK 58 zostaje na Metro (komunikat z
   powodem). Typecheck i Jest przykładu na SDK 58 padają tak samo na Node (kod aplikacji pod API SDK 57).
4. CI: job `sdk-next` (`expo@next`, `continue-on-error`) — `doctor`, `export:embed` Android Node vs Bun, `expo export`.
5. Drugi przebieg CI: po usunięciu konstruktora `WorkerFarm` web na linux x64 padał dalej, teraz z rozwiązaniem
   `metro/private/lib/countLines` z globalnego cache Buna (auto-install) — resolver Buna przy równoległym użyciu z
   wątków. Domyślnie transformacje Metro idą teraz w procesach jest-worker (każdy ładuje preload z `bunfig.toml`);
   wątki Buna tylko z `METRO_BUN_WORKERS=threads`. Lokalnie: embed Android = Node, web (terser) = Node, dev identyczny
   dla 3 silników, `RN_BUNDLER=bun` export = Metro (0 różnic), czas embed bez zmian. Docker na tym Macu przestał
   uruchamiać kontenery, więc linux x64 sprawdza CI. Job `sdk-next`: `bunfig.toml` przykładu usuwany przed instalacją
   (preload musi się rozwiązać, #20), potem `init`.
6. Przyczyna (#22) znaleziona macierzą w CI (`debug-web`, usunięta po diagnozie): w każdym wariancie (Node na PATH lub
   nie, shim na PATH, wcześniejszy eksport Android, cache transpilera Buna zimny/wyłączony) pierwszy eksport web po
   świeżej instalacji padał, drugi przechodził; ze świeżym `HOME` padał każdy; jedyne nowe pliki po pierwszym przebiegu
   to `sharp-cli` w `~/.bun/install/cache` — runtime auto-install Buna wywołany przez wyszukiwanie globalnego
   `sharp-cli` w Expo (`resolveGlobal`). Poprawka: `[install] auto = "disable"`. CI na `6b3088e`: wszystkie joby
   zielone (`checks`, `consumer`, `android`, `ios`, `bundle-determinism`, `sdk-next`). Hipoteza o wątkach (#22 w
   poprzedniej wersji) była błędna; procesy jest-worker zostają domyślne (wynik i czas jak wątki, kod Metro).
7. CI na `cf1f92a`: `bundle-determinism` web — tym razem **Node** dał inny hash (`entry-156c…`, „Web Bundled” przed „λ
   Bundled”), Bun zwykły (`entry-e62e…`). Przyczyna w kodzie Expo: jedna numeryczna fabryka ID serwera Metro eksportu,
   a bundle (platformy, render i klient web) budowane równolegle (#21) — wyścig dotyczy obu runtime'ów; lokalnie pełny
   eksport na Node dał raz też inne natywne `.hbc`. Pierwsza wersja poprawki porównywała web bez ID modułów — zastąpiona
   usunięciem przyczyny: `tools/bun/expo-export-order.js` (platformy po kolei, render przed klientem). Wynik: pełny
   eksport Node×2, Bun×2 i Node vs Bun identyczne (poza `.hbc`, #16), web SDK 58 Node vs Bun bajt w bajt; CI znowu
   porównuje pełny eksport bajtowo (Node z tą samą kolejnością przez `scripts/node-export-order.cjs`).
8. Ograniczenia z punktu 7 usunięte: (a) koszt kolejki zmierzony w CI (tymczasowy workflow `bench-export`, ubuntu,
   3× naprzemiennie): zimny pełny eksport 63,6 s równolegle vs 65,3 s po kolei, ciepły 19,4 vs 19,4 s — w szumie
   (lokalne +15% to był load ~300); (b) bundle komponentów DOM (`legacySinglePageExportBundleAsync`) w tej samej
   kolejce. Przy (b) złapany błąd: `nativeExportBundleAsync` sam woła `legacySinglePageExportBundleAsync`, więc
   kolejka zakleszczała każdy eksport (fikstura DOM zawisła) — kolejka reentrant przez `AsyncLocalStorage`, test
   regresji (bez poprawki: zakleszczenie). Fikstura DOM: eksport iOS 2× identyczny łącznie z `www.bundle`; CI na
   `40ba8ff` zielone.

