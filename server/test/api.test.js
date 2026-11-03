import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createAdminAccount } from '../src/admin-provision.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-'));
process.env.NODE_ENV = 'test'; process.env.DEV_OTP_ENABLED = 'true'; process.env.DATA_DIR = dir; process.env.DB_FILE = path.join(dir, 't.db'); process.env.UPLOAD_DIR = path.join(dir, 'up');
process.env.ENFORCE_TIME_WINDOW = 'false';
process.env.RAZORPAY_KEY_ID='rzp_test_local'; process.env.RAZORPAY_KEY_SECRET='test_secret_for_mock'; process.env.RAZORPAY_WEBHOOK_SECRET='webhook_secret_for_mock';
process.env.GOOGLE_CLIENT_ID='hstaff-test-client.apps.googleusercontent.com';
process.argv.push('--reset');

let server, base, database;
const { privateKey: googlePrivateKey, publicKey: googlePublicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleJwk = { ...googlePublicKey.export({ format: 'jwk' }), kid: 'hstaff-test-key', alg: 'RS256', use: 'sig' };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url).includes('www.googleapis.com/oauth2/v3/certs')
  ? Promise.resolve(new Response(JSON.stringify({ keys: [googleJwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }))
  : nativeFetch(url, options);
before(async () => {
  ({ db: database } = await import('../src/db.js'));
  await import('../src/seed.js');
  assert.equal(database.prepare("SELECT 1 FROM users WHERE role='admin'").get(), undefined, 'demo seed must not create a known-password administrator');
  await createAdminAccount(database, { name: 'Test Administrator', email: 'test-admin@example.test', password: 'TestAdminPassword!123' });
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0); base = `http://localhost:${server.address().port}/api`;
});
after(() => { server.close(); database?.close(); globalThis.fetch = nativeFetch; fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, token, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (email, pw) => (await call('POST', '/auth/login', null, { email, password: pw })).body.token;
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const googleToken = (claims = {}, signingKey = googlePrivateKey, options = {}) => jwt.sign({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID,
  sub: 'google-subject-default', email: 'google-user@example.test', email_verified: true, hd: 'example.test', name: 'Google User', ...claims },
  signingKey, { algorithm: 'RS256', keyid: 'hstaff-test-key', expiresIn: '5m', ...options });

test('Google identity verifies signature, audience and verified email before assigning ordinary User access', async () => {
  const token = googleToken();
  const created = await call('POST', '/auth/google', null, { credential: token, intent: 'user', role: 'admin' });
  assert.equal(created.status, 200); assert.equal(created.body.user.role, 'business'); assert.equal(created.body.created, true);
  const record = database.prepare('SELECT google_sub,password_hash FROM users WHERE id=?').get(created.body.user.id);
  assert.equal(record.google_sub, 'google-subject-default'); assert.notEqual(record.password_hash, '');
  const existing = await call('POST', '/auth/google', null, { credential: token, intent: 'user' });
  assert.equal(existing.status, 200); assert.equal(existing.body.user.id, created.body.user.id); assert.equal(existing.body.created, undefined);

  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({ aud: 'wrong-client' }), intent: 'user' })).status, 401);
  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({ email_verified: false }), intent: 'user' })).status, 401);
  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({ email: 'external@example.net', hd: undefined }), intent: 'user' })).status, 401);
  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), intent: 'user' })).status, 401);
  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({}, googlePrivateKey, { expiresIn: '-10s' }), intent: 'user' })).status, 401);
  assert.equal((await call('POST', '/auth/google', null, { credential: googleToken({ email: 'rohit@hstaff.example', sub: 'worker-google-sub' }), intent: 'user' })).status, 403);
});

