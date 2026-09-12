# Frontend

React + TypeScript, built by Vite. Run commands from the repository root.

Views contain user-facing screens; components contain maps, language controls and shared UI. The location hook handles device/simulator updates. The HTTP client handles credentials, CSRF and failures. The i18n directory localizes rendered text.

The frontend uses same-origin /api routes. Private keys do not belong in frontend code or VITE variables. The Maps JavaScript key is intentionally browser-visible and must be restricted by API and referrer.

npm run build emits dist/frontend. npm run dev rebuilds frontend changes.
