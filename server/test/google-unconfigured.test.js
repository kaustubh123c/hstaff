import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hstaff-google-off-'));
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: dir, DB_FILE: path.join(dir, 'google.db'), UPLOAD_DIR: path.join(dir, 'uploads'), JWT_SECRET: 'test-google-unconfigured-secret' });
process.env.GOOGLE_CLIENT_ID = ''; // empty (not deleted) so server/.env cannot re-populate it
let server, db;
before(async () => {
  ({ db } = await import('../src/db.js'));
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0); await new Promise(resolve => server.once('listening', resolve));
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Google authentication returns a setup error when OAuth client credentials are absent', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'x'.repeat(128), intent: 'user' }) });
  const body = await response.json();
  assert.equal(response.status, 503); assert.match(body.error, /GOOGLE_CLIENT_ID/);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 0);
});
