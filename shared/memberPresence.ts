import type { Member, Snapshot } from './types.ts';
import { boundaryState } from './boundary.ts';
export function memberLabel(member: Member, data: Snapshot) {
  if (member.status === 'sos') return 'Risk';
  if (data.demoMode) return boundaryState(member, data) === 'inside' ? 'Safe' : 'Risk';
  const lastSeen = Date.parse(member.lastSeen || '');
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 300000) return 'Offline';
  return boundaryState(member, data) === 'inside' ? 'Safe' : 'Risk';
}
