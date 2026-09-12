# Configuration

Copy .env.example to .env at the root. Do not commit the resulting file.

## Presentation services

- APP_URL: http://localhost:3000 locally; public HTTPS origin when hosted.
- AI_PROVIDER: groq or gemini.
- Groq requires GROQ_API_KEY and an account-enabled GROQ_MODEL.
- Gemini requires GEMINI_API_KEY and an account-enabled GEMINI_MODEL.
- GOOGLE_PLACES_API_KEY: server-side Places API (New) key.
- GOOGLE_MAPS_BROWSER_KEY: Maps JavaScript key with website referrer restrictions.
- DEMO_MODE: enables or disables saved-position presentation behavior.

Google APIs require enabled access and billing. Do not apply browser-referrer restrictions to the server Places key. Local key setup preserves existing keys when fields are blank.

## Nokia simulator

Use NOKIA_RAPIDAPI_KEY, the configured endpoint and the exact simulator number Nokia assigned. Registration's checkbox grants permission for that test number. Provider/operator authorization may also be required.

The test-area radius and original timestamp are preserved. Fetch time is recorded separately. Simulator coordinates do not establish real pilgrim location.

## Helpdesk

No environment key is needed. The leader saves a phone number in More → Group helpdesk. Include its country code. It is stored per group; other pilgrims cannot change it. Save an empty value to remove it.

## Optional features

Translation normally reuses the selected AI provider. TRANSLATION_PROVIDER=google uses GOOGLE_TRANSLATE_API_KEY.

A real pedestrian observation source can use CROWD_WEBHOOK_TOKEN and CROWD_SOURCE_NAME. The endpoint accepts authenticated fresh readings for exact Google Place IDs. Telecom congestion is not treated as pedestrian density.

Other Nokia OAuth, webhook and QoD settings are optional backend integrations. They require enabled provider services and public HTTPS for webhook delivery.

## Storage and mode

DATABASE_PATH defaults to ./data/safarai-v1.db. Use persistent storage. Set DEMO_MODE=false for live freshness/accuracy validation. The localhost key editor is deliberately unavailable through a public proxy.

## Copilot dictation

Dictation uses the existing GROQ_API_KEY through the server. GROQ_TRANSCRIPTION_MODEL optionally overrides whisper-large-v3-turbo. Allow microphone access, tap Dictate, speak, then Stop microphone. Recordings stop after 60 seconds, are transcribed, and are not stored by this application. Provider retention policies still apply. Enter sends the resulting text; Shift + Enter adds a line.
