# Step 23 — Valid integration-test identities

## Finding
The full API integration test reached the real login endpoint but used addresses under the reserved `.test` TLD. Pydantic `EmailStr`/email-validator correctly rejected those addresses with HTTP 422.

## Decision
Do not weaken production email validation to accommodate a test fixture.

## Fix
Integration identities now use syntactically and validator-accepted `example.com` addresses with randomized local parts.

## Verification
Acceptance CI must proceed past login and exercise the remaining invite, messaging idempotency, asset and origin-boundary assertions.
