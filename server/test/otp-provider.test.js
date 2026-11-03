import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-otp-provider-'));
Object.assign(process.env, { NODE_ENV: 'production', DEV_OTP_ENABLED: 'true', DATA_DIR: dir, DB_FILE: path.join(dir, 'otp.db'), UPLOAD_DIR: path.join(dir, 'uploads'), JWT_SECRET: 'test-only-production-otp-secret', TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: 'mock-token', TWILIO_FROM_NUMBER: '+15005550006' });
const nativeFetch = globalThis.fetch;
let providerStatus = 201, providerCalls = 0, server, db;
globalThis.fetch = (url, options) => {
  if (String(url).startsWith('https://api.twilio.com/')) {
    providerCalls++;
    return Promise.resolve(new Response(providerStatus === 201 ? JSON.stringify({ sid: 'SM-mock', status: 'queued' }) : JSON.stringify({ message: 'provider rejected request' }), { status: providerStatus, headers: { 'content-type': 'application/json' } }));
  }
  return nativeFetch(url, options);
};

before(async () => {
  ({ db } = await import('../src/db.js'));
  const { config } = await import('../src/config.js'); assert.equal(config.devOtpEnabled, false, 'production must ignore DEV_OTP_ENABLED');
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0); await new Promise(resolve => server.once('listening', resolve));
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db?.close(); globalThis.fetch = nativeFetch; fs.rmSync(dir, { recursive: true, force: true });
});

async function request(phone) {
  const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/api/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, role: 'user' }) });
  return { status: response.status, body: await response.json() };
}

test('production sends via configured SMS provider, hides OTP and starts cooldown only after delivery', async () => {
  const phone = '+919222000001';
  const delivered = await request(phone);
  assert.equal(delivered.status, 200); assert.equal(delivered.body.delivery, 'sms'); assert.equal('development_otp' in delivered.body, false); assert.equal(providerCalls, 1);
  assert.ok(db.prepare('SELECT requested_at FROM auth_otps WHERE phone=?').get(phone).requested_at);
  const cooledDown = await request(phone);
  assert.equal(cooledDown.status, 409); assert.equal(providerCalls, 1);

  providerStatus = 400;
  const failedPhone = '+919222000002';
  const failed = await request(failedPhone);
  assert.equal(failed.status, 502); assert.equal('development_otp' in failed.body, false);
  assert.equal(db.prepare('SELECT 1 FROM auth_otps WHERE phone=?').get(failedPhone), undefined);
  const retry = await request(failedPhone);
  assert.equal(retry.status, 502, 'provider failure must not start cooldown'); assert.equal(providerCalls, 3);
});

