# Release candidate verification

## Verified candidate — 2026-09-25

Application candidate: `afec35c604bd942c216c8566eff200b4801b2eba`.

GitHub Actions API confirmed all applicable workflows successful:
- [ci 36140330776](https://github.com/ios3kov/sudoku/actions/runs/36140330776)
- [device-access 36140330855](https://github.com/ios3kov/sudoku/actions/runs/36140330855)
- [beat-runtime 36140330934](https://github.com/ios3kov/sudoku/actions/runs/36140330934)
- [api-shutdown 36140330833](https://github.com/ios3kov/sudoku/actions/runs/36140330833)

CI passed API integration, migrations, OpenMLS build/tests, dependency audits, web lint/typecheck/build, UI contract, browser E2E, performance budget, controlled profiling, pinned MinIO checks including the isolated restore script, and production image builds. Raw measurement artifacts have not been independently downloaded/reviewed in this continuation. Native CI did not run on this SHA because of path filters; earlier native success is not a fresh physical acceptance result.

Integrated Free/Challenge modes, menu/dialog redesign, fonts/branding and browser regressions. Local Sudoku/UI verification passed 6 browser scenarios; domain verification passed 42 tests. Fixed scanner placeholder matching and CSS-contract false positives without retaining dummy CSS selectors.

**Not released.** Physical iPhone/two-account acceptance, VoiceOver/media quality, device profiling, full application login/messages against restored data, independent backup verification and deployment-specific configuration remain open. Python dependency locking and inline-script CSP review remain unresolved. CI restore success is limited to disposable services and synthetic data, not production disaster recovery. No production deployment, migration, restart, TestFlight or App Store publication was performed.

This documentation checkpoint does not designate a new application candidate or claim tests ran on a later documentation commit. Earlier pending statuses below are historical; this section supersedes them only within the verification scope stated above.

