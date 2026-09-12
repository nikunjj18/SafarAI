import type { Express } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Context } from './context.ts';
import { route, HttpError } from './errors.ts';
export type CrowdReading = {
  level: 'low' | 'medium' | 'high' | 'unknown';
  source: string | null;
  observedAt: string | null;
};
type Observation = {
  place_id: string;
  level: 'low' | 'medium' | 'high';
  source: string;
  observed_at: string;
};
export const CROWD_MAX_AGE = 120000;
export function crowdRoutes(app: Express, c: Context) {
  c.db.exec(
    'CREATE TABLE IF NOT EXISTS crowd_readings(place_id TEXT PRIMARY KEY,level TEXT NOT NULL,source TEXT NOT NULL,observed_at TEXT NOT NULL)',
  );
  app.post(
    '/api/crowd/observations',
    route((req, res) => {
      const token = c.env.CROWD_WEBHOOK_TOKEN,
        source = c.env.CROWD_SOURCE_NAME;
      if (!token || token.length < 32 || !source)
        throw new HttpError(503, 'A verified pedestrian crowd feed is not configured.');
      const supplied = Buffer.from(String(req.headers.authorization || '')),
        expected = Buffer.from('Bearer ' + token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new HttpError(401, 'Invalid crowd feed credential.');
      const b = z
        .object({
          placeId: z.string().trim().min(1).max(250),
          level: z.enum(['low', 'medium', 'high']),
          observedAt: z.iso.datetime(),
        })
        .strict()
        .parse(req.body);
      const age = Date.now() - Date.parse(b.observedAt);
      if (age < 0 || age > CROWD_MAX_AGE)
        throw new HttpError(400, 'Crowd readings must be measured within the last two minutes.');
      c.db
        .prepare(
          'INSERT INTO crowd_readings VALUES (?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET level=excluded.level,source=excluded.source,observed_at=excluded.observed_at WHERE julianday(excluded.observed_at)>julianday(crowd_readings.observed_at)',
        )
        .run(b.placeId, b.level, source.slice(0, 120), b.observedAt);
      c.db
        .prepare('DELETE FROM crowd_readings WHERE julianday(observed_at)<julianday(?)')
        .run(new Date(Date.now() - 86400000).toISOString());
      res.sendStatus(204);
    }),
  );
}
export function crowdEvidence(c: Context) {
  const now = Date.now();
  const rows = (
    c.db.prepare('SELECT * FROM crowd_readings ORDER BY place_id').all() as Observation[]
  ).filter(
    (r) => now - Date.parse(r.observed_at) >= 0 && now - Date.parse(r.observed_at) <= CROWD_MAX_AGE,
  );
  return {
    signature: JSON.stringify(rows),
    forPlace(placeId: string): CrowdReading {
      const r = rows.find((row) => row.place_id === placeId);
      return r
        ? { level: r.level, source: r.source, observedAt: r.observed_at }
        : { level: 'unknown', source: null, observedAt: null };
    },
  };
}
export function leastCongested<T extends { crowd: CrowdReading }>(candidates: T[]): T[] {
  const rank = { low: 0, medium: 1, unknown: 2, high: 3 };
  const best = Math.min(...candidates.map((p) => rank[p.crowd.level]));
  return candidates.filter((p) => rank[p.crowd.level] === best);
}
