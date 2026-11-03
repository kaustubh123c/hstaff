# Initial codebase audit

Audit date: 2026-10-14. Sources were inspected directly; this report records the pre-redesign baseline.

## Repository and runtime

- React 19 + Vite 8 frontend in `src/`; Express 4 API in `server/src/`.
- Node.js 22.12+ is required. SQLite uses Node's built-in `node:sqlite`; no external database server is needed.
- Auth is email/password with bcryptjs and JWT. Registration permits worker/business roles; admin accounts are only seeded.
- Existing app is a single role-aware SPA with Business, Worker, and Admin menus, responsive CSS, and partial Hindi/Marathi translations.
- Persistent data resides in `server/data/` (SQLite WAL database and private uploads). This directory contains an existing database and identity-document files; it was not reset or cleaned.

## Existing feature inventory

| Area | Observed implementation | Gaps / notes |
|---|---|---|
| Scheduled shifts | Create/edit/cancel, applications, capacity, role checks | Still the dominant user-facing business flow |
| Attendance | Signed QR, GPS distance checks and time window | Retain as legacy scheduled-shift path |
| Timesheets | Server duration/rate calculations, review/dispute | Existing API tests include mismatched expectations |
| KYC | Private local uploads, file checks, admin review | Manual review only; no identity-provider verification |
| On-demand | `ondemand.js`: location, nearby discovery, worker accept, start/finish codes | Start/finish delivery is demo-mode disclosure; no expiry/attempt table, user confirmation, tracking channel, or complete payment lifecycle for these jobs |
| Razorpay | Order creation, checkout signature + capture lookup, webhook signature/idempotency, payout status records | Requires credentials; no live credentials were present/used. Payout transfer provider execution is not implemented |
| Admin | Users, KYC, settings, reports, audit logs, disputes, payments | Useful capabilities retained; UI remains a shared SPA shell |
| i18n | English/Hindi/Marathi dictionary and selector | Coverage is partial; many screens are untranslated |
| Tests | Node integration tests use a disposable DATA_DIR | Initial seed failed due to positional insert after additive migrations; after repair deeper failures remain (see progress) |

## Baseline verification

- `npm test`: initially 0/8 passed because the seed used `INSERT INTO workers VALUES (...)` after the table grew to eight columns.
- `npm run build`: Vite transformed modules but was blocked clearing the existing `dist` directory with Windows `EPERM`.
- `npx vite build --outDir .codex-build-check`: succeeded (28 modules).
- No baseline app-wide end-to-end test or mobile device run was present.

## Changes made during audit

- Worker seed now names its columns, making it resilient to additive SQLite migrations.
- Removed a duplicate `platformFeePercent` key in config (the bounded 10% default is authoritative).
- Test cleanup now closes its disposable SQLite connection before deleting the temp directory.
- On-demand OTP verification rejects repeat completion.

No database files, uploads, built output, or legacy source modules were removed.
