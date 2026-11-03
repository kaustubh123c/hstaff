import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, forbidden, notFound, conflict, parseId, audit, notify, serializeShift, SHIFT_SELECT, makeQrToken, pad, shiftWindow } from '../util.js';
import { closeAttendance, refreshShiftStatus } from '../services.js';

export const router = Router();
router.use(authenticate);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const shiftSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional().default(''),
  skills: z.union([z.string(), z.array(z.string())]).optional().default('')
    .transform(v => (Array.isArray(v) ? v : v.split(',')).map(x => x.trim()).filter(Boolean).slice(0, 10).join(',')),
  location: z.string().trim().min(2).max(160),
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lng: z.coerce.number().min(-180).max(180).nullish(),
  radius_m: z.coerce.number().int().min(25).max(5000).optional().default(config.defaultGeofenceMeters),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  start_time: time, end_time: time,
  workers_needed: z.coerce.number().int().min(1).max(100),
  rate: z.coerce.number().int().min(1).max(100000),
})
  .refine(d => d.start_time !== d.end_time, { message: 'Start and end time must differ', path: ['end_time'] })
  .refine(d => (d.lat == null) === (d.lng == null), {
    message: 'Provide both latitude and longitude, or leave both blank',
    path: ['lng']
  });

function loadShift(id) {
  const s = db.prepare(`${SHIFT_SELECT} WHERE s.id=?`).get(id);
  if (!s) throw notFound('Shift not found');
  return s;
}
function ownShift(req, id) {
  const s = loadShift(id);
  if (req.user.role === 'business' && s.business_id !== req.user.id) throw forbidden('This shift belongs to another business');
  if (!['business', 'admin'].includes(req.user.role)) throw forbidden();
  return s;
}

router.get('/', wrap((req, res) => {
  const { role, id } = req.user;
  const q = (req.query.q || '').toString().toLowerCase();
  const status = req.query.status?.toString();
  let rows;
  if (role === 'business') rows = db.prepare(`${SHIFT_SELECT} WHERE s.business_id=? ORDER BY s.date DESC, s.id DESC`).all(id);
  else if (role === 'admin') rows = db.prepare(`${SHIFT_SELECT} ORDER BY s.date DESC, s.id DESC`).all();
  else if (req.query.scope === 'mine') rows = db.prepare(`${SHIFT_SELECT} JOIN applications a ON a.shift_id=s.id AND a.worker_id=? ORDER BY s.date DESC`).all(id);
  else rows = db.prepare(`${SHIFT_SELECT} WHERE s.status='Open' AND s.job_type != 'ondemand' ORDER BY s.date, s.start_time`).all();
  const out = rows.map(s => {
    const extra = {};
    if (role === 'worker') {
      extra.my_application = db.prepare('SELECT id, status FROM applications WHERE shift_id=? AND worker_id=?').get(s.id, id) ?? null;
      extra.my_timesheet = db.prepare('SELECT id, hours, amount, status FROM timesheets WHERE shift_id=? AND worker_id=?').get(s.id, id) ?? null;
    }
    if (role !== 'worker') extra.pending_applications = db.prepare("SELECT COUNT(*) c FROM applications WHERE shift_id=? AND status='Applied'").get(s.id).c;
    const out = serializeShift(s, extra);
    if (role === 'worker') { delete out.rate; delete out.my_timesheet; }
    return out;
  }).filter(s => (!q || `${s.title} ${s.location} ${s.business}`.toLowerCase().includes(q)) && (!status || status === 'All' || s.status === status));
  res.json({ shifts: out });
}));

router.get('/:id', wrap((req, res) => {
  const s = loadShift(parseId(req.params.id));
  if (req.user.role === 'business' && s.business_id !== req.user.id) throw forbidden();
  res.json({ shift: serializeShift(s) });
}));

