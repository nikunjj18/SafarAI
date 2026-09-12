import type { Member, Snapshot } from './types.ts';
export function coordinateDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = Math.PI / 180,
    x = (b.lat - a.lat) * r,
    y = (b.lng - a.lng) * r;
  const v = Math.sin(x / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(y / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
export function boundaryState(member: Member, data: Snapshot): 'inside' | 'outside' | 'unknown' {
  const t = member.telemetry,
    leader = data.members.find((m) => m.id === data.group.leaderId)?.telemetry;
  if (data.demoMode && t && leader)
    return coordinateDistance(t, leader) <= 150 ? 'inside' : 'outside';
  if (
    !t ||
    Date.now() - Date.parse(t.observedAt) > 120000 ||
    !leader ||
    Date.now() - Date.parse(leader.observedAt) > 120000 ||
    member.distance === null
  )
    return 'unknown';
  const accuracy = t.accuracy + (member.id === data.group.leaderId ? 0 : leader.accuracy);
  if (accuracy > 150) return 'unknown';
  if (member.distance + accuracy < 150) return 'inside';
  if (member.distance - accuracy > 150) return 'outside';
  return 'unknown';
}
