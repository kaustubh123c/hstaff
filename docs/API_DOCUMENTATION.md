# API documentation (current routes)

Base path: `/api`. Protected routes use `Authorization: Bearer <JWT>`. JSON errors use `{ "error": "..." }`; Zod validation errors include `details`.

| Route group | Auth | Purpose |
|---|---|---|
| `GET /health`, `GET /meta` | Public | Health and feature metadata |
| `POST /auth/register`, `POST /auth/login` | Public + rate limited | Email/password Worker/User auth; User is persisted as the existing internal `business` role; admin role is rejected |
| `POST /auth/google` | Public + rate limited | Verifies a Google ID token against configured Google signing keys and audience. `intent:user` may create/retrieve only a normal User (`business`) account; `intent:admin` authenticates only an already provisioned Admin. No role/email claims from the client are trusted. |
| `POST /auth/otp/request`, `POST /auth/otp/verify` | Public + rate limited | Phone OTP sign-in or Worker/User registration; one-minute resend limit, configured expiry, five attempts; Twilio in configured environments, development OTP only in `development`/`test`. A 503 indicates missing provider configuration and issues no code. |
| `GET/PUT /auth/me`, `POST /auth/change-password` | User | Profile/password; profile updates include email and support post-OTP onboarding |

Admin accounts are provisioned with `npm run create-admin --prefix server` for hosted environments. For local demos only, `POST /api/auth/admin/register` is enabled when the backend has `NODE_ENV=development` and `DEV_ADMIN_REGISTRATION_ENABLED=true`, and the request originates from localhost. It is disabled in production; Worker/User public registration cannot assign the Admin role.
| `/shifts`, `/applications` | Role-based | Scheduled shift CRUD, browse/apply/decision |
| `/attendance/*` | Role-based | QR/GPS check-in and checkout |
| `/timesheets` | User | List, business approval, dispute |
| `/payments` | User/admin | Payment history, Razorpay order/checkout verification, admin payout status |
| `/kyc` | Worker/admin | Private PDF/JPG/PNG worker upload (5 MB max), manual admin review, owner/admin file access |
| `/disputes` | User/admin | Raise and administer disputes |
| `/admin/*` | Admin | User status, settings, reports, audit |
| `POST /jobs` | Business | Create on-demand request; required title/location/lat/lng/date/times/rate |
| `POST /workers/location` | Worker | Store coordinates and optional availability |
| `GET /jobs/nearby?lat=&lng=&radius=` | Worker | Radius-filtered open on-demand work |
| `GET /workers/nearby?lat=&lng=&radius=` | Business/admin | Available workers by distance |
| `POST /jobs/:id/request` | Worker | Accept job if active, available, verified and open; transaction prevents ordinary duplicate wins |
| `GET /jobs/mine` | User | List own on-demand jobs and payment/worker/completion state |
| `GET /jobs/:id/otp/start`, `POST /jobs/:id/otp/start/resend` | Owning business | Deliver or renew expiring arrival code (development returns it to the business only) |
| `POST /jobs/:id/verify-start` | Assigned worker | Submit six-digit, ten-minute, five-attempt, one-use code |
| `POST /jobs/:id/location`, `GET /jobs/:id/location` | Assigned worker / owning business / admin | GPS updates and active job location read; tracking stops after completion |
| `POST /jobs/:id/complete`, `POST /jobs/:id/confirm-completion` | Assigned worker / owning business | Submit and confirm completion; server calculates duration and creates job payment |
| `POST /jobs/:id/ratings` | Owning business | Submit one 1–5 rating and feedback after confirmed completion |
| `POST /payments/jobs/:id/create-order`, `.../verify-checkout` | Owning business | Razorpay collect on completed on-demand job; gateway configuration required |
| `POST /payments/:id/mark-paid` | Admin | Record verified offline payment reference for an approved timesheet |

Example request: `POST /jobs` with `{ "title":"Moving help", "location":"Pune", "lat":18.52, "lng":73.86, "date":"2026-10-20", "start_time":"09:00", "end_time":"11:00", "rate":250 }`. Success returns `{ "ok":true, "job_id": 123 }`.

Razorpay order example: `POST /payments/:id/create-order`; checkout verification posts Razorpay's `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to `/payments/:id/verify-checkout`. A configured webhook requires a valid `x-razorpay-signature` and unique event id. Exact schemas are in `server/src/routes/` and should be updated with each API change.

Limitations: tracking uses polling rather than WebSockets; no OTP vendor or Razorpay credentials were supplied, so real provider transactions were not run. The legacy `server/src/routes/ondemand.js` is no longer mounted; active on-demand behavior is in `server/src/routes/marketplace.js`.
