# Clomate

Historical weather dashboard for travellers. Compare min and max daily temperature, feels-like, and rainfall across multiple locations and years and also a range of days when you are travelling — built for weather-sensitive travellers coming from different climates and for planning trips anywhere in the world.

## Stack

- **Frontend** — React 18 + Vite, plain CSS (no UI library)
- **Backend** — Node.js + Express
- **Data** — [Open-Meteo](https://open-meteo.com/) geocoding + historical archive APIs (free, no API key required)

## Project structure

```
clomate/
  backend/
    server.js          # Express API server (port 3001)
    package.json
  frontend/
    index.html
    vite.config.js     # Proxies /api/* → localhost:3001
    src/
      main.jsx
      App.jsx           # Phase machine: setup → loading → dashboard
      components/
        SetupFlow.jsx   # 4-step wizard
        Dashboard.jsx   # Charts, stats, day cards
      styles/
        globals.css     # Design tokens + all component styles
  cache/               # Disk-persisted weather cache (auto-created)
  sessions/            # Saved trip sessions (auto-created)
  CONTEXT.md
  README.md
```

## Getting started

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Start the backend

```bash
cd backend
node server.js
# Running on http://localhost:3001
```

### 3. Start the frontend

```bash
cd frontend
npm run dev
# Running on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check → `{ status: "ok" }` |
| GET | `/api/geocode?place=Kandersteg&country=Switzerland` | Geocode a place name |
| GET | `/api/weather?lat=46.49&lon=7.67&start=06-25&end=07-05&years=2021,2022,2023` | Fetch historical weather for multiple years in parallel |
| GET | `/api/cache/stats` | Cache stats → `{ entries, memEntries, sizeKB }` |
| GET | `/api/sessions` | List all saved sessions (metadata only) |
| POST | `/api/sessions` | Save a session `{ trip, weatherData }` |
| GET | `/api/sessions/:filename` | Load a saved session by filename |
| DELETE | `/api/sessions/:filename` | Delete a saved session |

The `start` and `end` params are in `MM-DD` format. Date ranges that cross year-end (e.g. `12-20` → `01-10`) are handled automatically.

## Caching

Weather data is cached at two layers to avoid redundant API calls:

- **In-memory** — an in-process `Map` for zero-latency repeat hits within a server session
- **Disk** — JSON files in `cache/`, keyed by an MD5 hash of `lat × lon × date-range × year`, with a 30-day TTL

Cache hits are shown in the loading screen as **from cache**, **live API**, or **N/M cached** badges per location.

## Sessions

Completed trips can be saved and reloaded so you don't have to re-fetch data:

- **Server sessions** — saved as JSON files in `sessions/`. Accessible from the sidebar on the setup screen (load or delete).
- **Local export** — sessions can be exported as `.clomate.json` files and loaded back via the "Load session" button in the header or the file picker on the setup screen.

Session files contain `{ version, savedAt, trip, weatherData }`.

## Rate limiting

The backend enforces per-IP rate limits to protect the upstream Open-Meteo API:

- Geocoding: 200 requests per 15 minutes
- Weather: 100 requests per 15 minutes

## Features

- **4-step setup** — country, date range (MM-DD), years to compare (2020–2025), up to 20 place names
- **Parallel data loading** — geocodes all places and fetches weather, shows per-place progress and cache source badges; skips places that fail geocoding
- **Dashboard sidebar** — location list with elevation badges, active location highlighted; "Start fresh" clears all state
- **Three chart views** per location:
  - Temperature — max / avg / min line chart
  - Feels like — actual avg vs apparent temperature
  - Rainfall — daily precipitation bar chart
- **Year switcher** — view a single year or average across all selected years
- **Hover crosshair** — interactive tooltip on all charts
- **Stats strip** — average, coldest, warmest, cold alerts (or rain totals)
- **Day-by-day cards** — scrollable strip with comfort badges and clothing suggestions
- **Location comparison** — select 2–4 locations to overlay on the same chart axes; shared crosshair tooltip and per-location stat cards for all three chart types
- **Configurable comfort thresholds** — Cold alert and Chilly cutoffs are adjustable via +/− controls in the sidebar; settings persist in `localStorage` and update badges, stats, and comparison cards instantly. Defaults: Cold alert `< 10°C` feels-like, Chilly `< 14°C`, Comfortable `≥ 14°C`
