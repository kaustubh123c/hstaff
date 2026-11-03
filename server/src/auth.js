import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError, forbidden } from './util.js';

export const signToken = user =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // Always re-read the user so suspended accounts lose access immediately.
    const user = db.prepare('SELECT id, email, role, name, phone, status FROM users WHERE id = ?').get(payload.sub);
    if (!user) return next(new HttpError(401, 'Account no longer exists'));
    if (user.status !== 'Active') return next(new HttpError(403, 'This account is suspended'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Session expired or invalid. Please sign in again.'));
  }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden(`Requires role: ${roles.join(' or ')}`));
