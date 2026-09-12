import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../backend/src/app.ts';
import { openDatabase } from '../backend/src/db.ts';
import type { Fetcher } from '../backend/src/providers.ts';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
async function fixture(
  invalidPlace = false,
  foreignMember = false,
  simulator = false,
  stale = false,
) {
  let searches = 0;
  const runtime = createApp({
    db: openDatabase(':memory:'),
    env: {
      APP_URL: 'http://localhost:3000',
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'fake-test-key',
      GROQ_MODEL: 'test-model',
      GOOGLE_PLACES_API_KEY: 'private-places-test',
      GOOGLE_MAPS_BROWSER_KEY: 'public-browser-test',
      CROWD_WEBHOOK_TOKEN: 'test-only-verified-crowd-token-12345678',
      CROWD_SOURCE_NAME: 'Test pedestrian sensor',
      NOKIA_RAPIDAPI_KEY: 'test-nokia-server-key',
    },
    fetcher: (async (url, init) => {
      if (String(url).endsWith('/audio/transcriptions')) {
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
        assert.equal(init.body.get('language'), 'en');
        return json({ text: 'Find my meeting point' });
      }
      const b = JSON.parse(String(init?.body));
      if (String(url).includes('places.googleapis.com')) {
        searches++;
        assert.equal(b.locationRestriction.circle.radius, 600);
        return json({
          places: [
            {
              id: 'near-place',
              displayName: { text: 'Test public meeting place' },
              location: { latitude: 21.427, longitude: 39.8262 },
              formattedAddress: 'Test address',
              businessStatus: 'OPERATIONAL',
            },
            {
              id: 'closer-place',
              displayName: { text: 'Another public place' },
              location: { latitude: 21.423, longitude: 39.8262 },
            },
            {
              id: 'far-away',
              displayName: { text: 'Far away' },
              location: { latitude: 22, longitude: 40 },
            },
          ],
        });
      }
      if (String(url).includes('location-retrieval')) {
        assert.equal(b.device.phoneNumber, '+15550008000');
        return json({
          area: {
            areaType: 'CIRCLE',
            center: { latitude: 21.4225, longitude: 39.8262 },
            radius: 1000,
          },
          lastLocationTime: new Date(Date.now() - (stale ? 180000 : 0)).toISOString(),
        });
      }
      const system = b.messages[0].content;
      if (system.startsWith('Select one'))
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  placeId: invalidPlace
                    ? 'invented-id'
                    : JSON.parse(b.messages[1].content).candidates[0].placeId,
                }),
              },
            },
          ],
        });
      if (system.startsWith('You select')) {
        const input = JSON.parse(b.messages[1].content);
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'call_member',
                  response: 'Model commentary is not an executable action.',
                  memberId: foreignMember ? 'outside-group-id' : input.leaderId,
                }),
              },
            },
          ],
        });
      }
      return json({ choices: [{ message: { content: 'Test answer' } }] });
    }) as Fetcher,
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const register = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test leader',
      email: 'leader@example.test',
      phone: '+15550008000',
      password: 'test-password-1234',
      role: 'leader',
      groupName: 'Test group',
      simulator,
    }),
  });
  const auth = (await register.json()) as any,
    cookie = register.headers.get('set-cookie')!.split(';')[0];
  const request = async (path: string, body?: unknown) => {
    const r = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: r.status === 204 ? null : ((await r.json()) as any) };
  };
  const locate = async () => {
    await request('/telemetry/start', {});
    await request('/telemetry', {
      lat: 21.4225,
      lng: 39.8262,
      accuracy: 5,
      observedAt: new Date().toISOString(),
      battery: 85,
    });
  };
  return {
    request,
    locate,
    observe: async (body: unknown, token = 'test-only-verified-crowd-token-12345678') =>
      fetch(base + '/api/crowd/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      }),
    searches: () => searches,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      runtime.close();
    },
  };
}
test('dynamic meeting uses real provider coordinates inside 600 m, requires GPS and coalesces concurrent searches', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/journey/meeting-point', {})).status, 409);
    assert.equal(f.searches(), 0);
    await f.locate();
    const [a, b] = await Promise.all([
      f.request('/journey/meeting-point', {}),
      f.request('/journey/meeting-point', {}),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.placeId, 'near-place');
    assert.equal(a.body.lat, 21.427);
    assert.ok(a.body.distanceFromLeader > 450 && a.body.distanceFromLeader <= 600);
    assert.equal(a.body.crowd.level, 'unknown');
    assert.equal(a.body.directionsUrl, b.body.directionsUrl);
    assert.equal(f.searches(), 1);
    const config = await f.request('/maps/config');
    assert.equal(config.body.browserKey, 'public-browser-test');
    assert.ok(!JSON.stringify(config.body).includes('private-places-test'));
  } finally {
    await f.close();
  }
});
test('agent cannot publish an invented meeting point', async () => {
  const f = await fixture(true);
  try {
    await f.locate();
    assert.equal((await f.request('/journey/meeting-point', {})).status, 502);
  } finally {
    await f.close();
  }
});
test('Copilot resolves a call to the group-owned phone and returns a dialer action, not a connected-call claim', async () => {
  const f = await fixture();
  try {
    const r = await f.request('/copilot/chat', { message: 'Call my leader', language: 'en' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.action, {
      type: 'call',
      href: 'tel:+15550008000',
      label: 'Call Test leader',
    });
    assert.match(r.body.text, /phone controls/);
  } finally {
    await f.close();
  }
});
test('Copilot rejects an agent-selected member outside the current group', async () => {
  const f = await fixture(false, true);
  try {
    assert.equal((await f.request('/copilot/chat', { message: 'Call my leader' })).status, 400);
    assert.deepEqual((await f.request('/copilot/messages')).body, []);
  } finally {
    await f.close();
  }
});

test('crowd selection uses authenticated fresh readings, invalidates cache, and rejects stale input', async () => {
  const f = await fixture();
  try {
    await f.locate();
    assert.equal((await f.request('/journey/meeting-point', {})).body.crowd.level, 'unknown');
    assert.equal(
      (
        await f.observe(
          { placeId: 'near-place', level: 'low', observedAt: new Date().toISOString() },
          'wrong',
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.observe({
          placeId: 'near-place',
          level: 'low',
          observedAt: new Date(Date.now() - 180000).toISOString(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.observe({
          placeId: 'near-place',
          level: 'high',
          observedAt: new Date().toISOString(),
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await f.observe({
          placeId: 'closer-place',
          level: 'low',
          observedAt: new Date().toISOString(),
        })
      ).status,
      204,
    );
    const meeting = await f.request('/journey/meeting-point', {});
    assert.equal(meeting.status, 200);
    assert.equal(meeting.body.placeId, 'closer-place');
    assert.equal(meeting.body.crowd.level, 'low');
    assert.equal(meeting.body.crowd.source, 'Test pedestrian sensor');
    assert.equal(f.searches(), 2);
  } finally {
    await f.close();
  }
});
test('five-digit Safety PINs are replaced atomically and old or eight-digit PINs are rejected', async () => {
  const f = await fixture();
  try {
    const a = await f.request('/safety/pin', {}),
      b = await f.request('/safety/pin', {});
    assert.equal(a.status, 200);
    assert.match(a.body.pin, /^\d{5}$/);
    assert.match(b.body.pin, /^\d{5}$/);
    assert.notEqual(a.body.pin, b.body.pin);
    assert.equal(
      (await f.request('/safety/report', { groupCode: a.body.groupCode, pin: a.body.pin })).status,
      400,
    );
    assert.equal(
      (await f.request('/safety/report', { groupCode: b.body.groupCode, pin: '12345678' })).status,
      400,
    );
    assert.equal(
      (await f.request('/safety/report', { groupCode: b.body.groupCode, pin: b.body.pin })).status,
      201,
    );
  } finally {
    await f.close();
  }
});

test('the agent does not direct pilgrims to a meeting point when all candidates have high crowd readings', async () => {
  const f = await fixture();
  try {
    await f.locate();
    for (const placeId of ['near-place', 'closer-place'])
      assert.equal(
        (await f.observe({ placeId, level: 'high', observedAt: new Date().toISOString() })).status,
        204,
      );
    const result = await f.request('/journey/meeting-point', {});
    assert.equal(result.status, 409);
    assert.match(result.body.error, /congestion is High/);
  } finally {
    await f.close();
  }
});

test('registered simulator uses the saved number, publishes labelled provider coordinates and rejects phone overrides', async () => {
  const f = await fixture(false, false, true);
  try {
    await f.request('/telemetry/start', {});
    const r = await f.request('/simulator/location', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.telemetry.source, 'nokia-simulator');
    assert.equal(r.body.telemetry.lat, 21.4225);
    assert.equal(r.body.telemetry.battery, null);
    const state = await f.request('/state');
    assert.equal(state.body.user.profile.simulator, true);
    assert.equal(state.body.members[0].telemetry.source, 'nokia-simulator');
    assert.equal((await f.request('/simulator/location', { phone: '+15550009999' })).status, 400);
  } finally {
    await f.close();
  }
});
test('simulator preserves old measurement timestamps as labelled test data and is unavailable to ordinary accounts', async () => {
  const a = await fixture(false, false, true, true),
    b = await fixture();
  try {
    await a.request('/telemetry/start', {});
    assert.equal((await a.request('/simulator/location', {})).status, 200);
    const t = (await a.request('/state')).body.members[0].telemetry;
    assert.ok(Date.now() - Date.parse(t.observedAt) > 120000);
    assert.ok(Date.now() - Date.parse(t.receivedAt) < 10000);
    assert.equal(t.source, 'nokia-simulator');
    assert.equal((await b.request('/simulator/location', {})).status, 403);
  } finally {
    await a.close();
    await b.close();
  }
});

test('meeting selection refreshes the simulator leader and accepts the labelled 1000 m test area', async () => {
  const f = await fixture(false, false, true, true);
  try {
    await f.request('/telemetry/start', {});
    const r = await f.request('/journey/meeting-point', {});
    assert.equal(r.status, 200);
    assert.match(r.body.selectionReason, /Nokia simulator/);
    assert.match(r.body.selectionReason, /1000 m/);
  } finally {
    await f.close();
  }
});

test('automatic meeting reads reuse cache; manual refresh selects another eligible place', async () => {
  const f = await fixture();
  try {
    await f.locate();
    const first = await f.request('/journey/meeting-point', {});
    const automatic = await f.request('/journey/meeting-point', {});
    assert.equal(automatic.body.selectedAt, first.body.selectedAt);
    assert.equal(f.searches(), 1);
    const next = await f.request('/journey/meeting-point', { refresh: true });
    assert.equal(next.status, 200);
    assert.notEqual(next.body.placeId, first.body.placeId);
    assert.ok(next.body.distanceFromLeader <= 600);
    assert.equal(f.searches(), 2);
    assert.equal((await f.request('/journey/meeting-point', {})).body.placeId, next.body.placeId);
  } finally {
    await f.close();
  }
});

test('dictation sends recorded audio to provider and validates audio input', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/copilot/transcribe', {
      audio: Buffer.alloc(200, 1).toString('base64'),
      mimeType: 'audio/webm',
      language: 'en',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.text, 'Find my meeting point');
    assert.equal(
      (
        await f.request('/copilot/transcribe', {
          audio: 'invalid!',
          mimeType: 'audio/webm',
          language: 'en',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('/copilot/transcribe', {
          audio: Buffer.alloc(200).toString('base64'),
          mimeType: 'text/html',
          language: 'en',
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
