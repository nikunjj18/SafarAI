import { newGroupCode } from './db.ts';
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { leaderOnly } from './auth.ts';
import { transaction, record, records, updateRecord } from './db.ts';
import { route, HttpError } from './errors.ts';
import { text, coord } from './validation.ts';
import { changed, iso, type Context } from './context.ts';
import type { User, Incident, Bulletin, MeetingPoint } from '../../shared/types.ts';
export function groupRoutes(app: Express, c: Context) {
  const { db, events } = c;
  app.patch(
    '/api/group/helpdesk',
    leaderOnly,
    route((req, res) => {
      const b = z
        .object({
          phone: z
            .string()
            .trim()
            .regex(
              /^(?:\+[1-9]\d{6,14})?$/,
              'Enter a phone number with country code, such as + followed by digits.',
            ),
        })
        .strict()
        .parse(req.body);
      db.prepare('UPDATE groups SET helpdesk_phone=? WHERE id=?').run(
        b.phone,
        res.locals.user.groupId,
      );
      events.publish(res.locals.user.groupId);
      res.json({ phone: b.phone });
    }),
  );
  app.patch(
    '/api/group',
    leaderOnly,
    route((req, res) => {
      const b = z
        .object({
          name: text(100),
          radius: z.number().min(25).max(10000),
          anchor: coord.nullable(),
        })
        .strict()
        .parse(req.body);
      db.prepare('UPDATE groups SET name=?,radius=150,anchor=NULL WHERE id=?').run(
        b.name,
        res.locals.user.groupId,
      );
      changed(c, res.locals.user.groupId);
      res.json({ success: true });
    }),
  );
  app.post('/api/group/rotate-code', leaderOnly, (_req, res) => {
    db.prepare('UPDATE groups SET code=? WHERE id=?').run(
      newGroupCode(db),
      res.locals.user.groupId,
    );
    events.publish(res.locals.user.groupId);
    res.json({ success: true });
  });
  app.delete(
    '/api/members/:id',
    leaderOnly,
    route((req, res) => {
      const user: User = res.locals.user;
      if (req.params.id === user.id)
        throw new HttpError(400, 'The leader cannot remove their own account here.');
      if (
        !db
          .prepare('SELECT id FROM users WHERE id=? AND group_id=?')
          .get(req.params.id, user.groupId)
      )
        throw new HttpError(404, 'Member not found.');
      if (
        db
          .prepare("SELECT id FROM records WHERE owner_id=? AND kind='network-resource' LIMIT 1")
          .get(req.params.id)
      )
        throw new HttpError(
          409,
          'This member must terminate their stored carrier resources before removal.',
        );
      transaction(db, () => {
        db.prepare('DELETE FROM records WHERE owner_id=?').run(req.params.id);
        db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
      });
      changed(c, user.groupId);
      res.sendStatus(204);
    }),
  );
  app.post(
    '/api/sos',
    route((_req, res) => {
      const user: User = res.locals.user;
      const incident = transaction(db, () => {
        const existing = records<Incident>(db, user.groupId, 'incident').find(
          (i) => i.memberId === user.id && !i.resolvedAt,
        );
        if (existing) return existing;
        const value = record(
          db,
          user.groupId,
          'incident',
          {
            memberId: user.id,
            name: user.name,
            createdAt: iso(),
            resolvedAt: null,
            resolution: null,
          },
          user.id,
        );
        record(db, user.groupId, 'bulletin', {
          kind: 'sos',
          title: 'SOS from ' + user.name,
          message:
            'An SOS was submitted to this group. Contact the member and review their latest reported location. Emergency services have not been contacted by this app.',
          actorId: user.id,
          createdAt: iso(),
        });
        return value;
      });
      changed(c, user.groupId);
      res.status(201).json({ incident, message: 'SOS saved to your group feed.' });
    }),
  );
  app.post(
    '/api/incidents/:id/resolve',
    leaderOnly,
    route((req, res) => {
      const b = z
          .object({ resolution: text(1000) })
          .strict()
          .parse(req.body),
        user: User = res.locals.user;
      const incident = records<Incident>(db, user.groupId, 'incident').find(
        (i) => i.id === req.params.id,
      );
      if (!incident) throw new HttpError(404, 'Incident not found.');
      if (!incident.resolvedAt)
        transaction(db, () => {
          updateRecord(db, incident.id, {
            ...incident,
            resolvedAt: iso(),
            resolution: b.resolution,
          });
          record(db, user.groupId, 'bulletin', {
            kind: 'resolution',
            title: 'SOS closed by group leader',
            message: incident.name + ': ' + b.resolution,
            actorId: user.id,
            createdAt: iso(),
          });
        });
      changed(c, user.groupId);
      res.json({ success: true });
    }),
  );
  app.post(
    '/api/group/broadcast',
    leaderOnly,
    route((req, res) => {
      const b = z
          .object({ message: text(2000) })
          .strict()
          .parse(req.body),
        user: User = res.locals.user;
      const bulletin = record(db, user.groupId, 'bulletin', {
        kind: 'broadcast',
        title: 'Message from ' + user.name,
        message: b.message,
        actorId: user.id,
        createdAt: iso(),
      });
      events.publish(user.groupId);
      res.status(201).json({ bulletin, message: 'Published to the group feed.' });
    }),
  );
  app.post('/api/notifications/read', (_req, res) => {
    transaction(db, () => {
      for (const b of records<Bulletin>(db, res.locals.user.groupId, 'bulletin'))
        db.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,0)').run(res.locals.user.id, b.id);
    });
    events.publish(res.locals.user.groupId);
    res.sendStatus(204);
  });
  app.delete('/api/notifications', (_req, res) => {
    transaction(db, () => {
      for (const b of records<Bulletin>(db, res.locals.user.groupId, 'bulletin'))
        db.prepare(
          'INSERT INTO receipts VALUES (?,?,1) ON CONFLICT(user_id,record_id) DO UPDATE SET hidden=1',
        ).run(res.locals.user.id, b.id);
    });
    events.publish(res.locals.user.groupId);
    res.sendStatus(204);
  });
  const pointSchema = coord
    .extend({
      name: text(100),
      crowd: z.number().int().min(0).max(100).nullable(),
      active: z.boolean(),
    })
    .strict();
  const checkpointSchema = coord
    .extend({
      title: text(120),
      description: z.string().max(1000),
      scheduledAt: z.iso.datetime(),
      status: z.enum(['upcoming', 'active', 'completed']),
    })
    .strict();
  for (const [endpoint, kind, schema] of [
    ['checkpoints', 'checkpoint', checkpointSchema],
    ['meeting-points', 'meeting-point', pointSchema],
  ] as const) {
    app.post(
      '/api/' + endpoint,
      leaderOnly,
      route((req, res) => {
        const value = schema.parse(req.body),
          user: User = res.locals.user;
        const item = transaction(db, () => {
          if (kind === 'meeting-point' && 'active' in value && value.active)
            for (const p of records<MeetingPoint>(db, user.groupId, kind))
              updateRecord(db, p.id, { ...p, active: false });
          return record(db, user.groupId, kind, {
            ...value,
            ...(kind === 'meeting-point' ? { observedAt: iso() } : {}),
          });
        });
        events.publish(user.groupId);
        res.status(201).json(item);
      }),
    );
    app.patch(
      '/api/' + endpoint + '/:id',
      leaderOnly,
      route((req, res) => {
        const value = schema.parse(req.body),
          user: User = res.locals.user;
        const existing = records<{ id: string; crowd?: number | null; observedAt?: string }>(
          db,
          user.groupId,
          kind,
        ).find((i) => i.id === req.params.id);
        if (!existing) throw new HttpError(404, 'Item not found.');
        transaction(db, () => {
          if (kind === 'meeting-point' && 'active' in value && value.active)
            for (const p of records<MeetingPoint>(db, user.groupId, kind))
              updateRecord(db, p.id, { ...p, active: false });
          updateRecord(db, existing.id, {
            ...value,
            id: existing.id,
            ...(kind === 'meeting-point'
              ? {
                  observedAt:
                    'crowd' in value && existing.crowd === value.crowd
                      ? existing.observedAt || iso()
                      : iso(),
                }
              : {}),
          });
        });
        events.publish(user.groupId);
        res.json({ success: true });
      }),
    );
    app.delete(
      '/api/' + endpoint + '/:id',
      leaderOnly,
      route((req, res) => {
        if (
          !db
            .prepare('DELETE FROM records WHERE id=? AND kind=? AND group_id=?')
            .run(req.params.id, kind, res.locals.user.groupId).changes
        )
          throw new HttpError(404, 'Item not found.');
        events.publish(res.locals.user.groupId);
        res.sendStatus(204);
      }),
    );
  }
}
