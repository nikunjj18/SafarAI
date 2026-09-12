import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryState } from '../shared/boundary.ts';
import { openDatabase, newGroupCode } from '../backend/src/db.ts';
import type { Snapshot, Member } from '../shared/types.ts';
test('saved positions work only in explicit demo mode without changing original GPS evidence', () => {
  const m = {
    id: 'one',
    distance: null,
    telemetry: { lat: 21, lng: 39, accuracy: 1000, observedAt: '2020-01-01T00:00:00.000Z' },
  } as Member;
  const d = { group: { leaderId: 'one' }, members: [m] } as Snapshot;
  assert.equal(boundaryState(m, d), 'unknown');
  assert.equal(boundaryState(m, { ...d, demoMode: true }), 'inside');
  assert.equal(
    boundaryState(
      { ...m, id: 'two', telemetry: { ...m.telemetry!, lat: 21.01 } },
      { ...d, demoMode: true },
    ),
    'outside',
  );
  assert.equal(m.telemetry!.accuracy, 1000);
  assert.equal(m.telemetry!.observedAt, '2020-01-01T00:00:00.000Z');
});
test('five-character invitation codes are unique among existing groups', () => {
  const db = openDatabase(':memory:');
  try {
    for (let i = 0; i < 50; i++) {
      const code = newGroupCode(db);
      assert.match(code, /^[A-Z2-9]{5}$/);
      db.prepare('INSERT INTO groups(id,name,code,leader_id) VALUES (?,?,?,?)').run(
        String(i),
        'Test',
        code,
        'leader',
      );
    }
  } finally {
    db.close();
  }
});
