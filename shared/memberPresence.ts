import type { Member, Snapshot } from './types.ts';
import { displayedBoundaryState } from './boundary.ts';
export function memberLabel(member: Member, data: Snapshot) {
  if (member.status === 'sos') return 'Risk';
  const lastSeen = Date.parse(member.lastSeen || '');
  if (!data.demoMode && (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 300000))
    return 'Offline';
  // The badge describes the retained position shown on the map, not a GPS
  // freshness timer. No fix / ambiguous accuracy has no invented safety label.
  const state = displayedBoundaryState(member, data);
  return state === 'inside' ? 'Safe' : state === 'outside' ? 'Risk' : '—';
}
