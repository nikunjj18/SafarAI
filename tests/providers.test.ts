import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type UserRow } from '../backend/src/db.ts';
import { createProviders, fetchJson, type Fetcher } from '../backend/src/providers.ts';
import { HttpError } from '../backend/src/errors.ts';
import { assess, distanceMeters } from '../backend/src/risk.ts';
import type { User, Group } from '../shared/types.ts';

const user: User = {
  id: 'unit-user',
  name: 'Unit test',
  email: 'unit@example.test',
  phone: '+15551234567',
  role: 'pilgrim',
  groupId: 'unit-group',
  profile: {
    language: 'en',
    medical: 'Private unit medical data',
    emergencyContact: '',
    theme: 'dark',
    notifications: false,
    networkConsent: true,
  },
};
test('upstream failures, timeouts and missing configuration never return simulated success', async () => {
  const db = openDatabase(':memory:');
  try {
    const missing = createProviders({}, db);
    await assert.rejects(
      () => missing.carrier(user, 'qod', {}),
      (e: unknown) => e instanceof HttpError && e.status === 503,
    );
    const failure = (async () =>
      new Response(JSON.stringify({ error: 'denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })) as Fetcher;
    const service = createProviders(
      {
        NOKIA_RAPIDAPI_KEY: 'test-key-not-real',
        NOKIA_QOD_URL: 'https://provider.example/sessions',
      },
      db,
      failure,
    );
    await assert.rejects(
      () => service.carrier(user, 'qod', {}),
      (e: unknown) => e instanceof HttpError && e.status === 502,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get()!.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get()!.n, 0);
    await assert.rejects(
      () =>
        fetchJson(
          (async () => {
            throw new DOMException('test timeout', 'TimeoutError');
          }) as Fetcher,
          'https://provider.example',
        ),
      (e: unknown) => e instanceof HttpError && e.status === 504,
    );
    await assert.rejects(
      () =>
        fetchJson(
          (async () =>
            new Response('<html>error</html>', {
              headers: { 'Content-Type': 'text/html' },
            })) as Fetcher,
          'https://provider.example',
        ),
      (e: unknown) => e instanceof HttpError && e.status === 502,
    );
    await assert.rejects(() =>
      fetchJson(
        (async () =>
          new Response('not json', { headers: { 'Content-Type': 'application/json' } })) as Fetcher,
        'https://provider.example',
      ),
    );
  } finally {
    db.close();
  }
});

test('carrier adapter forwards real request parameters and returns provider-assigned IDs unchanged', async () => {
  const db = openDatabase(':memory:');
  let received: RequestInit | undefined,
    url = '';
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    received = init;
    url = String(input);
    return new Response(
      JSON.stringify({
        sessionId: 'provider-assigned-id',
        qosStatus: 'REQUESTED',
        nested: { apiKey: 'test-only-key' },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }) as Fetcher;
  try {
    const service = createProviders(
      {
        NOKIA_RAPIDAPI_KEY: 'test-only-key',
        NOKIA_RAPIDAPI_HOST: 'provider.example',
        NOKIA_QOD_URL: 'https://provider.example/sessions',
      },
      db,
      fetcher,
    );
    const payload = { device: { phoneNumber: user.phone }, duration: 300 };
    const result = await service.carrier(user, 'qod', payload);
    assert.equal(url, 'https://provider.example/sessions');
    assert.deepEqual(JSON.parse(String(received?.body)), payload);
    assert.equal(result.sessionId, 'provider-assigned-id');
    assert.equal(result.qosStatus, 'REQUESTED');
    assert.equal(result.nested.apiKey, '[redacted]');
    assert.equal((received?.headers as Record<string, string>)['X-RapidAPI-Key'], 'test-only-key');
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM audit').all()).includes('test-only-key'),
      false,
    );
  } finally {
    db.close();
  }
});

test('risk uses freshness and accuracy; resolving SOS cannot manufacture a safe position', () => {
  const group: Group = {
    id: 'g',
    name: 'g',
    code: 'code',
    leaderId: 'leader',
    radius: 150,
    anchor: { lat: 0, lng: 0 },
  };
  const row: UserRow = {
    id: 'u',
    group_id: 'g',
    email: 'u@example.test',
    phone: '+15551234567',
    name: 'u',
    role: 'pilgrim',
    password: '',
    profile: '{}',
    telemetry: null,
    last_seen: null,
  };
  assert.equal(assess(row, group, null, false).status, 'unknown');
  const recent = {
    lat: 0.003,
    lng: 0,
    accuracy: 5,
    observedAt: new Date().toISOString(),
    source: 'browser',
    battery: 80,
  };
  row.telemetry = JSON.stringify(recent);
  assert.equal(assess(row, group, null, false).status, 'attention');
  assert.equal(assess(row, group, null, true).status, 'sos');
  assert.equal(assess(row, group, null, false, Date.now() + 130000).status, 'stale');
  row.telemetry = JSON.stringify({ ...recent, accuracy: 1000 });
  assert.equal(assess(row, group, null, false).status, 'unknown');
  assert.equal(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  assert.ok(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) > 111000);
});
