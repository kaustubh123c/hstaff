import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { config } from '../config.js';
import { wrap, notFound, conflict, parseId, audit, notify, pad, forbidden, bad } from '../util.js';

export const router = Router();
const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex');
const safeEqualHex = (a, b) => {
  if (!/^[a-f0-9]+$/i.test(String(a || '')) || !/^[a-f0-9]+$/i.test(String(b || ''))) return false;
  const aa = Buffer.from(a, 'hex'), bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
async function razorpayRequest(path, body) {
  const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.description || `Razorpay request failed (${response.status})`);
  return data;
}
function requireGateway() {
  if (!config.razorpayEnabled) throw conflict('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET after creating and activating your Razorpay account.');
}

router.get('/', authenticate, wrap((req, res) => {
  const { role, id } = req.user;
  const where = role === 'business' ? 'WHERE p.business_id=?' : role === 'worker' ? 'WHERE p.worker_id=?' : 'WHERE ?=?';
  const rows = db.prepare(`SELECT p.*, s.title shift_title, s.date, s.id shift_id, uw.name worker_name, b.company
    FROM payments p JOIN timesheets t ON t.id=p.timesheet_id JOIN shifts s ON s.id=t.shift_id
    JOIN users uw ON uw.id=p.worker_id JOIN businesses b ON b.user_id=p.business_id
    ${where} ORDER BY p.id DESC`).all(...(role === 'admin' ? [1, 1] : [id]));
  const displayAmount = r => role === 'worker' ? r.amount - r.fee : r.amount;
  const sum = st => rows.filter(r => (role === 'worker' ? r.payout_status === st : r.collection_status === st)).reduce((a, r) => a + displayAmount(r), 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  res.json({
    gateway: { provider: 'razorpay', configured: config.razorpayEnabled, mode: config.razorpayEnabled ? 'configured' : 'setup_required', fee_percent: config.platformFeePercent },
    payments: rows.map(r => ({ ...r, code: `PAY-${String(r.id).padStart(4, '0')}`, timesheet_code: pad('TS', r.timesheet_id), shift_code: pad('SFT', r.shift_id), net_amount: r.amount - r.fee })),
    summary: { pending_amount: rows.filter(r => role === 'worker' ? !['paid'].includes(r.payout_status) : r.collection_status !== 'paid').reduce((a,r)=>a+displayAmount(r),0), paid_amount: sum('paid'), count: rows.length,
      paid_this_month: rows.filter(r => (role === 'worker' ? r.payout_status === 'paid' : r.collection_status === 'paid') && (role === 'worker' ? r.payout_updated_at : r.collection_paid_at) && new Date((role === 'worker' ? r.payout_updated_at : r.collection_paid_at) + 'Z') >= monthStart).reduce((a,r)=>a+displayAmount(r),0) }
  });
}));

router.post('/jobs/:id/create-order', authenticate, requireRole('business'), wrap(async(req,res)=>{
  requireGateway(); const id=parseId(req.params.id),p=db.prepare('SELECT * FROM job_payments WHERE shift_id=?').get(id);
  if(!p) throw notFound('Confirmed on-demand job payment not found.'); if(p.business_id!==req.user.id) throw forbidden(); if(p.status==='paid') throw conflict('This job is already paid.');
  if(p.razorpay_order_id) return res.json({key_id:config.razorpayKeyId,order_id:p.razorpay_order_id,amount:p.amount*100,currency:'INR',payment_id:p.id,business_name:'H-Staff'});
  const order=await razorpayRequest('/orders',{amount:p.amount*100,currency:'INR',receipt:`hstaff_job_${id}`,notes:{hstaff_job_id:String(id),business_id:String(p.business_id),worker_id:String(p.worker_id)}});
  db.prepare('UPDATE job_payments SET razorpay_order_id=? WHERE id=? AND status!=\'paid\'').run(order.id,p.id);
  audit(req,'job_payment.order_created','shift',id,order.id); res.json({key_id:config.razorpayKeyId,order_id:order.id,amount:order.amount,currency:order.currency,payment_id:p.id,business_name:'H-Staff'});
}));
router.post('/jobs/:id/verify-checkout', authenticate, requireRole('business'), wrap(async(req,res)=>{
  requireGateway(); const id=parseId(req.params.id),{razorpay_order_id,razorpay_payment_id,razorpay_signature}=z.object({razorpay_order_id:z.string().min(1),razorpay_payment_id:z.string().min(1),razorpay_signature:z.string().min(1)}).parse(req.body);
  const p=db.prepare('SELECT * FROM job_payments WHERE shift_id=?').get(id); if(!p)throw notFound('Job payment not found.');if(p.business_id!==req.user.id)throw forbidden();if(p.status==='paid')return res.json({ok:true,status:'paid'});if(p.razorpay_order_id!==razorpay_order_id)throw bad('Order does not match this job.');
  if(!safeEqualHex(razorpay_signature,hmac(config.razorpayKeySecret,`${razorpay_order_id}|${razorpay_payment_id}`)))throw bad('Razorpay checkout signature is invalid.');
  const g=await razorpayRequest(`/payments/${encodeURIComponent(razorpay_payment_id)}`);if(g.order_id!==razorpay_order_id||g.amount!==p.amount*100||g.currency!=='INR'||g.status!=='captured')throw conflict('Gateway has not confirmed the expected captured amount.');
  tx(()=>{db.prepare("UPDATE job_payments SET status='paid',razorpay_payment_id=?,paid_at=datetime('now') WHERE id=? AND status!='paid'").run(razorpay_payment_id,p.id);const eid=`job-checkout:${razorpay_payment_id}`;if(!db.prepare('SELECT 1 FROM payment_events WHERE event_id=?').get(eid))db.prepare('INSERT INTO payment_events(provider,event_id,event_type,payload_json) VALUES(?,?,?,?)').run('razorpay',eid,'job.checkout.verified',JSON.stringify({job_id:id,razorpay_payment_id}));notify(p.worker_id,`Payment for completed job ${id} was received. Net earnings: ₹${p.amount-p.fee}.`);})();audit(req,'job_payment.collected','shift',id,razorpay_payment_id);res.json({ok:true,status:'paid'});
}));

// Client/business creates a Razorpay order for an approved, undisputed timesheet.
router.post('/:id/create-order', authenticate, requireRole('business'), wrap(async (req, res) => {
  requireGateway();
  const id = parseId(req.params.id);
  const p = db.prepare(`SELECT p.*, t.status timesheet_status FROM payments p JOIN timesheets t ON t.id=p.timesheet_id WHERE p.id=?`).get(id);
  if (!p) throw notFound('Payment not found');
  if (p.business_id !== req.user.id) throw forbidden('This payment does not belong to your business.');
  if (p.timesheet_status !== 'Approved' && p.timesheet_status !== 'Paid') throw conflict('Timesheet must be approved before payment.');
  if (p.collection_status === 'paid') throw conflict('Client payment has already been collected.');
  if (p.razorpay_order_id && p.collection_status === 'created') {
    return res.json({ key_id: config.razorpayKeyId, order_id: p.razorpay_order_id, amount: p.amount * 100, currency: 'INR', payment_id: p.id, business_name: 'H-Staff' });
  }
  const order = await razorpayRequest('/orders', { amount: p.amount * 100, currency: 'INR', receipt: `hstaff_pay_${p.id}`, notes: { hstaff_payment_id: String(p.id), timesheet_id: String(p.timesheet_id), business_id: String(p.business_id), worker_id: String(p.worker_id) } });
  db.prepare("UPDATE payments SET razorpay_order_id=?, collection_status='created', checkout_key=? WHERE id=? AND collection_status!='paid'").run(order.id, crypto.randomUUID(), p.id);
  audit(req, 'payment.razorpay_order_created', 'payment', p.id, order.id);
  res.json({ key_id: config.razorpayKeyId, order_id: order.id, amount: order.amount, currency: order.currency, payment_id: p.id, business_name: 'H-Staff' });
}));

// Browser callback is not trusted alone: verify signature and fetch the payment from Razorpay.
router.post('/:id/verify-checkout', authenticate, requireRole('business'), wrap(async (req, res) => {
  requireGateway();
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }).parse(req.body);
  const id = parseId(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw notFound('Payment not found');
  if (p.business_id !== req.user.id) throw forbidden('This payment does not belong to your business.');
  if (p.collection_status === 'paid') return res.json({ ok: true, collection_status: 'paid', payout_status: p.payout_status });
  if (p.razorpay_order_id !== razorpay_order_id) throw bad('Order does not match this payment.');
  if (!safeEqualHex(razorpay_signature, hmac(config.razorpayKeySecret, `${razorpay_order_id}|${razorpay_payment_id}`))) throw bad('Razorpay checkout signature is invalid.');
  const gatewayPayment = await razorpayRequest(`/payments/${encodeURIComponent(razorpay_payment_id)}`);
  if (gatewayPayment.order_id !== razorpay_order_id || gatewayPayment.amount !== p.amount * 100 || gatewayPayment.currency !== 'INR' || !['captured'].includes(gatewayPayment.status)) throw conflict('Payment is not captured for the expected amount. If you just paid, wait for confirmation and refresh.');
  const eventId = `checkout:${razorpay_payment_id}`;
  tx(() => {
    const seen = db.prepare('SELECT id FROM payment_events WHERE event_id=?').get(eventId);
    if (seen) return;
    db.prepare("UPDATE payments SET collection_status='paid', razorpay_payment_id=?, collection_paid_at=datetime('now'), reference=? WHERE id=? AND collection_status!='paid'").run(razorpay_payment_id, razorpay_payment_id, p.id);
    db.prepare('INSERT INTO payment_events (provider,event_id,event_type,payment_id,payload_json) VALUES (?,?,?,?,?)').run('razorpay', eventId, 'checkout.verified', p.id, JSON.stringify({ order_id: razorpay_order_id, payment_id: razorpay_payment_id }));
    notify(p.worker_id, `Client payment received for ${pad('PAY', p.id)}. Worker payout is ${config.razorpayEnabled ? 'awaiting payout setup/processing' : 'not configured'}.`);
  })();
  audit(req, 'payment.razorpay_collected', 'payment', p.id, razorpay_payment_id);
  res.json({ ok: true, collection_status: 'paid', payout_status: 'not_started', message: 'Client payment verified. Worker payout is tracked separately and is not automatically transferred by this checkout.' });
}));

