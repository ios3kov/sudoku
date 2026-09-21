# UI class contract CI repair — 2026-09-21

## Scope and observed failure

PR #29 CI #254 failed at `UI class contract`. The later web lint, typecheck, build, browser acceptance and production-image steps were skipped, so that run did not verify the redesign.

The checker read only `apps/web/app/globals.css`. The redesigned classes are defined in `apps/web/features/messenger/messenger-redesign.css`, which is imported by `apps/web/app/layout.tsx` after the global stylesheet. The checker incorrectly reported 17 missing selectors because it never read the second stylesheet.

## Correction

`scripts/check-web-ui-contract.mjs` now resolves relative side-effect CSS imports from the scanned TSX source files. Imported files must exist; unimported stylesheets cannot satisfy the contract. Generated output and dependency directories are excluded. Class extraction and the failure for genuinely missing selectors remain enabled.

This correction changes CI tooling, not the application, gesture threshold, API or MLS protocol. It does not establish that the redesign's runtime behavior or physical-device animation is correct.

## Verification performed

On Node.js v22.16.0, the regression suite was run against the original checker first: 3 tests passed and 4 failed, including the split-stylesheet case reproducing CI #254. After the correction, all 7 tests passed. Both JavaScript files also passed `node --check`.

Covered cases: the existing global stylesheet; the imported messenger stylesheet; a genuinely missing class; an unimported stylesheet; a missing imported stylesheet; generated/dependency source exclusion; and a component-relative CSS import with conditional classes.

```bash
node --check scripts/check-web-ui-contract.mjs
node --check scripts/check-web-ui-contract.test.mjs
node --test scripts/check-web-ui-contract.test.mjs
node scripts/check-web-ui-contract.mjs
```

The first three commands were executed locally. Full-repository class validation and the rest of the release pipeline remain GitHub CI gates. The CI `UI class contract` step now runs the regression suite before validating the actual application sources.

## Release gate

Do not merge or deploy on the basis of these tooling tests alone. Require the latest PR head's full CI, followed by exact-SHA deployment and the live/device checks in `70-live-verification.md`. Physical iPhone animation profiling and end-to-end UX verification are not claimed by this repair.
