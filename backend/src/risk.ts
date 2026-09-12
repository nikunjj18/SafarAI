import type { Group, Member, Telemetry, Incident } from '../../shared/types.ts';
import { type DB, type UserRow, telemetryFrom, records, record } from './db.ts';

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (v: number) => (v * Math.PI) / 180;
  const dlat = radians(b.lat - a.lat),
    dlng = radians(b.lng - a.lng);
  const v =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dlng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v))));
}
export function assess(
  row: UserRow,
  group: Group,
  leaderTelemetry: Telemetry | null,
  sos: boolean,
  now = Date.now(),
): Member {
  const telemetry = telemetryFrom(row);
  const stale = !telemetry || now - Date.parse(telemetry.observedAt) > 120000;
  const anchor =
    group.anchor ||
    (leaderTelemetry && now - Date.parse(leaderTelemetry.observedAt) <= 120000
      ? leaderTelemetry
      : null);
  const distance = telemetry && anchor ? distanceMeters(telemetry, anchor) : null;
  const uncertainty = telemetry
    ? telemetry.accuracy +
      (group.anchor || row.id === group.leaderId ? 0 : leaderTelemetry?.accuracy || 0)
    : 0;
  const factors: string[] = [];
  let status: Member['status'] = 'unknown',
    riskScore: number | null = null;
  if (telemetry) {
    if (stale) {
      status = 'stale';
      factors.push('Location is older than two minutes.');
    } else if (distance === null)
      factors.push('Set a meeting boundary or ask the leader to share location.');
    else if (uncertainty > group.radius || Math.abs(distance - group.radius) <= uncertainty)
      factors.push('Location accuracy is insufficient to determine boundary crossing.');
    else {
      status = distance - uncertainty > group.radius ? 'attention' : 'within_boundary';
      riskScore =
        status === 'attention'
          ? Math.min(80, Math.round(40 + (40 * (distance - group.radius)) / group.radius))
          : 0;
      factors.push(
        status === 'attention'
          ? 'Reported position is outside the group boundary.'
          : 'Recent position is within the configured boundary; this is not a safety guarantee.',
      );
    }
    if (telemetry.battery !== null && telemetry.battery <= 20) {
      factors.push('Device reported a low battery.');
      if (!stale) {
        status = 'attention';
        riskScore = Math.min(100, (riskScore || 0) + 20);
      }
    }
  } else factors.push('No location has been shared.');
  if (sos) {
    status = 'sos';
    riskScore = 100;
    factors.unshift('An unresolved SOS was submitted.');
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    telemetry,
    lastSeen: row.last_seen,
    status,
    distance,
    riskScore,
    factors,
  };
}
export function members(db: DB, group: Group) {
  const rows = db
    .prepare('SELECT * FROM users WHERE group_id=? ORDER BY name')
    .all(group.id) as UserRow[];
  const leader = rows.find((r) => r.id === group.leaderId);
  const incidents = records<Incident>(db, group.id, 'incident');
  return rows.map((row) =>
    assess(
      row,
      group,
      leader ? telemetryFrom(leader) : null,
      incidents.some((i) => i.memberId === row.id && !i.resolvedAt),
    ),
  );
}
export function evaluate(db: DB, group: Group) {
  let changed = false;
  for (const member of members(db, group)) {
    const previous = db.prepare('SELECT status FROM risk_states WHERE user_id=?').get(member.id) as
      { status: string } | undefined;
    if (previous?.status === member.status) continue;
    changed = true;
    db.prepare(
      'INSERT INTO risk_states VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status',
    ).run(member.id, member.status);
    if (member.status === 'attention')
      record(db, group.id, 'bulletin', {
        kind: 'risk',
        title: member.name + ': ' + member.status,
        message: member.factors.join(' '),
        actorId: member.id,
        createdAt: new Date().toISOString(),
      });
  }
  return changed;
}
