# H-Staff

H-Staff is a two-portal platform: **User Portal** and **Admin Portal**. Workers do not have a web portal. Worker accounts remain internal operational records for verification, proximity matching, task assignment, GPS tracking and payment records. When a User creates an on-demand task, the backend creates nearby-task notification events for available, verified workers within the requested radius. SQLite remains the database for this phase.

## Current features

- **Admin:** responsive operations dashboard, user and worker access management, KYC review, scheduled/on-demand job monitoring, payment/payout records, disputes, reports, settings and audit logs.
- **Worker operations (no portal):** internal worker profiles, KYC status, availability/location records, assignment, arrival verification, active-job GPS and completion status. Nearby task alerts are queued as notification events.
- **User:** scheduled shifts, on-demand requests, arrival code delivery, worker tracking, completion confirmation, ratings and payment checkout.
- **Payments:** legacy timesheet and on-demand Razorpay order/verification/webhook paths when credentials are configured.
- **Languages:** English, Hindi and Marathi are available on authentication, navigation, on-demand marketplace, dashboards, and key legacy shift, attendance, payment and profile labels. Translation coverage on older workflow dialogs and some status/error copy is still incomplete.

Important limitations: production SMS and Razorpay behavior need configured credentials and were not live tested. Tracking uses authenticated GPS updates and polling, not WebSockets. Some legacy screens still include English-only copy. KYC is manual admin review, not identity-provider verification. Payout records are tracked but external payout execution is not integrated. Details are in `docs/IMPLEMENTATION_PROGRESS.md`.

## Stack and layout

- Node.js 22.12+, npm, React 19, Vite 8, Express 4, built-in `node:sqlite`, JWT, bcryptjs, Zod, Razorpay REST API.
- `src/`: React SPA, role menus, pages, API client, translation map and styles.
- `server/src/routes/`: authentication, shifts, attendance, timesheets, payments, KYC, disputes, admin and on-demand APIs.
- `server/src/db.js`: SQLite schema and additive compatibility migrations.
- `server/data/`: default SQLite DB, WAL files and private uploads. Back this up. It is excluded from Git.
- `docs/`: audit, architecture, API, schema, tests, plan, progress and maintenance guidance.

```text
Browser (React/Vite) --JWT/JSON--> Express API --SQL--> SQLite
                                      |-- optional Razorpay REST + signed webhook
                                      |-- private local KYC upload directory
```

## Prerequisites and setup

Use Node.js 22.12 or newer and npm. SQLite ships through Node's `node:sqlite`; no separate database install is required.

```powershell
npm run setup
if (!(Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
npm run seed
npm run dev:all
```

Frontend: http://localhost:5173. API: http://localhost:4000/api. Demo logins:

| Role | Email | Password |
|---|---|---|
| User (legacy demo account) | abc@hstaff.example | Business@12345 |

`npm run seed` only seeds an empty DB. It does not reset existing records. New demo data does not create a default Admin account. Create the first Admin as shown below. Never pass `--reset` to the server seed command against valuable data.

The guarded copy command preserves an existing `server/.env`. If the file already exists, edit only the settings you intend to change; never replace it with the example file.

## Configuration

`server/.env.example` lists backend settings. The root `.env.example` is for the browser's public Google OAuth client ID. Set `JWT_SECRET` and `QR_SECRET` explicitly for production. `CORS_ORIGIN`, port, KYC gate, QR time window, timezone, radius, demo mode, OTP TTL and platform fee are configurable. `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, Twilio credentials, and other secrets are server-only. `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` must contain the same Google OAuth Web client ID; the client ID is public, while no Google client secret is used by this ID-token sign-in flow. Set `DEV_OTP_ENABLED=false` outside development/test.

The Twilio and Razorpay adapters are implemented, but this environment has no credentials so live SMS/charges were not tested. No maps API, push provider, or identity-verification provider is configured. Browser geolocation is used, with manual address/coordinates as fallback. Development OTP codes are disclosed only in development/test and are not a production delivery method. Uploaded documents are manually reviewed, not verified by an identity provider.

## User workflows

- Admin signs in and reviews KYC, users, disputes, reports and payment records.
- Workers have no web portal. Admin maintains worker records and verification/availability data. On-demand task creation queues a nearby-task notification event for available, verified workers whose last known location is within the task radius. The current repository does not include a production push/SMS delivery adapter or a worker-side accept/reject interface; those require a configured delivery channel (for example Firebase Cloud Messaging) and a worker notification client. Do not treat a queued database notification as a delivered push notification.
- User creates a scheduled shift or on-demand request, reviews assigned-worker state and active location, delivers the arrival code, confirms completion, rates the worker, and pays through Razorpay when configured. Settlement transfers still require an external payout integration.