router.post('/', requireRole('business'), wrap((req, res) => {
  const d = shiftSchema.parse(req.body);
  const { start } = shiftWindow({ ...d });
  if (start.getTime() < Date.now() - 24 * 3600000) throw bad('Shift date cannot be in the past');
  const r = db.prepare(`INSERT INTO shifts (business_id, title, description, skills, location, lat, lng, radius_m, date, start_time, end_time, workers_needed, rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, d.title, d.description, d.skills, d.location, d.lat ?? null, d.lng ?? null, d.radius_m, d.date, d.start_time, d.end_time, d.workers_needed, d.rate);
  audit(req, 'shift.create', 'shift', r.lastInsertRowid, d.title);
  res.status(201).json({ shift: serializeShift(loadShift(r.lastInsertRowid)) });
}));

router.put('/:id', requireRole('business'), wrap((req, res) => {
  const s = ownShift(req, parseId(req.params.id));
  if (!['Open', 'Filled'].includes(s.status)) throw conflict(`A ${s.status.toLowerCase()} shift can no longer be edited`);
  const d = shiftSchema.parse({ ...s, skills: s.skills, ...req.body });
  const accepted = db.prepare("SELECT COUNT(*) c FROM applications WHERE shift_id=? AND status='Accepted'").get(s.id).c;
  if (d.workers_needed < accepted) throw bad(`Cannot reduce below ${accepted} already accepted workers`);
  db.prepare(`UPDATE shifts SET title=?, description=?, skills=?, location=?, lat=?, lng=?, radius_m=?, date=?, start_time=?, end_time=?, workers_needed=?, rate=? WHERE id=?`)
    .run(d.title, d.description, d.skills, d.location, d.lat ?? null, d.lng ?? null, d.radius_m, d.date, d.start_time, d.end_time, d.workers_needed, d.rate, s.id);
  refreshShiftStatus(s.id);
  audit(req, 'shift.update', 'shift', s.id);
  res.json({ shift: serializeShift(loadShift(s.id)) });
}));

router.post('/:id/cancel', requireRole('business', 'admin'), wrap((req, res) => {
  const s = ownShift(req, parseId(req.params.id));
  if (['Completed', 'Cancelled'].includes(s.status)) throw conflict(`Shift is already ${s.status.toLowerCase()}`);
  tx(() => {
    db.prepare("UPDATE shifts SET status='Cancelled' WHERE id=?").run(s.id);
    for (const a of db.prepare("SELECT worker_id FROM applications WHERE shift_id=? AND status IN ('Applied','Accepted')").all(s.id))
      notify(a.worker_id, `${pad('SFT', s.id)} (${s.title}) was cancelled by the business.`);
  })();
  audit(req, 'shift.cancel', 'shift', s.id);
  res.json({ shift: serializeShift(loadShift(s.id)) });
}));

router.post('/:id/complete', requireRole('business', 'admin'), wrap((req, res) => {
  const s = ownShift(req, parseId(req.params.id));
  if (!['Ongoing', 'Filled'].includes(s.status)) throw conflict('Only filled or ongoing shifts can be completed');
  tx(() => {
    const now = new Date(), { end } = shiftWindow(s);
    const when = now < end ? now : end;
    for (const att of db.prepare('SELECT * FROM attendance WHERE shift_id=? AND clock_out IS NULL').all(s.id)) closeAttendance(att, s, when);
    db.prepare("UPDATE shifts SET status='Completed' WHERE id=?").run(s.id);
  })();
  audit(req, 'shift.complete', 'shift', s.id);
  res.json({ shift: serializeShift(loadShift(s.id)) });
}));

// ---- applications ----------------------------------------------------------
router.post('/:id/apply', requireRole('worker'), wrap((req, res) => {
  const s = loadShift(parseId(req.params.id));
  const w = db.prepare('SELECT kyc_status FROM workers WHERE user_id=?').get(req.user.id);
  if (config.requireKycToApply && w.kyc_status !== 'Verified') throw forbidden('Complete KYC verification before applying for shifts');
  if (s.status !== 'Open') throw conflict('This shift is no longer open for applications');
  // Prevent double-booking overlapping accepted/applied shifts
  const mine = db.prepare(`${SHIFT_SELECT} JOIN applications a ON a.shift_id=s.id WHERE a.worker_id=? AND a.status IN ('Applied','Accepted') AND s.status!='Cancelled'`).all(req.user.id);
  const win = shiftWindow(s);
  for (const o of mine) {
    const ow = shiftWindow(o);
    if (ow.start < win.end && win.start < ow.end) throw conflict(`This overlaps with your shift ${pad('SFT', o.id)} (${o.title})`);
  }
  const existing = db.prepare('SELECT id, status FROM applications WHERE shift_id=? AND worker_id=?').get(s.id, req.user.id);
  if (existing && existing.status !== 'Withdrawn') throw conflict('You have already applied for this shift');
  if (existing) db.prepare("UPDATE applications SET status='Applied', created_at=datetime('now') WHERE id=?").run(existing.id);
  else db.prepare('INSERT INTO applications (shift_id, worker_id) VALUES (?,?)').run(s.id, req.user.id);
  notify(s.business_id, `${req.user.name} applied for ${s.title} (${pad('SFT', s.id)}).`);
  audit(req, 'shift.apply', 'shift', s.id);
  res.status(201).json({ ok: true });
}));

router.delete('/:id/apply', requireRole('worker'), wrap((req, res) => {
  const id = parseId(req.params.id);
  const a = db.prepare('SELECT * FROM applications WHERE shift_id=? AND worker_id=?').get(id, req.user.id);
  if (!a || a.status === 'Withdrawn') throw notFound('No active application found');
  if (db.prepare('SELECT 1 FROM attendance WHERE shift_id=? AND worker_id=?').get(id, req.user.id)) throw conflict('You have already clocked in to this shift');
  db.prepare("UPDATE applications SET status='Withdrawn' WHERE id=?").run(a.id);
  refreshShiftStatus(id);
  audit(req, 'shift.withdraw', 'shift', id);
  res.json({ ok: true });
}));

router.get('/:id/applications', requireRole('business', 'admin'), wrap((req, res) => {
  const s = ownShift(req, parseId(req.params.id));
  const rows = db.prepare(`SELECT a.id, a.status, a.created_at, u.id worker_id, u.name, u.phone, w.skills, w.location, w.rating, w.kyc_status
    FROM applications a JOIN users u ON u.id=a.worker_id JOIN workers w ON w.user_id=u.id
    WHERE a.shift_id=? AND a.status!='Withdrawn' ORDER BY a.created_at`).all(s.id);
  res.json({ applications: rows });
}));

router.get('/:id/qr', requireRole('business', 'admin'), wrap(async (req, res) => {
  const s = ownShift(req, parseId(req.params.id));
  if (['Cancelled', 'Completed'].includes(s.status)) throw conflict('QR is unavailable for this shift');
  if (s.lat == null || s.lng == null) throw bad('Set both site latitude and longitude in shift details before generating an attendance QR code');
  const token = makeQrToken(s);
  res.set('Cache-Control', 'no-store');
  res.json({ token, svg: await QRCode.toString(token, { type: 'svg', margin: 2, errorCorrectionLevel: 'H' }) });
}));

// Decisions live here so the business-ownership check is in one place.
export const applicationsRouter = Router();
applicationsRouter.use(authenticate, requireRole('business', 'admin'));
applicationsRouter.post('/:id/decision', wrap((req, res) => {
  const { decision } = z.object({ decision: z.enum(['accept', 'reject']) }).parse(req.body);
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(parseId(req.params.id));
  if (!a) throw notFound('Application not found');
  const s = ownShift(req, a.shift_id);
  if (a.status === 'Withdrawn') throw conflict('The worker withdrew this application');
  if (['Cancelled', 'Completed'].includes(s.status)) throw conflict(`Shift is ${s.status.toLowerCase()}`);
  tx(() => {
    if (decision === 'accept') {
      const accepted = db.prepare("SELECT COUNT(*) c FROM applications WHERE shift_id=? AND status='Accepted'").get(s.id).c;
      if (a.status !== 'Accepted' && accepted >= s.workers_needed) throw conflict('All positions for this shift are already filled');
    }
    db.prepare('UPDATE applications SET status=? WHERE id=?').run(decision === 'accept' ? 'Accepted' : 'Rejected', a.id);
    refreshShiftStatus(s.id);
    notify(a.worker_id, `Your application for ${s.title} (${pad('SFT', s.id)}) was ${decision === 'accept' ? 'accepted' : 'declined'}.`);
  })();
  audit(req, `application.${decision}`, 'application', a.id, `shift ${s.id}`);
  res.json({ ok: true });
}));
