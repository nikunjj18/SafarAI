import type { Express } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { record, records, updateRecord } from './db.ts';
import { route, HttpError } from './errors.ts';
import { coord } from './validation.ts';
import { groupFor, changed, iso, type Context } from './context.ts';
import { userFrom, type UserRow } from './db.ts';
const locks = new WeakMap<Context, Set<string>>();
import type { User, NetworkResource } from '../../shared/types.ts';
export function networkRoutes(app: Express, c: Context) {
  const { db, env, providers } = c,
    busy = new Set<string>();
  app.use(
    '/api/carrier',
    rateLimit({
      windowMs: 60000,
      limit: 30,
      keyGenerator: (_req, res) => res.locals.user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many carrier requests. Wait a minute.' },
    }),
  );

  app.get('/api/carrier/results', (_req, res) =>
    res.json({
      checks: records(db, res.locals.user.groupId, 'network-check', res.locals.user.id),
      resources: records(db, res.locals.user.groupId, 'network-resource', res.locals.user.id),
      logs: db
        .prepare(
          'SELECT operation,status,duration,created_at FROM audit WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
        )
        .all(res.locals.user.id),
    }),
  );
  app.post(
    '/api/carrier/:operation',
    route(async (req, res) => {
      const operation = z
        .enum([
          'location-retrieval',
          'device-status',
          'qod',
          'geofencing',
          'congestion',
          'congestion-subscription',
        ])
        .parse(req.params.operation);
      const b = z
        .object({ duration: z.number().int().min(60).max(3600).optional() })
        .strict()
        .parse(req.body || {});
      res.json(await performNetwork(c, res.locals.user, operation, b));
    }),
  );
  for (const method of ['get', 'delete'] as const)
    app[method](
      '/api/carrier/resources/:id',
      route(async (req, res) => {
        const user: User = res.locals.user,
          resource = records<NetworkResource>(db, user.groupId, 'network-resource', user.id).find(
            (r) => r.id === req.params.id,
          );
        if (!resource) throw new HttpError(404, 'Resource not found.');
        let result: Record<string, any>;
        try {
          result = await providers.carrier(
            user,
            resource.kind,
            undefined,
            method.toUpperCase(),
            resource.providerId,
          );
        } catch (error) {
          if (method === 'delete' && error instanceof HttpError && error.code === 'UPSTREAM_404')
            result = { status: 'not_found_at_provider' };
          else throw error;
        }
        delete result.sinkCredential;
        if (method === 'delete') db.prepare('DELETE FROM records WHERE id=?').run(resource.id);
        else updateRecord(db, resource.id, { ...resource, data: result, updatedAt: iso() });
        res.json({ result, receivedAt: iso() });
      }),
    );
}