Public registration offers User only. Worker accounts are provisioned and managed operationally by Admin; there is no Worker sign-in, registration, dashboard or portal. User accounts continue to use the existing internal `business` role and SQLite `businesses` table so existing records, jobs and payment history remain available. For a local presentation, choose **Admin sign in → Create Admin account**, enter a name, email and 12+ character password, then sign in with those credentials. This form is enabled only by `DEV_ADMIN_REGISTRATION_ENABLED=true` under `NODE_ENV=development`, and the API accepts local-machine requests only. The production build hides the link and the production API always rejects self-registration. For a deployed environment, provision Admins with `npm run create-admin --prefix server`. Passwords are bcrypt-hashed; duplicate emails are rejected; existing records are never overwritten. Worker/User registration cannot create Admin accounts.

Run the Admin creation command once per new environment, and skip it when an Admin account already exists. It rejects an existing email instead of replacing the account.

## Authentication and privacy

Passwords are bcrypt hashed; JWTs are verified on every protected request, and suspended users are blocked. Auth routes are rate limited. Phone OTP is supported via the authenticated SMS flow described above. KYC files are stored outside the public web root with random filenames and owner/admin access checks; production should use private object storage and a compliant verification provider. Precise worker location is exposed only during the assigned active job. Keep `.env`, database files, uploads and logs private.

## Optional Google sign-in

Google sign-in is optional and remains disabled until configured. With no client ID, the page shows a short “currently unavailable” status and no environment-variable instructions. To enable it, create an OAuth **Web application** client in Google Cloud Console and add `http://localhost:5173` (plus your deployed origin) to its authorized JavaScript origins. Copy the client ID into `GOOGLE_CLIENT_ID` in `server/.env` and `VITE_GOOGLE_CLIENT_ID` in the root `.env`; the values must match. For a new root environment file, copy the example only if no root `.env` exists: `if (!(Test-Path .env)) { Copy-Item .env.example .env }`. Restart both server and Vite after configuration. Do not put a client secret in the frontend or source control.

The browser uses Google's Identity Services sign-in button and sends its ID token to the backend. The backend validates the RS256 signature against Google's rotating public keys, issuer, expiry, verified-email claim, and exact configured audience before using the stable Google `sub`. Only authoritative Gmail or hosted Workspace email identities are accepted for account linking. The User sign-in/register screen offers Google as an optional method. Google can create or retrieve User (`business` in the existing database) accounts. Worker accounts are not publicly registered or signed in through the web UI. Google cannot create Admin accounts: on Admin sign-in, it works only when the verified email already maps to an existing Admin provisioned with the command above. The first successful Google login binds the account to its stable subject; a different subject cannot take over the link, and choosing the wrong role is rejected. When either client ID is missing, Google authentication is unavailable and the API rejects the request; no login is faked.

## Local development OTP (no SMS provider needed)

1. Install Node.js 22.12+ and dependencies once with `npm run setup`.
2. Create `server/.env` only if you do not already have one: `if (!(Test-Path server/.env)) { Copy-Item server/.env.example server/.env }`. Keep `NODE_ENV=development` and `DEV_OTP_ENABLED=true` for local testing. Do not use these settings in production.
3. Start both applications with `npm run dev:all` and open http://localhost:5173. The API runs at http://localhost:4000/api.
4. Worker accounts are created and managed by Admin. Workers do not register or sign in to the web portal.
5. To register a User, choose **Register → User** and repeat the phone/code steps. Complete the profile after verification. The public User role is stored using the compatible existing `business` role/table.
6. To sign in later by mobile, choose **Sign In → sign in with mobile**, request a code for the registered number, read the local-only code shown on the page, and enter it. Email/password sign-in remains available. Admin uses its separate sign-in mode; configured Google sign-in is available to Users and existing authorized Admin accounts, never to Worker registration.
7. Local codes expire after `OTP_TTL_SECONDS` (default five minutes), are HMAC-hashed in SQLite, and are limited to five incorrect attempts. The route remains rate limited. Since local mode sends no SMS, it does not start the SMS resend cooldown. Requesting a fresh local code replaces the prior code.

For a local demo Admin, use the **Create Admin account** link on the Admin sign-in screen. Create the account once, then return to Admin sign-in and enter the same email and password. The Admin form does not automatically sign you in after account creation.

Local OTP mode is enabled only when `NODE_ENV` is `development` or `test` and `DEV_OTP_ENABLED=true`. Production always ignores the development flag and never includes OTP values in responses or logs.

### Enable Twilio later

