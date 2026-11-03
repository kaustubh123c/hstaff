import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = m => new HttpError(400, m);
export const forbidden = (m = 'You do not have access to this resource') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = m => new HttpError(409, m);

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const pad = (prefix, id) => `${prefix}-${String(id).padStart(3, '0')}`;
export const parseId = v => {
  const n = Number(String(v).replace(/^[A-Za-z]+-/, ''));
  if (!Number.isInteger(n) || n < 1) throw bad('Invalid id');
  return n;
};

export function audit(req, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?)')
    .run(req?.user?.id ?? null, action, entity ?? null, entityId != null ? String(entityId) : null,
      detail ?? null, req?.ip ?? null);
}
export function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?,?)').run(userId, message);
}

export async function sendSms(to, body) {
  if (!config.otpSmsConfigured) {
    if (!config.devOtpEnabled) throw new HttpError(503, 'SMS delivery is not configured. Configure Twilio credentials before requesting OTPs.');
    return false;
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (config.twilioMessagingServiceSid) form.set('MessagingServiceSid', config.twilioMessagingServiceSid);
  else form.set('From', config.twilioFromNumber);
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  let response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
  } catch {
    throw new HttpError(502, 'Could not reach the SMS provider. Check server connectivity and try again.');
  }
  if (!response.ok) throw new HttpError(502, 'SMS provider could not send the verification code. Try again later.');
  return true;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Shift start/end as absolute Date objects, interpreting date/time in the configured timezone.
export function shiftWindow(shift) {
  const [y, m, d] = shift.date.split('-').map(Number);
  const [sh, sm] = shift.start_time.split(':').map(Number);
  const [eh, em] = shift.end_time.split(':').map(Number);
  const off = config.tzOffsetMinutes * 60000;
  const start = new Date(Date.UTC(y, m - 1, d, sh, sm) - off);
  let end = new Date(Date.UTC(y, m - 1, d, eh, em) - off);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

// Signed QR payload: shiftId.expiresAtMs.hmac (verified server-side only).
// Keep the QR usable through a 12-hour post-shift grace period for real-world delays.
// Clock-in has a matching grace window; this does not bypass assignment or GPS checks.
export function makeQrToken(shift) {
  const { end } = shiftWindow(shift);
  const exp = end.getTime() + 12 * 3600000;
  const body = `${shift.id}.${exp}`;
  const sig = crypto.createHmac('sha256', config.qrSecret).update(body).digest('base64url').slice(0, 22);
  return `HS1.${body}.${sig}`;
}
export function verifyQrToken(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'HS1') return null;
  const [, idText, expText, sig] = parts;
  // Reject malformed numeric fields before signature verification or database access.
  if (!/^\d+$/.test(idText) || !/^\d+$/.test(expText) || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return null;
  const id = Number(idText);
  const exp = Number(expText);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(exp) || exp <= 0) return null;
  const expected = crypto.createHmac('sha256', config.qrSecret).update(`${idText}.${expText}`).digest('base64url').slice(0, 22);
  const actualBytes = Buffer.from(sig);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
  if (Date.now() > exp) return null;
  return id;
}

export const roundHours = ms => Math.round((ms / 3600000) * 4) / 4; // nearest 15 min

// ---- serializers -----------------------------------------------------------
export function serializeShift(s, extra = {}) {
  const filled = db.prepare("SELECT COUNT(*) c FROM applications WHERE shift_id=? AND status='Accepted'").get(s.id).c;
  return {
    id: s.id, code: pad('SFT', s.id), title: s.title, description: s.description,
    skills: s.skills ? s.skills.split(',').map(x => x.trim()).filter(Boolean) : [],
    business: s.company ?? undefined, business_id: s.business_id,
    location: s.location, lat: s.lat, lng: s.lng, radius_m: s.radius_m,
    date: s.date, start_time: s.start_time, end_time: s.end_time,
    workers_needed: s.workers_needed, workers_filled: filled,
    rate: s.rate, status: s.status, job_type: s.job_type ?? 'scheduled', ...extra,
  };
}
export const SHIFT_SELECT = `SELECT s.*, b.company FROM shifts s JOIN businesses b ON b.user_id = s.business_id`;
