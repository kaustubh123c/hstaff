import { Router } from 'express';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, notFound, conflict, forbidden, parseId, audit, notify, pad } from '../util.js';
import { createPaymentForTimesheet } from '../services.js';

export const router = Router();
router.use(authenticate);

const BASE = `SELECT d.*, u.name raised_by_name, u.role raised_by_role FROM disputes d JOIN users u ON u.id=d.raised_by`;
const shape = d => ({ ...d, code: pad('DSP', d.id), timesheet_code: d.timesheet_id ? pad('TS', d.timesheet_id) : null });

router.get('/', wrap((req, res) => {
  const rows = req.user.role === 'admin' ? db.prepare(`${BASE} ORDER BY d.id DESC`).all()
    : db.prepare(`${BASE} WHERE d.raised_by=? ORDER BY d.id DESC`).all(req.user.id);
  res.json({ disputes: rows.map(shape) });
}));

router.post('/', requireRole('worker', 'business'), wrap((req, res) => {
  const d = z.object({ subject: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).optional() }).parse(req.body);
  const id = db.prepare('INSERT INTO disputes (raised_by, subject, description) VALUES (?,?,?)').run(req.user.id, d.subject, d.description ?? null).lastInsertRowid;
  audit(req, 'dispute.create', 'dispute', id, d.subject);
  res.status(201).json({ ok: true, id });
}));

router.post('/:id/start', requireRole('admin'), wrap((req, res) => {
  const d = db.prepare('SELECT * FROM disputes WHERE id=?').get(parseId(req.params.id));
  if (!d) throw notFound('Dispute not found');
  if (d.status !== 'Open') throw conflict('Dispute is already being handled');
  db.prepare("UPDATE disputes SET status='In progress', updated_at=datetime('now') WHERE id=?").run(d.id);
  audit(req, 'dispute.start', 'dispute', d.id);
  res.json({ ok: true });
}));

// Outcome: approve_as_is | adjust_hours | close (no timesheet change)
router.post('/:id/resolve', requireRole('admin'), wrap((req, res) => {
  const b = z.object({
    outcome: z.enum(['approve_as_is', 'adjust_hours', 'close']),
    hours: z.coerce.number().min(0).max(24).optional(),
    resolution: z.string().trim().min(3, 'Please add a resolution note').max(500),
  }).parse(req.body);
  const d = db.prepare('SELECT * FROM disputes WHERE id=?').get(parseId(req.params.id));
  if (!d) throw notFound('Dispute not found');
  if (d.status === 'Resolved') throw conflict('Dispute is already resolved');
  tx(() => {
    if (b.outcome !== 'close') {
      if (!d.timesheet_id) throw bad('This dispute is not linked to a timesheet');
      let ts = db.prepare('SELECT * FROM timesheets WHERE id=?').get(d.timesheet_id);
      if (b.outcome === 'adjust_hours') {
        if (b.hours == null) throw bad('Hours are required to adjust a timesheet');
        const amount = Math.round(b.hours * ts.rate);
        db.prepare('UPDATE timesheets SET hours=?, amount=? WHERE id=?').run(b.hours, amount, ts.id);
      }
      db.prepare("UPDATE timesheets SET status='Approved', decided_at=datetime('now') WHERE id=?").run(ts.id);
      ts = db.prepare('SELECT * FROM timesheets WHERE id=?').get(ts.id);
      createPaymentForTimesheet(ts);
    }
    db.prepare("UPDATE disputes SET status='Resolved', resolution=?, resolved_by=?, updated_at=datetime('now') WHERE id=?").run(b.resolution, req.user.id, d.id);
    notify(d.raised_by, `Your dispute ${pad('DSP', d.id)} was resolved: ${b.resolution}`);
  })();
  audit(req, 'dispute.resolve', 'dispute', d.id, b.outcome);
  res.json({ ok: true });
}));
