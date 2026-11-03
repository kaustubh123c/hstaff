# Architecture

```text
React/Vite SPA (src) --Bearer JWT + JSON--> Express API (server/src)
                                               |-- auth/role middleware
                                               |-- route modules + services
                                               |-- node:sqlite (server/data/hstaff.db)
                                               |-- private local KYC uploads
                                               |-- Razorpay REST API + signed webhook (optional)
```

`src/App.jsx` restores the token, loads the user, selects a role menu, and renders screens. `src/api.js` sends authenticated requests. `src/i18n.js` contains the current translation map. `src/pages/` holds feature pages.

`server/src/index.js` configures Helmet, CORS, JSON size limits, API throttling, routes, errors, static frontend serving, and timesheet auto-approval. `auth.js` verifies JWT and current account status. Route modules own validation/authorization and call SQLite through `db.js`. `services.js` contains payment/timesheet helpers. `config.js` loads server environment and data paths.

The database initializes tables and applies additive column migrations at module load. Transactions use `BEGIN IMMEDIATE`. Existing data and uploads must be backed up before manual schema work. On-demand matching reads eligible workers/jobs and calculates Haversine distances in application memory; it is suitable only for current small SQLite scale.

Phone authentication records HMAC-protected OTPs with expiry and five-attempt limits. Job arrival codes are HMAC hashed and AES-GCM encrypted for the authorized business delivery path; they are consumed atomically. Twilio delivery is optional and configured server-side. Completion requires a worker submission and business confirmation; duration and fee are calculated on the backend. Razorpay order creation and capture verification are backend-only for timesheet and on-demand job payments. Checkout signatures are verified server-side, capture is checked with Razorpay, and webhooks are HMAC checked and deduplicated. Tracking uses authenticated, active-job GPS updates and polling rather than a real-time socket service. No provider credentials were available for live verification.
