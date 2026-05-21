# Clomate

Historical weather dashboard for travellers. Compare daily temperature, feels-like, and rainfall across multiple locations and years — built for cold-sensitive travellers from warm climates planning trips anywhere in the world.

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

The `start` and `end` params are in `MM-DD` format. Date ranges that cross year-end (e.g. `12-20` → `01-10`) are handled automatically.

## Features

- **4-step setup** — country, date range (MM-DD), years to compare (2020–2025), up to 10 place names
- **Parallel data loading** — geocodes all places simultaneously, shows per-place progress; skips places that fail geocoding
- **Dashboard sidebar** — location list with elevation badges, active location highlighted
- **Three chart views** per location:
  - Temperature — max / avg / min line chart
  - Feels like — actual avg vs apparent temperature
  - Rainfall — daily precipitation bar chart
- **Year switcher** — view a single year or average across all selected years
- **Hover crosshair** — interactive tooltip on all charts
- **Stats strip** — average, coldest, warmest, cold alerts (or rain totals)
- **Day-by-day cards** — scrollable strip with cold-alert badges:
  - `< 10°C feels-like` → Cold alert (red)
  - `< 14°C feels-like` → Chilly (amber)
  - `≥ 14°C feels-like` → Comfortable (green)
