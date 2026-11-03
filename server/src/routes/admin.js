import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, notFound, parseId, audit } from '../util.js';

export const router = Router();
router.use(authenticate, requireRole('admin'));

router.post('/users/:id/status', wrap((req, res) => {
  const { status } = z.object({ status: z.enum(['Active', 'Suspended']) }).parse(req.body);
  const id = parseId(req.params.id);
  if (id === req.user.id) throw bad('You cannot change your own account status');
  const u = db.prepare('SELECT id, role FROM users WHERE id=?').get(id);
  if (!u) throw notFound('User not found');
  if (u.role === 'admin') throw bad('Admin accounts cannot be suspended here');
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id);
  audit(req, `user.${status.toLowerCase()}`, 'user', id);
  res.json({ ok: true });
}));

router.get('/audit-logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const q = (req.query.q || '').toString();
  const rows = db.prepare(`SELECT l.id, l.action, l.entity, l.entity_id, l.detail, l.ip, l.created_at, u.name user_name, u.role user_role
    FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE (? = '' OR l.action LIKE ? OR l.detail LIKE ? OR u.name LIKE ?)
    ORDER BY l.id DESC LIMIT ?`).all(q, `%${q}%`, `%${q}%`, `%${q}%`, limit);
  res.json({ logs: rows });
});

router.get('/reports', (_req, res) => {
  const all = sql => db.prepare(sql).all();
  res.json({
    shifts_by_status: all('SELECT status, COUNT(*) count FROM shifts GROUP BY status'),
    payments_by_month: all(`SELECT substr(created_at,1,7) month, COUNT(*) count, SUM(amount) total, SUM(fee) fees FROM payments GROUP BY month ORDER BY month DESC LIMIT 6`),
    top_businesses: all(`SELECT b.company, COUNT(s.id) shifts, COALESCE(SUM(s.workers_needed),0) positions FROM businesses b LEFT JOIN shifts s ON s.business_id=b.user_id GROUP BY b.user_id ORDER BY shifts DESC LIMIT 5`),
    top_workers: all(`SELECT u.name, COUNT(t.id) shifts, COALESCE(SUM(t.hours),0) hours, COALESCE(SUM(t.amount),0) earned FROM users u JOIN timesheets t ON t.worker_id=u.id GROUP BY u.id ORDER BY earned DESC LIMIT 5`),
    totals: db.prepare(`SELECT COALESCE(SUM(hours),0) hours, COALESCE(SUM(amount),0) amount FROM timesheets WHERE status IN ('Approved','Paid')`).get(),
  });
});

const SETTINGS = { support_email: 'support@hstaff.example', auto_approve_hours: '24' };
export const getSettings = () => ({ ...SETTINGS, ...Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) });

router.get('/settings', (_req, res) => res.json({ settings: getSettings() }));
router.put('/settings', wrap((req, res) => {
  const d = z.object({
    support_email: z.string().trim().email().optional(),
    auto_approve_hours: z.coerce.number().int().min(0).max(168).optional(),
  }).parse(req.body);
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(d)) if (v !== undefined) up.run(k, String(v));
  audit(req, 'settings.update', 'settings', null, JSON.stringify(d));
  res.json({ settings: getSettings() });
}));
