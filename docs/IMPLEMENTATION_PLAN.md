# Implementation plan

1. **Audit and baseline** — inventory modules, data paths, integrations, tests, and builds. Done; see `INITIAL_CODEBASE_AUDIT.md`.
2. **SQLite-safe core** — keep additive migrations, explicit SQL columns, isolate matching/payment logic, and define ownership and job lifecycle. In progress.
3. **Marketplace backend** — finish request, assignment concurrency, expiring OTP, user confirmation, ratings/disputes, and payment linkage.
4. **Role experiences** — evolve the existing SPA into distinct user, worker, and admin navigation while preserving scheduled shifts.
5. **Location and languages** — improve GPS/manual fallback, protect precise location, cover all worker/user strings in English/Hindi/Marathi.
6. **Verification and docs** — run disposable DB tests/builds, document exact API/schema, known external dependencies, and maintenance steps.

Implementation order is incremental; existing scheduled shifts, KYC, QR attendance, dispute, reporting, and payment-history modules remain until replacements are verified.
