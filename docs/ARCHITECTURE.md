# Architecture

The browser calls Express on the same origin. Session authentication identifies the member and group; CSRF protects changes. SQLite stores accounts, locations, settings and records. Server-sent events notify connected members, with periodic refresh as fallback.

## Module boundaries

Frontend owns rendering and device APIs. Backend owns secrets, authorization, persistence and upstream calls. Shared contains contracts, language metadata and pure location rules.

The generated translation catalog contains public source strings. Private group translations require a session. Provider failures are surfaced without inventing success.

## Meetings and actions

Google Places provides real candidates within 600 m of the leader reference. The model can choose only an eligible returned ID. Coordinates and group ownership are validated separately. The group boundary remains 150 m.

Copilot selects constrained actions. The server resolves member IDs to group-owned destinations. Calls use a tel link and navigation uses Google Maps; the browser/OS performs the action.

## Presence

App contact is distinct from GPS freshness. Missing GPS does not by itself make a connected member offline. Saved-position mode preserves timestamps and labels retained positions. Nokia refreshes are consent-scoped and coalesced.

## Operational limits

SQLite and the event hub run in one process. Horizontal scaling requires shared persistence and delivery. Browsers cannot guarantee GPS after closure/suspension. Crowd observations do not prove access, capacity or safety.
