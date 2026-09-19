# Progress

## Current milestone
Full restored MVP acceptance and hardening.

## Repository truth
Steps 17–21 restored the complete ordinary-source MVP. Steps 22–24 are acceptance hardening.

### Step 22
API packaging fixed; S3 test moved in-process.

### Step 23
Invalid reserved test email domains replaced without weakening production validation.

### Step 24
API integration now reaches verified asset download. The test was incorrectly coupled to AWS SigV4 query naming; S3-compatible SigV2/SigV4 signed redirects are accepted.

## Verification
Latest acceptance passed: API install ✓ S3 start ✓ migrations ✓ invite/auth ✓ direct/group authorization ✓ message idempotency ✓ search ✓ pin/mute ✓ Origin boundary ✓ upload ✓ server-side asset integrity ✓.
It failed only on the signature-version-specific assertion before later push/domain/web stages.

## Next step
Repeat acceptance and continue until push boundary, domain tests, web typecheck and Next production build are green; then code/security review.
