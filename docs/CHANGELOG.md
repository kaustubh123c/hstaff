# Changelog

## 2026-10-14 — On-demand marketplace lifecycle

- Added phone OTP registration/sign-in, Twilio REST SMS sending, expiry, attempt limits and development/test-only OTP disclosure.
- Added encrypted business-delivered job arrival codes, expiry, attempts, resend throttling and one-time consumption.
- Added worker completion submission, business completion confirmation, backend duration/fee calculation, ratings and feedback.
- Added active-job scoped GPS write/read APIs and frontend GPS updates/status polling.
- Added on-demand Razorpay order, signature and capture verification, plus job webhook recording.
- Restored admin-only offline payment recording for approved timesheets after verifying this was the correct root cause of the legacy test failure.
- Replaced the mounted on-demand module with `server/src/routes/marketplace.js`; legacy module remains on disk but is no longer mounted pending final cleanup review.
- Added database tables for OTP records, job locations, ratings and on-demand payments; added completion request timestamp. Migrations are additive.
- Validation: `npm test` passed 8/8, including mocked Razorpay order/capture/signature/webhook behavior. Alternate-output Vite production build passed. Default `dist` build remains blocked by Windows `EPERM` on the pre-existing `dist/assets` directory. Live Twilio/Razorpay requests were not tested without credentials.

## 2026-10-14 — Audit and baseline repair

- Fixed demo seed insertion to name worker columns, because additive schema upgrades made positional inserts fail.
- Removed duplicate platform-fee config assignment so the bounded default is applied consistently.
- Prevented repeated on-demand finish verification after the job has completed.
- Closed the disposable SQLite test connection before temp-folder cleanup.
- Added architecture, API, schema, maintenance, testing, audit, implementation plan and progress documentation.
- Validation: Node tests exposed existing API/test mismatches; fresh-directory Vite build passed. See `docs/TESTING_GUIDE.md`.
- Database: no data migration or production database modification performed.

## Unreleased — unified UI, worker app rebuild, Vercel
- Worker, User and Admin portals share one design system (navy rail/header, indigo accent, white cards, line icons).
- Worker app rebuilt: Find work (go online, swipe right to accept/apply, left to skip), My orders (Active / Waiting /
  Done, now including applications still waiting for approval), Profile. Read-aloud, 3 languages, text sizes kept.
- Fix: workers could not see or take work in the previous portal (only already-accepted orders were listed).
- Fix: `GET /api/meta` is public again (the on-demand router's sign-in check was shadowing it).
- API: worker shift list excludes on-demand jobs; shifts include `job_type`; `GET /api/cron/auto-approve`.
- Vercel: `api/index.js`, `vercel.json`, `.vercelignore`, `render.yaml`, `DEPLOY_VERCEL.md`; server dependencies
  merged into the root `package.json`.
