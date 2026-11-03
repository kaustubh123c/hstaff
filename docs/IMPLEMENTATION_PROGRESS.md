# Implementation progress

Updated: 2026-10-14

| Work item | Status | Evidence / remaining work |
|---|---|---|
| Repository inspection | Complete | Existing routes, schema, frontend, scripts, and data paths reviewed |
| Baseline tests/build | Complete | Current backend and build results are recorded below |
| Existing architecture documented | Complete | See `ARCHITECTURE.md` |
| SQLite preservation | Complete | Existing data path untouched; additive schema remains |
| Seed migration compatibility | Complete | Explicit worker insert columns |
| Authentication | Complete for password and phone OTP | Phone OTP registration/login, HMAC storage, expiry, five attempts, one-use consume; Twilio config required outside dev/test |
| Auth/onboarding redesign | Complete for primary Worker/User flow | Responsive auth page; mobile OTP registration/sign-in; Admin email/password sign-in; optional Google button for Users and Admin; Worker Google sign-in hidden; English/Hindi/Marathi authentication strings |
| Registration role migration | Complete | Public `user` registration maps to existing internal `business` role and `businesses` table; ordinary registration rejects admin and legacy business roles; private provisioning CLI plus development-only localhost Admin sign-up; existing records remain intact |
| KYC onboarding | Complete for Worker registration flow | Private PDF/JPG/PNG upload with server signature checks, 5 MB limit, pending manual admin review; acceptance remains gated on admin approval |
| Admin UI | Implemented | Responsive control-center dashboard, quick links, user directory/status actions, worker directory/KYC state, live on-demand job monitoring/GPS view, payment/payout operations, complaints, reports and audit log screens. Existing APIs remain protected by admin role checks. |
| Worker UI | Partial | Nearby flow, accept, OTP, GPS, completion; old secondary screens remain |
| User/business UI | Partial | Request, OTP delivery, status polling, tracking, completion confirmation, rating, Razorpay checkout |
| Nearby matching | Implemented for current SQLite scale | Haversine radius filtering, verified/available worker gate, in-app notification to eligible workers |
| Assignment concurrency | Implemented | `BEGIN IMMEDIATE` transaction plus conditional Open→Filled update; API integration test races two workers and confirms one winner |
| Job-start OTP | Complete | HMAC hash, AES-GCM business delivery, 10-minute expiry, five attempts, one-time consumption, resend throttle |
| Completion confirmation | Complete | Worker submits completion; business confirms; server calculates rounded hours and fee |
| Live tracking | Partial | Authenticated active-job GPS updates and polling; no WebSocket, retention pruning, or field device tests |
| Razorpay collection | Partial | On-demand order/signature/capture/webhook path implemented and mock-tested; provider credentials unavailable for live test |
| Payout execution | Partial | Records/status transitions only; external transfer execution absent |
| i18n coverage | Partial | English/Hindi/Marathi are available for authentication, navigation, marketplace, dashboards, and key shift, attendance, payment and profile labels. Some legacy dialogs, descriptions, dynamic status/error messages remain English. |
| Automated tests | Passing | Latest `npm test`: 19/19 backend tests + 2/2 localization tests passed. Google tests verify signed token, audience, verified email, expiry, subject binding and role restrictions; Admin CLI helper tests hashing and duplicate protection. OTP tests verify explicit opt-in, production restriction, expiry and provider behavior. KYC, marketplace, payment and existing workflows remain passing. Live provider flows require credentials. |
| Documentation | Partial | Core setup/API/schema/maintenance docs updated; provider setup described |
| Cleanup | Deferred | No obsolete files removed without complete dependency replacement |

This checklist describes implementation evidence, not intended design.

## Authentication update (2026-10-14)

- Mobile registration now follows phone number → OTP → profile → Worker document submission. Returning phone accounts sign in directly without restarting onboarding.
- SMS codes are written to SQLite only after the SMS adapter reports successful delivery (or explicitly selected development-only delivery). A Twilio delivery failure no longer leaves a newly stored code and resend cooldown that appears like a successful request.
- New User accounts use the existing `business` database role/table to preserve compatibility; public registration only accepts Worker/User, with admin provisioning remaining controlled.
- Admin phone OTP is explicitly rejected; administrators must use the provisioned email/password sign-in path. Admin demo credentials were removed from frontend code.
- Worker uploads go through the authenticated `/api/kyc` route. Pending/Rejected/Verified states are determined by document submission and manual admin review; identity upload is not presented as automatic verification.
- Verification at that time: `npm test` passed 9/9. See the project-wide update below for current results.

