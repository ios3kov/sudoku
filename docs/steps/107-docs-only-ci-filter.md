# Step 107 — skip duplicate heavy CI on docs-only main pushes

Date: 2026-09-25.

## Goal

Avoid spending full release-CI resources twice for documentation-only work.

PR validation remains unchanged: pull requests still run the normal applicable workflows. The optimization applies only to the post-merge/direct `push` event on `main` when every changed path is documentation-only.

## Change

The following core workflows ignore `main` pushes that change only `docs/**` and root Markdown files:

- `ci`;
- `device-access`;
- `beat-runtime`;
- `api-shutdown`.

Application, infrastructure, workflow, dependency, script and test changes still trigger the same checks as before.

The native iOS workflow is unchanged because it already has explicit path filters and intentionally watches its two native release-plan documents.

## Safety

This does not remove pull-request verification and does not reduce test coverage for executable changes. It only removes a duplicate post-merge run for documentation-only changes.

Production deployment is unaffected and remains separately authorized.

## Merge verification

PR #96 merged to main as `3beb8851586a117bfde34948c5c210a6c6ac3be0`.

The PR head `232c6e7a69722f9f3609be0c47388f151b480373` passed `device-access`, `beat-runtime`, `api-shutdown` and the full parallel CI. During the first CI attempt, the Infra shard saw a transient MinIO HTTP disconnect during conditional-upload verification; GitHub reran only that failed shard, and the targeted rerun passed conditional uploads, isolated restore, Compose validation and production image builds. Browser E2E and all other shards were already green and were not re-executed.

Post-merge main verification also passed: `ci #711`, `device-access #394`, `beat-runtime #396` and `api-shutdown #378`.
