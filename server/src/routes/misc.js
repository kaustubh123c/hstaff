import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, forbidden, notFound, parseId, audit, serializeShift, SHIFT_SELECT, pad } from '../util.js';

export const router = Router();

router.get('/meta', (_req, res) => res.json({
  name: 'H-Staff', demo: config.demoMode, requireKycToApply: config.requireKycToApply,
  clockInEarlyMinutes: config.clockInEarlyMinutes,
  razorpayConfigured: config.razorpayEnabled,
}));

router.use(authenticate);

// ---- dashboards ------------------------------------------------------------
router.get('/dashboard', wrap((req, res) => {
  const { role, id } = req.user, one = (sql, ...p) => db.prepare(sql).get(...p);
  if (role === 'business') {
    const active = one("SELECT COUNT(*) c FROM shifts WHERE business_id=? AND status IN ('Open','Filled','Ongoing')", id).c;
    const needWorkers = one("SELECT COUNT(*) c FROM shifts s WHERE business_id=? AND status='Open'", id).c;
    const positions = one("SELECT COALESCE(SUM(workers_needed),0) n FROM shifts WHERE business_id=? AND status IN ('Open','Filled','Ongoing')", id).n;
    const filled = one("SELECT COUNT(*) c FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE s.business_id=? AND a.status='Accepted' AND s.status IN ('Open','Filled','Ongoing')", id).c;
    const tsTotal = one('SELECT COUNT(*) c FROM timesheets t JOIN shifts s ON s.id=t.shift_id WHERE s.business_id=?', id).c;
    const tsDone = one("SELECT COUNT(*) c FROM timesheets t JOIN shifts s ON s.id=t.shift_id WHERE s.business_id=? AND t.status IN ('Approved','Paid')", id).c;
    return res.json({
      stats: {
        active_shifts: active, need_workers: needWorkers,
        total_workers: one("SELECT COUNT(DISTINCT a.worker_id) c FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE s.business_id=? AND a.status='Accepted'", id).c,
        pending_timesheets: one("SELECT COUNT(*) c FROM timesheets t JOIN shifts s ON s.id=t.shift_id WHERE s.business_id=? AND t.status='Pending'", id).c,
        total_payments: one('SELECT COALESCE(SUM(amount),0) n FROM payments WHERE business_id=?', id).n,
        pending_applications: one("SELECT COUNT(*) c FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE s.business_id=? AND a.status='Applied'", id).c,
      },
      progress: { positions, filled, timesheets_total: tsTotal, timesheets_done: tsDone },
      recent_shifts: db.prepare(`${SHIFT_SELECT} WHERE s.business_id=? ORDER BY s.id DESC LIMIT 4`).all(id).map(s => serializeShift(s)),
    });
  }
  if (role === 'worker') {
    const w = one('SELECT kyc_status, rating FROM workers WHERE user_id=?', id);
    return res.json({
      stats: {
        available_shifts: one("SELECT COUNT(*) c FROM shifts s WHERE s.status='Open' AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.shift_id=s.id AND a.worker_id=? AND a.status!='Withdrawn')", id).c,
        my_shifts: one("SELECT COUNT(*) c FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE a.worker_id=? AND a.status IN ('Applied','Accepted') AND s.status IN ('Open','Filled','Ongoing')", id).c,
        upcoming: one("SELECT COUNT(*) c FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE a.worker_id=? AND a.status='Accepted' AND s.status IN ('Filled','Ongoing')", id).c,
        completed_shifts: one("SELECT COUNT(*) c FROM timesheets WHERE worker_id=? AND status IN ('Approved','Paid')", id).c,
      },
      kyc_status: w.kyc_status, rating: w.rating,
      recommended: db.prepare(`${SHIFT_SELECT} WHERE s.status='Open' AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.shift_id=s.id AND a.worker_id=? AND a.status!='Withdrawn') ORDER BY s.date, s.start_time LIMIT 3`).all(id).map(s => { const o = serializeShift(s); delete o.rate; return o; }),
    });
  }
  res.json({
    stats: {
      total_workers: one("SELECT COUNT(*) c FROM users WHERE role='worker'").c,
      total_businesses: one("SELECT COUNT(*) c FROM users WHERE role='business'").c,
      active_shifts: one("SELECT COUNT(*) c FROM shifts WHERE status IN ('Open','Filled','Ongoing')").c,
      pending_kyc: one("SELECT COUNT(DISTINCT worker_id) c FROM kyc_documents WHERE status='Pending'").c,
      open_disputes: one("SELECT COUNT(*) c FROM disputes WHERE status!='Resolved'").c,
      pending_payments: one("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='Pending'").n,
    },
    recent_registrations: db.prepare(`SELECT u.id, u.name, u.role, u.created_at,
      CASE WHEN u.role='worker' THEN w.kyc_status ELSE u.status END status
      FROM users u LEFT JOIN workers w ON w.user_id=u.id WHERE u.role!='admin' ORDER BY u.id DESC LIMIT 5`).all(),
  });
}));

// ---- people directories ----------------------------------------------------
router.get('/workers', requireRole('business', 'admin'), wrap((req, res) => {
  const base = `SELECT u.id, u.name, u.phone, u.status, u.created_at, w.skills, w.location, w.rating, w.kyc_status FROM users u JOIN workers w ON w.user_id=u.id`;
  const rows = req.user.role === 'admin' ? db.prepare(`${base} ORDER BY u.name`).all()
    : db.prepare(`${base} WHERE u.id IN (SELECT a.worker_id FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE s.business_id=? AND a.status IN ('Applied','Accepted')) ORDER BY u.name`).all(req.user.id);
  // Business users do not need phone numbers of non-accepted applicants.
  res.json({ workers: req.user.role === 'admin' ? rows : rows.map(({ phone, ...r }) => r) });
}));

router.get('/businesses', requireRole('admin'), (_req, res) => {
  res.json({ businesses: db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.status, u.created_at, b.company, b.address,
    (SELECT COUNT(*) FROM shifts s WHERE s.business_id=u.id) shifts FROM users u JOIN businesses b ON b.user_id=u.id ORDER BY b.company`).all() });
});

// ---- notifications ---------------------------------------------------------
router.get('/notifications', (req, res) => {
  res.json({
    unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c,
    notifications: db.prepare('SELECT id, message, read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id),
  });
});
router.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});
