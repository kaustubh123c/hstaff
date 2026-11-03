// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json) and handled by the Express app.
//
// IMPORTANT: Vercel functions have a read-only disk (only /tmp is writable) and no data survives between
// invocations/deploys. This entry therefore uses a SQLite file in /tmp, which is fine for a DEMO but not for
// real data. For production, host the API on a service with a persistent disk (see render.yaml) and point the
// Vercel frontend at it with VITE_API_URL. Details: DEPLOY_VERCEL.md.
let appPromise;

async function boot() {
  process.env.NODE_ENV ??= 'production';
  process.env.DATA_DIR ??= '/tmp/hstaff-data';
  process.env.UPLOAD_DIR ??= `${process.env.DATA_DIR}/uploads`;
  const missing = ['JWT_SECRET', 'QR_SECRET'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Server is not configured: set ${missing.join(' and ')} in Vercel → Project → Settings → Environment Variables, then redeploy.`);

  const { db } = await import('../server/src/db.js');
  // Ephemeral disk: rebuild the starting data on each cold start. Sample data first (the seed script refuses to
  // run on a non-empty database), then the administrator account from environment variables.
  if (process.env.DEMO_SEED === 'true' && !db.prepare('SELECT 1 FROM users LIMIT 1').get()) await import('../server/src/seed.js');
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: name } = process.env;
  if (email && password && !db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    const { createAdminAccount } = await import('../server/src/admin-provision.js');
    await createAdminAccount(db, { name: name || 'Administrator', email, password }, { source: 'environment variables' });
  }
  const { createApp } = await import('../server/src/index.js');
  return createApp();
}

export default async function handler(req, res) {
  try {
    appPromise ??= boot();
    (await appPromise)(req, res);
  } catch (error) {
    appPromise = undefined; // allow a retry after the settings are fixed
    console.error(error);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
