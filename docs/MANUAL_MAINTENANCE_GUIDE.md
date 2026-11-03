# Manual maintenance guide

- Add a screen in `src/pages/`, then add the role-checked menu/page mapping in `src/App.jsx`; use `src/api.js` for network calls and `src/i18n.js` for worker/user strings.
- Add an API feature in a focused module under `server/src/routes/`; validate input with Zod, authenticate, enforce role and record ownership, audit important changes, and mount it from `server/src/index.js`.
- Add SQLite tables/columns in `server/src/db.js` with additive upgrade logic. Qualify insert columns; never assume a table's positional shape.
- Add a work category as configuration/data once a category model is introduced; current on-demand title is free text.
- Change pricing only in backend calculations/services; do not trust client-submitted totals.
- Change auth in `server/src/auth.js` and `server/src/routes/auth.js`; preserve bcrypt, token checks, rate limits, and backend role enforcement.
- Payment changes belong in `server/src/routes/payments.js` and `server/src/services.js`; keep secrets server-only and verify capture/webhook signatures.
- Add notification delivery behind a provider adapter; current notifications are database-backed in-app messages.
- Admin permissions are enforced in route middleware, not only by hiding UI controls.
- Run `npm test` and a Vite build against a fresh output directory. Back up the SQLite database and uploads before deployment or destructive seed operations.
