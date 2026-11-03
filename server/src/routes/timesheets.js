import { Router } from 'express';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, forbidden, notFound, conflict, parseId, audit, notify, pad } from '../util.js';
import { createPaymentForTimesheet } from '../services.js';

export const router = Router();
router.use(authenticate);

const BASE = `SELECT t.*, s.title shift_title, s.date, s.business_id, s.location, b.company, u.name worker_name
  FROM timesheets t JOIN shifts s ON s.id=t.shift_id JOIN businesses b ON b.user_id=s.business_id JOIN users u ON u.id=t.worker_id`;
const shape = t => ({ ...t, code: pad('TS', t.id), shift_code: pad('SFT', t.shift_id) });

router.get('/', wrap((req, res) => {
  const { role, id } = req.user;
  const where = role === 'business' ? 'WHERE s.business_id=?' : role === 'worker' ? 'WHERE t.worker_id=?' : 'WHERE ?=?';
  const rows = db.prepare(`${BASE} ${where} ORDER BY t.id DESC`).all(...(role === 'admin' ? [1, 1] : [id]));
  const count = s => rows.filter(r => r.status === s).length;
  res.json({
    timesheets: rows.map(shape),
    summary: { pending: count('Pending'), approved: count('Approved'), disputed: count('Disputed'), paid: count('Paid') },
  });
}));

function loadForBusiness(req) {
  const t = db.prepare(`${BASE} WHERE t.id=?`).get(parseId(req.params.id));
  if (!t) throw notFound('Timesheet not found');
  if (req.user.role === 'business' && t.business_id !== req.user.id) throw forbidden();
  return t;
}

router.post('/:id/approve', requireRole('business', 'admin'), wrap((req, res) => {
  const t = loadForBusiness(req);
  if (t.status !== 'Pending') throw conflict(`Timesheet is already ${t.status.toLowerCase()}`);
  tx(() => {
    db.prepare("UPDATE timesheets SET status='Approved', decided_at=datetime('now') WHERE id=?").run(t.id);
    createPaymentForTimesheet(t);
    notify(t.worker_id, `Timesheet ${pad('TS', t.id)} approved. Payment of ₹${t.amount} is being processed.`);
  })();
  audit(req, 'timesheet.approve', 'timesheet', t.id);
  res.json({ ok: true });
}));

router.post('/:id/dispute', wrap((req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Please describe the issue').max(1000) }).parse(req.body);
  const t = db.prepare(`${BASE} WHERE t.id=?`).get(parseId(req.params.id));
  if (!t) throw notFound('Timesheet not found');
  const allowed = (req.user.role === 'business' && t.business_id === req.user.id) || (req.user.role === 'worker' && t.worker_id === req.user.id);
  if (!allowed) throw forbidden();
  if (!['Pending', 'Approved'].includes(t.status)) throw conflict(`A ${t.status.toLowerCase()} timesheet cannot be disputed`);
  const pay = db.prepare('SELECT status FROM payments WHERE timesheet_id=?').get(t.id);
  if (pay?.status === 'Paid') throw conflict('This timesheet has already been paid');
  const d = tx(() => {
    db.prepare("UPDATE timesheets SET status='Disputed' WHERE id=?").run(t.id);
    if (pay) db.prepare('DELETE FROM payments WHERE timesheet_id=?').run(t.id);
    return db.prepare('INSERT INTO disputes (timesheet_id, raised_by, subject, description) VALUES (?,?,?,?)')
      .run(t.id, req.user.id, `Hours dispute – ${pad('TS', t.id)}`, reason).lastInsertRowid;
  })();
  audit(req, 'timesheet.dispute', 'timesheet', t.id, reason);
  res.status(201).json({ ok: true, dispute: pad('DSP', d) });
}));