## Admin, localization and Windows build update (2026-10-14)

- Reworked the admin dashboard as a responsive control center with platform metrics, recent registrations and shortcuts. Added the Users directory entry while retaining the legacy `Businesses` view alias. The existing protected admin APIs power worker/user access toggles, KYC review, scheduled/on-demand job monitoring, payments and payout records, disputes, reports, settings and audit logs.
- Added automatic refresh, search, status filtering, payment visibility and active GPS point lookup to the admin on-demand jobs screen. GPS remains private to an authorized active assignment/admin.
- Expanded Worker/User translation coverage for dashboard, notifications, marketplace labels, shift table/search/apply controls, payment summary/table labels, attendance headings and profile fields. Remaining English-only dialogs, descriptions and some server/dynamic status messages mean complete localization is not yet verified.
- Investigated the Vite write failure: there was no running project Vite process, the denied bundle file did not exist, and Vite failed at file creation under the existing `dist/assets` path (not only at directory cleanup). Existing files were preserved. `vite.config.js` now builds to `.hstaff-build`; server static serving uses the same default and supports `WEB_DIST_DIR` overrides. `.hstaff-build` is ignored.
- Verification: at that milestone, `npm test` passed 10/10 API tests plus 2/2 translation tests and `npm run build` passed to `.hstaff-build`. The auth follow-up below has the latest run results.

## Authentication follow-up (2026-10-14)

- Removed the standalone Mobile OTP tab. Worker/User registration enters phone capture directly, and the code entry appears after the server successfully issues a code. Returning-user phone sign-in is a secondary action within Sign In.
- Added a separate Admin enrollment form and `POST /auth/admin/register`. Enrollment is disabled unless an operator sets `ADMIN_REGISTRATION_SECRET` in `server/.env`; the secret is never sent in frontend configuration. The endpoint validates it with a timing-safe comparison, remains rate limited, stores bcrypt password hashes and audits enrollment. Normal public registration continues to reject Admin roles.
- Clarified the OTP setup failure: when neither Twilio nor development-only OTP is enabled, the API returns an actionable setup message and explicitly states that no SMS or code was issued. Configure Twilio credentials in `server/.env`, or for local testing only set `NODE_ENV=development` with `DEV_OTP_ENABLED=true` and restart.
- Verification: `npm test` passed 11/11 API tests and 2/2 translation tests. The new Admin enrollment test rejects a wrong key, creates/logs in an Admin with the configured key, verifies access to an admin route, rejects duplicates, and confirms normal `/auth/register` still rejects Admin. `npm run build` passed (Vite 8.3.4, 29 modules); the built app, JS bundle and `/api/health` each returned HTTP 200 through Express. No live Twilio credentials are configured, so SMS delivery is not claimed or verified.

## Local development OTP update (2026-10-14)

- Development and test mode (`NODE_ENV=development|test` and `DEV_OTP_ENABLED=true`) now generates a cryptographically random six-digit OTP locally without invoking Twilio. The development UI clearly displays the code and states that no SMS was sent; the code is not auto-entered or automatically verified.
- OTP records keep only an HMAC hash, expiration, and attempt count. Local OTP requests leave the SMS cooldown timestamp empty, so a cooldown is not claimed when no SMS was sent. Route rate limiting, expiry, and the five-attempt verification cap remain active. A fresh local code replaces the previous code.
- Production always ignores the development flag. With valid Twilio config, OTP is stored only after provider acceptance, the SMS cooldown starts only after successful delivery, and the response contains no OTP. Provider failure does not persist a code or start cooldown. Without either local development mode or valid Twilio config, API returns an explicit configuration error and issues no code.
- Updated `server/.env.example` comments and README safe setup: an existing `server/.env` is not overwritten. README includes Worker/User/mobile-login and Twilio enablement instructions. Admin creation has since moved to the private CLI plus an explicitly development-only localhost form for demos; ordinary Worker/User registration remains restricted to those roles.
- Latest verification: `npm test` passed 15/15 backend tests and 2/2 localization tests. `npm run build` passed with Vite 8.3.4 (29 modules), outputting to the safe `.hstaff-build` directory. SMS provider behavior was mocked; no real Twilio credentials or messages were used. No live Twilio delivery was verified.