// Record an actual offline payment observed by an administrator (cash/UPI/bank).
// This is not an approval shortcut: the admin must supply the external reference.
router.post('/:id/mark-paid', authenticate, requireRole('admin'), wrap((req, res) => {
  const { reference } = z.object({ reference: z.string().trim().min(4).max(100) }).parse(req.body ?? {});
  const id = parseId(req.params.id);
  const p = db.prepare('SELECT p.*,t.status timesheet_status FROM payments p JOIN timesheets t ON t.id=p.timesheet_id WHERE p.id=?').get(id);
  if (!p) throw notFound('Payment not found');
  if (!['Approved','Paid'].includes(p.timesheet_status)) throw conflict('Only an approved timesheet can be recorded as paid.');
  if (p.collection_status === 'paid' || p.status === 'Paid') throw conflict('Payment is already recorded as paid.');
  tx(() => {
    db.prepare("UPDATE payments SET status='Paid',collection_status='paid',payout_status='paid',reference=?,payout_reference=?,collection_paid_at=datetime('now'),paid_at=datetime('now'),payout_updated_at=datetime('now') WHERE id=? AND status!='Paid'").run(reference, reference, id);
    db.prepare("UPDATE timesheets SET status='Paid' WHERE id=? AND status='Approved'").run(p.timesheet_id);
    notify(p.worker_id, `Offline payment ${pad('PAY', id)} recorded. Reference: ${reference}`);
  })();
  audit(req, 'payment.manual_recorded', 'payment', id, reference);
  res.json({ ok: true, status: 'Paid', collection_status: 'paid', payout_status: 'paid' });
}));

