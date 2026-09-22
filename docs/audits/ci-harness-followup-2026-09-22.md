# PR #34 — CI harness follow-up

Baseline: `cb9266497640b7d4b98cdcf09e4ea2e0a0a1eabf`.
No application, production configuration or acceptance-limit change.

Run `35709649389` executed 13/14 browser scenarios successfully. All media and
transaction-abort/key-integrity assertions passed. The remaining completion
observer was registered after the implementation's completion listener; a native
callback microtask checkpoint can resume the awaited promise before that later
observer runs. The observer now attaches at transaction creation, before the
production listener. The same completion-before-promise and rollback assertions
remain; no sleep, retry or production-code change hides the discrepancy.

The paired DB job stopped at Ruff: a synchronous Git invocation in async code
and the controlled baseline exec fixture. Git work now runs via asyncio.to_thread.
The immutable, hard-coded Git function is explicitly documented at its one scoped
S102 exception rather than disabling security lint for the file or workflow.
Python syntax and TypeScript passed locally; fresh hosted results are required.
No DB timing is claimed before the corrected profiler actually executes.

Primary event-loop reference:
https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-a-callback

The broader release scope, conflict decisions, test boundaries and remaining
manual/device/staging gates stay in `behavioral-hardening-2026-09-22.md`.
