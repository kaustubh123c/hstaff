# Testing guide

Requirements: Node 22.12+ and npm. Backend tests use `node:test`, a fresh OS temp directory and seeded fixture data; they do not intentionally use `server/data/hstaff.db`.

```powershell
npm test
npm run build
```

The production frontend is written to `.hstaff-build`, which the Express server serves by default. `WEB_DIST_DIR` can override this location. This avoids touching the existing `dist` files.

Latest run: `npm test` passed 19/19 backend tests and 2/2 localization tests. This includes explicit local OTP opt-in/production restrictions, OTP registration/login and SMS-provider outcomes, private Admin provisioning and authorization, Google token signature/audience/expiry/verified-email/authoritative-email checks and User/Admin/Worker restrictions, legacy scheduled-shift lifecycle and manual-payment authorization, marketplace OTP/GPS/completion/ratings, mocked Razorpay verification, and Worker/User label translations.

Latest `npm run build` passed with Vite 8.3.4 into `.hstaff-build` (29 modules). The original failure was Windows access denied while creating a hashed bundle in existing `dist/assets`; existing files were preserved. Google signing keys were mocked in tests. Live Google sign-in requires matching OAuth client IDs and runtime network access to Google's public signing keys; no real Google login, SMS, or Razorpay payment was performed. Hosted Admin accounts use the private interactive CLI; a localhost-only sign-up route is available for explicit development demos and is disabled in production.

External Razorpay, SMS, maps, and identity-provider behavior is not exercised by these tests. Add mocked integration tests before claiming those pathways verified. Use disposable `DATA_DIR`/`DB_FILE` values for any test that invokes `--reset`.