## Google sign-in and private Admin provisioning update (2026-10-14)

- Removed the Admin enrollment-key UI and public `POST /auth/admin/register` endpoint. `npm run create-admin --prefix server` now prompts for name/email and a hidden 12+ character password, bcrypt-hashes it, rejects existing emails, and never modifies or resets an existing account. Fresh demo seed data no longer creates an Admin with a known default password; existing SQLite records are preserved.
- Added an additive nullable `users.google_sub` column and a partial unique index. User Google sign-in creates/retrieves only the existing internal `business` role; Worker registration/accounts cannot use Google. Admin Google login requires an authoritative verified Gmail/Workspace email matching an existing Admin. The first valid sign-in binds the stable subject; the client cannot set email, user ID or role.
- Added Google Identity Services UI and server verification for RS256 signing key, issuer, expiry, verified email, and configured audience. The root `VITE_GOOGLE_CLIENT_ID` and backend `GOOGLE_CLIENT_ID` must match. Missing values disable the button and return a clear API setup response. Google credentials were not configured in this workspace; live OAuth was not tested. No dependency was added; the existing JWT library and Node crypto validate Google's cached public JWKs.
- Updated README, environment examples, API docs and tests. Latest verification: `npm test` passed 19/19 backend tests plus 2/2 localization tests; `npm run build` passed with Vite 8.3.4 (29 modules) into `.hstaff-build`. Google signing keys were mocked in tests; no live Google OAuth or Twilio request was performed. Historical Admin enrollment notes above describe the earlier implementation and are superseded by this update.

## Local demo and auth usability follow-up (2026-10-15)

- Created `server/.env` from the checked-in example only because this checkout had no local server config. It enables random development OTP only under `NODE_ENV=development`; no Twilio credentials were added and production behavior is unchanged. Restart a previously running API process to load it.
- Auth now labels first-time email users with “Sign in to your account” rather than “Welcome back.” Google UI no longer displays environment-variable names; without OAuth credentials it reports a short unavailable status and does not fake authentication. Live Google sign-in remains blocked until a real matching OAuth client ID is configured on frontend and server.
- Admin demo sign-up is now available from the Admin sign-in screen when the frontend is in Vite development mode. Backend signup additionally requires `NODE_ENV=development`, `DEV_ADMIN_REGISTRATION_ENABLED=true`, and a loopback request; production always rejects it. Creation hashes the password, blocks duplicates, writes an audit record, and requires a separate sign-in. Worker/User registration still cannot create Admin accounts.
- The Worker/User phone field now visibly provides the India `+91` prefix and accepts a 10-digit Indian mobile number; OTP requests and verification send the normalized `+91` number.
- Verification on 2026-10-15: `npm test` passed 21/21 backend tests plus 2/2 localization tests. `npm run build` passed (Vite 8.3.4, 29 modules) to `.hstaff-build`. Dedicated API tests cover Admin demo signup/login, duplicate protection, password hashing, and production-disabled behavior. Existing SQLite records were not reset.

## Google sign-up coverage update (2026-10-15)

- Added a Worker/User role selector for email/password login as well as registration. Both Worker and User views now show optional Google sign-in/sign-up, including while the Worker/User registration UI is in its phone OTP step.
- Google ID tokens continue to be cryptographically verified server-side. A new Worker account is created in the existing SQLite `users` + `workers` schema with a random unusable password and proceeds through the existing profile and KYC onboarding; returning Workers can link/sign in by verified email and stable Google subject. User accounts preserve the existing `business` schema. Mismatched selected roles are rejected.
- Admin Google remains sign-in-only for an already provisioned Admin. Google never creates or elevates an Admin; the existing controlled Admin registration method remains separate. No backend job, payment, OTP, KYC or other marketplace workflows were changed.
- Verification on 2026-10-15: `npm test` passed 22/22 backend tests and 2/2 localization tests; added coverage for Worker Google account creation, repeat sign-in, role mismatch and Admin denial. `npm run build` passed (Vite 8.3.4, 29 modules). Real Google OAuth still requires the matching frontend/server OAuth client IDs and was not tested without credentials.
