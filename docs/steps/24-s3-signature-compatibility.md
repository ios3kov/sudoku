# Step 24 — S3 signature compatibility

## Finding
The full API scenario now passes invite/auth, direct and group authorization, message retry idempotency, search, conversation preferences, Origin rejection, upload intent, object upload and server-side asset verification.

The test then assumed every S3-compatible implementation emits AWS SigV4 query parameter `X-Amz-Signature`. The in-process S3 test service emits a valid SigV2-style `Signature` query instead.

## Decision
Do not couple the application contract to a specific presigned-URL signature version. The storage contract is S3-compatible signed URLs.

## Fix
The integration assertion accepts either SigV4 `X-Amz-Signature` or SigV2 `Signature`, while still requiring the API to redirect to a signed URL.

## Next
Continue full acceptance through push boundary, domain tests, web typecheck and production build.