test('Google Admin sign-in requires a previously provisioned Admin and links stable subject', async () => {
  const denied = await call('POST', '/auth/google', null, { credential: googleToken({ sub: 'unknown-admin-sub', email: 'new-admin@example.test' }), intent: 'admin' });
  assert.equal(denied.status, 403); assert.equal(database.prepare('SELECT 1 FROM users WHERE email=?').get('new-admin@example.test'), undefined);
  const token = googleToken({ sub: 'authorized-admin-sub', email: 'test-admin@example.test', name: 'Test Administrator' });
  const authorized = await call('POST', '/auth/google', null, { credential: token, intent: 'admin' });
  assert.equal(authorized.status, 200); assert.equal(authorized.body.user.role, 'admin');
  assert.equal((await call('GET', '/admin/reports', authorized.body.token)).status, 200);
  assert.equal((await call('POST', '/auth/google', null, { credential: token, intent: 'user' })).status, 403);
});

test('Google can register and sign in as Worker without granting cross-role or Admin access', async () => {
  const credential = googleToken({ sub: 'google-worker-subject', email: 'google-worker@example.test', name: 'Google Worker' });
  const created = await call('POST', '/auth/google', null, { credential, intent: 'worker' });
  assert.equal(created.status, 200); assert.equal(created.body.created, true); assert.equal(created.body.user.role, 'worker');
  const workerProfile = database.prepare('SELECT skills,location FROM workers WHERE user_id=?').get(created.body.user.id);
  assert.equal(workerProfile.skills, ''); assert.equal(workerProfile.location, null);
  const profile = await call('PUT', '/auth/me', created.body.token, { name: 'Google Worker', skills: 'Cleaning', location: 'Pune' });
  assert.equal(profile.status, 200); assert.equal(profile.body.user.profile.skills, 'Cleaning');
  const existing = await call('POST', '/auth/google', null, { credential, intent: 'worker' });
  assert.equal(existing.status, 200); assert.equal(existing.body.created, undefined); assert.equal(existing.body.user.id, created.body.user.id);
  assert.equal((await call('POST', '/auth/google', null, { credential, intent: 'user' })).status, 403);
  assert.equal((await call('POST', '/auth/google', null, { credential, intent: 'admin' })).status, 403);
  assert.equal(database.prepare('SELECT role FROM users WHERE id=?').get(created.body.user.id).role, 'worker');
});

test('auth: bad password and missing token are rejected', async () => {
  assert.equal((await call('POST', '/auth/login', null, { email: 'abc@hstaff.example', password: 'nope' })).status, 401);
  assert.equal((await call('GET', '/shifts')).status, 401);
});

test('phone OTP creates and authenticates a worker without disclosing codes outside development', async () => {
  const phone='+919876500123';
  const issued=await call('POST','/auth/otp/request',null,{phone,role:'worker'});
  assert.equal(issued.status,200); assert.equal(typeof issued.body.development_otp,'string');
  const verified=await call('POST','/auth/otp/verify',null,{phone,otp:issued.body.development_otp,role:'worker'});
  assert.equal(verified.status,200); assert.equal(verified.body.user.role,'worker'); assert.equal(verified.body.created,true);
  const profile=await call('PUT','/auth/me',verified.body.token,{name:'OTP Worker',skills:'Cleaning',location:'Pune'});
  assert.equal(profile.body.user.name,'OTP Worker'); assert.equal(profile.body.user.profile.skills,'Cleaning');
  const form=new FormData(); form.append('doc_type','Identity document'); form.append('file',new Blob([Buffer.from('%PDF-1.4\nidentity')],{type:'application/pdf'}),'identity.pdf');
  const upload=await fetch(base+'/kyc',{method:'POST',headers:{authorization:`Bearer ${verified.body.token}`},body:form});
  assert.equal(upload.status,201); assert.equal((await call('GET','/kyc/mine',verified.body.token)).body.status,'Pending');
  assert.equal((await call('POST','/auth/otp/verify',null,{phone,otp:issued.body.development_otp})).status,400);
  const attacked=await call('POST','/auth/otp/request',null,{phone:'+919876500124',role:'worker',name:'OTP Limit'});
  for(let i=0;i<5;i++) assert.equal((await call('POST','/auth/otp/verify',null,{phone:'+919876500124',otp:'000000',role:'worker',name:'OTP Limit'})).status,400);
  assert.equal((await call('POST','/auth/otp/verify',null,{phone:'+919876500124',otp:attacked.body.development_otp,role:'worker',name:'OTP Limit'})).status,429);
});

