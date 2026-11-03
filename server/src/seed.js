// Loads demo data. Usage: node src/seed.js [--reset]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db } from './db.js';

const reset = process.argv.includes('--reset');
if (reset) {
  for (const t of ['audit_logs','notifications','disputes','kyc_documents','payments','timesheets','attendance','applications','shifts','workers','businesses','users','settings'])
    db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
} else if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  console.log('Database already has data. Use --reset to wipe and reseed.'); process.exit(0);
}

const PW = { business: 'Business@12345', worker: 'Worker@12345' };
const hash = Object.fromEntries(Object.entries(PW).map(([k, v]) => [k, bcrypt.hashSync(v, 10)]));
const iso = (days = 0, h = 0) => new Date(Date.now() + days * 86400000 + h * 3600000).toISOString();
const sqlTs = (days = 0, h = 0) => iso(days, h).slice(0, 19).replace('T', ' ');
const day = (n = 0) => { const d = new Date(Date.now() + config.tzOffsetMinutes * 60000 + n * 86400000); return d.toISOString().slice(0, 10); };

const user = (email, role, name, phone) => db.prepare('INSERT INTO users (email,password_hash,role,name,phone) VALUES (?,?,?,?,?)').run(email, hash[role], role, name, phone).lastInsertRowid;
const biz = (email, company, addr) => { const id = user(email, 'business', company, '+91 20 5550 01' + Math.floor(10 + Math.random() * 89)); db.prepare('INSERT INTO businesses VALUES (?,?,?)').run(id, company, addr); return id; };
const abc = biz('abc@hstaff.example', 'ABC Facilities', 'Hinjawadi Phase 1, Pune');
const xyz = biz('xyz@hstaff.example', 'XYZ Logistics', 'Kharadi, Pune');
const sec = biz('secure@hstaff.example', 'SecurePro', 'Viman Nagar, Pune');
// Name columns explicitly: additive migrations extend this table over time.
const wk = (email, name, skills, loc, rating, kyc) => { const id = user(email, 'worker', name, '+91 98765 0' + Math.floor(1000 + Math.random() * 8999)); db.prepare('INSERT INTO workers (user_id,skills,location,rating,kyc_status) VALUES (?,?,?,?,?)').run(id, skills, loc, rating, kyc); return id; };
const rohit = wk('rohit@hstaff.example', 'Rohit Kumar', 'Cleaning,General labour', 'Hinjawadi, Pune', 4.8, 'Verified');
const priya = wk('priya@hstaff.example', 'Priya Sharma', 'Warehouse,Packing', 'Kharadi, Pune', 4.7, 'Pending');
const amit = wk('amit@hstaff.example', 'Amit Patel', 'Security,Safety', 'Viman Nagar, Pune', 4.6, 'Verified');
const suresh = wk('suresh@hstaff.example', 'Suresh Yadav', 'Cleaning,Loading', 'Hadapsar, Pune', 4.5, 'Verified');