Set `DEV_OTP_ENABLED=false` in `server/.env`, then configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` with valid account values. Restart the backend. Requests then use Twilio; the API/UI report success only after the provider accepts the message, and provider failures do not store a code or start the resend cooldown. Production also requires valid provider configuration. Never put Twilio credentials in frontend variables or source control.

## Mobile onboarding

Choose **Register** to create a User account. Registration proceeds by mobile number → send code → OTP entry. Returning Users can sign in with mobile or email/password. Admin uses its separate sign-in mode. Worker accounts are maintained internally by Admin and do not have a web portal.

For production real-SMS delivery, Twilio must be configured using the settings above. If Twilio is missing while development OTP is disabled, the UI reports the configuration error and confirms that no message/code was issued. Provider failures return an error and are not reported as successful delivery. OTP values are never exposed in production. Before deployment set `NODE_ENV=production` and `DEV_OTP_ENABLED=false`; the backend rejects development OTP mode in production even if the flag is accidentally left true.

## Payments

Razorpay collection applies to approved, undisputed timesheet records and confirmed on-demand jobs. Backend creates orders, validates checkout signatures, confirms captured amount/currency with Razorpay, and verifies/deduplicates webhooks. Commission percentage is calculated server-side. Configure webhook events and credentials in the Razorpay dashboard and server environment. Payout tracking is an internal record/status workflow; no transfer API executes disbursements.

## Languages and maps

English, Hindi and Marathi are selected in the shared SPA; translations live in `src/i18n.js`. Authentication, navigation, marketplace, dashboards and key Worker/User shift, attendance, payment and profile labels use the selected language. Legacy workflow dialogs and some error/status messages remain English and require additional localization. Nearby matching uses SQLite-compatible coordinate columns and Haversine distance in Node, not a geospatial database index. A maps provider is not integrated.

## Testing and build

```powershell
npm test
npm run build
```

The API tests use disposable SQLite data. In this Windows workspace, writes into the existing `dist/assets` directory were denied (EPERM/access denied) even though the hashed bundle filename did not exist and no Vite process was running. To avoid deleting or replacing existing deployment files, `npm run build` now writes to `.hstaff-build`; the server uses that directory by default and accepts `WEB_DIST_DIR` to override it. `.hstaff-build` is ignored by Git.

## Documentation and maintenance

See `docs/INITIAL_CODEBASE_AUDIT.md`, `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_PROGRESS.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `API_DOCUMENTATION.md`, `DATABASE_SCHEMA.md`, `TESTING_GUIDE.md`, and `MANUAL_MAINTENANCE_GUIDE.md`.

SQLite is the current supported database. A future MongoDB move requires translating relational foreign keys/transactions, unique assignment constraints, payment idempotency, migrations, and test fixtures; it has not been started.

Before production, configure HTTPS, secrets, Twilio OTP delivery, Razorpay payment/webhook credentials, private document storage, identity verification, backups, device-level workflow tests, and privacy/compliance review.

## Marketplace workflow update

The current implementation includes mobile OTP sign-in/registration, Twilio SMS delivery, expiring job-start OTPs with a five-attempt cap and one-time consumption, worker completion submission, User confirmation, server-calculated hourly job totals, feedback/rating storage, and authenticated GPS update/read routes for active assignments. Confirmed on-demand jobs can use Razorpay order and signature verification endpoints under `/api/payments/jobs/:id/*`. Admins can record an actual offline timesheet payment using a transfer reference.

Configure Twilio in `server/.env` using `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either a `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`. Configure Razorpay with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`, then register `/api/payments/razorpay-webhook` in the Razorpay dashboard. No provider credentials are included, so real SMS sends and gateway charges have not been verified in this environment. Development OTP values are returned only when `NODE_ENV=development` or `test` and the development OTP flag is enabled; production never returns them.

Tracking uses authenticated GPS posts and client polling; it does not use a WebSocket provider. Several older Worker/User dialogs and error/status messages still need translation before claiming whole-app localization.



## Two-portal / worker notification model

- The web UI exposes only User and Admin portals. Existing Worker records remain in SQLite so historical assignments, KYC, payments and reports are preserved.
- User-created on-demand tasks generate `nearby_task` notification events for available, verified workers inside the task radius. Event payloads include job ID, service, location, distance, date/time and hourly rate.
- The notification event is currently stored in the `notifications` table. This is a dispatch queue/event record, **not a delivered mobile push notification**.
- To achieve the Uber-style experience in production, configure Firebase Cloud Messaging (or another push provider), register worker device tokens, send the queued event to those tokens, and provide secure accept/reject/deep-link actions. SMS fallback can be added using configured Twilio credentials.
