import { DatabaseSync } from 'node:sqlite'; // built into Node 22+, no native build step
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('worker','business','admin')),
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS businesses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  address TEXT
);
CREATE TABLE IF NOT EXISTS workers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skills TEXT NOT NULL DEFAULT '',
  location TEXT,
  rating REAL NOT NULL DEFAULT 0,
  kyc_status TEXT NOT NULL DEFAULT 'Not submitted' CHECK (kyc_status IN ('Not submitted','Pending','Verified','Rejected'))
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  skills TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  lat REAL, lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 200,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  start_time TEXT NOT NULL,      -- HH:MM
  end_time TEXT NOT NULL,        -- HH:MM (<= start means next day)
  workers_needed INTEGER NOT NULL CHECK (workers_needed BETWEEN 1 AND 100),
  rate INTEGER NOT NULL CHECK (rate > 0),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Filled','Ongoing','Completed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shifts_business ON shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status_date ON shifts(status, date);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Applied' CHECK (status IN ('Applied','Accepted','Rejected','Withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shift_id, worker_id)
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  in_lat REAL, in_lng REAL, in_distance_m REAL,
  out_lat REAL, out_lng REAL, out_distance_m REAL,
  UNIQUE (shift_id, worker_id)
);
CREATE TABLE IF NOT EXISTS timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  attendance_id INTEGER REFERENCES attendance(id),
  hours REAL NOT NULL,
  rate INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Disputed','Paid')),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shift_id, worker_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id INTEGER NOT NULL UNIQUE REFERENCES timesheets(id),
  business_id INTEGER NOT NULL REFERENCES users(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Paid')),
  reference TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payment_id INTEGER REFERENCES payments(id),
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payout_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_payout_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  amount INTEGER NOT NULL,
  reference TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kyc_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Rejected')),
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id INTEGER REFERENCES timesheets(id),
  raised_by INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In progress','Resolved')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Additive migrations keep existing SQLite installations usable.
for (const sql of [
  'ALTER TABLE workers ADD COLUMN lat REAL',
  'ALTER TABLE workers ADD COLUMN lng REAL',
  "ALTER TABLE workers ADD COLUMN available INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE shifts ADD COLUMN job_type TEXT NOT NULL DEFAULT 'scheduled'",
  'ALTER TABLE shifts ADD COLUMN start_otp_hash TEXT',
  'ALTER TABLE shifts ADD COLUMN finish_otp_hash TEXT',
  'ALTER TABLE shifts ADD COLUMN otp_verified_at TEXT',
  'ALTER TABLE shifts ADD COLUMN worker_lat REAL',
  'ALTER TABLE shifts ADD COLUMN worker_lng REAL',
]) { try { db.exec(sql); } catch (e) { if (!String(e.message).includes('duplicate column')) throw e; } }

// Usage: tx(() => { ... })()  — runs the body atomically; any throw rolls everything back.
export const tx = fn => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};


// Additive migrations keep existing SQLite databases usable after upgrades.
const paymentColumns = db.prepare('PRAGMA table_info(payments)').all().map(c => c.name);
const migrations = {
  collection_status: "TEXT NOT NULL DEFAULT 'unpaid'",
  razorpay_order_id: 'TEXT',
  razorpay_payment_id: 'TEXT',
  checkout_key: 'TEXT',
  collection_paid_at: 'TEXT',
  payout_status: "TEXT NOT NULL DEFAULT 'not_started'",
  payout_reference: 'TEXT',
  payout_updated_at: 'TEXT',
};
for (const [name, type] of Object.entries(migrations)) {
  if (!paymentColumns.includes(name)) db.exec(`ALTER TABLE payments ADD COLUMN ${name} ${type}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_collection ON payments(collection_status)');

// Marketplace lifecycle tables are additive so existing SQLite databases and history survive upgrades.
db.exec(`
CREATE TABLE IF NOT EXISTS job_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('start','finish')), code_hash TEXT NOT NULL, code_ciphertext TEXT, delivery_status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(shift_id,purpose)
);
CREATE TABLE IF NOT EXISTS job_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  business_id INTEGER NOT NULL REFERENCES users(id), worker_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  business_id INTEGER NOT NULL REFERENCES users(id), worker_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount>0), fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid', razorpay_order_id TEXT UNIQUE, razorpay_payment_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_otps (
  phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, requested_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_locations (
  shift_id INTEGER PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const verificationColumns = db.prepare('PRAGMA table_info(job_verifications)').all().map(c => c.name);
if (!verificationColumns.includes('code_ciphertext')) db.exec('ALTER TABLE job_verifications ADD COLUMN code_ciphertext TEXT');
if (!verificationColumns.includes('delivery_status')) db.exec("ALTER TABLE job_verifications ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'");
const shiftColumns = db.prepare('PRAGMA table_info(shifts)').all().map(c => c.name);
if (!shiftColumns.includes('completion_requested_at')) db.exec('ALTER TABLE shifts ADD COLUMN completion_requested_at TEXT');
for (const [name, type] of Object.entries({ phone: 'TEXT' })) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
}
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_active ON shifts(job_type,status,date)');
