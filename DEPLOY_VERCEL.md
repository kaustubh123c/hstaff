# Deploying H-Staff on Vercel

The frontend (Vite/React) is static and runs perfectly on Vercel. The API (Express + SQLite) also runs on
Vercel as one serverless function (`api/index.js`), **but Vercel's disk is temporary**: the SQLite database and
uploaded KYC files are rebuilt on every cold start and lost on every deploy. So choose one:

| | Where the API runs | Data survives? | Use it for |
|---|---|---|---|
| **A. Demo** | Vercel function (this repo as-is) | No | Showing the product, testing, client demos |
| **B. Real use (recommended)** | Render / Railway / Fly with a persistent disk (`render.yaml` included) | Yes | Real workers, businesses, payments |

## A. One-click demo on Vercel

1. Push this folder to a GitHub repo (the `.gitignore` already keeps secrets and local data out).
2. Vercel → **Add New → Project** → import the repo. Framework is detected as Vite; no build settings to change.
3. Before the first deploy open **Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `JWT_SECRET` | long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `QR_SECRET` | another long random string |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | your admin login (password 12+ characters). Created on each cold start |
| `DEMO_SEED` | `true` to load sample workers/users/shifts (omit for an empty system) |
| `DEMO_MODE` | `true` to show the demo sign-in shortcuts (omit in anything public) |
| `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` | your Google OAuth web client ID (optional). Add your Vercel domain under *Authorized JavaScript origins* |
| `CRON_SECRET` | any random string; lets the daily auto-approve job run |

4. Deploy. Open `https://<project>.vercel.app/api/health` — it should return `{"ok":true,…}`.
   A `503` with "Server is not configured" means a secret above is missing; add it and redeploy.

Limits to know about in demo mode:
- Data resets (cold start / new deploy). Accounts created by people are lost; the admin and seed data come back.
- Accepting an on-demand job and phone-OTP sign-in need SMS. Without Twilio, production mode refuses them on
  purpose. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`).
- Vercel limits request bodies to 4.5 MB, so KYC uploads above that fail (the app's own limit is 5 MB).
- Razorpay: add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and point the webhook to
  `https://<domain>/api/payments/razorpay-webhook`.

## B. Real use: Vercel frontend + persistent API

1. Deploy the API: Render → **New + → Blueprint** → select the repo (`render.yaml`). It mounts a 2 GB disk at
   `/var/data` for the database and uploads, and generates the two secrets. Set `CORS_ORIGIN` to your Vercel URL.
   Create the first admin once from the Render shell: `npm run create-admin --prefix server`.
2. In Vercel add `VITE_API_URL = https://<your-render-service>.onrender.com/api` (and the Google client ID).
   Because the frontend then talks to Render directly, remove the `/api` rewrite from `vercel.json` (or leave it;
   `VITE_API_URL` takes priority).
3. Redeploy the Vercel project so the variable is baked into the build.

The Render service can also serve the whole site by itself (it hosts the built frontend), so Vercel is optional.

## Running locally

```
npm run setup      # installs web + server dependencies
npm run seed       # optional sample data
npm run dev:all    # API on :4000, web on :5173
```
