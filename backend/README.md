# Backend

Express + TypeScript with SQLite persistence. Run commands from the repository root.

The index module starts the server. The app module assembles middleware, routes, event streams and scheduled work. Modules are named for the feature they implement.

Authentication uses hashed passwords, HTTP-only cookies and CSRF. Group membership scopes data and AI actions. Provider adapters use server-side configuration, bounded requests and validated responses. Schema migrations run at startup.

The backend imports shared contracts, not React components. The compiled entry point is dist/backend/src/index.js. Back up runtime data before upgrades.
