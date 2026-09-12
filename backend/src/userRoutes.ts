import { newGroupCode } from './db.ts';
import { refreshSimulator } from './simulator.ts';
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, checkPassword, createSession } from './auth.ts';
import { transaction, userFrom, type UserRow } from './db.ts';
import { route, HttpError } from './errors.ts';
import { isLocale } from '../../shared/locales.ts';
import { text, phone, language, defaultProfile, profileSchema, coord } from './validation.ts';
import { snapshot, changed, iso, type Context } from './context.ts';
import type { User } from '../../shared/types.ts';
export function authRoutes(app: Express, c: Context) {
  const { db } = c;
  const limiter = rateLimit({
    windowMs: 900000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes.' },
  });
  app.post(
    '/api/auth/register',
    limiter,
    route(async (req, res) => {
      const b = z
        .object({
          name: text(100),
          email: z
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          phone,
          password: z.string().min(12).max(128),
          role: z.enum(['leader', 'pilgrim']),
          groupName: z.string().trim().max(100).optional(),
          groupCode: z.string().trim().max(30).optional(),
          language: language.default('en'),
          simulator: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      if (db.prepare('SELECT id FROM users WHERE email=? OR phone=?').get(b.email, b.phone))
        throw new HttpError(409, 'Email or phone number already registered.');
      const password = await hashPassword(b.password),
        id = randomUUID();
      const user = transaction(db, () => {
        let groupId: string;
        if (b.role === 'leader') {
          if (!b.groupName) throw new HttpError(400, 'Enter a group name.');
          groupId = randomUUID();
          db.prepare('INSERT INTO groups (id,name,code,leader_id) VALUES (?,?,?,?)').run(
            groupId,
            b.groupName,
            newGroupCode(db),
            id,
          );
        } else {
          const group = db
            .prepare('SELECT id FROM groups WHERE code=?')
            .get((b.groupCode || '').toUpperCase()) as { id: string } | undefined;
          if (!group) throw new HttpError(400, 'Invalid group invitation code.');
          groupId = group.id;
        }
        if (db.prepare('SELECT id FROM users WHERE email=? OR phone=?').get(b.email, b.phone))
          throw new HttpError(409, 'Email or phone number already registered.');
        db.prepare(
          'INSERT INTO users (id,group_id,email,phone,name,role,password,profile) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          id,
          groupId,
          b.email,
          b.phone,
          b.name,
          b.role,
          password,
          JSON.stringify({
            ...defaultProfile,
            language: b.language,
            simulator: b.simulator,
            networkConsent: b.simulator,
          }),
        );
        return userFrom(db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow);
      });
      const csrf = createSession(db, res, id, c.publicUrl.protocol === 'https:');
      c.events.publish(user.groupId);
      res.status(201).json({ user, csrf });
    }),
  );
  app.post(
    '/api/auth/login',
    limiter,
    route(async (req, res) => {
      const b = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      const row = db.prepare('SELECT * FROM users WHERE email=?').get(b.email) as
        UserRow | undefined;
      const valid = await checkPassword(
        b.password,
        row?.password || '0'.repeat(32) + ':' + '0'.repeat(128),
      );
      if (!valid || !row) throw new HttpError(401, 'Email or password is incorrect.');
      res.json({
        user: userFrom(row),
        csrf: createSession(db, res, row.id, c.publicUrl.protocol === 'https:'),
      });
    }),
  );
}
export function userRoutes(app: Express, c: Context) {
  const { db, events } = c;
  app.get('/api/auth/me', (_req, res) =>
    res.json({ user: res.locals.user, csrf: res.locals.csrf }),
  );
  app.post('/api/auth/logout', (_req, res) => {
    db.prepare('DELETE FROM sessions WHERE hash=?').run(res.locals.sessionHash);
    res.clearCookie('safar_session', {
      path: '/',
      httpOnly: true,
      secure: c.publicUrl.protocol === 'https:',
      sameSite: 'lax',
    });
    res.sendStatus(204);
  });
  app.get('/api/state', (_req, res) => res.json(snapshot(c, res.locals.user)));
  app.get('/api/events', (req, res, next) => {
    const user: User = res.locals.user;
    if (!events.add(user.groupId, res)) {
      next(new HttpError(429, 'Too many live connections.'));
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\nevent: change\ndata: {}\n\n');
    const timer = setInterval(() => {
      if (
        !db
          .prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?')
          .get(res.locals.sessionHash, Date.now())
      ) {
        res.end();
        return;
      }
      res.write(': heartbeat\n\n');
    }, 15000);
    req.on('close', () => clearInterval(timer));
  });
  app.patch(
    '/api/profile/language',
    route((req, res) => {
      const b = z
        .object({ language: z.string().refine(isLocale) })
        .strict()
        .parse(req.body);
      const profile = { ...res.locals.user.profile, language: b.language };
      db.prepare('UPDATE users SET profile=? WHERE id=?').run(
        JSON.stringify(profile),
        res.locals.user.id,
      );
      events.publish(res.locals.user.groupId);
      res.json({ language: b.language });
    }),
  );
  app.patch(
    '/api/profile',
    route((req, res) => {
      const b = z
        .object({ name: text(100), profile: profileSchema })
        .strict()
        .parse(req.body);
      db.prepare('UPDATE users SET name=?,profile=? WHERE id=?').run(
        b.name,
        JSON.stringify(b.profile),
        res.locals.user.id,
      );
      events.publish(res.locals.user.groupId);
      res.json({ success: true });
    }),
  );
  app.post(
    '/api/simulator/location',
    rateLimit({
      windowMs: 60000,
      limit: 8,
      keyGenerator: (_req, res) => res.locals.user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    route(async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      res.json(await refreshSimulator(c, res.locals.user));
    }),
  );
  app.post('/api/telemetry/start', (_req, res) => {
    db.prepare('UPDATE users SET location_sharing=1 WHERE id=?').run(res.locals.user.id);
    res.sendStatus(204);
  });
  app.post(
    '/api/telemetry',
    route((req, res) => {
      if (!res.locals.row.location_sharing)
        throw new HttpError(409, 'Start location sharing before sending measurements.');
      const b = coord
        .extend({
          accuracy: z.number().min(0).max(100000),
          observedAt: z.iso.datetime(),
          battery: z.number().int().min(0).max(100).nullable(),
        })
        .strict()
        .parse(req.body);
      const delta = Date.now() - Date.parse(b.observedAt);
      if (delta < -30000 || delta > 120000)
        throw new HttpError(400, 'Location sample is too old or in the future.');
      const row: UserRow = res.locals.row,
        previous = row.telemetry ? JSON.parse(row.telemetry) : null;
      if (previous && Date.parse(previous.observedAt) > Date.parse(b.observedAt)) {
        res.json({ accepted: false });
        return;
      }
      // GPS fallback can be kilometres less accurate than the last fix.
      // Keep that valid fix until another usable measurement arrives; do not
      // refresh its timestamp or manufacture movement during an interruption.
      if (previous?.source === 'browser' && previous.accuracy <= 150 && b.accuracy > 150) {
        db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(iso(), row.id);
        res.json({ accepted: false, retainedPrevious: true });
        return;
      }
      db.prepare('UPDATE users SET telemetry=?,last_seen=? WHERE id=?').run(
        JSON.stringify({ ...b, source: 'browser' }),
        iso(),
        row.id,
      );
      changed(c, row.group_id);
      res.json({ accepted: true });
    }),
  );
  app.delete('/api/telemetry', (_req, res) => {
    db.prepare('UPDATE users SET telemetry=NULL,location_sharing=0 WHERE id=?').run(
      res.locals.user.id,
    );
    changed(c, res.locals.user.groupId);
    res.sendStatus(204);
  });
  app.post('/api/heartbeat', (_req, res) => {
    db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(iso(), res.locals.user.id);
    res.sendStatus(204);
  });
}
