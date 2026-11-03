import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-admin-prod-'));
Object.assign(process.env, {
  NODE_ENV: 'production', DEV_ADMIN_REGISTRATION_ENABLED: 'true',
  DATA_DIR: dir, DB_FILE: path.join(dir, 'prod.db'), UPLOAD_DIR: path.join(dir, 'uploads'),
  JWT_SECRET: 'test-only-admin-production-registration-secret', QR_SECRET: 'test-only-admin-production-qr-secret',
});

test('Admin self-registration stays disabled in production even if the dev flag is true', async t => {
  const [{ createApp }, { db }] = await Promise.all([import('../src/index.js'), import('../src/db.js')]);
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/admin/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Blocked Admin', email: 'blocked-admin@example.test', password: 'SomeLongPassword!123' }),
  });
  assert.equal(response.status, 404);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email=?').get('blocked-admin@example.test'), undefined);
});
