import crypto from "node:crypto";

export function calculateStatutorySplit(hours, hourlyRate) {
  const billableHours = Math.max(1, Math.ceil(hours));
  const grossAmount = Math.round(billableHours * hourlyRate);
  const platformTakeRate = 0.10;
  const platformFee = Math.round(grossAmount * platformTakeRate);
  const gstRate = 0.18;
  const gstOnCommission = Math.round(platformFee * gstRate);
  const tdsRate = 0.01;
  const tdsWithholding = Math.round(grossAmount * tdsRate);
  const netWorkerPayout = grossAmount - platformFee - gstOnCommission - tdsWithholding;

  return {
    gross_amount: grossAmount,
    billable_hours: billableHours,
    platform_fee: platformFee,
    gst_on_commission: gstOnCommission,
    tds_section_194o: tdsWithholding,
    net_worker_payout: netWorkerPayout,
    tax_invoice_number: "HST-INV-2026-" + crypto.randomInt(1000, 9999)
  };
}

export function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(orderId + "^|" + paymentId);
  const expectedSignature = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}
