# Step 66 — Activation test fixture isolation

## Finding
After the MLS activation gate was hardened, two older integration tests still called the activation endpoint without registering a current MLS device or delivering Welcome messages.

Those tests were not testing activation. They test:
- ciphertext-only persistence/plaintext rejection after activation;
- rejection of legacy plaintext edit/reaction mutations for E2EE messages.

Calling the production activation endpoint from those fixtures now correctly fails.

## Fix
The two focused tests set the already-created conversation to active directly in the isolated test database. The dedicated MLS activation test remains responsible for exercising the real endpoint and verifies:
- premature activation is rejected;
- the creator current MLS device is registered;
- required Welcome delivery exists;
- activation then succeeds.

## Security
The production activation gate is not weakened. Test concerns are separated so security coverage cannot be bypassed accidentally by broad fixtures.

## Verification
Full API integration, OpenMLS browser build, web typecheck, Next production build and Compose validation are required.
