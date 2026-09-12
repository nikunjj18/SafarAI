import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../backend/src/app.ts';
import { openDatabase } from '../backend/src/db.ts';
import { translateBatch } from '../backend/src/localization.ts';
import { HttpError } from '../backend/src/errors.ts';
import { LOCALES, isRtl } from '../shared/locales.ts';
import type { Fetcher, Environment } from '../backend/src/providers.ts';
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('30 languages include requested scripts and bundled native recovery text', () => {
  assert.equal(LOCALES.length, 30);
  assert.equal(new Set(LOCALES.map((l) => l[0])).size, 30);
  for (const code of ['ar', 'en', 'ur', 'hi', 'fa']) assert.ok(LOCALES.some((l) => l[0] === code));
  for (const l of LOCALES) assert.ok(l.every((s) => s.length > 0));
  for (const code of ['ar', 'ur', 'fa', 'ps']) assert.ok(isRtl(code));
  assert.equal(isRtl('hi'), false);
});

test('translation adapters validate output, propagate failures and keep keys server-side', async () => {
  const env: Environment = {
    TRANSLATION_PROVIDER: 'google',
    GOOGLE_TRANSLATE_API_KEY: 'translation-test-only-key',
  };
  let sent: any,
    headers: any,
    url = '';
  const fetcher = (async (input, init) => {
    url = String(input);
    headers = init?.headers;
    sent = JSON.parse(String(init?.body));
    return response({ data: { translations: [{ translatedText: 'مرحبا' }] } });
  }) as Fetcher;
  assert.deepEqual(await translateBatch(env, fetcher, 'ar', ['Hello'], 'en'), ['مرحبا']);
  assert.equal(url, 'https://translation.googleapis.com/language/translate/v2');
  assert.equal(url.includes(env.GOOGLE_TRANSLATE_API_KEY!), false);
  assert.equal(headers['X-Goog-Api-Key'], env.GOOGLE_TRANSLATE_API_KEY);
  assert.equal(sent.target, 'ar');
  assert.equal(sent.source, 'en');
  assert.equal(sent.format, 'text');
  await translateBatch(env, fetcher, 'ar', ['Hello'], 'auto');
  assert.equal(sent.source, undefined);
  await assert.rejects(
    () => translateBatch({}, fetcher, 'ar', ['Hello'], 'en'),
    (e: unknown) => e instanceof HttpError && e.status === 503,
  );
  await assert.rejects(
    () =>
      translateBatch(
        env,
        (async () => response({ data: { translations: [] } })) as Fetcher,
        'ar',
        ['Hello'],
        'en',
      ),
    (e: unknown) => e instanceof HttpError && e.code === 'TRANSLATION_FORMAT',
  );
  await assert.rejects(
    () => translateBatch(env, (async () => response({}, 429)) as Fetcher, 'ar', ['Hello'], 'en'),
    (e: unknown) => e instanceof HttpError && e.status === 429,
  );
  await assert.rejects(
    () =>
      translateBatch(
        env,
        (async () => {
          throw new DOMException('timeout', 'TimeoutError');
        }) as Fetcher,
        'ar',
        ['Hello'],
        'en',
      ),
    (e: unknown) => e instanceof HttpError && e.status === 504,
  );
  for (const provider of ['gemini', 'groq']) {
    const config = {
      TRANSLATION_PROVIDER: provider,
      GEMINI_API_KEY: 'test',
      GEMINI_MODEL: 'test-model',
      GROQ_API_KEY: 'test',
      GROQ_MODEL: 'test-model',
    };
    const model = (async (_input, init) => {
      const b = JSON.parse(String(init?.body));
      const instruction =
        provider === 'gemini' ? b.systemInstruction.parts[0].text : b.messages[0].content;
      assert.match(instruction, /Urdu \(ur\)/);
      assert.match(instruction, /untrusted/);
      return response(
        provider === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: '{"translations":["سلام"]}' }] } }] }
          : { choices: [{ message: { content: '{"translations":["سلام"]}' } }] },
      );
    }) as Fetcher;
    assert.deepEqual(await translateBatch(config, model, 'ur', ['Hello'], 'en'), ['سلام']);
  }
});

