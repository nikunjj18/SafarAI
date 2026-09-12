import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { route, HttpError } from './errors.ts';
import type { Environment } from './providers.ts';

export function localSetupRoutes(app: Express, env: Environment, file = resolve('.env')) {
  const token = randomBytes(32).toString('hex');
  const local = new Set(['localhost', '127.0.0.1', '[::1]']);
  const secret = z
    .string()
    .trim()
    .max(4096)
    .regex(/^[A-Za-z0-9_\-.:/+=]*$/);
  const schema = z
    .object({
      AI_PROVIDER: z.enum(['gemini', 'groq']),
      GEMINI_API_KEY: secret.optional(),
      GROQ_API_KEY: secret.optional(),
      NOKIA_RAPIDAPI_KEY: secret.optional(),
      GOOGLE_PLACES_API_KEY: secret.optional(),
      GOOGLE_MAPS_BROWSER_KEY: secret.optional(),
      GEMINI_MODEL: z
        .string()
        .trim()
        .min(1)
        .max(150)
        .regex(/^[\w./:-]+$/)
        .optional(),
      GROQ_MODEL: z
        .string()
        .trim()
        .min(1)
        .max(150)
        .regex(/^[\w./:-]+$/)
        .optional(),
    })
    .strict();
  app.use('/api/local-setup', (req, res, next) => {
    let host = '';
    try {
      host = new URL('http://' + req.headers.host).hostname;
    } catch {}
    const address = req.socket.remoteAddress;
    if (
      !local.has(new URL(env.APP_URL || 'http://localhost:3000').hostname) ||
      !['127.0.0.1', 'localhost', '::1'].includes(env.HOST || '127.0.0.1') ||
      !local.has(host) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '') ||
      req.headers['x-forwarded-for'] ||
      req.headers['forwarded'] ||
      req.headers['x-forwarded-host']
    )
      return next(new HttpError(404, 'Local setup is unavailable.'));
    res.setHeader('Cache-Control', 'no-store');
    if (
      req.method !== 'GET' &&
      (req.headers.origin !== 'http://' + req.headers.host ||
        req.headers['x-local-setup-token'] !== token)
    )
      return next(new HttpError(403, 'Reopen local setup and try again.'));
    next();
  });
  app.get('/api/local-setup', (_req, res) =>
    res.json({
      token,
      provider: env.AI_PROVIDER || 'gemini',
      geminiModel: env.GEMINI_MODEL || '',
      groqModel: env.GROQ_MODEL || '',
      configured: {
        gemini: !!env.GEMINI_API_KEY,
        groq: !!env.GROQ_API_KEY,
        nokia: !!env.NOKIA_RAPIDAPI_KEY,
        googlePlaces: !!env.GOOGLE_PLACES_API_KEY,
        googleMaps: !!env.GOOGLE_MAPS_BROWSER_KEY,
      },
    }),
  );
  app.post(
    '/api/local-setup',
    route(async (req, res) => {
      const parsed = schema.parse(req.body);
      const values: Record<string, string> = {
        AI_PROVIDER: parsed.AI_PROVIDER,
        TRANSLATION_PROVIDER: parsed.AI_PROVIDER,
      };
      for (const [key, value] of Object.entries(parsed)) if (value) values[key] = value;
      let contents = '';
      try {
        contents = readFileSync(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new HttpError(500, 'Could not read the local configuration.');
      }
      const lines = contents
        .split(/\r?\n/)
        .filter(
          (line) =>
            !Object.keys(values).some((key) =>
              new RegExp('^\\s*(?:export\\s+)?' + key + '\\s*=').test(line),
            ),
        );
      const updated =
        lines.join('\n').trimEnd() +
        '\n' +
        Object.entries(values)
          .map(([k, v]) => k + '=' + v)
          .join('\n') +
        '\n';
      try {
        writeFileSync(file + '.tmp', updated, { mode: 0o600 });
        renameSync(file + '.tmp', file);
      } catch {
        throw new HttpError(500, 'Could not save .env. Check project folder permissions.');
      }
      Object.assign(env, values);
      res.json({ saved: true });
    }),
  );
}
