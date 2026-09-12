# SafarAI

A pilgrimage group companion for coordinating people, shared locations and meeting points. Leaders create a group; pilgrims join with a five-character invitation code. The interface supports 30 languages.

## Run locally

Requirements: Node.js 24 and npm. This is a TypeScript project; Python and a separate database installation are not required.

    npm ci

Copy .env.example to .env in this root folder and configure your keys. Preserve an existing .env when updating.

    npm run build
    npm start

Open http://localhost:3000. One Node process serves the compiled frontend, API and live event stream. Stop another process on port 3000 first. Local key setup is available at http://localhost:3000/?setup=1.

For development, run npm run dev. Frontend changes rebuild automatically; refresh the browser after rebuilding. Restart after backend changes.

## Repository layout

    safarai/
      frontend/
        src/
          views/          Authentication, Home/Group, Journey, Copilot and More
          components/     Maps, language selection and shared UI
          hooks/          Location acquisition and recovery
          lib/            HTTP client
          i18n/           Translation-aware rendering
          styles/         Interface and map styles
          assets/         Application images
        public/           Public icon
        index.html
        vite.config.ts
      backend/
        src/
          index.ts        HTTP server entry point
          app.ts          Middleware and route assembly
          userRoutes.ts   Accounts, sessions, profiles and telemetry
          groupRoutes.ts  Invitations, helpdesk, messages and incidents
          journeyAgent.ts Places selection and constrained AI actions
          simulator.ts    Consented Nokia simulator retrieval
          db.ts           SQLite schema and migrations
      shared/             Types, language metadata and location rules
      tests/              API, providers, authorization and rendering checks
      scripts/            Translation-catalog generation
      docs/               Configuration, architecture and API notes
      .github/workflows/  Automated checks

The dependency folder, compiled output and runtime data are excluded from Git and the ZIP. SQLite defaults to data/safarai-v1.db.

## Main flows

- Register: choose a language, create a leader account or join as a pilgrim.
- Home: personal/group position summary. Pilgrims can call the leader or send SOS; leaders call their configured helpdesk.
- Group: member details, call/map links, invitations, messages and updates.
- Journey: group map, 150 m boundary and an automatic meeting point within 600 m of the leader reference.
- Copilot: multilingual responses and validated actions within the group.
- More: profile, language, five-digit Safety PIN and leader helpdesk settings.

Leaders save the helpdesk number in More, including country code. A missing number produces a setup action, never an invented phone number. Calls open the device dialer.

## Location modes

Real location requires permission and an active device/browser session. Different people need separate devices or browser profiles; two tabs share a login.

Choose Test with Nokia simulator at registration to use a Nokia-provided test number with the saved server key. The server refreshes enabled, consenting simulator members while their group is viewed.

DEMO_MODE=true enables the requested presentation behavior: saved positions remain visible across account switches and boundary status uses saved centres. The interface identifies saved positions. Original timestamps and accuracy remain unchanged. Set false for strict live freshness/accuracy checks. A member without any recorded position remains unknown.

## Checks

    npm run format:check
    npm test
    npm run build

Use npm run format after edits. npm run check runs all submission checks. Provider fixtures exist only in tests; runtime routes use configured services and actual stored records.

## External services

Configure Groq or Gemini for AI/translation, Google Places (New) for meeting selection and Maps JavaScript for the map. Nokia is required only for simulator/carrier features. See [configuration](docs/CONFIGURATION.md).

Unknown pedestrian congestion is not displayed in Journey. Google Places does not supply pedestrian crowd measurements. Optional authenticated crowd observations can influence selection; no crowd reading is fabricated.

## Deployment

Run the same build/start commands on a Node host with persistent writable storage. Set APP_URL to the public HTTPS origin and HOST=0.0.0.0 when required by the host. Restrict the Google browser key to that origin. Remote browser GPS requires HTTPS. Keep .env and the SQLite database outside version control.

This is a single-instance prototype. Multiple instances require shared persistence and event delivery. Phone calls, background GPS after suspension, crowd capacity and emergency-service dispatch are not guaranteed by this web application.
