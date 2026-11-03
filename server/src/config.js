import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load server/.env if present (Node 20.12+ built-in loader). Real environment variables win.
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env file */ }
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Secrets: use env vars if provided, otherwise generate once and keep on disk.
function persistentSecret(name, envValue) {
  if (envValue) return envValue;
  const file = path.join(dataDir, `.${name}`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const value = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export const config = {
  root,
  port: Number(process.env.PORT || 4000),
  isProd: process.env.NODE_ENV === 'production',
  devOtpEnabled: ['development','test'].includes(process.env.NODE_ENV) && process.env.DEV_OTP_ENABLED === 'true',
  devAdminRegistrationEnabled: process.env.NODE_ENV === 'development' && process.env.DEV_ADMIN_REGISTRATION_ENABLED === 'true',
  dbFile: process.env.DB_FILE || path.join(dataDir, 'hstaff.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(dataDir, 'uploads'),
  jwtSecret: persistentSecret('jwt_secret', process.env.JWT_SECRET),
  qrSecret: persistentSecret('qr_secret', process.env.QR_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  distDir: path.resolve(root, '..', process.env.WEB_DIST_DIR || '.hstaff-build'),
  // Business rules
  requireKycToApply: (process.env.REQUIRE_KYC_TO_APPLY ?? 'true') === 'true',
  enforceTimeWindow: (process.env.ENFORCE_TIME_WINDOW ?? 'true') === 'true',
  tzOffsetMinutes: Number(process.env.TZ_OFFSET_MINUTES ?? 330), // IST
  clockInEarlyMinutes: Number(process.env.CLOCK_IN_EARLY_MINUTES ?? 30),
  defaultGeofenceMeters: Number(process.env.DEFAULT_GEOFENCE_METERS ?? 200),
  demoMode: (process.env.DEMO_MODE ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  platformFeePercent: Math.min(30, Math.max(0, Number(process.env.PLATFORM_FEE_PERCENT ?? 10))),
  otpTtlSeconds: Math.min(600, Math.max(60, Number(process.env.OTP_TTL_SECONDS || 300))),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
  otpSmsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
};
fs.mkdirSync(config.uploadDir, { recursive: true });
