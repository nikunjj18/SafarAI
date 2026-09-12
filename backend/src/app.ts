import { startSimulatorPolling } from './simulator.ts';
import express from 'express';
import { crowdRoutes } from './crowd.ts';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { openDatabase, groupFrom, type DB } from './db.ts';
import { authenticate } from './auth.ts';
import { HttpError, errorHandler } from './errors.ts';
import { createEvents } from './events.ts';
import { evaluate } from './risk.ts';
import { createProviders, type Environment, type Fetcher } from './providers.ts';
import { authRoutes, userRoutes } from './userRoutes.ts';
import { groupRoutes } from './groupRoutes.ts';
import { providerRoutes, publicProviderRoutes } from './providerRoutes.ts';
import { iso, type Context } from './context.ts';
import { createGuardian, guardianRoutes, safetyRoutes } from './guardian.ts';
import { localizationRoutes } from './localization.ts';
import { localSetupRoutes } from './localSetup.ts';
import { journeyAgentRoutes } from './journeyAgent.ts';
export function createApp(options: { env?: Environment; db?: DB; fetcher?: Fetcher } = {}) {
  const env = options.env || process.env;
  const db = options.db || openDatabase(env.DATABASE_PATH || './data/safarai-v1.db');
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  const publicUrl = new URL(env.APP_URL || 'http://localhost:' + (env.PORT || '3000'));
  if (env.TRUST_PROXY) app.set('trust proxy', Number(env.TRUST_PROXY));
  const allowedOrigins = new Set([
    publicUrl.origin,
    ...(env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const events = createEvents();
  const c: Context = {
    db,
    env,
    events,
    providers: createProviders(env, db, options.fetcher),
    publicUrl,
  };
  app.use(
    helmet({
      contentSecurityPolicy:
        env.NODE_ENV === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: [
                  "'self'",
                  'data:',
                  'blob:',
                  'https://*.tile.openstreetmap.org',
                  'https://*.googleapis.com',
                  'https://*.gstatic.com',
                  'https://*.google.com',
                  'https://*.googleusercontent.com',
                ],
                connectSrc: [
                  "'self'",
                  'https://*.googleapis.com',
                  'https://*.gstatic.com',
                  'https://*.google.com',
                ],
                workerSrc: ["'self'", 'blob:'],
                upgradeInsecureRequests: publicUrl.protocol === 'https:' ? [] : null,
              },
            }
          : false,
      strictTransportSecurity: publicUrl.protocol === 'https:' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      next(new HttpError(403, 'This origin is not allowed.'));
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use('/api/copilot/transcribe', express.json({ limit: '4mb' }));
  app.use(
    express.json({ limit: '64kb', type: ['application/json', 'application/cloudevents+json'] }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Wait a minute.' },
    }),
  );
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: iso() });
  });
  safetyRoutes(app, c);
  crowdRoutes(app, c);
  localSetupRoutes(app, env);
  const guardian = createGuardian(c);
  authRoutes(app, c);
  localizationRoutes(app, db, env, options.fetcher);
  const clearProviders = publicProviderRoutes(app, c);
  app.use('/api', authenticate(db));
  const simulatorPolling = startSimulatorPolling(c);
  app.use('/api/state', (_req, res, next) => {
    simulatorPolling.touch(res.locals.user.groupId);
    next();
  });
  userRoutes(app, c);
  groupRoutes(app, c);
  providerRoutes(app, c);
  guardianRoutes(app, c, guardian);
  journeyAgentRoutes(app, c);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found.')));
  app.use(errorHandler);
  const timer = setInterval(() => {
    try {
      for (const row of db.prepare('SELECT * FROM groups').all()) {
        const group = groupFrom(row);
        if (evaluate(db, group)) events.publish(group.id);
      }
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    } catch {
      console.error(JSON.stringify({ level: 'error', event: 'periodic_evaluation_failed' }));
    }
  }, 15000);
  timer.unref();
  return {
    app,
    db,
    close() {
      simulatorPolling.close();
      guardian.close();
      clearInterval(timer);
      clearProviders();
      events.close();
      db.close();
    },
  };
}
