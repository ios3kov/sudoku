# Step 109 — stable OpenMLS artifact across targeted CI reruns

Date: 2026-09-25.

## Finding

Post-merge CI on main `ee01adee61fcaf3b4628a69c05fe7bfb5aec8d94` exposed a CI orchestration bug, not an application failure.

The OpenMLS browser package artifact was named with both `github.run_id` and `github.run_attempt`. When only a downstream job is rerun, GitHub increments `run_attempt` for that run while the already-successful OpenMLS job is not rebuilt. The rerun therefore requested a new artifact name that did not exist.

Observed failure: Browser E2E attempted to download `mls-wasm-36168819280-2` although the successful OpenMLS shard had retained the package from the earlier attempt. Web and all application/security/infra shards were otherwise green.

## Fix

The OpenMLS package now uses the stable name:

`mls-wasm-${{ github.run_id }}`

The upload uses `overwrite: true`, so either of these workflows is safe:

- rerun only Web or Browser: reuse the already-built package;
- rerun OpenMLS itself or rerun the whole workflow: replace the package under the same stable run identity.

The two downstream downloads use the same stable name.

## Regression coverage

`tests/ops/test_ci_artifact_contract.py` verifies that:

- all three OpenMLS artifact references use only `github.run_id`;
- no OpenMLS artifact reference includes `github.run_attempt`;
- the upload block enables overwrite.

The test is part of the existing `Operations unit regressions` shard.

## Release boundary

This is CI-only hardening. It does not change application runtime behavior and does not deploy production.
