# H-Staff Razorpay integration setup

## Important status
This code includes server-side Razorpay order creation, Checkout signature verification, webhook signature verification, deduplicated webhook event storage, separate client-collection and worker-payout statuses, and an admin payout queue. It does **not** send a worker bank transfer automatically. Live payouts require Razorpay approval for an applicable marketplace/Route or RazorpayX payout product, worker beneficiary onboarding, and credentials. Do not advertise automatic payouts until that provider integration is separately enabled and tested.

## Local setup
1. Create/activate your Razorpay account and use Test Mode keys first.
2. Copy `server/.env.example` to `server/.env`.
3. Add server-only values:
   - `RAZORPAY_KEY_ID=rzp_test_...`
   - `RAZORPAY_KEY_SECRET=...`
   - `RAZORPAY_WEBHOOK_SECRET=...` (choose the same secret in Razorpay's webhook configuration)
   - `PLATFORM_FEE_PERCENT=10` (set your actual disclosed fee; default shown is 10%)
4. Configure a Razorpay webhook URL: `https://YOUR_API_HOST/api/payments/razorpay-webhook`. Subscribe to `payment.captured` and `payment.failed`.
5. Install dependencies and run the app as usual. No Razorpay secret belongs in a `VITE_` variable or frontend code.

## Flow
- A business can start Checkout for an approved timesheet.
- Server creates the Razorpay order for the gross amount and stores the order ID.
- Checkout callback signature is verified server-side and payment status/amount/order/currency are fetched from Razorpay before collection is marked paid.
- Webhooks are signature-verified against the raw body. Event IDs are unique to make retries idempotent.
- Client collection and worker payout statuses are distinct. Admin can queue a payout for operations and record a real external transfer only with a required UTR/reference. Queueing is not a transfer.

## Before production
- Obtain approval for the marketplace/settlement product and verify applicable KYC, tax, fee disclosure, refunds, disputes, and reconciliation requirements.
- Use HTTPS and a persistent production database/storage. SQLite on ephemeral hosting is not production-safe.
- Set `CORS_ORIGIN` to the exact deployed frontend URL, keep secrets in the host's secret manager, and configure webhook retries/monitoring.
- Implement and test the provider's actual linked-account/payout API after the account is approved; don't mark payouts paid until the provider confirms success.
