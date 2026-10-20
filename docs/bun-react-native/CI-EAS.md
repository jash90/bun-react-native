# CI i EAS Build na Bun

## GitHub Actions — gotowe

Plik: [`.github/workflows/mobile-bun.yml`](../../.github/workflows/mobile-bun.yml); hooki EAS w [`package.json`](../../package.json), profile w [`eas.json`](../../example/eas.json).

| Element | Jak | Status |
|---|---|---|
| Instalacja Buna | `oven-sh/setup-bun@v2` (v2.2.0, 2026-03-14), `bun-version` albo `bun-version-file` | udokumentowane: `sources/bun/guides__runtime__cicd.md` |
| Shim zamiast Node | `echo "$GITHUB_WORKSPACE/tools/bin" >> "$GITHUB_PATH"` + krok `assert-no-node` (`node -p "process.versions.bun"`) | mechanizm sprawdzony lokalnie (PoC), workflow nieuruchomiony na GitHubie |
| Cache | `~/.bun/install/cache` po `hashFiles('bun.lock')` | — |
| Instalacja | `bun install --frozen-lockfile` | PoC: 2,2 s z ciepłym cache vs `npm ci` 14,2 s |
| Bez `--bun` | shebang → shim → Bun; `--bun` wstawia alias `node` z bugiem #40482 przed shim | sprawdzone w PoC |
| Determinizm | job porównujący `export:embed` Node vs Bun (`cmp` + `diff -r` assetów) | mechanizm sprawdzony w PoC |

Uwaga: runnery GitHuba mają preinstalowany Node, a `setup-bun` sam działa na runtime Actions `node24` —
to nie wpływa na toolchain aplikacji, o ile shim jest pierwszy na PATH.

## EAS Build

### Co jest oficjalne (źródła w `sources/eas/` i `sources/expo/`)
- EAS używa Buna jako menedżera pakietów, gdy w repo jest `bun.lock` lub `bun.lockb`
  (`sources/expo/guides-using-bun.md`; logika: `sources/eas/eas-build-tools-packageManager.ts.md` →
  `bun install`, `bun x …`, `bun add …`).
- Wersja Buna: pole `"bun"` w profilu `eas.json` (schemat: `sources/eas/eas-json-build-common-schema.js.md`).
- Obrazy (`sources/eas/build-reference-infrastructure.md`, stan 2026-10-08): `sdk-57` → **Bun 1.3.14**, Node 22;
  `sdk-58` → Bun 1.4.2. **Przypnij `"bun": "1.4.3"`** — obejścia z RUNBOOK zweryfikowano na 1.4.3.
- Hooki `package.json`: `eas-build-pre-install`, `eas-build-post-install`, `eas-build-on-success|error|complete|cancel`
  (`sources/eas/build-reference-npm-hooks.md`). W custom builds hooki nie wykonują się automatycznie.
- `set-env NAZWA wartość` w hooku ustawia zmienną dla kolejnych faz buildu
  (`sources/eas/eas-environment-variables-usage.md`).

### „100% Bun” na EAS — konfiguracja proponowana (NIEZWERYFIKOWANA na EAS)

Obrazy EAS mają Node, a natywne kroki (`pod install`, Gradle) wołają `node`. Żeby trafiały w shim, `bunx
bun-react-native init` dopisuje hook uruchamiany po instalacji zależności (przed instalacją paczki jeszcze nie ma —
KNOWN-ISSUES #20):

```jsonc
// package.json
"scripts": {
  // set-env PATH "<node_modules/bun-react-native/tools/bin>:$PATH" + asercja, że shim uruchamia Buna
  "eas-build-post-install": "bun-react-native eas-build-post-install"
}
```
```jsonc
// eas.json
{ "build": { "production": { "bun": "1.4.3" }, "preview": { "bun": "1.4.3" } } }
```

Niewiadome (do sprawdzenia pierwszym buildem EAS; nie uruchamiano, bo EAS wymaga konta i jest płatny):
1. czy `set-env PATH` nadpisuje PATH dla faz install/prebuild/pod install/Gradle (dokumentacja mówi ogólnie o zmiennych);
2. czy w monorepo hook trafia na paczkę (ścieżka shima liczona z położenia paczki, nie z `EAS_BUILD_WORKINGDIR`);
3. oven-sh/bun#33520 — patche (`patchedDependencies`) mogą nie zostać zaaplikowane przy ciepłym cache EAS:
   dodaj asercję w `eas-build-post-install` (np. `grep` znacznika z patcha w `node_modules`);
4. expo/eas-cli#3126 — monorepo z lokalnymi modułami (zamknięte „not planned”).

Fallback, jeśli `set-env PATH` nie działa: `eas build --local` na własnym runnerze z shimem na PATH
(`sources/eas/build-reference-local-builds.md`) albo Bun tylko jako menedżer pakietów na EAS (Node w krokach natywnych).
