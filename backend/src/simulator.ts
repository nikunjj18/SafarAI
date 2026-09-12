import { z } from 'zod';
import { HttpError } from './errors.ts';
import { userFrom, type UserRow } from './db.ts';
import { changed, iso, type Context } from './context.ts';
import type { User } from '../../shared/types.ts';
const jobs = new WeakMap<Context, Map<string, Promise<any>>>();
export async function refreshSimulator(c: Context, user: User): Promise<any> {
  const { db } = c;
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as UserRow | undefined;
  if (
    !row ||
    !userFrom(row).profile.simulator ||
    !userFrom(row).profile.networkConsent ||
    !row.location_sharing
  )
    throw new HttpError(403, 'Simulator location sharing is not enabled.');
  user = userFrom(row);
  const cached = row.telemetry ? JSON.parse(row.telemetry) : null;
  if (
    cached?.source === 'nokia-simulator' &&
    Date.now() - Date.parse(cached.receivedAt || '') < 10000
  )
    return { accepted: true, telemetry: cached };
  let active = jobs.get(c);
  if (!active) {
    active = new Map();
    jobs.set(c, active);
  }
  if (active.has(user.id)) return active.get(user.id);
  const task = (async () => {
    try {
      const result = await c.providers.carrier(user, 'location-retrieval', {
        device: { phoneNumber: user.phone },
        maxAge: 60,
      });
      const parsed = z
        .object({
          area: z.object({
            areaType: z.literal('CIRCLE'),
            center: z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            }),
            radius: z.number().min(0).max(100000),
          }),
          lastLocationTime: z.iso.datetime(),
        })
        .safeParse(result);
      if (!parsed.success)
        throw new HttpError(
          502,
          'Nokia did not return a supported location circle and measurement timestamp. Check your simulator device setup.',
        );
      const r = parsed.data,
        age = Date.now() - Date.parse(r.lastLocationTime);
      if (age < -30000) throw new HttpError(409, 'Nokia returned a future measurement timestamp.');
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as
        UserRow | undefined;
      if (
        !current ||
        !current.location_sharing ||
        !userFrom(current).profile.networkConsent ||
        !userFrom(current).profile.simulator
      )
        throw new HttpError(409, 'Simulator location sharing has been stopped.');
      const previous = current.telemetry ? JSON.parse(current.telemetry) : null;
      if (previous && Date.parse(previous.observedAt) > Date.parse(r.lastLocationTime))
        return { accepted: false };
      const telemetry = {
        lat: r.area.center.latitude,
        lng: r.area.center.longitude,
        accuracy: r.area.radius,
        observedAt: r.lastLocationTime,
        battery: null,
        source: 'nokia-simulator',
        receivedAt: iso(),
      };
      db.prepare('UPDATE users SET telemetry=?,last_seen=? WHERE id=?').run(
        JSON.stringify(telemetry),
        iso(),
        user.id,
      );
      changed(c, user.groupId);
      return { accepted: true, telemetry };
    } finally {
      active!.delete(user.id);
    }
  })();
  active.set(user.id, task);
  return task;
}

// Poll consenting simulator devices only while someone is viewing their group.
export function startSimulatorPolling(c: Context) {
  const activeGroups = new Map<string, number>();
  let closed = false,
    running = false;
  const timer = setInterval(async () => {
    if (closed || running) return;
    running = true;
    try {
      for (const [groupId, seen] of activeGroups) {
        if (Date.now() - seen > 90000) {
          activeGroups.delete(groupId);
          continue;
        }
        const rows = c.db
          .prepare('SELECT * FROM users WHERE group_id=? AND location_sharing=1')
          .all(groupId) as UserRow[];
        for (const row of rows) {
          if (closed) return;
          const user = userFrom(row),
            t = row.telemetry ? JSON.parse(row.telemetry) : null;
          if (!user.profile.simulator || !user.profile.networkConsent) continue;
          if (t?.receivedAt && Date.now() - Date.parse(t.receivedAt) < 25000) continue;
          try {
            await refreshSimulator(c, user);
          } catch {
            /* Provider failures preserve the previous timestamp and uncertain status. */
          }
        }
      }
    } finally {
      running = false;
    }
  }, 30000);
  timer.unref();
  return {
    touch(groupId: string) {
      activeGroups.set(groupId, Date.now());
    },
    close() {
      closed = true;
      clearInterval(timer);
      activeGroups.clear();
    },
  };
}
