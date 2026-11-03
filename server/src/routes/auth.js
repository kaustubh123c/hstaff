import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db, tx } from '../db.js';
import { signToken, authenticate } from '../auth.js';
import { wrap, bad, conflict, audit, HttpError, sendSms } from '../util.js';
import { config } from '../config.js';
import { verifyGoogleIdentityToken } from '../google-auth.js';
import { createAdminAccount } from '../admin-provision.js';

export const router = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 500 : 50, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' } });

const password = z.string().min(8, 'Password must be at least 8 characters').max(100);
const phoneSchema = z.string().trim().regex(/^\+?[1-9]\d{9,14}$/, 'Enter a phone number with country code');
const otpHash = (phone, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');
const registerSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('worker'), name: z.string().trim().min(2).max(80), email: z.string().trim().email(), password,
    phone: z.string().trim().max(20).optional(), skills: z.string().trim().max(200).optional(), location: z.string().trim().max(120).optional() }),
  z.object({ role: z.literal('user'), name: z.string().trim().min(2).max(80), email: z.string().trim().email(), password,
    phone: z.string().trim().max(20).optional() }),
]);

// Keep the established database/API role for existing business records while
// presenting the public marketplace role as User in new registration flows.
const databaseRole = role => role === 'user' ? 'business' : role;

// Phone OTP login/registration. New accounts can only be worker or business; admin provisioning remains controlled.
router.post('/otp/request', limiter, wrap(async (req, res) => {
  const d = z.object({ phone: phoneSchema, role: z.enum(['worker','user']).optional(), name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email().optional(), skills: z.string().trim().max(200).optional(), location: z.string().trim().max(120).optional() }).parse(req.body);
  const localOtp = config.devOtpEnabled;
  if (!localOtp && !config.otpSmsConfigured) throw new HttpError(503, 'SMS delivery is unavailable. Configure Twilio account SID, auth token and sender in server/.env, then restart. For local development only, set NODE_ENV=development and DEV_OTP_ENABLED=true. No SMS was sent and no code was issued.');
  const phone = d.phone.startsWith('+') ? d.phone : `+${d.phone}`;
  if(db.prepare('SELECT count(*) n FROM users WHERE phone=?').get(phone).n>1) throw conflict('This phone number is linked to multiple accounts. Contact support to resolve it.');
  const recent = db.prepare('SELECT requested_at FROM auth_otps WHERE phone=?').get(phone);
  // The resend cooldown protects real SMS delivery only. Locally generated
  // codes send no message and leave requested_at empty, while the route-level
  // limiter and verification attempt cap still apply.
  if (!localOtp && recent?.requested_at && Date.now() - new Date(`${recent.requested_at.replace(' ','T')}Z`).getTime() < 60000) throw conflict('Please wait one minute before requesting another code.');
  const code = String(crypto.randomInt(100000, 1000000));
  const expires = new Date(Date.now() + config.otpTtlSeconds * 1000).toISOString().slice(0,19).replace('T',' ');
  // Development OTP is local-only even when Twilio credentials happen to be
  // present. Production always takes the SMS path and never returns the code.
  const delivered = localOtp ? false : await sendSms(phone, `Your H-Staff sign-in code is ${code}. It expires in ${Math.ceil(config.otpTtlSeconds/60)} minutes.`);
  const requestedAt = delivered ? "datetime('now')" : "''";
  db.prepare(`INSERT INTO auth_otps(phone,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,0,${requestedAt})
    ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at`).run(phone, otpHash(phone, code), expires);
  res.json({ ok: true, expires_in: config.otpTtlSeconds, ...(localOtp ? { development_otp: code } : {}), delivery: localOtp ? 'development' : 'sms' });
}));

