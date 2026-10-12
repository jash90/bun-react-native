# React Native / Expo w 100% na Bun — dokumentacja

Stan: **2026-10-12**. Zweryfikowano end-to-end bez prawdziwego Node.js na PATH (szczegóły: [VERIFICATION.md](VERIFICATION.md)):
Expo SDK 57.0.27 · React Native 0.86.3 · Metro 0.84.5 · Hermes · Bun 1.4.3 · Xcode 26.6 · JDK 17 · macOS arm64.

> Na urządzeniu kod wykonuje **Hermes** — Bun zastępuje Node.js wyłącznie w toolchainie (instalacja, CLI, Metro,
> Babel, Jest, lint/typecheck, CocoaPods/Gradle/Xcode build phases, CI).

## Zawartość

| Dokument | Co zawiera |
|---|---|
| [BUNDLER.md](BUNDLER.md) | Bundler na Bunie zastępujący Metro: architektura, użycie, pomiary, weryfikacja, ograniczenia |
| [RUNBOOK.md](RUNBOOK.md) | Krok po kroku: instalacja, pliki konfiguracyjne, shim `node`, skrypty, buildy natywne, CI, EAS, weryfikacja, wycofanie |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Wszystkie znane bugi (Bun/Expo/RN/Jest) z linkami, statusem, obejściem, testem i warunkiem usunięcia obejścia |
| [VERIFICATION.md](VERIFICATION.md) | Dowody: przebieg e2e bez Node, porównania bajt-w-bajt z Node, pomiary czasów, lista miejsc wołających `node` |
| [HISTORY.md](HISTORY.md) | Jak do tego doszliśmy: etapy, konkretne kroki, błędy z przyczynami i commity |
| [CI-EAS.md](CI-EAS.md) | GitHub Actions i EAS Build: co działa, co niezweryfikowane |
| Pliki w repo | [`bunfig.toml`](../../bunfig.toml), [`tools/bun/node-compat.preload.js`](../../tools/bun/node-compat.preload.js), [`tools/bun/jest.preload.js`](../../tools/bun/jest.preload.js), [`metro.config.js`](../../metro.config.js), [`tools/bin/node`](../../tools/bin/node), [`plugins/with-bun-xcode-env.js`](../../plugins/with-bun-xcode-env.js), [`.github/workflows/mobile-bun.yml`](../../.github/workflows/mobile-bun.yml), [`eas.json`](../../eas.json) |
| [sources/bun/](sources/bun/INDEX.md) | Lokalna kopia oficjalnej dokumentacji Buna (oven-sh/bun@`c39c718`, 2026-10-12) + posty z bloga 1.3–1.4.3 |
| [sources/](sources/) — Expo / React Native / Metro / EAS | Lokalna kopia oficjalnej dokumentacji (indeks: `sources/INDEX-expo-rn-metro.md`) |

## Skrót: co trzeba zrobić

1. `bun install` przy starym lockfile'u (migracja zachowuje wersje), commit `bun.lock`, pin `@react-native/metro-config`.
2. Pliki z tabeli wyżej są już w repo; lokalnie dodaj `tools/bin` na początek PATH (RUNBOOK § 4).
3. Skrypty bez `--bun` (shebang → shim → Bun).
4. CI: `.github/workflows/mobile-bun.yml` (z jobem porównującym bundle Node/Bun).
5. Weryfikacja: pułapka na Node + `cmp` bundli + test na urządzeniach.

## Czego NIE da się zrobić „na Bunie” i co zamiast

| Zamiast | Używamy | Dlaczego |
|---|---|---|
| `Bun.build` bez dodatków | własny bundler na API Buna (`tools/bun-bundler/`, [BUNDLER.md](BUNDLER.md)) — buildy, dev server, eksport OTA i web; Metro tylko jako wyjście awaryjne | `Bun.build` nie zna formatu modułów Metro, HMR RN ani rejestru assetów — patrz KNOWN-ISSUES |
| `bun test` | Jest uruchomiony na runtime Bun | Flow + presety Jest RN (oven-sh/bun#16945) |
| usunięcie Node z obrazów EAS / runnerów | Node obecny, ale nieużywany (shim przed nim na PATH) | obrazy dostarcza dostawca |

## Rozbieżności z dokumentacją oficjalną (stan 2026-10-12)

| Dokumentacja mówi | Test w PoC | Źródło |
|---|---|---|
| „Node.js (LTS) is still required for `bun create expo-app` and `bun expo prebuild`” | `expo prebuild --clean` przeszedł bez Node (SDK 57, Bun 1.4.3); `create-expo-app` nie testowano bez Node | `sources/expo/guides-using-bun.md` |
| `--bun` „Overrides `#!/usr/bin/env node` shebangs by symlinking node to Bun” — bez zastrzeżeń | alias `node` ma bug #40482; przy natywnych buildach `--bun` szkodzi | `sources/bun/runtime__index.md`, KNOWN-ISSUES #1, #3 |
| `transformIgnorePatterns` z `.bun` w Jest dla Buna | potrzebne tylko przy linkerze `isolated`; przy `hoisted` zbędne | `sources/expo/develop-unit-testing.md` |
| Metro docs (wersja 0.87) | projekt używa Metro 0.84.5; `transformer.unstable_workerThreads` istnieje w 0.84.5 (`metro-config/src/defaults/index.js:151`) | `sources/metro/Configuration.md` |
| Obraz EAS `sdk-57` | Bun 1.3.14 (obejścia zweryfikowano na 1.4.3 → przypnij wersję w `eas.json`) | `sources/eas/build-reference-infrastructure.md` |