test('public User registration maps to the preserved business record and admin is not a public role', async () => {
  const phone='+919876500125';
  const issued=await call('POST','/auth/otp/request',null,{phone,role:'user'});
  const verified=await call('POST','/auth/otp/verify',null,{phone,otp:issued.body.development_otp,role:'user'});
  assert.equal(verified.status,200); assert.equal(verified.body.user.role,'business'); assert.equal(verified.body.created,true);
  const completedProfile=await call('PUT','/auth/me',verified.body.token,{name:'Local User',email:'local-user@example.com'});
  assert.equal(completedProfile.body.user.name,'Local User'); assert.equal(completedProfile.body.user.profile.company,'Local User');
  const emailUser=await call('POST','/auth/register',null,{role:'user',name:'Email User',email:'email-user@example.com',password:'Passw0rd!x'});
  assert.equal(emailUser.status,201); assert.equal(emailUser.body.user.role,'business');
  assert.equal((await call('POST','/auth/login',null,{email:'email-user@example.com',password:'Passw0rd!x'})).status,200);
  assert.equal((await call('POST','/auth/register',null,{role:'admin',name:'Admin',email:'bad-admin@example.com',password:'Passw0rd!x'})).status,400);
  assert.equal((await call('POST','/auth/register',null,{role:'business',name:'Legacy public business',email:'legacy-public@example.com',password:'Passw0rd!x',company:'Legacy'})).status,400);
  const adminPhone='+919876500127'; database.prepare('UPDATE users SET phone=? WHERE email=?').run(adminPhone,'test-admin@example.test');
  const adminOtp=await call('POST','/auth/otp/request',null,{phone:adminPhone});
  assert.equal((await call('POST','/auth/otp/verify',null,{phone:adminPhone,otp:adminOtp.body.development_otp})).status,403);
  assert.equal((await call('POST','/auth/login',null,{email:'test-admin@example.test',password:'TestAdminPassword!123'})).status,200);
});

test('administrator provisioning is private, hashes passwords, and never overwrites existing accounts', async () => {
  assert.equal((await call('POST', '/auth/admin/register', null, { name: 'Public Admin', email: 'public-admin@example.test', password: 'NotAllowedPassword!123' })).status, 404, 'development Admin self-registration stays disabled in tests unless explicitly enabled');
  assert.equal((await call('POST', '/auth/register', null, { role: 'admin', name: 'Public Admin', email: 'public-admin@example.test', password: 'NotAllowedPassword!123' })).status, 400);
  const admin = database.prepare('SELECT password_hash,role FROM users WHERE email=?').get('test-admin@example.test');
  assert.equal(admin.role, 'admin'); assert.notEqual(admin.password_hash, 'TestAdminPassword!123');
  await assert.rejects(createAdminAccount(database, { name: 'Replacement Admin', email: 'test-admin@example.test', password: 'AnotherPassword!123' }), /already belongs/);
  assert.equal(database.prepare('SELECT name FROM users WHERE email=?').get('test-admin@example.test').name, 'Test Administrator');
  const token = await login('test-admin@example.test', 'TestAdminPassword!123');
  assert.equal((await call('GET', '/admin/reports', token)).status, 200);
});

test('roles are enforced', async () => {
  const worker = await login('rohit@hstaff.example', 'Worker@12345');
  const biz = await login('abc@hstaff.example', 'Business@12345');
  assert.equal((await call('POST', '/shifts', worker, {})).status, 403);
  assert.equal((await call('GET', '/admin/audit-logs', biz)).status, 403);
  // a business cannot touch another business's shift
  const other = await login('xyz@hstaff.example', 'Business@12345');
  assert.equal((await call('POST', '/shifts/1/cancel', other)).status, 403);
});

