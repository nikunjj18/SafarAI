import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSetupRoutes } from '../backend/src/localSetup.ts';
import { errorHandler } from '../backend/src/errors.ts';
import type { Environment } from '../backend/src/providers.ts';
test('local setup keeps secrets private, requires same-origin token, preserves configuration and rejects proxy access', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'safarai-setup-')),
    file = join(dir, '.env');
  writeFileSync(file, 'PORT=3000\nGROQ_API_KEY=old-secret\n');
  const env: Environment = { GROQ_API_KEY: 'old-secret' };
  const app = express();
  app.use(express.json());
  localSetupRoutes(app, env, file);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const response = await fetch(base + '/api/local-setup');
    const data = (await response.json()) as any;
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(data).includes('old-secret'), false);
    const body = JSON.stringify({
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'new-test-secret',
      GROQ_MODEL: 'test-model',
      NOKIA_RAPIDAPI_KEY: '',
    });
    const save = (headers: Record<string, string>) =>
      fetch(base + '/api/local-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      });
    assert.equal((await save({ Origin: base })).status, 403);
    assert.equal(
      (await save({ Origin: 'https://other.example', 'X-Local-Setup-Token': data.token })).status,
      403,
    );
    assert.equal((await save({ Origin: base, 'X-Local-Setup-Token': data.token })).status, 200);
    assert.equal(env.GROQ_API_KEY, 'new-test-secret');
    assert.equal(env.TRANSLATION_PROVIDER, 'groq');
    assert.match(readFileSync(file, 'utf8'), /PORT=3000/);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /old-secret/);
    assert.equal(
      (await fetch(base + '/api/local-setup', { headers: { 'X-Forwarded-For': '127.0.0.1' } }))
        .status,
      404,
    );
    env.APP_URL = 'https://public.example';
    assert.equal((await fetch(base + '/api/local-setup')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
