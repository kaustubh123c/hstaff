import { Router } from 'express';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, forbidden, notFound, conflict, parseId, audit, haversineMeters, verifyQrToken, shiftWindow, pad, serializeShift, SHIFT_SELECT } from '../util.js';
import { closeAttendance, refreshShiftStatus } from '../services.js';

export const router = Router();
router.use(authenticate);

const coords = { lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() };

function geofence(shift, lat, lng) {
  if (shift.lat == null || shift.lng == null) throw forbidden('This shift has no site GPS pin. Ask the business to set its latitude and longitude before recording attendance.');
  if (lat == null || lng == null) throw bad('Location is required to verify attendance. Please allow location access.');
  const distance = Math.round(haversineMeters(shift.lat, shift.lng, lat, lng));
  if (distance > shift.radius_m) throw forbidden(`You are ${distance} m from the work location. You must be within ${shift.radius_m} m.`);
  return { distance };
}

// Worker: assigned shifts that can be clocked into / are in progress
router.get('/mine', requireRole('worker'), wrap((req, res) => {
  const rows = db.prepare(`${SHIFT_SELECT} JOIN applications a ON a.shift_id=s.id AND a.worker_id=? AND a.status='Accepted'
    WHERE s.status IN ('Filled','Ongoing','Open') OR EXISTS (SELECT 1 FROM attendance t WHERE t.shift_id=s.id AND t.worker_id=? AND t.clock_out IS NULL)
    ORDER BY s.date, s.start_time`).all(req.user.id, req.user.id);
  const history = db.prepare(`SELECT t.*, s.title, s.date FROM attendance t JOIN shifts s ON s.id=t.shift_id WHERE t.worker_id=? ORDER BY t.clock_in DESC LIMIT 10`).all(req.user.id);
  res.json({
    assignments: rows.map(s => serializeShift(s, { attendance: db.prepare('SELECT id, clock_in, clock_out FROM attendance WHERE shift_id=? AND worker_id=?').get(s.id, req.user.id) ?? null })),
    history,
  });
}));

router.post('/clock-in', requireRole('worker'), wrap((req, res) => {
  const d = z.object({ token: z.string().min(10).max(200), ...coords }).parse(req.body);
  const shiftId = verifyQrToken(d.token);
  if (!shiftId) throw bad('Invalid or expired QR code');
  const shift = db.prepare('SELECT * FROM shifts WHERE id=?').get(shiftId);
  if (!shift) throw notFound('Shift not found');
  if (['Cancelled', 'Completed'].includes(shift.status)) throw conflict(`This shift is ${shift.status.toLowerCase()}`);
  const app = db.prepare("SELECT 1 FROM applications WHERE shift_id=? AND worker_id=? AND status='Accepted'").get(shiftId, req.user.id);
  if (!app) throw forbidden('You are not assigned to this shift');
  if (db.prepare('SELECT 1 FROM attendance WHERE shift_id=? AND worker_id=?').get(shiftId, req.user.id)) throw conflict('You have already clocked in to this shift');
  if (config.enforceTimeWindow) {
    const { start, end } = shiftWindow(shift), now = Date.now();
    if (now < start.getTime() - config.clockInEarlyMinutes * 60000) throw forbidden(`Clock-in opens ${config.clockInEarlyMinutes} minutes before the shift starts`);
    if (now > end.getTime() + 12 * 3600000) throw forbidden('The clock-in grace period has ended. Ask the business to correct the shift or record an attendance adjustment.');
  }
  const { distance } = geofence(shift, d.lat, d.lng);
  tx(() => {
    db.prepare('INSERT INTO attendance (shift_id, worker_id, clock_in, in_lat, in_lng, in_distance_m) VALUES (?,?,?,?,?,?)')
      .run(shiftId, req.user.id, new Date().toISOString(), d.lat ?? null, d.lng ?? null, distance);
    refreshShiftStatus(shiftId);
  })();
  audit(req, 'attendance.clock_in', 'shift', shiftId, distance != null ? `${distance} m from site` : 'no geofence');
  res.status(201).json({ ok: true, shift: pad('SFT', shiftId), distance_m: distance });
}));

router.post('/clock-out', requireRole('worker'), wrap((req, res) => {
  const d = z.object({ shift_id: z.coerce.number().int().min(1), ...coords }).parse(req.body);
  const att = db.prepare('SELECT * FROM attendance WHERE shift_id=? AND worker_id=?').get(d.shift_id, req.user.id);
  if (!att) throw notFound('You have not clocked in to this shift');
  if (att.clock_out) throw conflict('You have already clocked out');
  const shift = db.prepare('SELECT * FROM shifts WHERE id=?').get(d.shift_id);
  const { distance } = geofence(shift, d.lat, d.lng);
  const ts = tx(() => closeAttendance(att, shift, new Date(), { lat: d.lat, lng: d.lng, distance }))();
  audit(req, 'attendance.clock_out', 'shift', d.shift_id, `${ts.hours} h`);
  res.json({ ok: true, hours: ts.hours, amount: ts.amount, timesheet: pad('TS', ts.id) });
}));

// Business/admin: who is on site
router.get('/shift/:id', requireRole('business', 'admin'), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM shifts WHERE id=?').get(parseId(req.params.id));
  if (!s) throw notFound('Shift not found');
  if (req.user.role === 'business' && s.business_id !== req.user.id) throw forbidden();
  res.json({ attendance: db.prepare(`SELECT t.*, u.name FROM attendance t JOIN users u ON u.id=t.worker_id WHERE t.shift_id=?`).all(s.id) });
}));
