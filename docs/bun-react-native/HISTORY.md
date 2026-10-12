# Jak doszliśmy do toolchainu React Native w 100% na Bunie

Dziennik prac z 2026-10-12: kolejne etapy, konkretne kroki, decyzje, znalezione błędy (z przyczyną) i sposób
weryfikacji, z odnośnikami do commitów. Gałąź robocza: `feat/bun-toolchain`; eksperymenty: worktree
`../bun-react-native-poc` (gałąź `poc/bun-toolchain`) oraz `/tmp/bunpoc` (artefakty, fikstura `wt-web`, wyniki
porównań). `main` nie był zmieniany.

Zasady przyjęte na starcie i trzymane do końca:
- fakty oddzielone od hipotez; każdą tezę o zachowaniu Metro/Expo sprawdzamy w ich kodzie (`node_modules`) albo
  porównaniem wyników, a nie z pamięci;
- miarą poprawności jest **porównanie z Metro plik po pliku** (`expo export`, `expo export:embed`) oraz uruchomienie
  na urządzeniu (symulator iOS, emulator Androida) i w przeglądarce (Playwright);
- funkcje Expo CLI, które **nie uruchamiają Metro** (manifesty tras, serializacja HTML, favicon, metadane EAS Update,
  Hermes, `expo-server`), wykorzystujemy bez zmian; Bun zastępuje bundlowanie, rozwiązywanie modułów, serwer dev.

---

## Etap 0 — audyt i PoC w izolacji (gałąź `poc/bun-toolchain`)

| Commit | Co |
|---|---|
| `0a347e1` | szkielet aplikacji Expo SDK 57 (bez instalacji) |
| `17f4167` | `bun install` (lockfile), mocki Jest, shim/pułapka na Node, skrypty benchmarków |
| `2f92561` | obejścia blokad Buna: preload sortujący `readdir`, workery Metro jako procesy, `vm.SyntheticModule` w Jest |
| `dc408b1` | komplet dokumentacji (runbook, znane problemy, weryfikacja, CI/EAS, kopia oficjalnych źródeł) + plugin `.xcode.env` |

Kroki:
1. Inwentaryzacja warstw, w których działa Node: instalacja pakietów, Expo CLI, Metro (bundlowanie, transformacja,
   serwer), Babel, Jest, ESLint, skrypty CocoaPods/Xcode/Gradle, EAS, CI.
