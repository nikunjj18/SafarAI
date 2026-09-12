import type { Telemetry } from './types.ts';
// Simulator retrieval freshness is separate from the original measurement time.
// This permits a labelled test-area reference, never a precise live safety claim.
export function usableMeetingAnchor(t: Telemetry | null | undefined): boolean {
  if (!t) return false;
  const age =
    Date.now() - Date.parse(t.source === 'nokia-simulator' ? t.receivedAt || '' : t.observedAt);
  return (
    Number.isFinite(age) &&
    age >= -30000 &&
    age < 120000 &&
    (t.source === 'nokia-simulator' || t.accuracy <= 150)
  );
}