test('admin operations workspaces expose protected records and persist settings', async () => {
  const admin = await login('test-admin@example.test', 'TestAdminPassword!123');
  const worker = await login('rohit@hstaff.example', 'Worker@12345');
  for (const [url, key] of [['/workers','workers'], ['/businesses','businesses'], ['/jobs/mine','jobs'], ['/payments','payments'], ['/disputes','disputes'], ['/kyc','documents'], ['/admin/audit-logs','logs']]) {
    const result = await call('GET', url, admin);
    assert.equal(result.status, 200, `${url}: ${JSON.stringify(result.body)}`);
    assert.ok(Array.isArray(result.body[key]), `${url} should return ${key}`);
  }
  const report = await call('GET', '/admin/reports', admin);
  assert.equal(report.status, 200); assert.ok(report.body.totals);
  const saved = await call('PUT', '/admin/settings', admin, { support_email: 'ops@example.com', auto_approve_hours: 36 });
  assert.equal(saved.status, 200); assert.equal(saved.body.settings.support_email, 'ops@example.com');
  assert.equal((await call('GET', '/admin/settings', admin)).body.settings.auto_approve_hours, '36');
  assert.equal((await call('GET', '/businesses', worker)).status, 403);
  assert.equal((await call('GET', '/admin/reports', worker)).status, 403);
});

