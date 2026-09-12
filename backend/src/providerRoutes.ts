import type { Express } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { record, records, transaction } from './db.ts';
import { route, HttpError } from './errors.ts';
import { isLocale } from '../../shared/locales.ts';
import { text } from './validation.ts';
import { leaderOnly } from './auth.ts';
import { changed, groupFor, snapshot, iso, type Context } from './context.ts';
import { members } from './risk.ts';
import { operationKeys, fetchJson } from './providers.ts';
import { networkRoutes } from './networkRoutes.ts';
import { planAction, dynamicMeeting, cachedMeeting } from './journeyAgent.ts';
import { translateBatch } from './localization.ts';
import type { ClientAction } from '../../shared/types.ts';
import type { ChatMessage, User } from '../../shared/types.ts';
export { publicProviderRoutes } from './carrierAuth.ts';
export function providerRoutes(app: Express, c: Context) {
  const { db, env, providers } = c;
  networkRoutes(app, c);
  const busyChat = new Set<string>();
  app.get('/api/config', (_req, res) => {
    const provider = env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : 'groq');
    res.json({
      ai: {
        provider,
        configured:
          provider === 'gemini'
            ? !!(env.GEMINI_API_KEY && env.GEMINI_MODEL)
            : !!(env.GROQ_API_KEY && env.GROQ_MODEL),
      },
      carrier: {
        configured: !!env.NOKIA_RAPIDAPI_KEY,
        connected: false,
        operations: Object.entries(operationKeys)
          .filter(([, key]) => !!env[key])
          .map(([key]) => key),
      },
      maps: 'OpenStreetMap',
      prayerMethod: Number(env.PRAYER_METHOD || 4),
    });
  });
  app.post('/api/agent/evaluate', leaderOnly, (_req, res) => {
    changed(c, res.locals.user.groupId);
    res.json({
      members: members(db, groupFor(c, res.locals.user)),
      engine: 'Boundary, freshness, battery and SOS rules. No carrier action was executed.',
    });
  });
  app.post(
    '/api/copilot/transcribe',
    rateLimit({ windowMs: 60000, limit: 6, keyGenerator: (_req, res) => res.locals.user.id }),
    route(async (req, res) => {
      const body = z
        .object({
          audio: z
            .string()
            .min(4)
            .max(3800000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          mimeType: z.enum(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']),
          language: z.string().refine(isLocale),
        })
        .strict()
        .parse(req.body);
      if (!env.GROQ_API_KEY)
        throw new HttpError(503, 'Set GROQ_API_KEY in .env to enable dictation.');
      const audio = Buffer.from(body.audio, 'base64');
      if (audio.length < 100 || audio.length > 2800000)
        throw new HttpError(400, 'Record a short audio message of up to one minute.');
      const form = new FormData();
      form.append(
        'file',
        new Blob([audio], { type: body.mimeType }),
        'dictation.' + body.mimeType.split('/')[1],
      );
      form.append('model', env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
      form.append('language', body.language.split('-')[0]);
      form.append('response_format', 'json');
      const result = await fetchJson(
        providers.fetcher,
        'https://api.groq.com/openai/v1/audio/transcriptions',
        { method: 'POST', headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY }, body: form },
        30000,
      );
      if (typeof result.text !== 'string' || !result.text.trim())
        throw new HttpError(422, 'No speech detected. Speak clearly and try again.');
      res.json({ text: result.text.trim().slice(0, 4000) });
    }),
  );
  app.get('/api/copilot/messages', (_req, res) =>
    res.json(
      records<ChatMessage>(db, res.locals.user.groupId, 'chat', res.locals.user.id).reverse(),
    ),
  );
  app.delete('/api/copilot/messages', (_req, res) => {
    db.prepare("DELETE FROM records WHERE kind='chat' AND owner_id=?").run(res.locals.user.id);
    res.sendStatus(204);
  });
  app.post(
    '/api/copilot/chat',
    rateLimit({
      windowMs: 60000,
      limit: 12,
      keyGenerator: (_req, res) => res.locals.user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many Copilot messages. Wait a minute.' },
    }),
    route(async (req, res) => {
      const b = z
          .object({ message: text(4000), language: z.string().refine(isLocale).optional() })
          .strict()
          .parse(req.body),
        user: User = res.locals.user;
      if (busyChat.has(user.id)) throw new HttpError(409, 'Wait for your current reply.');
      busyChat.add(user.id);
      try {
        const history = records<ChatMessage>(db, user.groupId, 'chat', user.id).reverse();
        const context = { ...snapshot(c, user), dynamicMeeting: cachedMeeting(c, user.groupId) };
        if (b.language)
          context.user = {
            ...context.user,
            profile: { ...context.user.profile, language: b.language },
          };
        const plan = await planAction(c, context, b.message);
        let action: ClientAction | undefined,
          actionText = '';
        if (plan.action === 'call_member' || plan.action === 'view_member') {
          const member = context.members.find((m) => m.id === plan.memberId);
          if (!member)
            throw new HttpError(
              400,
              'Name one member in your group so I can select the right person.',
            );
          if (plan.action === 'call_member') {
            action = { type: 'call', href: 'tel:' + member.phone, label: 'Call ' + member.name };
            actionText =
              'Opening the dialer for ' +
              member.name +
              '. Your phone controls whether the call connects.';
          } else {
            if (!member.telemetry)
              throw new HttpError(409, member.name + ' has not shared a location.');
            action = {
              type: 'map',
              href:
                'https://www.google.com/maps/search/?api=1&query=' +
                member.telemetry.lat +
                ',' +
                member.telemetry.lng,
              label: 'View ' + member.name + ' on Google Maps',
            };
            actionText =
              'Opening the last reported location for ' +
              member.name +
              '. Recorded at ' +
              member.telemetry.observedAt +
              '.';
          }
        }
        if (plan.action === 'meeting_point' || plan.action === 'navigate_meeting') {
          const meeting = await dynamicMeeting(c, user);
          actionText =
            'Your dynamic meeting point is ' +
            meeting.name +
            '. ' +
            meeting.address +
            '. ' +
            meeting.distanceFromLeader +
            ' metres from the leader. Follow Google Maps walking directions and check local access.';
          if (plan.action === 'navigate_meeting')
            action = {
              type: 'map',
              href: meeting.directionsUrl,
              label: 'Directions to ' + meeting.name,
            };
        }
        if (plan.action === 'share_location') {
          action = { type: 'share_location', label: 'Enable live location' };
          actionText =
            'Requesting location sharing. Allow the browser location permission to appear on your group map.';
        }
        if (plan.action === 'stop_location') {
          action = { type: 'stop_location', label: 'Stop location sharing' };
          actionText = 'Stopping location sharing and removing your shared location.';
        }
        const language = context.user.profile.language;
        const answer = actionText
          ? {
              text:
                language === 'en'
                  ? actionText
                  : (await translateBatch(env, providers.fetcher, language, [actionText], 'en'))[0],
              provider: env.AI_PROVIDER || 'groq',
            }
          : await providers.chat(context, history, b.message);
        if (!db.prepare('SELECT id FROM users WHERE id=?').get(user.id))
          throw new HttpError(401, 'Account no longer exists.');
        const message = transaction(db, () => {
          record(
            db,
            user.groupId,
            'chat',
            { role: 'user', text: b.message, createdAt: iso() },
            user.id,
          );
          return record(
            db,
            user.groupId,
            'chat',
            {
              role: 'assistant',
              text: answer.text,
              provider: answer.provider,
              language: context.user.profile.language,
              action,
              createdAt: iso(),
            },
            user.id,
          );
        });
        res.status(201).json(message);
      } finally {
        busyChat.delete(user.id);
      }
    }),
  );
  app.get(
    '/api/prayers',
    route(async (_req, res) => {
      if (!res.locals.row.telemetry)
        throw new HttpError(409, 'Share a current location to calculate prayer times.');
      const telemetry = JSON.parse(res.locals.row.telemetry);
      if (Date.now() - Date.parse(telemetry.observedAt) > 120000)
        throw new HttpError(409, 'Refresh your location before requesting prayer times.');
      const url = new URL('https://api.aladhan.com/v1/timings/' + Math.floor(Date.now() / 1000));
      url.search = new URLSearchParams({
        latitude: String(telemetry.lat),
        longitude: String(telemetry.lng),
        method: String(Number(env.PRAYER_METHOD || 4)),
      }).toString();
      const result = await fetchJson(providers.fetcher, url);
      if (!result.data?.timings || !result.data?.meta?.timezone)
        throw new HttpError(502, 'Unexpected prayer provider response.');
      res.json({
        timings: result.data.timings,
        date: result.data.date,
        timezone: result.data.meta.timezone,
        method: result.data.meta.method,
        source: 'AlAdhan',
        retrievedAt: iso(),
      });
    }),
  );
}
