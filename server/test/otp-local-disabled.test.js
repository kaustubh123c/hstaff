import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-otp-off-'));
Object.assign(process.env, { NODE_ENV: 'development', DEV_OTP_ENABLED: 'false', DATA_DIR: dir, DB_FILE: path.join(dir, 'otp.db'), UPLOAD_DIR: path.join(dir, 'uploads'), JWT_SECRET: 'test-only-disabled-otp-secret' });
for (const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','TWILIO_MESSAGING_SERVICE_SID']) delete process.env[key];
let server, db;
before(async () => {
  ({ db } = await import('../src/db.js'));
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0); await new Promise(resolve => server.once('listening', resolve));
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('development OTP requires explicit opt-in and disabled mode issues no code without Twilio', async () => {
  const phone = '+919444000001';
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, role: 'user' }) });
  const body = await response.json();
  assert.equal(response.status, 503); assert.match(body.error, /DEV_OTP_ENABLED=true/); assert.equal('development_otp' in body, false);
  assert.equal(db.prepare('SELECT 1 FROM auth_otps WHERE phone=?').get(phone), undefined);
});