test('public UI translation is allowlisted; private content needs session and CSRF; only UI cache persists', async () => {
  let calls = 0;
  const runtime = createApp({
    db: openDatabase(':memory:'),
    env: {
      APP_URL: 'http://localhost:3000',
      TRANSLATION_PROVIDER: 'google',
      GOOGLE_TRANSLATE_API_KEY: 'test-only',
    },
    fetcher: (async (_input, init) => {
      calls++;
      const b = JSON.parse(String(init?.body));
      return response({
        data: { translations: b.q.map((_: string) => ({ translatedText: 'ترجمة' })) },
      });
    }) as Fetcher,
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  let cookie = '',
    csrf = '';
  async function request(path: string, body?: unknown, method = 'POST', security = true) {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(security ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data };
  }
  try {
    const payload = { language: 'ar', texts: ['Welcome back'], source: 'en' };
    assert.equal((await request('/localization/translate', payload)).status, 200);
    assert.equal(calls, 1);
    await request('/localization/translate', payload);
    assert.equal(calls, 1);
    assert.equal(
      (
        await request('/localization/translate', {
          ...payload,
          texts: ['Private test message'],
          source: 'auto',
        })
      ).status,
      401,
    );
    assert.equal(
      (await request('/localization/translate', { ...payload, language: 'xx' })).status,
      400,
    );
    const config = await request('/localization/config', undefined, 'GET');
    assert.equal(config.data.configured, true);
    assert.equal(JSON.stringify(config).includes('test-only'), false);
    assert.equal(
      (
        await request('/auth/register', {
          name: 'Localization Test',
          email: 'localization@example.test',
          phone: '+15559992222',
          password: 'localization-test-pass-123',
          role: 'leader',
          groupName: 'Locale Test',
          language: 'ur',
        })
      ).status,
      201,
    );
    const privatePayload = { language: 'ar', texts: ['Private test message'], source: 'auto' };
    assert.equal((await request('/localization/translate', privatePayload)).status, 200);
    assert.equal(
      (await request('/localization/translate', privatePayload, 'POST', false)).status,
      401,
    );
    const saved = csrf;
    csrf = 'wrong';
    assert.equal((await request('/localization/translate', privatePayload)).status, 403);
    csrf = saved;
    assert.equal(runtime.db.prepare('SELECT count(*) n FROM ui_translations').get()!.n, 1);
    assert.equal((await request('/profile/language', { language: 'fa' }, 'PATCH')).status, 200);
    assert.equal((await request('/auth/me', undefined, 'GET')).data.user.profile.language, 'fa');
    assert.equal((await request('/profile/language', { language: 'xx' }, 'PATCH')).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    runtime.close();
  }
});

test('Copilot uses the selected request language even when the saved profile differs', async () => {
  let instruction = '';
  const runtime = createApp({
    db: openDatabase(':memory:'),
    env: {
      APP_URL: 'http://localhost:3000',
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'test-model',
    },
    fetcher: (async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      instruction = b.systemInstruction.parts[0].text;
      if (instruction.startsWith('You select'))
        return response({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'answer' }) }] } }],
        });
      return response({ candidates: [{ content: { parts: [{ text: 'پاسخ آزمایشی' }] } }] });
    }) as Fetcher,
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const registered = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Language Test',
        email: 'language-chat@example.test',
        phone: '+15559993333',
        password: 'language-test-pass-123',
        role: 'leader',
        groupName: 'Test Group',
        language: 'en',
      }),
    });
    const cookie = registered.headers.get('set-cookie')!.split(';')[0],
      auth = (await registered.json()) as { csrf: string };
    const result = await fetch(base + '/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': auth.csrf },
      body: JSON.stringify({ message: 'Where is our meeting point?', language: 'fa' }),
    });
    const message = (await result.json()) as { language: string; text: string };
    assert.equal(result.status, 201);
    assert.equal(message.language, 'fa');
    assert.match(instruction, /Respond in language fa/);
    assert.match(instruction, /entire answer only in this language/);
    assert.equal(message.text, 'پاسخ آزمایشی');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    runtime.close();
  }
});
