# Step 83 — PIN production deploy

Date: 2026-09-23

## Result

Production rollout of device PIN support completed successfully on application commit `7ae408baf61f7fd978735773d82d038ce4d1cdc4`.

Operator evidence:
- pre-resume schema was `0014_mls_device_rekey` and the paired backup checksums passed;
- corrected non-root API image could read Alembic and reported revision `0014_mls_device_rekey` before migration;
- migration completed to `0015_session_pins`;
- only application services were recreated: api, worker, beat, web; PostgreSQL, Redis and MinIO were not reconciled by the resume flow;
- api, worker, beat and web reported `running`, restart count `0`, OOM `false`;
- API process-boundary check printed `API_EXEC_OK` (Uvicorn is PID1 rather than a child of `/bin/sh`);
- Caddy was reopened after application verification;
- production smoke passed DNS, HTTPS application, API readiness, asset TLS and HTTP redirects;
- unauthenticated `/v1/auth/device-access` returned HTTP 401;
- terminal marker: `PIN_DEPLOY_OK 7ae408baf61f7fd978735773d82d038ce4d1cdc4`.

The first HTTPS probe immediately after Caddy start briefly returned connection refused; the smoke script retry then completed successfully. This is startup convergence, not a final smoke failure.

## Remaining acceptance

Technical rollout is complete. Manual member/admin PIN UX acceptance remains: remember login, set PIN, reload/reopen unlock, wrong-PIN attempt handling, password recovery, disable PIN, logout/revoke behavior, and physical iOS/Android/two-device acceptance. Backup restore drill and off-host encrypted backup remain separate operational acceptance.