router.post('/otp/verify', limiter, wrap(async (req, res) => {
  const d = z.object({ phone: phoneSchema, otp: z.string().regex(/^\d{6}$/), role: z.enum(['worker','user']).optional(), name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email().optional(), skills: z.string().trim().max(200).optional(), location: z.string().trim().max(120).optional() }).parse(req.body);
  const phone = d.phone.startsWith('+') ? d.phone : `+${d.phone}`;
  const row = db.prepare('SELECT * FROM auth_otps WHERE phone=?').get(phone);
  if (!row || row.consumed_at || new Date(`${row.expires_at.replace(' ','T')}Z`).getTime() <= Date.now()) throw new HttpError(400, 'The code is invalid or expired. Request a new code.');
  if (row.attempts >= 5) throw new HttpError(429, 'Too many incorrect codes. Request a new code.');
  const actual = Buffer.from(row.code_hash, 'hex'), expected = Buffer.from(otpHash(phone, d.otp), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    db.prepare('UPDATE auth_otps SET attempts=attempts+1 WHERE phone=?').run(phone);
    throw new HttpError(400, 'The code is incorrect.');
  }
  const result = tx(() => {
    const current = db.prepare('SELECT * FROM auth_otps WHERE phone=?').get(phone);
    if (!current || current.attempts >= 5 || current.code_hash !== row.code_hash || new Date(`${current.expires_at.replace(' ','T')}Z`).getTime() <= Date.now()) throw conflict('The code is no longer valid. Request a new code.');
    db.prepare('DELETE FROM auth_otps WHERE phone=?').run(phone);
    let user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    let created = false;
    if (!user) {
      if (!d.role) throw bad('Choose Worker or User to create your account.');
      const email = d.email || `${phone.replace(/\D/g,'')}@phone.hstaff.local`;
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw conflict('That email is already in use. Sign in with the existing account.');
      const role = databaseRole(d.role);
      const id = db.prepare("INSERT INTO users(email,password_hash,role,name,phone) VALUES(?,? ,?,?,?)").run(email, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), role, d.name ?? (role === 'worker' ? 'Worker profile' : 'User profile'), phone).lastInsertRowid;
      if (role === 'worker') db.prepare('INSERT INTO workers(user_id,skills,location) VALUES(?,?,?)').run(id,d.skills ?? '',d.location ?? null);
      else db.prepare('INSERT INTO businesses(user_id,company) VALUES(?,?)').run(id,d.company ?? d.name ?? 'User');
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      created = true;
    }
    if (user.role === 'admin') throw new HttpError(403, 'Administrators must sign in with their provisioned email and password.');
    if (user.status !== 'Active') throw new HttpError(403, 'This account is suspended');
    return { user, created };
  })();
  req.user = result.user;
  audit(req, result.created ? 'auth.phone_register' : 'auth.phone_otp', 'user', result.user.id);
  const onboardingIncomplete = ['Worker profile','User profile'].includes(result.user.name);
  res.json({ token: signToken(result.user), user: publicUser(result.user.id), ...(result.created || onboardingIncomplete ? { created: true } : {}) });
}));

export function publicUser(id) {
  const u = db.prepare('SELECT id, email, role, name, phone, status, created_at FROM users WHERE id=?').get(id);
  if (u.role === 'business') u.profile = db.prepare('SELECT company, address FROM businesses WHERE user_id=?').get(id);
  if (u.role === 'worker') u.profile = db.prepare('SELECT skills, location, rating, kyc_status, available FROM workers WHERE user_id=?').get(id);
  return u;
}

router.post('/register', limiter, wrap(async (req, res) => {
  const d = registerSchema.parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(d.email)) throw conflict('An account with this email already exists');
  const phone=d.phone ? (d.phone.startsWith('+')?d.phone:`+${d.phone}`) : null;
  if(phone&&db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw conflict('This phone number is already linked to an account. Sign in with mobile OTP.');
  const hash = await bcrypt.hash(d.password, 12);
  const id = tx(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash, role, name, phone) VALUES (?,?,?,?,?)')
    .run(d.email, hash, databaseRole(d.role), d.name, phone);
    if (databaseRole(d.role) === 'worker') db.prepare('INSERT INTO workers (user_id, skills, location) VALUES (?,?,?)').run(lastInsertRowid, d.skills ?? '', d.location ?? null);
    else db.prepare('INSERT INTO businesses (user_id, company, address) VALUES (?,?,?)').run(lastInsertRowid, d.company ?? d.name, d.address ?? null);
    return Number(lastInsertRowid);
  })();
  req.user = { id };
  audit(req, 'auth.register', 'user', id, d.role);
  res.status(201).json({ token: signToken({ id, role: databaseRole(d.role) }), user: publicUser(id) });
}));

// Local presentation setup only. This endpoint is disabled outside explicit
// development mode and refuses requests that do not originate on this machine.
router.post('/admin/register', limiter, wrap(async (req, res) => {
  const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  if (!config.devAdminRegistrationEnabled || !localAddresses.has(req.socket.remoteAddress)) {
    throw new HttpError(404, 'Admin self-registration is unavailable.');
  }
  const d = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), password: z.string().min(12).max(100) }).parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(d.email)) throw conflict('An account with this email already exists.');
  const id = await createAdminAccount(db, d, { source: 'development Admin sign-up page' });
  res.status(201).json({ ok: true, user: { id, name: d.name, email: d.email, role: 'admin' } });
}));

