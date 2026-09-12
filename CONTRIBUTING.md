# Contributing

Use Node 24 and run all commands from the root.

1. Run npm ci.
2. Copy .env.example to .env for local configuration.
3. Edit the relevant frontend, backend or shared module.
4. Add tests for authorization, persistence, providers or location-rule changes.
5. Run npm run format and npm run check.

Do not commit keys, databases, personal location data, videos or generated builds. Keep public interface strings in source for catalog generation. Use provider fixtures only in tests. Describe validation and limitations in pull requests.
