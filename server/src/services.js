import { db } from './db.js';
import { config } from './config.js';
import { roundHours, notify, pad } from './util.js';

// Closes an attendance record and creates the timesheet. Hours/amount are always computed on the server.
export function closeAttendance(att, shift, when, out = {}) {
  const ms = Math.max(0, when.getTime() - new Date(att.clock_in).getTime());
  const hours = roundHours(ms);
  db.prepare('UPDATE attendance SET clock_out=?, out_lat=?, out_lng=?, out_distance_m=? WHERE id=?')
    .run(when.toISOString(), out.lat ?? null, out.lng ?? null, out.distance ?? null, att.id);
  const amount = Math.round(hours * shift.rate);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO timesheets (shift_id, worker_id, attendance_id, hours, rate, amount) VALUES (?,?,?,?,?,?)')
    .run(shift.id, att.worker_id, att.id, hours, shift.rate, amount);
  notify(shift.business_id, `Timesheet ${pad('TS', lastInsertRowid)} for ${shift.title} is ready for review.`);
  return { id: Number(lastInsertRowid), hours, amount };
}

export function refreshShiftStatus(shiftId) {
  const s = db.prepare('SELECT * FROM shifts WHERE id=?').get(shiftId);
  if (!s || ['Cancelled', 'Completed'].includes(s.status)) return;
  const accepted = db.prepare("SELECT COUNT(*) c FROM applications WHERE shift_id=? AND status='Accepted'").get(shiftId).c;
  const started = db.prepare('SELECT COUNT(*) c FROM attendance WHERE shift_id=?').get(shiftId).c;
  const status = started > 0 ? 'Ongoing' : accepted >= s.workers_needed ? 'Filled' : 'Open';
  if (status !== s.status) db.prepare('UPDATE shifts SET status=? WHERE id=?').run(status, shiftId);
}

export function createPaymentForTimesheet(ts) {
  const shift = db.prepare('SELECT business_id FROM shifts WHERE id=?').get(ts.shift_id);
  const fee = Math.round(ts.amount * config.platformFeePercent / 100);
  db.prepare('INSERT OR IGNORE INTO payments (timesheet_id, business_id, worker_id, amount, fee) VALUES (?,?,?,?,?)')
    .run(ts.id, shift.business_id, ts.worker_id, ts.amount, fee);
}