// Google can create/retrieve User accounts; Admin is allowed only for an
// already provisioned account. The client-provided intent never grants a role.
router.post('/google', limiter, wrap(async (req, res) => {
  const d = z.object({ credential: z.string().min(100).max(8192), intent: z.enum(['user','worker','admin']) }).parse(req.body);
  const identity = await verifyGoogleIdentityToken(d.credential);
  const result = tx(() => {
    const bySubject = db.prepare('SELECT * FROM users WHERE google_sub=?').get(identity.sub);
    const byEmail = db.prepare('SELECT * FROM users WHERE email=?').get(identity.email);
    if (bySubject && byEmail && bySubject.id !== byEmail.id) throw new HttpError(409, 'This Google identity and email are associated with different accounts. Contact support.');
    let user = bySubject || byEmail;
    let created = false;
    if (d.intent === 'admin') {
      if (!user || user.role !== 'admin') throw new HttpError(403, 'Google sign-in is available only to an existing authorized administrator account.');
    } else if (user?.role === 'admin') {
      throw new HttpError(403, 'Use the separate Admin sign-in option for this administrator account.');
    } else if (user && user.role !== databaseRole(d.intent)) {
      throw new HttpError(403, `This Google account belongs to a ${user.role === 'worker' ? 'Worker' : 'User'} account. Choose the matching account type.`);
    }
    if (user?.google_sub && user.google_sub !== identity.sub) throw new HttpError(409, 'This account is linked to a different Google identity. Contact support.');
    if (!user) {
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
      const dbRole = databaseRole(d.intent);
      const id = Number(db.prepare('INSERT INTO users(email,password_hash,role,name,google_sub) VALUES(?,?,?,?,?)')
        .run(identity.email, passwordHash, dbRole, identity.name, identity.sub).lastInsertRowid);
      if (dbRole === 'worker') db.prepare('INSERT INTO workers(user_id,skills,location) VALUES(?,?,?)').run(id, '', null);
      else db.prepare('INSERT INTO businesses(user_id,company) VALUES(?,?)').run(id, identity.name);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      created = true;
    } else if (!user.google_sub) {
      db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(identity.sub, user.id);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    }
    if (user.status !== 'Active') throw new HttpError(403, 'This account is suspended');
    return { user, created };
  })();
  req.user = result.user;
  audit(req, result.created ? 'auth.google_register' : 'auth.google_login', 'user', result.user.id, result.user.role);
  res.json({ token: signToken(result.user), user: publicUser(result.user.id), ...(result.created ? { created: true } : {}) });
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { email, password: pw } = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(req.body);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Compare against a dummy hash when user is missing to keep timing similar.
  const ok = await bcrypt.compare(pw, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!u || !ok) throw new HttpError(401, 'Incorrect email or password');
  if (u.status !== 'Active') throw new HttpError(403, 'This account is suspended');
  req.user = u;
  audit(req, 'auth.login', 'user', u.id);
  res.json({ token: signToken(u), user: publicUser(u.id) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user.id) }));

router.put('/me', authenticate, wrap(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email().optional(), phone: z.string().trim().max(20).optional(),
    skills: z.string().trim().max(200).optional(), location: z.string().trim().max(120).optional(),
    company: z.string().trim().min(2).max(120).optional(), address: z.string().trim().max(200).optional(),
  }).parse(req.body);
  if (d.email && db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(d.email, req.user.id)) throw conflict('That email is already in use.');
  tx(() => {
    if (d.name || d.phone !== undefined || d.email) db.prepare('UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone) WHERE id=?').run(d.name ?? null, d.email ?? null, d.phone ?? null, req.user.id);
    if (req.user.role === 'worker') db.prepare('UPDATE workers SET skills=COALESCE(?,skills), location=COALESCE(?,location) WHERE user_id=?').run(d.skills ?? null, d.location ?? null, req.user.id);
    if (req.user.role === 'business') db.prepare("UPDATE businesses SET company=CASE WHEN ? IS NOT NULL THEN ? WHEN company='User' THEN ? ELSE company END, address=COALESCE(?,address) WHERE user_id=?")
      .run(d.company ?? null, d.company ?? null, d.name ?? null, d.address ?? null, req.user.id);
  })();
  audit(req, 'profile.update', 'user', req.user.id);
  res.json({ user: publicUser(req.user.id) });
}));

router.post('/change-password', authenticate, limiter, wrap(async (req, res) => {
  const d = z.object({ current: z.string().min(1), next: password }).parse(req.body);
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!(await bcrypt.compare(d.current, u.password_hash))) throw bad('Current password is incorrect');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(d.next, 12), req.user.id);
  audit(req, 'auth.password_change', 'user', req.user.id);
  res.json({ ok: true });
}));
