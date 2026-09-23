# Step 87 — Repository hygiene and dependency PR policy

Date: 2026-09-23

## Goal

Remove stale pull-request debt after the final control audit and prevent Dependabot from recreating the same review noise as many one-dependency branches.

No production deployment or runtime change is part of this step.

## Closed stale pull requests

The following pull requests were closed without merge because their branches were based on obsolete repository state and were no longer valid integration candidates:

- #34 — old 1.0 release-readiness branch, superseded by the later hardening, phone/contact and final control-audit work now on `main`;
- #3–17 — old Dependabot branches created before the current mainline and all reported non-mergeable against the current base.

The dependency proposals were not security blockers at the time of closure. Current main CI dependency checks were green:

- Python dependency audit;
- npm production dependency audit;
- Rust dependency audit.

Major toolchain/runtime changes such as TypeScript, ESLint, Node, Rust and GitHub Actions major versions should be tested from current `main`, not merged from stale branches.

## Dependabot policy

`.github/dependabot.yml` now groups version updates per ecosystem into two categories:

- `routine` — minor + patch updates;
- `major` — major-version updates.

This applies to:

- npm;
- pip;
- Cargo;
- GitHub Actions;
- API Docker images;
- Web Docker images.

Each ecosystem is limited to two open version-update PRs at a time. Security updates are not ignored or disabled by this policy.

The intent is to keep dependency review actionable: routine updates can be evaluated together, while major compatibility changes remain isolated from routine upgrades.

## Release boundary

Dependency maintenance remains subject to the same normal gate:

1. branch from current `main`;
2. exact-head CI;
3. review compatibility changes;
4. merge only if green;
5. post-merge push verification.

Closing obsolete Dependabot PRs is repository hygiene, not evidence that future major upgrades are automatically safe.

## Result

After Step86 and this cleanup:

- the final interactive-control audit is on `main`;
- the obsolete button-audit PR is closed;
- the old release-readiness PR is closed;
- stale pre-mainline Dependabot PRs are closed;
- future version updates are grouped into manageable maintenance PRs;
- no production service, database or infrastructure change was performed.