const shift = (b, title, skills, loc, lat, lng, d, st, et, n, rate, status, desc = '') =>
  Number(db.prepare('INSERT INTO shifts (business_id,title,description,skills,location,lat,lng,radius_m,date,start_time,end_time,workers_needed,rate,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b, title, desc, skills, loc, lat, lng, 250, d, st, et, n, rate, status).lastInsertRowid);
const apply = (s, w, status = 'Accepted') => db.prepare('INSERT INTO applications (shift_id,worker_id,status) VALUES (?,?,?)').run(s, w, status).lastInsertRowid;

// Live shifts (dates relative to today so the demo always looks current)
const s1 = shift(abc, 'Cleaner', 'Cleaning,General labour', 'Hinjawadi, Pune', 18.5912, 73.7389, day(0), '00:00', '23:59', 5, 150, 'Ongoing', 'General office cleaning. Own PPE provided.');
const s2 = shift(xyz, 'Warehouse Helper', 'Warehouse,Loading', 'Kharadi, Pune', 18.5515, 73.9404, day(1), '08:00', '16:00', 3, 160, 'Filled', 'Loading and sorting inbound parcels.');
const s3 = shift(xyz, 'Warehouse Staff', 'Warehouse,Packing', 'Hadapsar, Pune', 18.5018, 73.9259, day(2), '09:00', '18:00', 4, 160, 'Open', 'Pick and pack for e-commerce orders.');
const s4 = shift(sec, 'Security Guard', 'Security', 'Viman Nagar, Pune', 18.5679, 73.9143, day(3), '18:00', '02:00', 2, 170, 'Open', 'Night gate duty. Uniform provided.');
for (const w of [rohit, amit, suresh]) apply(s1, w);
apply(s1, priya, 'Applied');
for (const w of [rohit, amit, suresh]) apply(s2, w);
apply(s3, suresh);
db.prepare('INSERT INTO attendance (shift_id,worker_id,clock_in,in_lat,in_lng,in_distance_m) VALUES (?,?,?,?,?,?)').run(s1, suresh, iso(0, -3), 18.5914, 73.7391, 35);

// History: completed shifts, timesheets, payments
const done = (b, title, loc, d, workers, rate, hrs) => {
  const s = shift(b, title, '', loc, null, null, d, '09:00', '17:00', workers.length, rate, 'Completed');
  return { s, rows: workers.map(([w, st, h = hrs]) => {
    apply(s, w);
    const a = db.prepare('INSERT INTO attendance (shift_id,worker_id,clock_in,clock_out) VALUES (?,?,?,?)').run(s, w, iso(-1, -9), iso(-1, -9 + h)).lastInsertRowid;
    const t = db.prepare('INSERT INTO timesheets (shift_id,worker_id,attendance_id,hours,rate,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(s, w, a, h, rate, Math.round(h * rate), st, sqlTs(0, -2)).lastInsertRowid;
    return { t: Number(t), w, amount: Math.round(h * rate), st };
  }) };
};
const h1 = done(abc, 'Cleaner', 'Hinjawadi, Pune', day(-1), [[rohit, 'Pending'], [suresh, 'Approved']], 150, 8);
const h2 = done(xyz, 'Warehouse Helper', 'Kharadi, Pune', day(-4), [[amit, 'Paid', 7.5]], 160, 7.5);
const h3 = done(sec, 'Security Guard', 'Viman Nagar, Pune', day(-2), [[amit, 'Disputed']], 170, 8);
const pay = (b, r, status) => db.prepare('INSERT INTO payments (timesheet_id,business_id,worker_id,amount,status,paid_at,reference) VALUES (?,?,?,?,?,?,?)')
  .run(r.t, b, r.w, r.amount, status, status === 'Paid' ? sqlTs(-2) : null, status === 'Paid' ? 'UPI-DEMO-1042' : null);
pay(abc, h1.rows[1], 'Pending'); pay(xyz, h2.rows[0], 'Paid');

// Disputes
db.prepare('INSERT INTO disputes (timesheet_id,raised_by,subject,description,status) VALUES (?,?,?,?,?)').run(h3.rows[0].t, amit, 'Hours mismatch – TS-004', 'Business recorded 8h but I worked until 3 AM.', 'Open');
db.prepare('INSERT INTO disputes (raised_by,subject,description,status) VALUES (?,?,?,?)').run(abc, 'Payment issue', 'Invoice amount does not match our records.', 'In progress');

// KYC placeholder files (tiny valid PDFs)
const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const kyc = (w, type, status) => {
  const stored = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(config.uploadDir, stored), pdf);
  db.prepare('INSERT INTO kyc_documents (worker_id,doc_type,original_name,stored_name,mime,size,status,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(w, type, 'sample-document.pdf', stored, 'application/pdf', pdf.length, status, null, null);
};
for (const w of [rohit, amit, suresh]) kyc(w, 'Identity document', 'Verified');
kyc(priya, 'Identity document', 'Pending');

db.prepare('INSERT INTO audit_logs (action,entity,detail) VALUES (?,?,?)').run('system.seed', 'system', 'Demo data loaded');
db.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').run(abc, 'Priya Sharma applied for Cleaner (SFT-001).');
db.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').run(rohit, 'Your application for Cleaner (SFT-001) was accepted.');

console.log('Seeded Worker and User demo data. Create an administrator with `npm run create-admin --prefix server`.');
console.log('  business abc@hstaff.example     /', PW.business, '(also xyz@, secure@)');
console.log('  worker   rohit@hstaff.example   /', PW.worker, '(also priya@, amit@, suresh@)');