// Razorpay webhook uses the raw request body and an event-id uniqueness constraint for idempotency.
export async function razorpayWebhook(req, res) {
  if (!config.razorpayWebhookSecret) return res.status(503).json({ error: 'Razorpay webhook secret is not configured.' });
  const signature = req.get('x-razorpay-signature') || '';
  const raw = req.rawBody;
  if (!raw || !safeEqualHex(signature, hmac(config.razorpayWebhookSecret, raw))) return res.status(400).json({ error: 'Invalid webhook signature.' });
  const event = req.body;
  const eventId = req.get('x-razorpay-event-id');
  if (!eventId) return res.status(400).json({ error: 'Missing webhook event id.' });
  try {
    tx(() => {
      if (db.prepare('SELECT id FROM payment_events WHERE event_id=?').get(eventId)) return;
      const entity = event?.payload?.payment?.entity;
      const orderId = entity?.order_id;
      const p = orderId ? db.prepare('SELECT * FROM payments WHERE razorpay_order_id=?').get(orderId) : null;
      const jp = !p && orderId ? db.prepare('SELECT * FROM job_payments WHERE razorpay_order_id=?').get(orderId) : null;
      db.prepare('INSERT INTO payment_events (provider,event_id,event_type,payment_id,payload_json) VALUES (?,?,?,?,?)').run('razorpay', eventId, String(event.event || 'unknown'), p?.id ?? null, JSON.stringify(event));
      if (p && event.event === 'payment.captured' && entity.amount === p.amount * 100 && entity.currency === 'INR') {
        db.prepare("UPDATE payments SET collection_status='paid', razorpay_payment_id=?, collection_paid_at=COALESCE(collection_paid_at,datetime('now')), reference=? WHERE id=? AND collection_status!='paid'").run(entity.id, entity.id, p.id);
        notify(p.worker_id, `Client payment received for ${pad('PAY', p.id)}. Worker payout is tracked separately.`);
      } else if (p && event.event === 'payment.failed' && p.collection_status !== 'paid') {
        db.prepare("UPDATE payments SET collection_status='failed' WHERE id=? AND collection_status!='paid'").run(p.id);
      } else if (jp && event.event === 'payment.captured' && entity.amount === jp.amount * 100 && entity.currency === 'INR') {
        db.prepare("UPDATE job_payments SET status='paid',razorpay_payment_id=?,paid_at=COALESCE(paid_at,datetime('now')) WHERE id=? AND status!='paid'").run(entity.id,jp.id);
        notify(jp.worker_id, `Payment for completed job ${jp.shift_id} was received.`);
      }
    })();
    return res.json({ received: true });
  } catch (e) { console.error('Razorpay webhook processing failed:', e); return res.status(500).json({ error: 'Webhook processing failed; provider may retry.' }); }
}

