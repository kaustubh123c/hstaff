import test from "node:test";
import assert from "node:assert";
import { calculateStatutorySplit, verifyRazorpaySignature } from "../src/services/settlement.js";
import { calculateHaversineDistance, detectVelocitySpoofing } from "../src/services/geofence.js";
import { validateIndianPAN } from "../src/services/panKyc.js";
import crypto from "node:crypto";

test("Member 4 Engine Check: Section 194-O Tax Ledger Math", () => {
  const split = calculateStatutorySplit(3, 300);
  assert.strictEqual(split.gross_amount, 900);
  assert.strictEqual(split.platform_fee, 90);
  assert.strictEqual(split.gst_on_commission, 16);
  assert.strictEqual(split.tds_section_194o, 9);
  assert.strictEqual(split.net_worker_payout, 785);
});

test("Member 4 Engine Check: Razorpay Cryptographic HMAC Verification", () => {
  const secret = "enterprise_test_secret_2026";
  const orderId = "order_HST123";
  const paymentId = "pay_HST456";
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(orderId + "^|" + paymentId);
  const validSig = hmac.digest("hex");
  assert.strictEqual(verifyRazorpaySignature(orderId, paymentId, validSig, secret), true);
});

test("Member 4 Engine Check: Geofencing & Velocity Anti-Spoofing", () => {
  const dist = calculateHaversineDistance(19.8762, 75.3433, 19.8765, 75.3435);
  assert.ok(dist < 100);
  const spoofFraud = detectVelocitySpoofing(500000, 300);
  assert.strictEqual(spoofFraud, true);
});

test("Member 4 Engine Check: Indian PAN Entity Validation Gate", () => {
  assert.strictEqual(validateIndianPAN("ABCPE1234F").valid, true);
  assert.strictEqual(validateIndianPAN("ABCCE1234F").valid, false);
});