export async function performNetwork(
  c: Context,
  user: User,
  operation:
    | 'location-retrieval'
    | 'device-status'
    | 'qod'
    | 'geofencing'
    | 'congestion'
    | 'congestion-subscription',
  b: { duration?: number } = {},
) {
  const { db, env, providers } = c;
  let busy = locks.get(c);
  if (!busy) {
    busy = new Set();
    locks.set(c, busy);
  }
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as UserRow | undefined;
  if (!row) throw new HttpError(404, 'Account no longer exists.');
  user = userFrom(row);
  if (busy.has(user.id)) throw new HttpError(409, 'Wait for the current carrier request.');
  const group = groupFor(c, user),
    area = group.anchor
      ? {
          areaType: 'CIRCLE',
          center: { latitude: group.anchor.lat, longitude: group.anchor.lng },
          radius: group.radius,
        }
      : null;
  let payload: unknown;
  if (operation === 'location-retrieval')
    payload = { device: { phoneNumber: user.phone }, maxAge: 60 };
  if (operation === 'device-status') payload = { device: { phoneNumber: user.phone } };

  if (operation === 'qod') {
    if (!env.QOD_APPLICATION_SERVER_IPV4 || !env.QOD_PROFILE)
      throw new HttpError(
        503,
        'Configure QOD_APPLICATION_SERVER_IPV4 and QOD_PROFILE. QoD applies only to traffic to that server.',
        'NOT_CONFIGURED',
      );
    if (!z.ipv4().safeParse(env.QOD_APPLICATION_SERVER_IPV4).success)
      throw new HttpError(503, 'Invalid QOD_APPLICATION_SERVER_IPV4.');
    payload = {
      device: { phoneNumber: user.phone },
      applicationServer: { ipv4Address: env.QOD_APPLICATION_SERVER_IPV4 },
      qosProfile: env.QOD_PROFILE,
      duration: b.duration || 300,
    };
  }
  if (operation === 'geofencing') {
    if (!area) throw new HttpError(409, 'The leader must set a fixed group boundary first.');
    if (c.publicUrl.protocol !== 'https:' || !env.NOKIA_WEBHOOK_TOKEN)
      throw new HttpError(
        503,
        'Carrier geofencing requires public HTTPS APP_URL and NOKIA_WEBHOOK_TOKEN.',
      );
    payload = {
      protocol: 'HTTP',
      sink: c.publicUrl.origin + '/api/carrier/webhook',
      types: ['org.camaraproject.geofencing-subscriptions.v0.area-left'],
      sinkCredential: {
        credentialType: 'ACCESSTOKEN',
        accessToken: env.NOKIA_WEBHOOK_TOKEN,
        accessTokenType: 'bearer',
        accessTokenExpiresUtc: new Date(Date.now() + 3600000).toISOString(),
      },
      config: {
        subscriptionDetail: { device: { phoneNumber: user.phone }, area },
        subscriptionExpireTime: new Date(Date.now() + 3600000).toISOString(),
        initialEvent: true,
      },
    };
  }
  if (operation === 'congestion')
    throw new HttpError(410, 'Congestion is consumed through authenticated subscription events.');
  if (operation === 'congestion-subscription') {
    if (c.publicUrl.protocol !== 'https:' || !env.NOKIA_WEBHOOK_TOKEN)
      throw new HttpError(503, 'A public HTTPS APP_URL and NOKIA_WEBHOOK_TOKEN are required.');
    payload = {
      device: { phoneNumber: user.phone },
      webhook: {
        notificationUrl: c.publicUrl.origin + '/api/carrier/congestion-webhook/' + user.id,
        notificationAuthToken: env.NOKIA_WEBHOOK_TOKEN,
      },
      subscriptionExpireTime: new Date(Date.now() + 3600000).toISOString(),
    };
  }
  busy.add(user.id);
  try {
    const result = await providers.carrier(user, operation, payload);
    if (
      operation === 'qod' ||
      operation === 'geofencing' ||
      operation === 'congestion-subscription'
    ) {
      const providerId = result.sessionId || result.id || result.subscriptionId;
      if (typeof providerId !== 'string')
        throw new HttpError(
          502,
          'Provider did not return a resource ID. Check the provider portal before retrying.',
          'UPSTREAM_FORMAT',
        );
      // Do not expose the webhook authentication secret if echoed by the provider.
      const visible = { ...result };
      delete visible.sinkCredential;
      record(
        db,
        user.groupId,
        'network-resource',
        { kind: operation, providerId, data: visible, updatedAt: iso() },
        user.id,
      );
      delete result.sinkCredential;
    } else
      record(db, user.groupId, 'network-check', { operation, result, createdAt: iso() }, user.id);
    if (operation === 'location-retrieval' && result.area?.areaType === 'CIRCLE') {
      const sample = coord
        .extend({ accuracy: z.number().min(0).max(100000), observedAt: z.iso.datetime() })
        .safeParse({
          lat: result.area.center?.latitude,
          lng: result.area.center?.longitude,
          accuracy: result.area.radius,
          observedAt: result.lastLocationTime,
        });
      if (sample.success && Date.parse(sample.data.observedAt) <= Date.now() + 30000) {
        const old = row.telemetry ? JSON.parse(row.telemetry) : null;
        if (!old || Date.parse(sample.data.observedAt) >= Date.parse(old.observedAt))
          db.prepare('UPDATE users SET telemetry=? WHERE id=?').run(
            JSON.stringify({ ...sample.data, source: 'carrier', battery: null }),
            user.id,
          );
      }
    }
    changed(c, user.groupId);
    return { result, receivedAt: iso() };
  } finally {
    busy.delete(user.id);
  }
}
