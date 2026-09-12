import type { Member, Snapshot } from './types.ts';
import { boundaryState } from './boundary.ts';
export function memberLabel(member: Member, data: Snapshot) {
  if (member.status === 'sos') return 'Risk';
  if (data.demoMode) {
    const state = boundaryState(member, data);
    return state === 'inside' ? 'Safe' : state === 'outside' ? 'Risk' : 'Location unavailable';
  }
  const lastSeen = Date.parse(member.lastSeen || '');
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 300000) return 'Offline';
  if (member.telemetry && Date.now() - Date.parse(member.telemetry.observedAt) > 120000)
    return 'Last known';
  const state = boundaryState(member, data);
  return state === 'inside' ? 'Safe' : state === 'outside' ? 'Risk' : 'Location unavailable';
}
