# Database schema

SQLite database path defaults to `server/data/hstaff.db`; WAL and foreign keys are enabled. Initialization and additive upgrades are in `server/src/db.js`.

| Table | Purpose / key relationships |
|---|---|
| users | Credentials, role (`worker`, `business`, `admin`), active/suspended status |
| workers | Worker skills, location, rating, KYC state, coordinates, availability; FK to users |
| businesses | Company/address; FK to users |
| shifts | Scheduled and on-demand work requests, location, date/time, rate, status; FK to business user |
| applications | Worker application/assignment per shift; unique `(shift_id, worker_id)` |
| attendance | QR/GPS clock events; unique `(shift_id, worker_id)` |
| timesheets | Calculated hours/amount and review state; shift, worker, attendance references |
| payments | Timesheet collection and Razorpay order/payment/payout metadata |
| payment_events | Provider event idempotency and webhook records |
| payout_attempts | Payout attempt/reference/status history |
| job_verifications | HMAC code hash, AES-GCM ciphertext for business delivery, provider-delivery state, expiration, attempt count and consumption timestamp per job/purpose |
| job_payments | Confirmed on-demand job amount/fee, Razorpay order/payment IDs, status and paid timestamp |
| job_ratings | One 1–5 rating and feedback per completed job; worker rating is updated from average |
| auth_otps | Phone-keyed HMAC OTP hash, expiry, attempts, request time; records are consumed by deletion |
| job_locations | Latest active job GPS point; readable only by assigned worker/business/admin while ongoing |
| kyc_documents | Private upload metadata and review status; worker/admin references |
| disputes | Timesheet or free-form complaint and resolution |
| notifications | Per-user in-app messages |
| audit_logs | Actor, action, entity, detail, IP, timestamp |
| settings | Admin key/value configuration |

Current migrations add worker GPS/availability, on-demand shift metadata and OTP hashes, worker tracking coordinates, and payment collection/payout columns. They are additive and guarded by column inspection/duplicate-column handling. There is no formal numbered migration ledger yet. Keep SQL inserts column-qualified. `npm run seed` loads demo records; `npm run seed --prefix server -- --reset` is destructive and must only target a disposable database.

Migrations also add `shifts.completion_requested_at` for worker-submitted/user-confirmed completion. OTP delivery relies on optional Twilio and a development-only code response. The schema currently uses `shifts` as the job record for both scheduled and on-demand work.
