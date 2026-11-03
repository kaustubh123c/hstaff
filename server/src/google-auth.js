import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './util.js';

let keysCache;
let keysExpiresAt = 0;

async function googleSigningKey(kid, refresh = false) {
  if (!config.googleClientId) throw new HttpError(503, 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server and VITE_GOOGLE_CLIENT_ID for the web app.');
  if (refresh || !keysCache || Date.now() >= keysExpiresAt) {
    let response;
    try { response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) }); }
    catch { throw new HttpError(503, 'Google sign-in could not reach Google to verify the identity token.'); }
    if (!response.ok) throw new HttpError(503, 'Google sign-in could not load verification keys. Try again later.');
    let body;
    try { body = await response.json(); } catch { throw new HttpError(503, 'Google returned an invalid verification key set.'); }
    if (!Array.isArray(body.keys)) throw new HttpError(503, 'Google returned an invalid verification key set.');
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
    keysCache = body.keys;
    keysExpiresAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  }
  const key = keysCache.find(item => item.kid === kid && item.kty === 'RSA' && item.alg === 'RS256');
  if (!key && !refresh) return googleSigningKey(kid, true);
  if (!key) { keysCache = null; throw new HttpError(401, 'Google identity token signing key is not recognized. Please try again.'); }
  return crypto.createPublicKey({ key, format: 'jwk' });
}

export async function verifyGoogleIdentityToken(token) {
  if (!config.googleClientId) throw new HttpError(503, 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server and VITE_GOOGLE_CLIENT_ID for the web app.');
  if (typeof token !== 'string' || token.length < 100 || token.length > 8192) throw new HttpError(400, 'A valid Google identity token is required.');
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') throw new HttpError(401, 'Google identity token is invalid.');
  const key = await googleSigningKey(decoded.header.kid);
  let claims;
  try {
    claims = jwt.verify(token, key, { algorithms: ['RS256'], audience: config.googleClientId, issuer: ['accounts.google.com', 'https://accounts.google.com'], clockTolerance: 5 });
  } catch { throw new HttpError(401, 'Google identity token is invalid or expired.'); }
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || claims.email_verified !== true) throw new HttpError(401, 'Google must provide a verified email address.');
  const email = claims.email.trim().toLowerCase();
  if (!email.endsWith('@gmail.com') && !(typeof claims.hd === 'string' && claims.hd.trim())) throw new HttpError(401, 'Google sign-in requires an authoritative Gmail or Workspace email identity.');
  return { sub: claims.sub, email, name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 80) : email.split('@')[0] };
}

// Tests can replace the public key cache through a dedicated reset function;
// production has no route or environment control that can change verification.
export function resetGoogleSigningKeysForTests() { keysCache = null; keysExpiresAt = 0; }
