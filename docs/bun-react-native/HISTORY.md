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

## Etap 10 — `.env` jak w Expo, `export:embed` jak `exportEmbedAsync`, mapy źródeł w kształcie Expo

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
