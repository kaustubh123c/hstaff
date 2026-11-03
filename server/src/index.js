import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';
import { getSettings } from './routes/admin.js';
import { router as authRouter } from './routes/auth.js';
import { router as shiftsRouter, applicationsRouter } from './routes/shifts.js';
import { router as attendanceRouter } from './routes/attendance.js';
import { router as timesheetsRouter } from './routes/timesheets.js';
import { router as paymentsRouter, razorpayWebhook } from './routes/payments.js';
import { router as kycRouter } from './routes/kyc.js';
import { router as disputesRouter } from './routes/disputes.js';
import { router as adminRouter } from './routes/admin.js';
import { router as miscRouter } from './routes/misc.js';
import { router as onDemandRouter } from './routes/marketplace.js';
import { createPaymentForTimesheet } from './services.js';
import { notify, pad } from './util.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://accounts.google.com'], frameSrc: ["'self'", 'https://accounts.google.com'], connectSrc: ["'self'", 'https://accounts.google.com', 'https://www.googleapis.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https://*.gstatic.com'] } } }));
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '100kb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  // Vercel Cron (see vercel.json) calls this daily; it replaces the in-process timer that serverless cannot keep alive.
  app.get('/api/cron/auto-approve', (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ ok: true, approved: autoApproveTimesheets() });
  });
  app.post('/api/payments/razorpay-webhook', (req, res) => { void razorpayWebhook(req, res); });
  app.use('/api/auth', authRouter);
  app.use('/api/shifts', shiftsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/timesheets', timesheetsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/disputes', disputesRouter);
  app.use('/api', miscRouter); // keeps the public GET /api/meta ahead of routers that require sign-in
  app.use('/api', onDemandRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

  // Serve the built frontend in production
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
    app.use(express.static(config.distDir));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const msg = err.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ');
      return res.status(400).json({ error: msg, details: err.issues });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 5 MB)' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side' });
  });
  return app;
}

// Auto-approve timesheets the business has not reviewed within the configured window.
export function autoApproveTimesheets() {
  const hours = Number(getSettings().auto_approve_hours);
  if (!hours) return 0;
  const rows = db.prepare(`SELECT t.* FROM timesheets t WHERE t.status='Pending' AND t.created_at <= datetime('now', ?)`).all(`-${hours} hours`);
  for (const t of rows) {
    db.prepare("UPDATE timesheets SET status='Approved', decided_at=datetime('now') WHERE id=?").run(t.id);
    createPaymentForTimesheet(t);
    notify(t.worker_id, `Timesheet ${pad('TS', t.id)} was auto-approved after ${hours}h.`);
    db.prepare('INSERT INTO audit_logs (action, entity, entity_id, detail) VALUES (?,?,?,?)').run('timesheet.auto_approve', 'timesheet', String(t.id), `after ${hours}h`);
  }
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) console.log('Database is empty. Run `npm run seed` to load demo data.');
  createApp().listen(config.port, () => console.log(`H-Staff API listening on http://localhost:${config.port}`));
  setInterval(() => { try { autoApproveTimesheets(); } catch (e) { console.error(e); } }, 10 * 60 * 1000).unref();
}
