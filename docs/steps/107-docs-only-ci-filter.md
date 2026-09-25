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