2. Uruchomienie każdej warstwy pod Bunem w worktree i spisanie błędów z numerami issue Buna
   (`docs/bun-react-native/KNOWN-ISSUES.md`), np. błąd aliasu `node` (oven-sh/bun#40482), kolejność `readdir`
   (oven-sh/bun#44947), `vm.SyntheticModule` w Jest.
3. Pułapka na Node: `node` na `PATH` zastąpiony skryptem, który kończy się błędem — wszystko, co nadal wołało
   Node, wychodziło na jaw.
4. Test determinizmu: bundle z Metro na Node i Metro na Bunie porównane `cmp` (z osobnym `TMPDIR` na każdy runtime —
   wspólny cache Metro dawał fałszywie identyczne wyniki).

## Etap 1 — aplikacja z toolchainem na Bunie (`49773de`)

1. `tools/bin/node` — shim `node` → `bun --no-env-file`, pierwszy na `PATH` (zamiast `bun --bun`, który wstawia
   wadliwy alias `node` przed shim i psuje autolinking w Gradle/CocoaPods).
2. `bunfig.toml`: linker `hoisted`, rejestr npm przypięty (lockfile miał adresy z `~/.npmrc`), preloady.
3. `tools/bun/node-compat.preload.js` sortuje `fs.readdir*` jak Node; `metro.config.js` przełącza workery Metro na
   procesy (`unstable_workerThreads=false`), bo preload nie dociera do `worker_threads`.
4. `tools/bun/jest.preload.js` — Jest na runtime Buna bez ścieżki ESM.
5. `plugins/with-bun-xcode-env.js` — `NODE_BINARY=bun` w `ios/.xcode.env`; hooki EAS; workflow CI z testem
   determinizmu Node vs Bun.

## Etap 2 — minifikator Metro na Bunie (`cca5253`)

1. `tools/bun/metro-minifier.js` jako `transformer.minifierPath`: `Bun.build` w pamięci + złożone source mapy.
2. Błędy Buna znalezione testami i obejścia: gubienie `"use strict"` w funkcji (wstawiamy z przesunięciem mapy),
   polyfille zamieniane w moduły ES (minifikujemy tylko moduły `__d`), globalny regex z `lastIndex`.
3. Fallback na terser per moduł; testy `bun test` w `tools/`.

## Etap 3 — własny bundler na Bunie zamiast Metro (`2732501`)

Decyzja (wybór użytkownika: „Nowy bundler na Bunie”): Metro na Bunie działało, ale celem było przepisanie
bundlowania na API Buna.

1. `resolver.ts` — rozwiązywanie modułów jak `metro-resolver` (rozszerzenia platform, pola `main`, mapy zamienników,
   `exports`/warunki, granica `package.json` na segmencie `node_modules`).
2. `transform-worker.ts` — pula `Worker`ów Buna z dokładnie tą transformacją Babel, której używa Expo.
3. `bundle.ts` — `Bun.build` (IIFE) z pluginem RN: moduły wirtualne, prelude/polyfille Metro, `require.context`,
   assety, mapy Bun → Babel → źródło, cache po `Bun.hash` treści.
4. Problemy i przyczyny:
   - Bun nie przekazuje `pluginData` z `onResolve` do `onLoad` → mapy po ścieżce;
   - importy nazw, których moduł nie eksportuje (typy TS) przerywają linkowanie Buna → stuby `undefined` (semantyka
     Metro) i ponowne linkowanie;
   - proces nie kończył się (Xcode czekał 38 min) — zakończone `Worker`y trzymały pętlę → `process.exit(0)`;
   - `getPackageForModule` zaczynał od katalogu nadrzędnego → test wykrył, poprawione jak w Metro.
5. `plugins/with-bun-bundler.js` — faza bundlowania Xcode i zadanie Gradle wołają `tools/bun-bundler/cli.ts`.
6. Weryfikacja: ten sam zbiór modułów co Metro, `hermesc` 0 błędów, aplikacje release iOS/Android uruchomione,
   bundle 4,5–5,4 s na zimno / ~1 s z cache wobec 6,9–7,9 s w Metro, bytecode Hermesa −9,4%.

## Etap 4 — Fast Refresh i debugger (`afd8591`)

1. `dev-graph.ts` — graf dev w **formacie modułów Metro** (`__d`/`__r` + runtime `require` Expo), bo tylko on daje
   podmianę modułów na urządzeniu; aktualizacje HMR w protokole Metro z odwrotnymi zależnościami.
2. `transform-worker.ts` (format `metro`): ESM → CommonJS, `require("x")` → `require(_dependencyMap[i], "x")` —
   dwa przebiegi Babela (jeden zepsuł kolejność).
3. `inspector.ts` — proxy inspektora (`/inspector/device`, `/inspector/debug`, `/json/list`, `/open-debugger`).
4. `fs.watch` zgłaszał zdarzenia bez zmian → filtr po `mtime`/rozmiarze.
5. Weryfikacja na iOS i Androidzie: stan zachowany po edycji, nakładka błędu składni, nowa trasa, `Runtime.evaluate`.

## Etap 5 — web (`417fff7`)

1. CSS przez transformację Expo, eksport statyczny: bundle klienta + bundle serwerowy `render.js` wykonywany w
   procesie → `getManifest` + `getStaticContent`.
2. Błędy: `node:async_hooks` w bundlu przeglądarki (wbudowane moduły Node → pakiet albo pusty moduł, jak Expo),
   pusty moduł ESM bez nazwanych eksportów, 0 tras przez złe przejście manifestu, inne hashe assetów (pojedynczy plik
   ma md5 samego pliku — `getMD5ForData` Expo).
3. Weryfikacja: zbiór plików identyczny z Metro, HTML różny tylko białymi znakami; Playwright: hydratacja, nawigacja.

## Etap 6 — `expo export` na Bunie, SSR w dev, zgodność assetów (`568f4bf`)

Pierwsza runda „popraw ograniczenia”.

1. Ponowne sprawdzenie Androida po zmianach na świeżym emulatorze (wcześniej przeciążony: load ~32, swap).
2. Odczyt kodu Expo CLI (`exportStaticAsync`, `exportApp`, `MetroBundlerDevServer`, `createServerRouteMiddleware`)
   → decyzja: używać funkcji Expo do manifestów/HTML/plików (`expo-helpers.ts`), Bun do bundli.
3. Fikstura `/tmp/bunpoc/wt-web` (osobny worktree): trasy `[id]`, `[slug]` + `generateStaticParams`, grupa
   `(marketing)`, trasy API — eksporty Metro jako wzorzec.
4. Eksport web `single`/`static`/`server` (trasy API i middleware jako CommonJS dla `expo-server`, `routes.json`,
   tryb SSR), dev SSR przez `expo-server` (adapter Bun).
5. Eksport natywny OTA: Hermes przez `buildHermesBundleAsync` Expo, `assets/<md5>`, `metadata.json`.
6. Błędy znalezione porównaniem z Metro:
   - brak 13 plików assetów → nasz resolver szukał `img.ios@2x.png`, a Metro używa `img@2x.ios.png` i zastępuje
     warianty ogólne wariantami platformy (`getAbsoluteAssetRecord`) — dotyczyło też buildów release;
   - `require.context` rzucał dla nieznanego klucza (Metro zwraca `undefined`) → 404 w SSR padało;
   - kolejność CSS i assetów zależna od równoległości → przejście grafu z `metafile` Buna;
   - `export:embed`: brak filtra skal iOS i `raw/keep.xml` → `persistMetroAssetsAsync` Expo.
7. Weryfikacja: eksporty fikstury identyczne z Metro plik po pliku; `.hbc` z eksportu uruchomiony w aplikacji Release.

## Etap 7 — łańcuch resolverów Expo, transform-worker, CSS, leniwe bundle, loadery, DOM (`459f13c`)

Druga runda „przeanalizuj ponownie i popraw” — przegląd każdej różnicy względem kodu Expo.

1. Odkrycie: wołaliśmy `babel-transformer` Expo bezpośrednio, pomijając **transform-worker Expo** → przeniesione
   kroki: pliki `+api`/`+html`/`+middleware` wycinane z klienta, `.env`, `expo/virtual/env`, `streams`, wejście DOM;
   opcje transformera jak w Metro (`enableBabelRCLookup`, `enableBabelRuntime`).
2. CSS jak Expo: PostCSS, Sass, `targets` z browserslist, `@import` lokalne i zewnętrzne, natywnie `unstable_styles`.
3. `asyncRoutes`: dev — `import()` jako async require Metro i leniwe bundle `modulesOnly` (mapa `paths` jak
   `getModuleParams`); eksport — chunki ES + `modulepreload`. Błąd: przy dzieleniu Bun zapisuje krawędzie `import()`
   w `metafile` jako ścieżki chunków (`entryPoint` = źródło) → assety i CSS znikały.
4. Loadery expo-router (eksport, SSR, dev strumieniowy). Różnica w arkuszu RNW wynika z równoległego renderowania Expo;
   bundle loaderów budowane przed renderowaniem → wynik deterministyczny.
5. Komponenty DOM: test ujawnił brak **zależności opcjonalnych** (`require` w `try` — Metro `allowOptionalDependencies`).
6. Łańcuch resolverów Expo (`withMetroMultiPlatform`) przeniesiony w tej samej kolejności: m.in. pomijanie
   produkcyjnego Reacta w dev (wcześniej błędnie uznane za zachowanie Metro — sprostowane), `@react-navigation/core`,
   resolver zapasowy przez `expo`/`expo-router`, autolinking „sticky”, tvOS/macOS. Rdzeń Metro wydzielony do
   `metro-resolver.ts`.
7. Błąd ścieżek: `/tmp` vs `/private/tmp` — klucze `metafile` i ścieżki resolvera różniły się → `realpath`.
8. Weryfikacja: eksport projektu i fikstury identyczny z Metro, pełne buildy Xcode i Gradle uruchomione na urządzeniach,
   dev iOS/Android, 28 testów.

## Etap 8 — menu deweloperskie (bez zmian w kodzie)

1. Menu przez potrząśnięcie: pokazuje się; „Reload” pobiera nowy bundle z serwera Buna; „Open DevTools” otwiera
   React Native DevTools w przeglądarce (połączenia z `:8081`).
2. Cmd+D nie dało się wysłać automatycznie (macOS: brak zgody na zdarzenia klawiatury dla `osascript`) — wymaga
   uprawnienia Dostępność albo ręcznego testu.

## Etap 9 — tryb ścisły, `--unstable-hosted-native`, `--source-maps inline`, skrypt porównań (`2450197`)

1. Ponowna analiza różnic z Metro: bundle Metro ma 983 dyrektywy `"use strict"` (po jednej na moduł ES), bundle Buna — 1.
   Bun łączy moduły w jedną nieścisłą funkcję IIFE, więc kod ES działał w trybie nieścisłym (inne `this` w funkcjach,
   ciche błędy przypisań). Poprawka: `strictIife` (`shared.ts`) wstawia `"use strict"` na początek IIFE i przesuwa
   pierwszą linię sourcemapy; dla web (klient bez dzielenia) to samo, a funkcje serwerowe CJS dostają dyrektywę na
   początku pliku. Pierwsze podejście zapisywało plik przed wstawieniem dyrektywy i działało tylko z mapą — przebudowane.
2. Weryfikacja trybu ścisłego: `hermesc` 0 błędów (iOS, Android), aplikacja Release iOS (podmieniony `.hbc`) i Android
   (pełny Gradle, „Android Bundled … with Bun”) — nawigacja, sekcje, obrazy; eksport web hydratuje bez ostrzeżeń;
   trasy API fikstury przez `expo-server`. Błąd #418 na `/` fikstury pochodzi z komponentu DOM fikstury (`typeof
   document` inaczej na serwerze i kliencie) — Metro daje ten sam błąd.
3. `--unstable-hosted-native`: w Expo assety natywne dostają w nazwie `md5(fileHashes)` (`getUniversalAssetData`,
   `isHosted`) i są zapisywane jak web (`persistMetroAssetsAsync`, platforma `web`), bundle trafia do domeny `client`.
   Odtworzone opcją `hostedAssets` w `bundle.ts` i `hostedNative` w `export.ts`. Pierwsze porównanie pokazało
   `assets/<md5>` zamiast ścieżek — przyczyna: `cli.ts` nie przekazywał flagi do `resolveOptionsAsync`; po poprawce 0
   różnic, identyczne obiekty `registerAsset`.
4. `--source-maps inline`: natywnie z Hermesem Expo kompiluje bez mapy (sam `.hbc`), bez bytecode mapa idzie jako
   `data:` URL; na web Expo ignoruje `inline` i zapisuje zewnętrzny `.map` (`exportApp.js`: `includeSourceMaps:
   sourceMaps`) — pierwsza wersja wstawiała mapę inline także na web, wycofane po porównaniu.
5. Skrypt porównań przeniesiony z `/tmp` do repo: `bun run compare:export <metro-dir> <bun-dir>`
   (`tools/bun-bundler/compare-exports.ts`: ten sam zbiór plików, treść bajt w bajt, HTML/JSON po normalizacji
   hashy `entry-…`; same bundle JS/HBC tylko co do obecności).

## Etap 10 — `.env` jak w Expo, `export:embed` jak `exportEmbedAsync`, mapy źródeł w kształcie Expo, klawisze `expo start` (`5d5bebf`)

Metoda: lista flag i kroków `@expo/cli/build/src/export/embed` (`resolveOptions.js`, `exportEmbedAsync.js`) oraz
serializera map (`@expo/metro-config/build/serializer/sourceMap.js`, `serializeChunks.js`, Metro `Server.js`)
porównana punkt po punkcie z `tools/bun-bundler`, każda różnica sprawdzona eksperymentem na fiksturze.

1. **`.env` (błąd funkcjonalny).** Fikstura z `.env.production` (`EXPO_PUBLIC_X=production-file`) i `.env.development`:
   - `bun tools/bun-bundler/cli.ts export:embed --dev false` wstawiał `development-file` — Bun sam wczytuje
     `.env.<NODE_ENV z chwili startu>` (bez `NODE_ENV`: development), a `@expo/env` traktuje to jak zmienne z powłoki;
   - przez shim `node` (Xcode/Gradle) — `undefined`: shim ma `--no-env-file`, a `export:embed` nie wczytywał plików;
   - Metro: `production-file`.
   Poprawka: `env.ts` (Expo `setNodeEnv` + `loadEnvFiles`) w `export:embed`, `export`, `start` (+ przeładowanie po
   zmianie pliku, jak `watchEnvironmentVariables`), `bunfig.toml` `env = false`. Drugi błąd wyszedł przy weryfikacji:
   wartości nadal `undefined`, bo **Bun `Worker` nie widzi zmian `process.env` z wątku głównego** (test w `/tmp`:
   `new Worker()` → `missing`, z `{ env }` → OK; `worker_threads` → OK) — pula transformacji dostaje `env`.
   Wynik: bezpośrednio i przez shim `production-file`, zmienna z powłoki wygrywa (`shell`), OTA `production-file`, dev
   `development-file` i po edycji pliku nowa wartość bez restartu (jak Metro). KNOWN-ISSUES #12, #13.
2. **`export:embed`** (`embed.ts`, wydzielony z `cli.ts`): domyślnie `--dev true` i wejście z `package.json` (wcześniej
   `index.js` — błąd „Unable to resolve index.js” bez `--entry-file`), usuwanie starego bundla i kopii w `.app`,
   `--bytecode` (wynik: bytecode Hermes v98 + mapa z tymi samymi kluczami co Metro), `--sourcemap-use-absolute-path`,
   `--sourcemap-sources-root`, `--bundle-encoding`, `--max-workers`, błędy w formacie Xcode. `expo run … Release`
   robi wcześniej prebundle Metro („eager”) — ignorowany z komunikatem (opis w BUNDLER.md).
3. **Mapy źródeł** — porównanie kluczy i zawartości z Metro wykazało: brak `//# sourceMappingURL`/`//# debugId` w
   bundlu embed, brak `debugId`, `x_google_ignoreList`, `x_facebook_sources`, prelude i polyfille bez mapowań oraz
   **bezwzględne ścieżki dysku w `sources`** (`rn-asset:/Users/…`, `rn-context:…`), których Expo celowo unika.
   Ustalone z kodu i danych: `debugId = stringToUUID("<wejście>-<md5 kodu>")` — dla bundla Metro z
   `entry-76d29103…` daje dokładnie `bb3e99a3-…` z `main.jsbundle` Metro (test jednostkowy). Poprawka: `sourcemap.ts`
   (sklejanie map prelude/polyfilli/grafu, ścieżki `/…` względem roota serwera, `?ctx=<sha1>` jak Metro, ignore list
   wg reguły Metro/Expo, `functionMapBabelPlugin` w workerze → `x_facebook_sources`), adnotacje jak Metro (eksport
   natywny: `http://localhost:8081/…map`, web: `/_expo/…map`), mapa `.hbc.map` z `debugId`; mapy funkcji serwerowych
   względne bez `/` (jak Metro), mapy dev z bezwzględnymi ścieżkami, `x_google_ignoreList` (wcześniej pusta lista —
   DevTools nie ukrywał ramek `node_modules`) i `x_facebook_sources`.
   Weryfikacja: zestawy kluczy map identyczne z Metro dla embed, `.hbc.map`, web i JS natywnego; pozycje
   (`explore.tsx:102:29`, `console.js:45:11`) mapują się tak samo jak w Metro; `/symbolicate` w dev bez zmian;
   `compare:export` 0 różnic; 36 testów `bun test tools`. Przy `asyncRoutes` na web chunki i `runtime-*.js` nie
   miały map (Metro: mapa dla każdego chunka) — dodane, z `debugId`; pozycje w chunku `explore` mapują się na
   `explore.tsx:102:29`.
4. **`bun run start` jak `expo start`** (`terminal.ts`): brakowało całego interfejsu terminala Expo. Klawisze
   wysyłają komunikaty `/message` jak `broadcastMessage` Expo (`reload`, `devMenu`, `sendDevCommand`), `j` używa
   `JsInspector` Expo; `--clear`, `-p`, `-i/-a/-w`. Sprawdzone w pseudo-TTY (`script -F`) z aplikacją Debug na
   symulatorze: `m` otwiera „React Native Dev Menu”, `r` przeładowuje (nowe żądanie bundla), `?`, Ctrl+C zwalnia port.
   Projekt nie ma `expo-dev-client`, więc Expo otworzyłby Expo Go — tu `i`/`a` uruchamiają zainstalowany build dev
   (manifest Expo Go nieobsługiwany — BUNDLER.md).
5. Build Release iOS (`xcodebuild`, czysty `derivedDataPath`): `BUILD SUCCEEDED`, bundle Bun 2,0 s, bytecode Hermes
   v98; aplikacja na symulatorze: ekran główny i zakładka Explore. Mapy jak w skrypcie RN (`hermesc
   -output-source-map` + `compose-source-maps.js`) — te same klucze co przy mapie Metro.

## Etap 11 — Expo CLI jako interfejs: `expo start` z Expo Go, eager Release, nazwy chunków, RSC (`6ccba38`, `776abb1`)

Źródła: dokumentacja Expo (protokół Expo Updates v1, przewodnik React Server Components, `llms.txt`) i kod
`@expo/cli` 57.0.28 (`BundlerDevServer`, `MetroBundlerDevServer`, middleware, `start/interface`, `export/embed`).
Zasada tej rundy: zamiast odtwarzać zachowanie Expo, uruchamiać kod Expo i podmieniać tylko części, które w Metro
dotykają bundlera.

1. **`bun run start` = `expo start`** (`6ccba38`). Własny interfejs terminala z etapu 10 usunięty. `cli.ts` uruchamia
   binarkę Expo CLI, a `MetroBundlerDevServer` w `require.cache` zastępuje `BunBundlerDevServer` (podklasa
   `BundlerDevServer`). Expo daje wtedy wszystko poza bundlerem: QR, `s` (Expo Go ↔ development build), `a/i`
   (wybór i uruchomienie urządzenia, pobranie Expo Go), tunel, Bonjour, sprawdzanie zależności, typy tras. Middleware
   Expo (manifest Expo Go i dev clientów, `/_expo/*`) działa na wewnętrznym `node:http` + `connect`, a `Bun.serve`
   przekazuje do niego te ścieżki (test: `fetch` w Bunie zachowuje nagłówek `Host`). Doszło też CORS Expo: obce
   originy były wcześniej przyjmowane, teraz dostają 500 jak w Metro. `/message` ma pełny protokół Expo. Watcher
   Metro dla typów tras odtworzony z watchera Buna.
   Błąd po drodze: Expo Go wysyła `/status` bez nagłówka `Host`, więc `request.url` w Bunie jest względny i
   `new URL()` rzucał wyjątek. Poprawka: przebudowanie żądania z bazowym URL.
   Weryfikacja: Expo Go SDK 57 (pobrany przez Expo po klawiszu `i`) uruchamia aplikację z serwera Buna (manifest,
   bundle, menu Expo Go, Reload, Fast Refresh po edycji `index.tsx`); manifest i kody `/_expo/*` identyczne z
   `expo start` na Metro (porównanie na porcie 8091); build dev `dev.poc.bunrn` nadal działa.
2. **`export` / `export:embed` = komendy Expo.** Wspólny mechanizm `patchExpoCliModule` podmienia eksporty
   `export/exportApp` (`exportAppAsync`) i `export/embed/exportEmbedAsync` (`exportEmbedAsync`,
   `exportEmbedInternalAsync`). Expo parsuje argumenty, wyświetla pomoc i godzi prebundle „eager”; reszta modułu
   (używana przez `expo-updates`) zostaje Metro. Eksport serwera przy `web.output: "server"` idzie przez
   `exportStandaloneServerAsync` Expo z fasadą, która bundluje trasy API Bunem (`exportApiRoutesAsync`).
   Przy okazji: `engine: hermes` i profil `hermes-stable` były ustawione na sztywno dla platform natywnych; teraz,
   jak w Expo, zależą od Hermesa (JSC: `default`), a `--unstable-transform-profile` jest honorowany.
3. **Prebundle „eager” Release.** `tools/bun/expo-cli.preload.js` zakłada tę samą podmianę w procesach
   `bun expo run:*`/`export:embed`, więc prebundle przed `xcodebuild` robi Bun. `expo run:ios --configuration Release`:
   „iOS Bundled … with Bun” przed „Planning build”, potem build, instalacja i uruchomienie aplikacji. Ustalenie z
   `.expo/xcodebuild.log`: klucz eager i klucz fazy Xcode różnią się tylko o `"skipServer":false` — to błąd Expo SDK 57
   (KNOWN-ISSUES #15), także na Metro, więc faza Xcode bundluje drugi raz (u nas ~1 s).
   Problem po drodze: komendy wisiały po zakończeniu pracy. Bisekcja: zakończenie procesu blokował sam import
   `web.ts`, a dalej `transform-worker.ts`, który przy imporcie ustawia `self.onmessage` — w wątku głównym Buna to
   aktywny nasłuch. Zabezpieczenie Expo (`ensureProcessExitsAfterDelay`) nie zadziałało, bo
   `process.getActiveResourcesInfo()` w Bunie zwraca `[]` (KNOWN-ISSUES #14). Poprawka: `if (!Bun.isMainThread)`;
   wcześniejszy `process.exit` w CLI był obejściem tego samego błędu.
   Problem środowiska (nie bundlera): pierwszy w PATH `/usr/local/bin/pod` (Ruby 2.6) jest uszkodzony; Expo zainstalował
   wtedy gem `cocoapods` do Rubiego z Homebrew. Test z `/opt/homebrew/bin` na początku PATH.
   Gradle `createBundleReleaseJsAndAssets` przechodzi przez nową ścieżkę (Android 6,5 s, mapa złożona z Hermesem).
4. **Nazwy chunków web** jak w Metro: `<trasa>-<md5>.js`, `__common-<md5>.js`, `__expo-metro-runtime-<md5>.js`.
   Odwołania między chunkami przepisywane razem z przesunięciem kolumn map (`replaceInGenerated`; kod jest w jednej
   linii). W przeglądarce wszystkie chunki ładują się (200), konsola czysta, mapy trafiają w `explore.tsx:102:29`.
   Różnica, która zostaje: Bun dzieli wspólny kod na kilka plików `__common-*`, Metro na jeden.
5. **React Server Components.** Analiza `createServerComponentsMiddleware` Expo pokazała ścisłe związanie z Metro:
   - serwer i klient współdzielą numeryczne ID modułów;
   - moduły `react-server` są wykonywane jako bundle Metro w Node;
   - granice klienta to leniwe bundle `.bundle?…&resolver.clientboundary=true&xRSC=1`;
   - do tego manifesty akcji serwerowych i eksport payloadów `_flight`.
   Zamiast błędu `start`, `export` i `export:embed` same przełączają takie projekty na Metro (na runtime Buna).
   Sprawdzone na fiksturze z `react-server-dom-webpack` 19.2.8 i funkcją `'use server'`: eksport przez nasze CLI
   tworzy `/_flight/[...rsc]`. Przeniesienie RSC na bundler Buna to osobny, wielodniowy projekt.

## Etap 12 — realizacja PLAN-1TO1.md

Plan: `PLAN-1TO1.md` (analiza kodu Expo/Metro i źródeł z sieci). Przyjęte domyślne decyzje: format bundli Metro jako
domyślny (`Bun.build` jako opcja), weryfikacja bajtów na terserze, instalacje tylko w fiksturach w `/tmp`, RSC jako
faza 5.

### Faza 0 — serwer dev jak Metro + krok 1.1 (ładowanie configu)

1. **Config Metro jak w Expo** (`metro-config.ts`): wywołanie `loadMetroConfigAsync` Expo CLI (`metro.config.js` +
   domyślne Expo + `withMetroMultiPlatformAsync`) z atrapą bundlera Metro, do której Expo rejestruje moduły wirtualne.
   Sprawdzone pod Bunem: `sourceExts`, `assetExts`, platformy, `resolveRequest`, `customizeFrame`, `publicPath`
   (`/assets/?unstable_path=.` w dev — u nas było `/assets`; poprawi to faza 3.1).
2. **`/symbolicate`** (`symbolicate.ts`): kolumny liczone od 0 (był błąd o 1), nazwy funkcji z map funkcji,
   `symbolicator.customizeFrame/customizeStack` z configu, `codeFrame` z pierwszej nie-zwiniętej ramki z pliku w grafie,
   błędy 400/500. Porównanie z Metro uruchomionym obok (8091) dla ramki w `explore.tsx` i w `ExceptionsManager.js`:
   identyczne ramki, zwinięcie, nazwy funkcji, `codeFrame` i komunikat błędu.
3. **`loader-invalidate`**: bundle loaderów zapamiętują swój graf; zmiana pliku z grafu → `sendDevCommand
   {name:'loader-invalidate', data:{scope:'all'}}` jak `setupLoaderGraphListener` Expo. Fikstura z loaderem: komunikat
   po każdej zmianie pliku.
4. **Endpointy Metro** (`metro-endpoints.ts`, `createMetroMiddleware` Expo): assety przez `getAsset` Metro (ścieżka i
   `?unstable_path=`, skala, `Range`, typ MIME, 404 bez `Content-Type`), `/[metro-project]/` i `/[metro-watchFolders]/`
   (łącznie z `Content-Type: false` Metro dla nieznanych typów), `/open-stack-frame` Expo (root serwera, limit), `/open-url`
   → 404, `/events` (przyjęty i cichy jak w Expo), nagłówki no-cache na każdej odpowiedzi, kompresja `.bundle`/`.map`
   (br/gzip/deflate jak pakiet `compression`), `X-React-Native-Project-Root` na `/status`. Porównanie z Metro:
   identyczne kody, typy, rozmiary i md5 odpowiedzi.

### Faza 1 — test wykonalności: Metro na Bunie zamiast odtwarzania Metro

1. **Pomiar bazowy** (świeży `TMPDIR`, `--reset-cache`): `RN_BUNDLER=metro bun expo export:embed --platform ios
   --dev false --minify false` 7,8 s zimny / 1,8 s ciepły; bundler Buna 6,1 s zimny. `export` trzech platform: Metro
   ~28–29 s zimny / 10,7 s ciepły, Bun 28,8 / 12,5 s — stary pomiar 37,7 vs 13,1 s nie powtarza się.
2. **`WorkerFarm` Metro na wątkach Buna** (`tools/bun/metro-worker-farm.js` + `.worker.js`, instalowany w
   `metro.config.js`; `METRO_BUN_WORKERS=0` wyłącza): Transformer Metro czyta `require('./WorkerFarm').default` przy
   tworzeniu bundlera, więc wystarcza podmiana eksportu. Wątek ładuje `node-compat.preload.js` (preload z `bunfig`
   nie dociera do wątków — sprawdzone: `readdir` w wątku zwraca kolejność systemu plików) i woła `Worker.js` Metro.
   Przydział jak jest-worker przy `stickyWorkers` (plik wraca do tego samego wątku, inaczej najmniej zajęty; pierwsza
   wersja z haszem nazwy pliku była wolniejsza: 9,8 s). Błędy odtwarzane jak `ChildProcessWorker` jest-worker
   (konstruktor o tej nazwie, `type`, `stack`, własne pola) — inaczej Metro pisało `Error:` zamiast `SyntaxError:`.
3. **Weryfikacja**: `export:embed` iOS i Android — bundle i mapa identyczne z jest-worker; `export` trzech platform —
   identyczny poza `.hbc`, a to niedeterminizm Expo (losowa ścieżka tymczasowa wkompilowana przez `hermesc`;
   `hermesc` na tym samym pliku 4× ten sam md5; KNOWN-ISSUES #16); dev (`expo start` na 8091/8092) — bundle różni się
   tylko portem w `sourceMappingURL`, mapa identyczna, odpowiedź błędu składni identyczna poza ramkami stosu workera;
   test `tools/bun/metro-worker-farm.test.ts`.
4. **Cache Metro przez buildy natywne**: Xcode i Gradle zawsze przekazują `--reset-cache`; Expo w CI go ignoruje
   (`exportEmbedAsync.js:202-207`), ale nie ma w kluczu wartości `EXPO_PUBLIC_*`, które `inline-env-vars`
   (`babel-preset-expo`) wstawia w produkcji — klucz z `metro-transform-worker` Expo obejmuje tylko pliki workera,
   config i pliki configu Babel. `metro.config.js` dopisuje hash `EXPO_PUBLIC_*`/`BABEL_ENV` do `cacheVersion`, a
   `cli.ts` przy `RN_BUNDLER=metro` pomija `--reset-cache` dla `export:embed` (`RN_BUNDLER_RESET_CACHE=1` przywraca).
   Test z próbnikiem `EXPO_PUBLIC_P1_PROBE` w `src/app/index.tsx` (cofniętym po teście): ciepły bundle = zimny wzorzec
   bajt w bajt dla `one` i `two`, zmiana wartości unieważnia cache; ciepły 1,85 s vs zimny ~8 s; bundle bez próbnika
   identyczny ze wzorcem sprzed zmiany `cacheVersion`. Zimne pomiary przy load average 82 (inne procesy) dawały
   12–14 s — powtórzone przy normalnym obciążeniu.
5. Uwaga przy testach serwera dev: `CI=1` wyłącza w Expo obserwowanie plików — nowy plik nie trafia do mapy plików.
6. **Macierz weryfikacji na silniku Metro** (fikstura `/tmp/bunpoc/wt-p6`: odłączony worktree z `50f03ea`, instalacje
   tylko tam; wzorzec: Metro na Node 25.9.0 z nvm, świeży `TMPDIR` po obu stronach):

   | Funkcja | Wynik na Bunie |
   |---|---|
   | `react-native-svg-transformer` (`babelTransformerPath`, `sourceExts`/`assetExts` z README) | `export:embed` iOS bajt w bajt = Node; bundler Buna ignoruje config i pakuje `logo.svg` jako asset (komponent byłby liczbą) |
   | `expo-updates` (`createUpdatesResources.js ios … all`, `CONFIGURATION=Release`) | `app.manifest` = Node poza losowymi `id`/`commitTime` (36 assetów); assety z `export:embed` bundlera Buna = zbiór Metro poza SVG |
   | Expo Atlas (`EXPO_ATLAS=1 expo export -p ios`) | `.expo/atlas.jsonl`: 7 modułów runtime + 1520 modułów |
   | RSC (`react-server-dom-webpack`, `experiments.reactServerFunctions`, `web.output: single`, Server Function `'use server'`) | `expo export -p web` bajt w bajt = Node przy `METRO_BUN_MINIFIER=0` (z minifikatorem Buna te same pliki, inne bajty JS); `bun run export` = Metro na Bunie (automatyczne przełączenie); `expo serve` na Bunie + Chromium: `POST /_flight/web/ACTION_…/renderInfo` 200, tekst z serwera z sekretem z `process.env` |
   | Wszystko naraz, `export:embed` iOS i Android | bajt w bajt = Node (36 i 44 pliki) |

   Trasa `/rsc` w fiksturze wymagała `TabTrigger` w `app-tabs.web.tsx` (szablon używa własnych zakładek; bez niego
   `/rsc` pokazuje ekran główny). RSC w `expo start` (`bun run start` sam przełącza się na Metro): błąd
   `__webpack_get_script_filename__ is not defined` — identyczny na Node 25.9.0, więc błąd Expo (KNOWN-ISSUES #17);
   jednolinijkowy shim w `rsc/runtime.js` fikstury go usuwa (sprawdzone w Chromium, plik przywrócony po teście).
   Niesprawdzone: `expo-updates` w prawdziwym buildzie Xcode.
7. **Wniosek** (PLAN-1TO1.md § 2a): 1:1 najtaniej daje Metro jako silnik na Bunie; fazy 1–5 planu dla bundlera Buna
   czekają na decyzję o domyślnym silniku.

### Faza 2 — `metro.config.js`: co obsługuje bundler Buna, resztę robi Metro

1. **Wykrywanie** (`metro-config-support.ts`): config użytkownika porównany z `getDefaultConfig(projectRoot)` Expo —
   tablice w całości, funkcje po źródle (`getDefaultConfig` tworzy nowe domknięcia przy każdym wywołaniu, ale z tym
   samym kodem: dwa wywołania = 0 różnic). Ignorowane ustawienia toolchainu Buna (`cacheVersion`,
   `unstable_workerThreads`, minifikator `tools/bun/metro-minifier.js`, workery/cache/reporter). Ścieżka projektu
   przez `realpath` (inaczej `/tmp` vs `/private/tmp` dawało fałszywe różnice `projectRoot`/`serverRoot`).
2. **Obsługiwane w bundlerze Buna**: `resolver.sourceExts`/`assetExts` → resolver, `transformer.babelTransformerPath`
   → worker (transformer może być asynchroniczny jak w Metro — worker stał się `async`). Klucz cache bundlera Buna
   obejmuje teraz pliki configu Babel (`getCacheKey` babel-transformera Expo, jak klucz Metro) i plik transformera.
3. **Reszta → Metro**: `start`, `export`, `export:embed` (także przez preload `expo run:*`) z komunikatem o przyczynie;
   zastępuje osobny warunek RSC. `cli.ts` zachowuje cache Metro (bez `--reset-cache`) także przy automatycznym
   przełączeniu.
4. **Weryfikacja** (fikstura `wt-p6` bez RSC, `cli.ts` z repo): SVG w bundlerze Buna — `export:embed` iOS z komponentem
   (`"#e33"` w kodzie, zbiór assetów = Metro), web w Chromium renderuje `<svg>` z `<circle fill="#e33">`, bundle dev
   z `logo.svg` jako modułem JS; owinięty `serializer.customSerializer` → komunikat i wynik = Metro na Node bajt w
   bajt. Aplikacja repo: bundle iOS identyczny jak przed zmianą, `hermesc` iOS/Android OK, `compare:export` 87 plików
   / 0 różnic, web w Chromium bez błędów. Test `metro-config-support.test.ts` (4 przypadki).

### Faza 3 — serwer dev 1:1 z Metro (iOS/Android)

1. **Pomiar**: pierwszy bundle dev na zimno Bun 6,40 s vs Metro 6,43 s; ciepły restart 0,95 vs 0,40 s; po edycji
   0,03 vs 0,45 s. Kod modułów różny (CommonJS Babela zamiast transformacji importów Expo), ID zgodne w 2 z 1704.
2. **Transformacja Metro** (`metro-transformer.ts`): przechwycone wejście i wyjście Metro dla `explore.tsx` (hak w
   `WorkerFarm` przez tymczasowy wpis w `metro.config.js`; `bun --preload` jest ignorowane, gdy `bunfig.toml` ma
   preload — KNOWN-ISSUES #10). Worker Expo wywołany w Bunie z tymi danymi = kod, mapa, `functionMap`, zależności
   identyczne. `Transformer` Metro z `getOrComputeSha1` (moduły wirtualne Expo przez `fileBuffer` jak
   `getMetroBundlerWithVirtualModules`), opcje jak `calcTransformerOptions`, `pruneCustomTransformOptions` Expo
   (nieeksportowane — skopiowane). Po podpięciu: 1700/1704 moduły z identycznym kodem.
3. **Serializacja jak `metro/Server`** (`dev-graph-metro.ts`): przechwycone wywołanie `customSerializer` (opcje,
   moduły wstępne: `__prelude__`, runtime Expo, polyfille, `\0polyfill:*`, `streams.js`). Graf w kształcie Metro w
   kolejności `reorderGraph`, ID ze wspólnej fabryki serwera (`createModuleIdFactory`, jak w `Server`), URL przez
   `parseBundleOptionsFromBundleRequestUrl` + `splitBundleOptions` (forma jsc-safe `sourceURL`), mapa przez
   `sourceMapStringNonBlocking` posortowanych modułów (`_getSortedModules`), `getSource` z wyniku transformacji
   (inaczej `sourcesContent` modułów wirtualnych był pusty). Pusty moduł → `resolver.emptyModulePath`,
   `\0polyfill:assets-registry` przez Metro. Wynik: bundle i mapa iOS, bundle Androida (fabryka wspólna dla platform),
   bundle leniwy i jego mapa — bajt w bajt jak Metro na tym samym porcie.
4. **HMR jak `metro/HmrServer`**: aktualizacja początkowa przy `register-entrypoints`, `clientUrl` z parametrami
   Metro, moduły przez `hmrJSBundle` Expo, `revisionId` 8 bajtów hex, `update-done` z `changeId` (UUID), aktualizacja
   także gdy zmieniony plik grafu nie zmienił wyniku. Treść aktualizacji = Metro (poza losowym `revisionId`). Metro
   wysyła więcej pustych aktualizacji, bo jego watcher zgłasza więcej zdarzeń na jeden zapis.
5. **`--no-dev` / `--minify`**: graf per `dev`/`minify` (klucz `|nodev`, `|minify`), prelude z `isDev` transformacji.
   Bundle `dev=false&minify=true` = Metro łącznie z `debugId` — `debugId` to hash kodu `baseJSBundle`, który zawiera
   URL z portem, więc różni się między serwerami na różnych portach (sprawdzone: Bun na 8091 = Metro na 8091).
6. **Terminal jak Expo**: zdarzenia `bundle_build_started` / `bundle_transform_progressed` / `bundle_build_done` /
   `bundle_build_failed` + `bundling_error` do `reporter` z configu (`MetroTerminalReporter` Expo), `buildID` w base36,
   postęp liczony jak `onDependencyAdd/Added` grafu Metro, logi klienta jako `client_log`; bez własnych linii
   `[HMR …]`. Wynik: `iOS Bundled 6909ms node_modules/expo-router/entry.js (1705 modules)`, z cache `(1 module)` —
   jak Metro (liczba modułów w Metro też zależy od przebiegu: 1530/1642/1705).
7. **Atlas** (`EXPO_ATLAS`/`EXPO_UNSTABLE_ATLAS` przez `env` Expo) → Metro (`metro-config-support.ts`).
8. **Symulator** (iPhone 17 Pro, `dev.poc.bunrn`, serwer Buna na 8081): aplikacja z bundla identycznego z Metro, Fast
   Refresh zmiany tytułu, zakładka Explore, obraz z `/assets/?unstable_path=…`.
9. **Web — niedokończone, wycofane**: z transformacją Metro 1279/1298 modułów identycznych; różnice w resolverze
   (helpery `@babel/runtime/helpers/esm/*` dla importów ES, shimy `\0shim:react-native-web/...` jako moduły wirtualne) i
   w HTML (Expo bierze skrypt i CSS z zasobów serializera `static` — 9 bloków `data-expo-css-hmr` vs 8). Web zostaje na
   dotychczasowej ścieżce do czasu tych poprawek.

### Faza 4 — `expo-updates`: `app.manifest` z grafu Buna

1. **Problem**: w buildzie Release osadzony bundle i assety robi bundler Buna, a `app.manifest` (hashe assetów
   osadzonej aktualizacji) liczy `createUpdatesResources.js` z `expo-updates` przez `createMetroServerAndBundleRequestAsync`
   + `exportEmbedAssetsAsync` Expo — serwer Metro i przejście jego grafu (~7–8 s na zimno w każdym buildzie).
2. **`updates.ts`**: przez preload (`tools/bun/expo-cli.preload.js`, skrypt rozpoznany po ścieżce) obie funkcje z
   `@expo/cli/build/src/expoUpdatesExports` zwracają assety bundla Buna tego samego wpisu, platformy i trybu (kształt
   `AssetData` Metro). Preload działa, bo skrypt biegnie z katalogu projektu (iOS `cd "$PROJECT_ROOT"`, Android
   `workingDir(projectRoot)` w `ExpoUpdatesPlugin.kt`). Projekty na Metro (RSC, nieobsługiwany `metro.config.js`,
   `RN_BUNDLER=metro`) zostają przy Metro.
3. Błąd po drodze: `createUpdatesResources.js` dostaje ścieżkę `/tmp/...`, resolver zwraca `/private/tmp/...`, więc
   zaślepki brakujących eksportów nie trafiały w pliki i `Bun.build` kończył się błędem „No matching export” —
   `realpath` jak w `cli.ts`.
4. **Weryfikacja** (fikstura `wt-p6` z `expo-updates` i SVG, `CONFIGURATION=Release|Debug`): `app.manifest` z grafu
   Buna = Metro (poza losowymi `id`/`commitTime`) — iOS Release 36 assetów, Android Release 43, iOS Debug 42, Android
   Debug 49.
5. **Build Release na symulatorze** (iPhone 17 Pro, `expo run:ios --configuration Release`, `updates.url` fikcyjny z
   `checkAutomatically: NEVER`, `runtimeVersion: p4-1`): bundle z Buna (`iOS Bundled 2093ms with Bun`), `app.manifest`
   w `EXUpdates.bundle` = Metro (36 assetów); aplikacja: `Updates.isEnabled=true`, `isEmbeddedLaunch=true`, `updateId`
   = `id` wbudowanego manifestu, `runtimeVersion=p4-1`, obraz PNG z osadzonych assetów i SVG z pluginu — bez błędów
   `expo-updates` w logu. Po drodze: pozostałość testu RSC w fiksturze (import pliku `'use server'` przy wyłączonym
   RSC) wywracała start błędem `window.location.href is not defined` — błąd fikstury, nie bundlera. Android: tylko
   porównanie manifestów (pkt 4), bez buildu Gradle.

### Faza 5 — zamknięta decyzją z § 2a

RSC zostaje na Metro (runtime Buna, automatycznie); weryfikacja w macierzy fazy 1. Odtwarzanie RSC w bundlerze Buna
(15–22 dni) nie daje lepszej zgodności niż Metro. Dokończenie: błąd Expo w `expo start` (KNOWN-ISSUES #17) obchodzi
toolchain — polyfill `__webpack_get_script_filename__` (`tools/bun/rsc-dev-polyfill.js`) dopisywany do
`serializer.getPolyfills` tylko w dev i tylko przy RSC (`reactServerFunctions` / `reactServerComponentRoutes` /
`EXPO_UNSTABLE_SERVER_FUNCTIONS`, jak `instantiateMetro`), `BUN_RN_RSC_DEV_FIX=0` wyłącza. Fikstura: z obejściem
Server Function renderuje się w `expo start` (Chromium), bez — `ReferenceError`; eksport web bez polyfillu.

### Faza 6 — macierz weryfikacji

1. **Monorepo** (`/tmp/bunpoc/mono`: workspace Buna `apps/mobile` = kopia aplikacji z HEAD + `packages/ui` z
   komponentem TS i obrazem PNG, `linker = "hoisted"`; Expo sam ustawia `watchFolders` i `unstable_serverRoot` na
   korzeń workspace):
   - `export:embed` iOS: bundler Buna i Metro zawierają moduł z `@mono/ui`, identyczny zbiór 37 assetów (pliki spoza
     aplikacji jako `assets/__packages/ui/...`, nazewnictwo Metro);
   - serwer dev (iOS, URL z manifestu Expo względem korzenia workspace): bundle i mapa bajt w bajt jak Metro;
   - **błąd znaleziony i naprawiony**: `bun run export` szukał wpisu w `apps/mobile/node_modules/expo-router/entry` —
     `resolveRelativeEntryPoint` Expo zwraca ścieżkę względem korzenia serwera Metro (korzenia workspace), a
     `export.ts`/`web-export.ts` doklejały ją do katalogu aplikacji; teraz bezwzględny `resolveEntryPoint` Expo. Po
     poprawce `compare:export` (iOS + Android + web static) 90 plików / 0 różnic;
   - **błąd znaleziony i naprawiony**: web dev — czcionka z `node_modules` korzenia workspace pod
     `/node_modules/...` (404), bo publicPath `/assets` + ścieżka `../../node_modules` się skracała. Teraz publicPath
     dev Expo (`/assets/?unstable_path=.`) i kodowanie jak `getUniversalAssetData`: URL-e i bajty jak w Metro (także w
     zwykłym repo: `/assets/?unstable_path=.%2Fassets%2Fimages/...`).
2. **Expo Go**: iOS (symulator) i Android (emulator, Expo Go zainstalowane przez `expo start --android`) z serwerem
   Buna — aplikacja się ładuje, Fast Refresh działa (Android ~2,2 s).
3. **Android Release z `expo-updates`** (Gradle, fikstura `wt-p6`): bundle z Buna, APK z `assets/app.manifest` =
   Metro (43 assety); na emulatorze `isEmbeddedLaunch=true`, `updateId` = `id` manifestu z APK, PNG i SVG działają.
   Po drodze środowisko: `OutOfMemoryError: Metaspace` w KSP (`expo-updates`) przy domyślnym `-Xmx2048m
   -XX:MaxMetaspaceSize=512m` — build z `GRADLE_OPTS=-Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1536m"` i
   `ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a`; zawieszony demon Gradle trzymał blokadę
   `~/.gradle/caches/journal-1` (zakończony). Emulator Pixel_2_API_36 przestał odpowiadać po ~40 min (znane).
4. **Metro na Bunie dla obcych `metro.config.js`** (zewnętrzny projekt: Nx monorepo,
   Sentry `getSentryExpoConfig`, Uniwind, transformer SVG — toolchain sam przełącza na Metro): `export:embed` z
   toolchainu ≠ Metro na Node w wymiarach i kolejności plików assetów `expo-router` — dwie przyczyny:
   - config projektu nie wyłącza wątków Expo, a w wątkach nie ma shimu `readdir` (KNOWN-ISSUES #4/#5) →
     `metro-on-bun.ts`: dla każdego procesu Expo CLI na Bunie (preload, `cli.ts`) `WorkerFarm` na wątkach Buna z shimami
     i `EXPO_PUBLIC_*` w `cacheVersion` przez `withMetroMultiPlatformAsync` Expo (każdy config, który Expo składa) —
     także `cli.ts` pomija `--reset-cache` bezpiecznie w obcych projektach;
   - projekt ma dwie wersje Metro (`metro` 0.87 wciągnięte jako peer `*`, KNOWN-ISSUES #9, i 0.84.5 w `@expo/metro`,
     której używa Expo CLI) → `tools/bun/metro-require.js`: Metro z łańcucha `@expo/cli` → `@expo/metro` → `metro` dla
     `WorkerFarm` (wątek ładuje `Worker.js` tej samej kopii) i wszystkich `metro/private/...` bundlera.
   Wynik: `export:embed` iOS i Android — bundle, mapa i assety bajt w
   bajt jak Metro na Node 25.9, łącznie z debug ID Sentry. Hook musi się zainstalować przed załadowaniem modułów Expo
   CLI (trzymają referencje do eksportów) — w `cli.ts` na samym początku.

---

## Jak powtórzyć weryfikację

```bash
# zgodność eksportu z Metro (plik po pliku)
bun run export:metro -- --output-dir /tmp/metro && bun run export --output-dir /tmp/bun
bun run compare:export /tmp/metro /tmp/bun                 # ten sam zbiór plików + porównanie treści

# zasoby buildu natywnego
bun expo export:embed --platform ios --dev false --minify false --entry-file node_modules/expo-router/entry.js \
  --bundle-output /tmp/m/main.jsbundle --assets-dest /tmp/m/res          # Metro
bun tools/bun-bundler/cli.ts export:embed …                              # Bun (te same argumenty)

# testy i bramki
bun run typecheck && bun run lint && bun run test && bun run test:tools
```

Porównania Metro wymagają osobnego `TMPDIR` na każdy przebieg (cache Metro w `$TMPDIR/metro-cache`).