test('full lifecycle: register → KYC → apply → accept → clock in/out → approve → pay', async () => {
  const reg = await call('POST', '/auth/register', null, { role: 'worker', name: 'Test Worker', email: 'tw@example.com', password: 'Passw0rd!x', skills: 'Cleaning' });
  assert.equal(reg.status, 201);
  const w = reg.body.token;
  assert.equal((await call('POST', '/auth/register', null, { role: 'worker', name: 'Dup', email: 'TW@example.com', password: 'Passw0rd!x' })).status, 409);

  const biz = await login('abc@hstaff.example', 'Business@12345');
  const created = await call('POST', '/shifts', biz, { title: 'Test Shift', location: 'Pune', lat: 18.5, lng: 73.8, date: tomorrow(), start_time: '09:00', end_time: '17:00', workers_needed: 1, rate: 200, skills: ['Cleaning'] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sid = created.body.shift.id;

  // QR attendance requires a complete site pin; partial coordinates are rejected.
  const noPin = await call('POST', '/shifts', biz, { title: 'No GPS Shift', location: 'Pune', date: tomorrow(), start_time: '10:00', end_time: '18:00', workers_needed: 1, rate: 150 });
  assert.equal(noPin.status, 201, JSON.stringify(noPin.body));
  assert.equal((await call('GET', `/shifts/${noPin.body.shift.id}/qr`, biz)).status, 400);
  const partialPin = await call('POST', '/shifts', biz, { title: 'Partial GPS Shift', location: 'Pune', lat: 18.5, date: tomorrow(), start_time: '10:00', end_time: '18:00', workers_needed: 1, rate: 150 });
  assert.equal(partialPin.status, 400);

  // KYC gate
  assert.equal((await call('POST', `/shifts/${sid}/apply`, w)).status, 403);
  const form = new FormData(); form.append('doc_type', 'Identity document');
  form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'id.pdf');
  const up = await fetch(base + '/kyc', { method: 'POST', headers: { authorization: `Bearer ${w}` }, body: form });
  assert.equal(up.status, 201);
  const spoof = new FormData(); spoof.append('doc_type', 'Identity document'); spoof.append('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'x.pdf');
  assert.equal((await fetch(base + '/kyc', { method: 'POST', headers: { authorization: `Bearer ${w}` }, body: spoof })).status, 400);

  const admin = await login('test-admin@example.test', 'TestAdminPassword!123');
  const docs = (await call('GET', '/kyc', admin)).body.documents;
  const doc = docs.find(d => d.worker_name === 'Test Worker');
  assert.equal((await call('POST', `/kyc/${doc.id}/review`, admin, { decision: 'reject' })).status, 400); // reason required
  assert.equal((await call('POST', `/kyc/${doc.id}/review`, admin, { decision: 'approve' })).status, 200);

  assert.equal((await call('POST', `/shifts/${sid}/apply`, w)).status, 201);
  assert.equal((await call('POST', `/shifts/${sid}/apply`, w)).status, 409);
  const apps = (await call('GET', `/shifts/${sid}/applications`, biz)).body.applications;
  assert.equal((await call('POST', `/applications/${apps[0].id}/decision`, biz, { decision: 'accept' })).status, 200);
  assert.equal((await call('GET', `/shifts/${sid}`, biz)).body.shift.status, 'Filled');

  // Attendance: forged QR rejected, far location rejected, valid works
  assert.equal((await call('POST', '/attendance/clock-in', w, { token: 'HS1.1.9999999999999.forgedsignaturexxxxxx', lat: 18.5, lng: 73.8 })).status, 400);
  const { token } = (await call('GET', `/shifts/${sid}/qr`, biz)).body;
  const far = await call('POST', '/attendance/clock-in', w, { token, lat: 19.0, lng: 72.8 });
  assert.equal(far.status, 403); assert.match(far.body.error, /within/);
  assert.equal((await call('POST', '/attendance/clock-in', w, { token })).status, 400); // no location
  assert.equal((await call('POST', '/attendance/clock-in', w, { token, lat: 18.5001, lng: 73.8001 })).status, 201);
  assert.equal((await call('GET', `/shifts/${sid}`, biz)).body.shift.status, 'Ongoing');

  const out = await call('POST', '/attendance/clock-out', w, { shift_id: sid, lat: 18.5, lng: 73.8 });
  assert.equal(out.status, 200);
  const ts = (await call('GET', '/timesheets', biz)).body.timesheets.find(t => t.shift_id === sid);
  assert.ok(ts && ts.status === 'Pending');
  assert.equal(ts.amount, Math.round(ts.hours * 200)); // server-computed
  // worker cannot approve own timesheet
  assert.equal((await call('POST', `/timesheets/${ts.id}/approve`, w)).status, 403);
  assert.equal((await call('POST', `/timesheets/${ts.id}/approve`, biz)).status, 200);
  assert.equal((await call('POST', `/timesheets/${ts.id}/approve`, biz)).status, 409);

  const pay = (await call('GET', '/payments', admin)).body.payments.find(p => p.timesheet_id === ts.id);
  assert.equal(pay.status, 'Pending');
  assert.equal((await call('POST', `/payments/${pay.id}/mark-paid`, biz)).status, 403);
  assert.equal((await call('POST', `/payments/${pay.id}/mark-paid`, admin, { reference: 'UTR1' })).status, 200);
  assert.equal((await call('GET', '/timesheets', w)).body.timesheets[0].status, 'Paid');
});

test('dispute resolution adjusts hours and creates payment', async () => {
  const admin = await login('test-admin@example.test', 'TestAdminPassword!123');
  const d = (await call('GET', '/disputes', admin)).body.disputes.find(x => x.timesheet_id);
  assert.equal((await call('POST', `/disputes/${d.id}/resolve`, admin, { outcome: 'adjust_hours', resolution: 'Verified with gate log' })).status, 400); // hours missing
  assert.equal((await call('POST', `/disputes/${d.id}/resolve`, admin, { outcome: 'adjust_hours', hours: 9, resolution: 'Verified with gate log' })).status, 200);
  const pays = (await call('GET', '/payments', admin)).body.payments;
  assert.ok(pays.some(p => p.timesheet_id === d.timesheet_id && p.amount === 9 * 170));
});

test('suspended users lose access immediately', async () => {
  const admin = await login('test-admin@example.test', 'TestAdminPassword!123');
  const w = await login('suresh@hstaff.example', 'Worker@12345');
  assert.equal((await call('GET', '/dashboard', w)).status, 200);
  const uid = (await call('GET', '/workers', admin)).body.workers.find(x => x.name === 'Suresh Yadav').id;
  assert.equal((await call('POST', `/admin/users/${uid}/status`, admin, { status: 'Suspended' })).status, 200);
  assert.equal((await call('GET', '/dashboard', w)).status, 403);
  assert.equal((await call('POST', '/auth/login', null, { email: 'suresh@hstaff.example', password: 'Worker@12345' })).status, 403);
});

test('KYC files are private to owner/admin', async () => {
  const admin = await login('test-admin@example.test', 'TestAdminPassword!123');
  const rohit = await login('rohit@hstaff.example', 'Worker@12345');
  const amit = await login('amit@hstaff.example', 'Worker@12345');
  const docs = (await call('GET', '/kyc', admin)).body.documents;
  const rohitDoc = docs.find(d => d.worker_name === 'Rohit Kumar');
  const get = t => fetch(`${base}/kyc/${rohitDoc.id}/file`, { headers: { authorization: `Bearer ${t}` } });
  assert.equal((await get(rohit)).status, 200);
  assert.equal((await get(admin)).status, 200);
  assert.equal((await get(amit)).status, 403);
});

test('on-demand matching: availability, nearby discovery, OTP start and completion', async () => {
  const biz = await login('abc@hstaff.example', 'Business@12345');
  const registered = await call('POST','/auth/register',null,{role:'worker',name:'Marketplace Worker',email:'market-worker@example.com',password:'Passw0rd!x'});
  const worker = registered.body.token;
  database.prepare("UPDATE workers SET kyc_status='Verified' WHERE user_id=?").run(registered.body.user.id);
  const location = { lat: 18.5912, lng: 73.7389 };
  assert.equal((await call('POST', '/workers/location', worker, { ...location, available: true })).status, 200);
  const rivalReg=await call('POST','/auth/register',null,{role:'worker',name:'Rival Worker',email:'rival@example.com',password:'Passw0rd!x'});
  assert.equal(rivalReg.status, 201, JSON.stringify(rivalReg.body));
  database.prepare("UPDATE workers SET kyc_status='Verified' WHERE user_id=?").run(rivalReg.body.user.id);
  assert.equal((await call('POST','/workers/location',rivalReg.body.token,{...location,available:true})).status,200);
  const created = await call('POST', '/jobs', biz, { title: 'Urgent helper', location: 'Hinjawadi, Pune', ...location, date: tomorrow(), start_time: '09:00', end_time: '11:00', rate: 250 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const nearby = await call('GET', `/jobs/nearby?lat=${location.lat}&lng=${location.lng}`, worker);
  assert.ok(nearby.body.jobs.some(j => j.id === created.body.job_id));
  const workerDiscovery=await call('GET',`/workers/nearby?lat=${location.lat}&lng=${location.lng}`,biz);
  assert.equal(workerDiscovery.body.workers[0].lat,undefined); assert.equal(workerDiscovery.body.workers[0].lng,undefined);
  const winners=await Promise.all([call('POST',`/jobs/${created.body.job_id}/request`,worker),call('POST',`/jobs/${created.body.job_id}/request`,rivalReg.body.token)]);
  assert.deepEqual(winners.map(x=>x.status).sort(),[201,409]);
  const assignedToken=winners[0].status===201?worker:rivalReg.body.token;
  const accepted=winners.find(x=>x.status===201);
  assert.equal(accepted.body.demo_otps, undefined); // never disclose the worker-entered code to the worker
  const code = (await call('GET', `/jobs/${created.body.job_id}/otp/start`, biz)).body.otp;
  database.prepare("UPDATE job_verifications SET expires_at=datetime('now','-1 minute') WHERE shift_id=? AND purpose='start'").run(created.body.job_id);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/verify-start`, assignedToken, { otp: code })).status, 400);
  database.prepare("UPDATE job_verifications SET created_at=datetime('now','-2 minutes') WHERE shift_id=? AND purpose='start'").run(created.body.job_id);
  const renewed=await call('POST',`/jobs/${created.body.job_id}/otp/start/resend`,biz,{});assert.equal(renewed.status,200);
  for(let i=0;i<5;i++) assert.equal((await call('POST', `/jobs/${created.body.job_id}/verify-start`, assignedToken, { otp: '000000' })).status,400);
  assert.equal(database.prepare("SELECT attempts FROM job_verifications WHERE shift_id=? AND purpose='start'").get(created.body.job_id).attempts,5);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/verify-start`, assignedToken, { otp: renewed.body.otp })).status,429);
  database.prepare("UPDATE job_verifications SET created_at=datetime('now','-2 minutes') WHERE shift_id=? AND purpose='start'").run(created.body.job_id);
  const rotated=await call('POST',`/jobs/${created.body.job_id}/otp/start/resend`,biz,{});assert.equal(rotated.status,200);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/verify-start`, assignedToken, { otp: rotated.body.otp })).status, 200);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/verify-start`, assignedToken, { otp: rotated.body.otp })).status, 409);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/location`, assignedToken, location)).status, 200);
  assert.equal((await call('GET', `/jobs/${created.body.job_id}/location`, biz)).body.available, true);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/complete`, assignedToken)).status, 200);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/confirm-completion`, biz)).status, 200);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/ratings`, biz, {rating:5,feedback:'Great work'})).status, 201);
  assert.equal((await call('POST', `/jobs/${created.body.job_id}/ratings`, biz, {rating:5})).status, 409); // one rating per job
  assert.equal(database.prepare('SELECT rating FROM workers WHERE user_id=?').get(registered.body.user.id).rating,5);
  const jobPayment=(await call('GET','/jobs/mine',biz)).body.jobs.find(j=>j.id===created.body.job_id);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    if(url==='https://api.razorpay.com/v1/orders'){
      const body=JSON.parse(init.body);return new Response(JSON.stringify({id:'order_test_job',amount:body.amount,currency:'INR'}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(url==='https://api.razorpay.com/v1/payments/pay_test_job')return new Response(JSON.stringify({id:'pay_test_job',order_id:'order_test_job',amount:jobPayment.job_amount*100,currency:'INR',status:'captured'}),{status:200,headers:{'content-type':'application/json'}});
    return originalFetch(input,init);
  };
  try{
    const order=await call('POST',`/payments/jobs/${created.body.job_id}/create-order`,biz,{});assert.equal(order.status,200);
    const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_test_job|pay_test_job').digest('hex');
    const paid=await call('POST',`/payments/jobs/${created.body.job_id}/verify-checkout`,biz,{razorpay_order_id:'order_test_job',razorpay_payment_id:'pay_test_job',razorpay_signature:signature});assert.equal(paid.status,200);
    const webhook={event:'payment.captured',payload:{payment:{entity:{id:'pay_test_job',order_id:'order_test_job',amount:jobPayment.job_amount*100,currency:'INR'}}}};
    for(let i=0;i<2;i++){const response=await originalFetch(base+'/payments/razorpay-webhook',{method:'POST',headers:{'content-type':'application/json','x-razorpay-signature':crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(webhook)).digest('hex'),'x-razorpay-event-id':'evt_job_test'},body:JSON.stringify(webhook)});assert.equal(response.status,200);}
    assert.equal(database.prepare("SELECT count(*) n FROM payment_events WHERE event_id='evt_job_test'").get().n,1);
    assert.equal((await call('GET','/jobs/mine',biz)).body.jobs.find(j=>j.id===created.body.job_id).job_payment_status,'paid');
  } finally {globalThis.fetch=originalFetch;}
});


test('GET /api/meta is public so the sign-in page can read demo mode', async () => {
  const r = await call('GET', '/meta');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.demo, 'boolean');
});

test('workers see open scheduled shifts only: no on-demand jobs, no pay', async () => {
  const biz = await login('abc@hstaff.example', 'Business@12345');
  const created = await call('POST', '/jobs', biz, { title: 'Instant cleaner', location: 'Baner, Pune', lat: 18.56, lng: 73.78, date: tomorrow(), start_time: '09:00', end_time: '12:00', rate: 200 });
  assert.equal(created.status, 201);
  const worker = await login('priya@hstaff.example', 'Worker@12345');
  const { body } = await call('GET', '/shifts', worker);
  assert.ok(body.shifts.length > 0, 'scheduled shifts should be listed');
  assert.ok(body.shifts.every(s => s.job_type === 'scheduled'), 'on-demand jobs must not appear in the shift list');
  assert.ok(body.shifts.every(s => !('rate' in s)), 'pay is hidden from workers');
});

test('cron auto-approve endpoint is closed unless CRON_SECRET matches', async () => {
  assert.equal((await call('GET', '/cron/auto-approve')).status, 401);
});
