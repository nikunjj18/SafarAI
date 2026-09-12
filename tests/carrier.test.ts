import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../backend/src/app.ts';
import { openDatabase } from '../backend/src/db.ts';
import type { Fetcher } from '../backend/src/providers.ts';

test('number verification binds OAuth state to the originating session and uses the provider result', async () => {
  const calls: { url: string; body: any }[] = [];
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ devicePhoneNumberVerified: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as Fetcher;
  const runtime = createApp({
    db: openDatabase(':memory:'),
    fetcher,
    env: {
      APP_URL: 'http://localhost:3000',
      NOKIA_RAPIDAPI_KEY: 'test-only-secret',
      NOKIA_CLIENT_ID: 'test-client',
      NOKIA_AUTHORIZATION_URL: 'https://provider.example/fast-auth',
      NOKIA_NUMBER_VERIFICATION_URL: 'https://provider.example/verify',
    },
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const created = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'leader',
        name: 'OAuth test',
        email: 'oauth@example.test',
        phone: '+15550003001',
        password: 'test-password-12345',
        groupName: 'OAuth test',
      }),
    });
    const cookie = created.headers.get('set-cookie')!.split(';')[0],
      auth = (await created.json()) as any;
    const headers = {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': auth.csrf,
    };
    await fetch(base + '/api/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: auth.user.name,
        profile: { ...auth.user.profile, networkConsent: true },
      }),
    });
    async function start() {
      const r = await fetch(base + '/api/carrier/number-verification/start', {
        method: 'POST',
        headers,
        body: '{}',
      });
      assert.equal(r.status, 200);
      return new URL(((await r.json()) as any).url);
    }
    const first = await start();
    assert.equal(first.searchParams.get('login_hint'), auth.user.phone);
    const unbound = await fetch(
      base + '/api/carrier/oauth/callback?state=' + first.searchParams.get('state') + '&code=one',
      { redirect: 'manual' },
    );
    assert.equal(unbound.status, 400);
    assert.equal(calls.length, 0);
    const second = await start();
    const callback = await fetch(
      base + '/api/carrier/oauth/callback?state=' + second.searchParams.get('state') + '&code=two',
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/?carrier=verified');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.phoneNumber, auth.user.phone);
    assert.equal(new URL(calls[0].url).searchParams.get('code'), 'two');
    const replay = await fetch(
      base + '/api/carrier/oauth/callback?state=' + second.searchParams.get('state') + '&code=two',
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );
    assert.equal(replay.status, 400);
    assert.equal(calls.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    runtime.close();
  }
});

test('geofence webhook validates credentials and subscription ownership and deduplicates events', async () => {
  const runtime = createApp({
    db: openDatabase(':memory:'),
    fetcher: (async () =>
      new Response(JSON.stringify({ id: 'provider-subscription', status: 'ACTIVE' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })) as Fetcher,
    env: {
      APP_URL: 'https://demo.example',
      NOKIA_RAPIDAPI_KEY: 'test-only-secret',
      NOKIA_GEOFENCING_URL: 'https://provider.example/subscriptions',
      NOKIA_WEBHOOK_TOKEN: 'test-webhook-token',
    },
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const registration = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'leader',
        name: 'Webhook test',
        email: 'webhook@example.test',
        phone: '+15550003002',
        password: 'test-password-12345',
        groupName: 'Webhook group',
      }),
    });
    const cookie = registration.headers.get('set-cookie')!.split(';')[0],
      auth = (await registration.json()) as any;
    const headers = {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': auth.csrf,
    };
    await fetch(base + '/api/profile', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: auth.user.name,
        profile: { ...auth.user.profile, networkConsent: true },
      }),
    });
    // A saved legacy fixed subscription fixture isolates webhook behavior from the moving-boundary UI.
    runtime.db
      .prepare('UPDATE groups SET anchor=? WHERE id=?')
      .run(JSON.stringify({ lat: 21.42, lng: 39.82 }), auth.user.groupId);
    assert.equal(
      (await fetch(base + '/api/carrier/geofencing', { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    const event = {
      id: 'provider-event-1',
      type: 'org.camaraproject.geofencing-subscriptions.v0.area-left',
      time: new Date().toISOString(),
      data: { subscriptionId: 'provider-subscription' },
    };
    const send = (token: string) =>
      fetch(base + '/api/carrier/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(event),
      });
    assert.equal((await send('wrong')).status, 401);
    assert.equal((await send('test-webhook-token')).status, 204);
    assert.equal((await send('test-webhook-token')).status, 204);
    const state = (await (
      await fetch(base + '/api/state', { headers: { Cookie: cookie } })
    ).json()) as any;
    assert.equal(
      state.bulletins.filter((b: any) => b.title === 'Carrier geofence event').length,
      1,
    );
    assert.equal(state.members[0].telemetry, null);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    runtime.close();
  }
});
