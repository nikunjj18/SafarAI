import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, RequestHandler } from 'express';
import { HttpError } from './errors.ts';
import { userFrom, type DB, type UserRow } from './db.ts';
const derive = promisify(scrypt);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64)) as Buffer;
  return salt + ':' + hash.toString('hex');
}
export async function checkPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(':');
  const hash = (await derive(password, salt, 64)) as Buffer;
  const target = Buffer.from(encoded, 'hex');
  return target.length === hash.length && timingSafeEqual(hash, target);
}
export function sessionHash(req: Request) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('safar_session='))
    ?.slice(14);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? digest(raw) : '';
}
export function createSession(db: DB, res: Response, userId: string, secure: boolean) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    digest(token),
    userId,
    csrf,
    Date.now() + 7 * 86400000,
  );
  res.cookie('safar_session', token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400000,
  });
  return csrf;
}
export function authenticate(db: DB): RequestHandler {
  return (req, res, next) => {
    const hash = sessionHash(req);
    const session = db
      .prepare('SELECT * FROM sessions WHERE hash=? AND expires>?')
      .get(hash, Date.now()) as { user_id: string; csrf: string; expires: number } | undefined;
    if (!session) {
      next(new HttpError(401, 'Please sign in.', 'AUTH_REQUIRED'));
      return;
    }
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id) as
      UserRow | undefined;
    if (!row) {
      next(new HttpError(401, 'Please sign in.'));
      return;
    }
    res.locals.user = userFrom(row);
    res.locals.row = row;
    res.locals.sessionHash = hash;
    res.locals.csrf = session.csrf;
    res.locals.expires = session.expires;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-csrf-token'] !== session.csrf
    ) {
      next(
        new HttpError(
          403,
          'Session security check failed. Refresh and try again.',
          'CSRF_REJECTED',
        ),
      );
      return;
    }
    next();
  };
}
export const leaderOnly: RequestHandler = (_req, res, next) => {
  if (res.locals.user.role !== 'leader')
    next(new HttpError(403, 'This action requires the group leader.'));
  else next();
};
