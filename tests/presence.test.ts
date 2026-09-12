import test from 'node:test';
import assert from 'node:assert/strict';
import { memberLabel } from '../shared/memberPresence.ts';
import type { Member, Snapshot } from '../shared/types.ts';
test('GPS loss does not make a connected member offline or safe; lost heartbeat and SOS stay distinct', () => {
  const m = {
    id: 'one',
    lastSeen: new Date().toISOString(),
    status: 'stale',
    telemetry: null,
    distance: null,
  } as Member;
  const data = { group: { leaderId: 'one' }, members: [m] } as Snapshot;
  assert.equal(memberLabel(m, data), 'Risk');
  assert.equal(
    memberLabel({ ...m, lastSeen: new Date(Date.now() - 310000).toISOString() }, data),
    'Offline',
  );
  assert.equal(memberLabel({ ...m, lastSeen: null, status: 'sos' }, data), 'Risk');
});
