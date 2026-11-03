import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-admin-demo-'));
Object.assign(process.env, {
  NODE_ENV: 'development', DEV_ADMIN_REGISTRATION_ENABLED: 'true', DEV_OTP_ENABLED: 'true',
  DATA_DIR: dir, DB_FILE: path.join(dir, 'demo.db'), UPLOAD_DIR: path.join(dir, 'uploads'),
  JWT_SECRET: 'test-only-admin-demo-registration-secret', QR_SECRET: 'test-only-admin-demo-qr-secret',
});

let server;
let base;
let db;
test('local Admin sign-up creates a password-hashed account which can sign in', async t => {
  ({ db } = await import('../src/db.js'));
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const credentials = { name: 'Demo Admin', email: 'demo-admin@example.test', password: 'DemoAdminPassword!123' };
  const created = await fetch(`${base}/auth/admin/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.user.role, 'admin');
  assert.equal('token' in createdBody, false, 'registration does not automatically sign in');
  const stored = db.prepare('SELECT password_hash, role FROM users WHERE email=?').get(credentials.email);
  assert.equal(stored.role, 'admin');
  assert.notEqual(stored.password_hash, credentials.password);

  const duplicate = await fetch(`${base}/auth/admin/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  });
  assert.equal(duplicate.status, 409);

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, 'admin');
});
