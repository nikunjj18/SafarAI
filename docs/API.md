# API overview

Authenticated writes require a session cookie and X-CSRF-Token. All group data is scoped to the signed-in member. Errors use appropriate HTTP status codes and a JSON error message.

## Core endpoints

- POST /api/auth/register and /api/auth/login: establish a session.
- GET /api/auth/me and POST /api/auth/logout: session lifecycle.
- GET /api/state and /api/events: snapshot and live updates.
- POST /api/heartbeat: app presence.
- POST /api/telemetry/start, POST /api/telemetry, DELETE /api/telemetry: sharing.
- POST /api/simulator/location: retrieve the registered simulator number.
- PATCH /api/profile and /api/profile/language: member settings.
- PATCH /api/group/helpdesk: leader-only phone field; empty string removes it.
- POST /api/group/rotate-code: replace the five-character invitation.
- POST /api/group/broadcast: group message.
- POST /api/sos and /api/incidents/:id/resolve: member incident and leader resolution.
- GET /api/maps/config and POST /api/journey/meeting-point: maps and meeting selection.
- POST /api/copilot/chat and GET /api/copilot/messages: assistant.
- POST /api/safety/pin: create/replace a five-digit PIN.
- POST /api/safety/report: rate-limited borrowed-phone check-in.
- GET /api/health: database-backed health check.

## Optional crowd feed

POST /api/crowd/observations uses the configured bearer credential. The strict JSON fields are placeId, level (low, medium or high), and observedAt (UTC ISO time within two minutes). The feed must provide actual pedestrian measurements. Unknown readings are not displayed as a congestion row.

## Local setup

GET/POST /api/local-setup require direct localhost access and a same-origin setup token. Keys are saved in the root .env and never returned as plaintext. Public deployments use environment configuration.

## Dictation and meeting refresh

POST /api/copilot/transcribe accepts authenticated, CSRF-protected JSON with audio (base64), mimeType and language. It returns text using server-side Groq transcription. Maximum decoded audio is 2.8 MB; the UI records at most one minute.

POST /api/journey/meeting-point accepts refresh: true for an alternative eligible place. Automatic reads reuse the valid cached result. If no alternative in the best available crowd tier exists, the current eligible place can remain.
