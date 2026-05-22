# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Backend** (port 3001):
```bash
cd backend && npm install
node server.js          # production
node --watch server.js  # dev with auto-restart
```

**Frontend** (port 5173):
```bash
cd frontend && npm install
npm run dev     # dev server with HMR
npm run build   # production build
npm run preview # preview production build
```

Both processes must be running for the app to work. Vite proxies all `/api/*` requests to `localhost:3001`.

There are no tests in this project.

## Architecture

### App phases (frontend)

[App.jsx](frontend/src/App.jsx) owns the top-level phase machine with three states:

- **`setup`** — [SetupFlow.jsx](frontend/src/components/SetupFlow.jsx) renders a 4-step wizard (country → date range MM-DD → years → place names). Also shows `SavedSessionsPanel` (inline in App.jsx) listing server-saved sessions.
- **`loading`** — `LoadingScreen` (inline in App.jsx) geocodes each place sequentially, then fetches weather for all years in parallel per place. Shows per-item progress and cache hit badges.
- **`dashboard`** — [Dashboard.jsx](frontend/src/components/Dashboard.jsx) renders the sidebar location list, chart switcher (temperature / feels-like / rainfall), year switcher, stats strip, and day-cards.

State flow: `trip` (setup config) and `weatherData` (array of location objects) are lifted into `App`. Sessions can be loaded from server or from a local `.clomate.json` file (via `BrandBar`, also inline in App.jsx) and jump directly to the dashboard phase.

### Backend ([server.js](backend/server.js))

Express app with ESM (`"type": "module"`). Key pieces:

- **Two-layer cache** — in-memory `Map` backed by JSON files in `cache/`. Cache key is an MD5 hash of `lat_lon_start_end_year`. TTL is 30 days. Cache is checked before every Open-Meteo archive request; hits are returned immediately.
- **Geocoding** — proxies to `geocoding-api.open-meteo.com/v1/search`. Not cached (results are small and rarely change).
- **Weather** — proxies to `archive-api.open-meteo.com/v1/archive`. Fetches all requested years in parallel via `Promise.all`. Returns `{ years: { "2023": [...days] }, cachedYears, totalYears }`.
- **Sessions** — saved as JSON files in `sessions/`. Filename encodes country + date range + timestamp. Full session JSON contains `{ version, savedAt, trip, weatherData }`.
- **Rate limiting** — 200 req/15 min on geocode, 100 req/15 min on weather (both applied per IP via `express-rate-limit`).

### Weather data shape

Each day object returned by `/api/weather` (and stored in sessions):
```js
{ date, min, max, avg, feels, rain }
```
`weatherData` array items (one per successfully geocoded location):
```js
{ name, lat, lon, elevation, country, years: { "2021": [...days], "2022": [...days] } }
```

### Styling

All styles are in [globals.css](frontend/src/styles/globals.css) using CSS custom properties (design tokens). No CSS modules, no UI library. Charts are rendered with raw SVG/Canvas inside Dashboard.jsx — no charting library dependency.

### External APIs (no auth required)

- Geocoding: `https://geocoding-api.open-meteo.com/v1/search`
- Historical weather: `https://archive-api.open-meteo.com/v1/archive`

Date params for the archive API are `YYYY-MM-DD`. The backend converts the `MM-DD` inputs and handles date ranges that cross a year boundary (e.g. Dec → Jan) by incrementing the end year.
