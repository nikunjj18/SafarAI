import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/src/app.ts';
import { openDatabase } from '../backend/src/db.ts';

async function fixture(filename = ':memory:') {
  const runtime = createApp({
    db: openDatabase(filename),
    env: { APP_URL: 'http://localhost:3000', AI_PROVIDER: 'gemini' },
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port,
    base = 'http://127.0.0.1:' + port;
  function client() {
    let cookie = '',
      csrf = '';
    return {
      get cookie() {
        return cookie;
      },
      async request(
        url: string,
        method = 'GET',
        body?: unknown,
        extra: Record<string, string> = {},
      ) {
        const response = await fetch(base + '/api' + url, {
          method,
          headers: {
            Cookie: cookie,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            'X-CSRF-Token': csrf,
            ...extra,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (response.headers.get('set-cookie'))
          cookie = response.headers.get('set-cookie')!.split(';')[0];
        const text = await response.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
        if (json?.csrf) csrf = json.csrf;
        return { status: response.status, body: json };
      },
    };
  }
  return {
    ...runtime,
    base,
    client,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      runtime.close();
    },
  };
}
let number = 10000000;
const registration = (role = 'leader', extra: Record<string, unknown> = {}) => ({
  name: 'Test ' + number,
  email: 'test' + number + '@example.test',
  phone: '+1555' + number++,
  password: 'test-password-long-123',
  role,
  groupName: 'Test Group',
  ...extra,
});

test('registration, login, CSRF, cross-group isolation, persistence, medical privacy and logout', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'safarai-test-')),
    filename = path.join(directory, 'test.db');
  let f = await fixture(filename);
  try {
    const leader = f.client(),
      input = registration();
    assert.equal((await leader.request('/state')).status, 401);
    const created = await leader.request('/auth/register', 'POST', input);
    assert.equal(created.status, 201);
    const state = (await leader.request('/state')).body;
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0].status, 'unknown');
    assert.equal(state.members[0].telemetry, null);
    assert.equal(
      (
        await leader.request(
          '/profile',
          'PATCH',
          { name: 'Secret name', profile: state.user.profile },
          { 'X-CSRF-Token': 'bad' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await leader.request('/state', 'GET', undefined, { Origin: 'https://evil.example' })).status,
      403,
    );
    const pilgrim = f.client();
    const pilgrimData = registration('pilgrim', { groupCode: state.group.code });
    assert.equal((await pilgrim.request('/auth/register', 'POST', pilgrimData)).status, 201);
    const ps = (await pilgrim.request('/state')).body;
    assert.equal(
      (
        await pilgrim.request('/profile', 'PATCH', {
          name: ps.user.name,
          profile: { ...ps.user.profile, medical: 'PRIVATE_MEDICAL_TEST' },
        })
      ).status,
      200,
    );
    assert.equal(
      JSON.stringify((await leader.request('/state')).body).includes('PRIVATE_MEDICAL_TEST'),
      false,
    );
    assert.equal(
      (await pilgrim.request('/group/broadcast', 'POST', { message: 'Unauthorized' })).status,
      403,
    );
    assert.equal((await f.client().request('/auth/register', 'POST', input)).status, 409);
    assert.equal(
      (
        await f
          .client()
          .request('/auth/register', 'POST', registration('pilgrim', { groupCode: 'invalid' }))
      ).status,
      400,
    );
    const outsider = f.client();
    assert.equal((await outsider.request('/auth/register', 'POST', registration())).status, 201);
    assert.equal((await outsider.request('/members/' + ps.user.id, 'DELETE')).status, 404);
    assert.equal((await outsider.request('/state')).body.members.length, 1);
    assert.equal((await leader.request('/not-an-api')).status, 404);
    await f.stop();
    f = await fixture(filename);
    const returning = f.client();
    assert.equal(
      (
        await returning.request('/auth/login', 'POST', {
          email: input.email,
          password: input.password,
        })
      ).status,
      200,
    );
    assert.equal((await returning.request('/state')).body.members.length, 2);
    assert.equal((await returning.request('/auth/logout', 'POST')).status, 204);
    assert.equal((await returning.request('/state')).status, 401);
    assert.equal(
      (
        await returning.request('/auth/login', 'POST', {
          email: input.email,
          password: 'incorrect',
        })
      ).status,
      401,
    );
  } finally {
    await f.stop();
    if (!path.resolve(directory).startsWith(path.join(tmpdir(), 'safarai-test-')))
      throw new Error('Unsafe cleanup path');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('live group updates, telemetry validation, SOS idempotency, per-user notifications and itinerary CRUD', async () => {
  const f = await fixture();
  try {
    const leader = f.client();
    await leader.request('/auth/register', 'POST', registration());
    const ls = (await leader.request('/state')).body;
    const pilgrim = f.client();
    await pilgrim.request(
      '/auth/register',
      'POST',
      registration('pilgrim', { groupCode: ls.group.code }),
    );
    await leader.request('/group', 'PATCH', {
      name: ls.group.name,
      radius: 300,
      anchor: { lat: 21.4225, lng: 39.8262 },
    });
    assert.equal((await leader.request('/state')).body.group.radius, 150);
    assert.equal((await leader.request('/state')).body.group.anchor, null);
    await leader.request('/telemetry/start', 'POST');
    await leader.request('/telemetry', 'POST', {
      lat: 21.4225,
      lng: 39.8262,
      accuracy: 5,
      observedAt: new Date().toISOString(),
      battery: 90,
    });
    const controller = new AbortController();
    const stream = await fetch(f.base + '/api/events', {
      headers: { Cookie: pilgrim.cookie },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.ok(stream.headers.get('content-type')?.includes('text/event-stream'));
    const reader = stream.body!.getReader();
    await reader.read();
    assert.equal(
      (await leader.request('/group/broadcast', 'POST', { message: 'Meet at the selected point.' }))
        .status,
      201,
    );
    const next = await reader.read();
    assert.match(new TextDecoder().decode(next.value), /event: change/);
    await reader.cancel();
    controller.abort();
    let state = (await pilgrim.request('/state')).body;
    assert.equal(state.bulletins[0].message, 'Meet at the selected point.');
    await pilgrim.request('/notifications/read', 'POST');
    assert.equal((await pilgrim.request('/state')).body.bulletins[0].read, true);
    assert.equal((await leader.request('/state')).body.bulletins[0].read, false);
    await pilgrim.request('/telemetry/start', 'POST');
    const sample = {
      lat: 21.4275,
      lng: 39.8262,
      accuracy: 5,
      observedAt: new Date().toISOString(),
      battery: 80,
    };
    assert.equal(
      (await pilgrim.request('/telemetry', 'POST', { ...sample, lat: 100 })).status,
      400,
    );
    assert.equal(
      (
        await pilgrim.request('/telemetry', 'POST', {
          ...sample,
          observedAt: '2020-01-01T00:00:00.000Z',
        })
      ).status,
      400,
    );
    assert.equal((await pilgrim.request('/telemetry', 'POST', sample)).status, 200);
    state = (await pilgrim.request('/state')).body;
    assert.equal(state.members.find((m: any) => m.id === state.user.id).status, 'attention');
    assert.equal((await pilgrim.request('/sos', 'POST')).status, 201);
    await pilgrim.request('/sos', 'POST');
    state = (await pilgrim.request('/state')).body;
    assert.equal(state.incidents.length, 1);
    assert.equal(state.members.find((m: any) => m.id === state.user.id).status, 'sos');
    assert.equal(
      (
        await pilgrim.request('/incidents/' + state.incidents[0].id + '/resolve', 'POST', {
          resolution: 'No',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await leader.request('/incidents/' + state.incidents[0].id + '/resolve', 'POST', {
          resolution: 'Leader contacted member.',
        })
      ).status,
      200,
    );
    const after = (await pilgrim.request('/state')).body.members.find(
      (m: any) => m.id === state.user.id,
    );
    assert.equal(after.status, 'attention');
    assert.equal(after.telemetry.lat, sample.lat);
    const cp = {
      title: 'Meeting checkpoint',
      description: 'Actual entered itinerary',
      lat: 21.4225,
      lng: 39.8262,
      scheduledAt: new Date().toISOString(),
      status: 'upcoming',
    };
    const created = await leader.request('/checkpoints', 'POST', cp);
    assert.equal(created.status, 201);
    assert.equal(
      (
        await leader.request('/checkpoints/' + created.body.id, 'PATCH', {
          ...cp,
          status: 'completed',
        })
      ).status,
      200,
    );
    assert.equal((await pilgrim.request('/state')).body.checkpoints[0].status, 'completed');
    assert.equal((await leader.request('/checkpoints/' + created.body.id, 'DELETE')).status, 204);
    const p1 = await leader.request('/meeting-points', 'POST', {
      name: 'One',
      lat: 1,
      lng: 1,
      crowd: null,
      active: true,
    });
    await leader.request('/meeting-points', 'POST', {
      name: 'Two',
      lat: 2,
      lng: 2,
      crowd: 25,
      active: true,
    });
    assert.equal(
      (await pilgrim.request('/state')).body.meetingPoints.filter((p: any) => p.active).length,
      1,
    );
    await leader.request('/meeting-points/' + p1.body.id, 'DELETE');
    assert.equal(
      (await pilgrim.request('/copilot/chat', 'POST', { message: 'Help with itinerary' })).status,
      503,
    );
    assert.deepEqual((await pilgrim.request('/copilot/messages')).body, []);
    assert.equal((await pilgrim.request('/carrier/location-retrieval', 'POST', {})).status, 403);
    assert.equal((await pilgrim.request('/carrier/results')).body.resources.length, 0);
    await pilgrim.request('/telemetry', 'DELETE');
    assert.equal(
      (
        await pilgrim.request('/telemetry', 'POST', {
          ...sample,
          observedAt: new Date().toISOString(),
        })
      ).status,
      409,
    );
    assert.equal(
      (await pilgrim.request('/state')).body.members.find((m: any) => m.id === state.user.id)
        .telemetry,
      null,
    );
  } finally {
    await f.stop();
  }
});

test('helpdesk number is validated, leader-managed and isolated by group', async () => {
  const f = await fixture();
  try {
    const leader = f.client(),
      pilgrim = f.client(),
      outsider = f.client();
    assert.equal((await leader.request('/auth/register', 'POST', registration())).status, 201);
    const state = (await leader.request('/state')).body;
    await pilgrim.request(
      '/auth/register',
      'POST',
      registration('pilgrim', { groupCode: state.group.code }),
    );
    await outsider.request('/auth/register', 'POST', registration());
    assert.equal(
      (await leader.request('/group/helpdesk', 'PATCH', { phone: 'not-a-phone' })).status,
      400,
    );
    assert.equal(
      (await pilgrim.request('/group/helpdesk', 'PATCH', { phone: '+15550001234' })).status,
      403,
    );
    assert.equal(
      (await leader.request('/group/helpdesk', 'PATCH', { phone: '+15550001234' })).status,
      200,
    );
    assert.equal((await pilgrim.request('/state')).body.group.helpdeskPhone, '+15550001234');
    assert.equal((await outsider.request('/state')).body.group.helpdeskPhone, '');
    assert.equal((await leader.request('/group/helpdesk', 'PATCH', { phone: '' })).status, 200);
    assert.equal((await leader.request('/state')).body.group.helpdeskPhone, '');
  } finally {
    await f.stop();
  }
});