// Queue a worker payout after collection. Actual transfer is deliberately not fabricated:
// a Razorpay Route/RazorpayX product, approved account, beneficiary details and API credentials are required.
router.post('/:id/queue-payout', authenticate, requireRole('admin'), wrap((req, res) => {
  const id = parseId(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw notFound('Payment not found');
  if (p.collection_status !== 'paid') throw conflict('Client funds must be captured before queuing a worker payout.');
  if (p.payout_status === 'paid' || p.status === 'Paid') throw conflict('Worker payout is already marked paid.');
  const key = `hstaff-payout-${p.id}`;
  const existing = db.prepare('SELECT * FROM payout_attempts WHERE idempotency_key=?').get(key);
  if (!existing) db.prepare("INSERT INTO payout_attempts (payment_id,idempotency_key,status,amount) VALUES (?,?,'queued',?)").run(p.id, key, p.amount - p.fee);
  db.prepare("UPDATE payments SET payout_status='queued', payout_updated_at=datetime('now') WHERE id=?").run(p.id);
  audit(req, 'payment.payout_queued', 'payment', p.id, key);
  res.json({ ok: true, payout_status: 'queued', net_amount: p.amount - p.fee, message: 'Queued for payout operations. No bank transfer has been initiated: Razorpay marketplace/payout access and verified worker beneficiary details are required.' });
}));

// Admin confirms a real external transfer only after verifying the bank/UPI reference.
router.post('/:id/confirm-payout', authenticate, requireRole('admin'), wrap((req, res) => {
  const { reference } = z.object({ reference: z.string().trim().min(4).max(100) }).parse(req.body ?? {});
  const id = parseId(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw notFound('Payment not found');
  if (p.collection_status !== 'paid') throw conflict('Client payment has not been collected.');
  if (p.payout_status === 'paid' || p.status === 'Paid') throw conflict('Payout already confirmed.');
  tx(() => {
    db.prepare("UPDATE payments SET status='Paid', payout_status='paid', payout_reference=?, payout_updated_at=datetime('now'), paid_at=datetime('now'), reference=COALESCE(reference,?) WHERE id=? AND status!='Paid'").run(reference, reference, id);
    db.prepare("UPDATE timesheets SET status='Paid' WHERE id=? AND status='Approved'").run(p.timesheet_id);
    db.prepare("UPDATE payout_attempts SET status='paid', reference=?, updated_at=datetime('now') WHERE payment_id=?").run(reference, id);
    notify(p.worker_id, `Worker payout of ₹${p.amount - p.fee} confirmed. Reference: ${reference}`);
  })();
  audit(req, 'payment.payout_confirmed', 'payment', id, reference);
  res.json({ ok: true, payout_status: 'paid' });
}));
