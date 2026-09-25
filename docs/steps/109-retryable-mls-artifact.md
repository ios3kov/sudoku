# Step 109 — retryable OpenMLS CI artifact

Date: 2026-09-25.

## Problem

A post-merge Browser E2E retry exposed a CI orchestration bug: the generated OpenMLS browser artifact name included `github.run_attempt`. A targeted rerun of Browser E2E increments the workflow attempt but does not rerun the successful OpenMLS build, so the retried Browser job searched for a new artifact name that did not exist.

## Fix

The OpenMLS browser artifact is now named only by `github.run_id`, which is stable across attempts of the same workflow run.

- crypto uploads `mls-wasm-${{ github.run_id }}`;
- Web and Browser jobs download that same stable artifact;
- upload uses `overwrite: true` so rerunning the crypto job can safely replace the artifact for the same run.

## Result

Targeted Web/Browser retries can reuse the already verified OpenMLS output instead of forcing a full workflow rerun.

This is CI-only. It does not change application runtime, production data or deployment state.
