import type { Express } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { route, HttpError } from './errors.ts';
import { text } from './validation.ts';
import { record, transaction } from './db.ts';
import { iso, type Context } from './context.ts';
import { sessionHash } from './auth.ts';
import { authenticate } from './auth.ts';
import { secureUrl } from './providers.ts';
import { userFrom, type UserRow } from './db.ts';
export function publicProviderRoutes(app: Express, c: Context) {
  const { db, env } = c;
  const pending = new Map<string, { userId: string; hash: string; expires: number }>();
  app.get(
    '/api/carrier/oauth/callback',
    route(async (req, res) => {
      const state = z.string().parse(req.query.state),
        item = pending.get(state);
      pending.delete(state);
      if (!item || item.expires < Date.now() || item.hash !== sessionHash(req))
        throw new HttpError(400, 'Carrier authorization expired. Start verification again.');
      if (req.query.error) {
        res.redirect('/?carrier=denied');
        return;
      }
      const row = db.prepare('SELECT * FROM users WHERE id=?').get(item.userId) as
        UserRow | undefined;
      if (!row) throw new HttpError(401, 'Account no longer exists.');
      try {
        const code = z.string().min(1).max(4096).parse(req.query.code),
          user = userFrom(row);
        const result = await c.providers.carrier(
          user,
          'number-verification',
          { phoneNumber: user.phone },
          'POST',
          undefined,
          { code, state },
        );
        if (typeof result.devicePhoneNumberVerified !== 'boolean')
          throw new HttpError(502, 'Invalid carrier verification response.');
        record(
          db,
          user.groupId,
          'network-check',
          { operation: 'number-verification', result, createdAt: iso() },
          user.id,
        );
        c.events.publish(user.groupId);
        res.redirect('/?carrier=' + (result.devicePhoneNumberVerified ? 'verified' : 'mismatch'));
      } catch {
        res.redirect('/?carrier=failed');
      }
    }),
  );
  app.post(
    '/api/carrier/number-verification/start',
    authenticate(db),
    route((req, res) => {
      const user = res.locals.user;
      if (!user.profile.networkConsent)
        throw new HttpError(403, 'Enable carrier data consent first.');
      if (!env.NOKIA_CLIENT_ID || !env.NOKIA_NUMBER_VERIFICATION_URL)
        throw new HttpError(
          503,
          'Configure Nokia fast-flow authorization and number verification first.',
          'NOT_CONFIGURED',
        );
      const url = secureUrl(env.NOKIA_AUTHORIZATION_URL, 'NOKIA_AUTHORIZATION_URL'),
        state = randomBytes(32).toString('hex');
      pending.set(state, {
        userId: user.id,
        hash: res.locals.sessionHash,
        expires: Date.now() + 300000,
      });
      for (const [key, value] of Object.entries({
        client_id: env.NOKIA_CLIENT_ID,
        response_type: 'code',
        scope: env.NOKIA_NUMBER_SCOPE || 'number-verification:verify',
        redirect_uri: c.publicUrl.origin + '/api/carrier/oauth/callback',
        login_hint: user.phone,
        state,
      }))
        url.searchParams.set(key, value);
      res.json({ url: url.toString() });
    }),
  );
  app.post(
    '/api/carrier/webhook',
    route((req, res) => {
      if (!env.NOKIA_WEBHOOK_TOKEN) throw new HttpError(503, 'Webhook is not configured.');
      const supplied = Buffer.from(String(req.headers.authorization || '')),
        expected = Buffer.from('Bearer ' + env.NOKIA_WEBHOOK_TOKEN);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new HttpError(401, 'Invalid webhook credential.');
      const b = z
        .object({
          id: text(200),
          type: text(200),
          time: z.iso.datetime(),
          data: z.object({ subscriptionId: text(200) }).passthrough(),
        })
        .passthrough()
        .parse(req.body);
      if (
        ![
          'org.camaraproject.geofencing-subscriptions.v0.area-entered',
          'org.camaraproject.geofencing-subscriptions.v0.area-left',
          'org.camaraproject.geofencing-subscriptions.v0.subscription-ends',
        ].includes(b.type)
      )
        throw new HttpError(400, 'Unsupported event type.');
      const rows = db.prepare("SELECT * FROM records WHERE kind='network-resource'").all() as {
        group_id: string;
        owner_id: string;
        data: string;
      }[];
      const resource = rows.find(
        (r) =>
          JSON.parse(r.data).providerId === b.data.subscriptionId &&
          JSON.parse(r.data).kind === 'geofencing',
      );
      if (!resource) throw new HttpError(404, 'Subscription not found.');
      const id = 'carrier-event:' + b.id;
      if (!db.prepare('SELECT id FROM records WHERE id=?').get(id))
        transaction(db, () => {
          db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?)').run(
            id,
            resource.group_id,
            resource.owner_id,
            'carrier-event',
            JSON.stringify(b),
            iso(),
          );
          record(db, resource.group_id, 'bulletin', {
            kind: 'risk',
            title: 'Carrier geofence event',
            message: b.type + ' at ' + b.time,
            actorId: resource.owner_id,
            createdAt: iso(),
          });
        });
      c.events.publish(resource.group_id);
      res.sendStatus(204);
    }),
  );
  app.post(
    '/api/carrier/congestion-webhook/:userId',
    route((req, res) => {
      if (!env.NOKIA_WEBHOOK_TOKEN) throw new HttpError(503, 'Webhook is not configured.');
      const supplied = Buffer.from(String(req.headers.authorization || '')),
        expected = Buffer.from('Bearer ' + env.NOKIA_WEBHOOK_TOKEN);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new HttpError(401, 'Invalid webhook credential.');
      const b = z
        .object({
          id: text(200),
          time: z.iso.datetime(),
          data: z.object({ level: text(80) }).passthrough(),
        })
        .passthrough()
        .parse(req.body);
      if (Date.parse(b.time) > Date.now() + 30000 || Date.now() - Date.parse(b.time) > 300000)
        throw new HttpError(400, 'Event is stale or in the future.');
      const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.userId) as any;
      if (!row || !JSON.parse(row.profile).networkConsent)
        throw new HttpError(404, 'Active subscriber not found.');
      const resources = db
        .prepare("SELECT data FROM records WHERE kind='network-resource' AND owner_id=?")
        .all(row.id) as { data: string }[];
      if (!resources.some((r) => JSON.parse(r.data).kind === 'congestion-subscription'))
        throw new HttpError(404, 'Subscription not found.');
      const id = 'congestion-event:' + b.id;
      db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?)').run(
        id,
        row.group_id,
        row.id,
        'congestion-event',
        JSON.stringify(b),
        iso(),
      );
      c.events.publish(row.group_id);
      res.sendStatus(204);
    }),
  );
  return () => {};
}
