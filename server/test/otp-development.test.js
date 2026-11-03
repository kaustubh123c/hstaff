import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-otp-dev-'));
Object.assign(process.env, { NODE_ENV: 'development', DEV_OTP_ENABLED: 'true', DATA_DIR: dir, DB_FILE: path.join(dir, 'otp.db'), UPLOAD_DIR: path.join(dir, 'uploads'), JWT_SECRET: 'test-only-development-otp-secret' });
for (const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','TWILIO_MESSAGING_SERVICE_SID']) delete process.env[key];
const nativeFetch = globalThis.fetch;
let twilioCalls = 0, server, db;
globalThis.fetch = (...args) => { if (String(args[0]).startsWith('https://api.twilio.com/')) twilioCalls++; return nativeFetch(...args); };

before(async () => {
  ({ db } = await import('../src/db.js'));
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db?.close(); globalThis.fetch = nativeFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

const endpoint = () => `http://127.0.0.1:${server.address().port}/api/auth`;
async function call(pathname, body) {
  const response = await nativeFetch(`${endpoint()}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('development OTP supports Worker and User registration and existing-user mobile sign-in without SMS', async () => {
  const workerPhone = '+919111000001';
  const issueWorker = await call('/otp/request', { phone: workerPhone, role: 'worker', name: 'Test Worker', email: 'otp-worker@example.test' });
  assert.equal(issueWorker.status, 200); assert.equal(issueWorker.body.delivery, 'development');
  assert.match(issueWorker.body.development_otp, /^\d{6}$/); assert.equal(twilioCalls, 0);
  const stored = db.prepare('SELECT code_hash, requested_at FROM auth_otps WHERE phone=?').get(workerPhone);
  assert.notEqual(stored.code_hash, issueWorker.body.development_otp); assert.equal(stored.requested_at, '');
  let reissueWorker;
  do { reissueWorker = await call('/otp/request', { phone: workerPhone, role: 'worker' }); }
  while (reissueWorker.body.development_otp === issueWorker.body.development_otp);
  assert.equal(reissueWorker.status, 200, 'local issuance should not start SMS resend cooldown');
  assert.equal((await call('/otp/verify', { phone: workerPhone, otp: issueWorker.body.development_otp, role: 'worker' })).status, 400, 'reissuing invalidates the previous code');
  const verifiedWorker = await call('/otp/verify', { phone: workerPhone, otp: reissueWorker.body.development_otp, role: 'worker' });
  assert.equal(verifiedWorker.status, 200); assert.equal(verifiedWorker.body.user.role, 'worker');

  const userPhone = '+919111000002';
  const issueUser = await call('/otp/request', { phone: userPhone, role: 'user', name: 'Test User', email: 'otp-user@example.test' });
  const verifiedUser = await call('/otp/verify', { phone: userPhone, otp: issueUser.body.development_otp, role: 'user' });
  assert.equal(verifiedUser.status, 200); assert.equal(verifiedUser.body.user.role, 'business');

  const loginPhone = '+919111000003';
  const id = db.prepare("INSERT INTO users(email,password_hash,role,name,phone) VALUES(?,?,'business',?,?)").run('existing@example.test', 'unused', 'Existing User', loginPhone).lastInsertRowid;
  db.prepare('INSERT INTO businesses(user_id,company) VALUES(?,?)').run(id, 'Existing Company');
  const issueLogin = await call('/otp/request', { phone: loginPhone });
  const verifiedLogin = await call('/otp/verify', { phone: loginPhone, otp: issueLogin.body.development_otp });
  assert.equal(verifiedLogin.status, 200); assert.equal(verifiedLogin.body.created, undefined); assert.equal(verifiedLogin.body.user.id, id);
  assert.equal(twilioCalls, 0);
});

test('development OTP rejects wrong and expired codes and caps verification at five attempts', async () => {
  const phone = '+919111000010';
  const issued = await call('/otp/request', { phone, role: 'worker', name: 'Attempt Worker' });
  for (let i = 0; i < 5; i++) assert.equal((await call('/otp/verify', { phone, otp: '000000', role: 'worker' })).status, 400);
  assert.equal((await call('/otp/verify', { phone, otp: issued.body.development_otp, role: 'worker' })).status, 429);

  const expiredPhone = '+919111000011';
  const expired = await call('/otp/request', { phone: expiredPhone, role: 'user' });
  db.prepare("UPDATE auth_otps SET expires_at='2000-01-01 00:00:00' WHERE phone=?").run(expiredPhone);
  assert.equal((await call('/otp/verify', { phone: expiredPhone, otp: expired.body.development_otp, role: 'user' })).status, 400);
});
