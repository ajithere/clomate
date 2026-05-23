import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
const CACHE_DIR    = path.join(__dirname, '..', 'cache');

await fs.mkdir(SESSIONS_DIR, { recursive: true });
await fs.mkdir(CACHE_DIR,    { recursive: true });

// ── In-memory cache (warm on start, persisted to disk) ────────────────────────

const memCache = new Map();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function weatherCacheKey(lat, lon, start, end, year) {
  const norm = `${Number(lat).toFixed(4)}_${Number(lon).toFixed(4)}_${start}_${end}_${year}`;
  return crypto.createHash('md5').update(norm).digest('hex');
}

async function getCached(key) {
  if (memCache.has(key)) return memCache.get(key);
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf-8');
    const entry = JSON.parse(raw);
    if (Date.now() - new Date(entry.cachedAt).getTime() < CACHE_TTL_MS) {
      memCache.set(key, entry.data);
      return entry.data;
    }
  } catch {}
  return null;
}

async function setCached(key, data) {
  memCache.set(key, data);
  const entry = { cachedAt: new Date().toISOString(), data };
  await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(entry)).catch(() => {});
}

// ── Rate limiters ─────────────────────────────────────────────────────────────

const geocodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many geocoding requests. Please wait a few minutes and try again.' },
});

const weatherLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many weather requests. Please wait a few minutes and try again.' },
  skip: async (req) => {
    const { lat, lon, start, end, years } = req.query;
    if (!lat || !lon || !start || !end || !years) return false;
    const yearList = years.split(',').map(y => y.trim());
    const hits = await Promise.all(yearList.map(y => getCached(weatherCacheKey(lat, lon, start, end, y))));
    return hits.every(h => h !== null);
  },
});

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Geocode ───────────────────────────────────────────────────────────────────

app.get('/api/geocode', geocodeLimiter, async (req, res) => {
  const { place, country } = req.query;
  if (!place) return res.status(400).json({ error: 'place is required' });

  try {
    const params = { name: place, count: 1, language: 'en', format: 'json' };
    if (country) params.country = country;

    const { data } = await axios.get(
      'https://geocoding-api.open-meteo.com/v1/search',
      { params, timeout: 8000 }
    );

    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const r = data.results[0];
    res.json({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      elevation: r.elevation,
      country: r.country,
    });
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// ── Weather ───────────────────────────────────────────────────────────────────

app.get('/api/weather', weatherLimiter, async (req, res) => {
  const { lat, lon, start, end, years } = req.query;
  if (!lat || !lon || !start || !end || !years) {
    return res.status(400).json({ error: 'lat, lon, start, end, years are required' });
  }

  const yearList = years.split(',').map(y => y.trim());

  const [startMonth, startDay] = start.split('-').map(Number);
  const [endMonth, endDay]     = end.split('-').map(Number);
  const crossesYearEnd = endMonth < startMonth || (endMonth === startMonth && endDay < startDay);

  const fetchYear = async (year) => {
    const key    = weatherCacheKey(lat, lon, start, end, year);
    const cached = await getCached(key);
    if (cached) {
      console.log(`cache hit  ${year} ${lat},${lon} ${start}→${end}`);
      return { data: cached, fromCache: true };
    }

    console.log(`cache miss ${year} ${lat},${lon} ${start}→${end} — fetching Open-Meteo`);

    const startDate = `${year}-${start}`;
    const endYear   = crossesYearEnd ? Number(year) + 1 : Number(year);
    const endDate   = `${endYear}-${end}`;

    const { data } = await axios.get(
      'https://archive-api.open-meteo.com/v1/archive',
      {
        timeout: 10000,
        params: {
          latitude:  lat,
          longitude: lon,
          start_date: startDate,
          end_date:   endDate,
          daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'temperature_2m_mean',
            'apparent_temperature_mean',
            'precipitation_sum',
          ].join(','),
          timezone: 'auto',
        },
      }
    );

    const daily = data.daily;
    const result = daily.time.map((date, i) => ({
      date,
      min:   daily.temperature_2m_min[i],
      max:   daily.temperature_2m_max[i],
      avg:   daily.temperature_2m_mean[i],
      feels: daily.apparent_temperature_mean[i],
      rain:  daily.precipitation_sum[i],
    }));

    await setCached(key, result);
    return { data: result, fromCache: false };
  };

  try {
    const results    = await Promise.all(yearList.map(y => fetchYear(y)));
    const yearsObj   = {};
    let cachedCount  = 0;
    yearList.forEach((y, i) => {
      yearsObj[y] = results[i].data;
      if (results[i].fromCache) cachedCount++;
    });

    res.json({
      location: { lat: Number(lat), lon: Number(lon) },
      cachedYears: cachedCount,
      totalYears:  yearList.length,
      years: yearsObj,
    });
  } catch (err) {
    console.error('Weather error:', err.message);
    res.status(500).json({ error: 'Weather fetch failed' });
  }
});

// ── Cache stats ───────────────────────────────────────────────────────────────

app.get('/api/cache/stats', async (_req, res) => {
  try {
    const files = (await fs.readdir(CACHE_DIR)).filter(f => f.endsWith('.json'));
    let totalBytes = 0;
    for (const f of files) {
      const stat = await fs.stat(path.join(CACHE_DIR, f));
      totalBytes += stat.size;
    }
    res.json({
      entries: files.length,
      memEntries: memCache.size,
      sizeKB: Math.round(totalBytes / 1024),
    });
  } catch {
    res.json({ entries: 0, memEntries: 0, sizeKB: 0 });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

app.post('/api/sessions', async (req, res) => {
  const session = req.body;
  if (!session.trip || !session.weatherData) {
    return res.status(400).json({ error: 'Invalid session' });
  }
  const slug     = session.trip.country.toLowerCase().replace(/\s+/g, '-');
  const filename = `${slug}-${session.trip.startMD}-${session.trip.endMD}-${Date.now()}.json`;
  const toSave   = { version: 1, savedAt: new Date().toISOString(), ...session };
  await fs.writeFile(path.join(SESSIONS_DIR, filename), JSON.stringify(toSave, null, 2));
  res.json({ filename, savedAt: toSave.savedAt });
});

app.get('/api/sessions', async (_req, res) => {
  try {
    const files = (await fs.readdir(SESSIONS_DIR)).filter(f => f.endsWith('.json'));
    const metas = await Promise.all(files.map(async (filename) => {
      const raw = await fs.readFile(path.join(SESSIONS_DIR, filename), 'utf-8');
      const s   = JSON.parse(raw);
      return {
        filename,
        country:       s.trip?.country,
        startMD:       s.trip?.startMD,
        endMD:         s.trip?.endMD,
        years:         s.trip?.years || [],
        places:        s.trip?.places || [],
        locationCount: s.weatherData?.length ?? 0,
        savedAt:       s.savedAt,
      };
    }));
    metas.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json(metas);
  } catch {
    res.json([]);
  }
});

app.get('/api/sessions/:filename', async (req, res) => {
  const filepath = path.join(SESSIONS_DIR, path.basename(req.params.filename));
  try {
    res.json(JSON.parse(await fs.readFile(filepath, 'utf-8')));
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.delete('/api/sessions/:filename', async (req, res) => {
  const filepath = path.join(SESSIONS_DIR, path.basename(req.params.filename));
  try {
    await fs.unlink(filepath);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ── Share export ─────────────────────────────────────────────────────────────

function buildAllAvgServer(yearData) {
  const allYears = Object.values(yearData);
  if (!allYears.length) return [];
  const len = allYears[0].length;
  const result = [];
  for (let i = 0; i < len; i++) {
    const rows = allYears.map(y => y[i]).filter(Boolean);
    const valid = arr => arr.filter(v => v != null && !isNaN(v));
    const mean = arr => { const v = valid(arr); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    result.push({
      date: allYears[0][i].date,
      min: mean(rows.map(r => r.min)), max: mean(rows.map(r => r.max)),
      avg: mean(rows.map(r => r.avg)), feels: mean(rows.map(r => r.feels)),
      rain: mean(rows.map(r => r.rain)),
    });
  }
  return result;
}

const SHARE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--bg:#ffffff;--surface:#f6f8fb;--surface-2:#eef2f8;--border:#e6eaf0;--border-strong:#d6dce6;--ink:#0e1422;--ink-2:#4a5462;--ink-3:#8b95a6;--ink-4:#aab3c2;--blue:oklch(0.58 0.15 245);--blue-strong:oklch(0.50 0.17 245);--blue-soft:oklch(0.96 0.025 245);--blue-tint:oklch(0.92 0.04 245);--teal:oklch(0.68 0.10 200);--teal-soft:oklch(0.95 0.03 200);--green:oklch(0.70 0.13 165);--green-soft:oklch(0.95 0.04 165);--amber:oklch(0.78 0.14 75);--amber-soft:oklch(0.96 0.05 80);--red:oklch(0.62 0.20 25);--red-soft:oklch(0.96 0.04 25);--radius-sm:8px;--radius:12px;--radius-lg:16px;--shadow-1:0 1px 2px rgba(14,20,34,0.04),0 1px 1px rgba(14,20,34,0.03);--shadow-2:0 4px 14px -6px rgba(14,20,34,0.10),0 2px 6px -3px rgba(14,20,34,0.06);--font-sans:"Manrope",ui-sans-serif,system-ui,sans-serif;--font-mono:"IBM Plex Mono",ui-monospace,monospace;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;}
body{font-family:var(--font-sans);background:var(--bg);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;}
button{font-family:var(--font-sans);cursor:pointer;border:none;background:none;}
.app-shell{max-width:1280px;margin:0 auto;min-height:100vh;background:var(--bg);}
.brand-bar{height:60px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 32px;}
.brand-identity{display:flex;align-items:center;gap:10px;}
.brand-mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--blue) 0%,var(--blue-strong) 100%);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.brand-name{font-weight:700;font-size:17px;color:var(--ink);letter-spacing:-0.02em;}
.brand-tagline{font-size:13px;color:var(--ink-3);}
.dashboard{display:flex;height:calc(100vh - 60px);overflow:hidden;}
.sidebar{width:260px;flex-shrink:0;border-right:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;}
.sidebar-trip-info{padding:24px 20px 16px;border-bottom:1px solid var(--border);}
.sidebar-trip-label{font-size:10px;font-weight:700;color:var(--ink-4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;}
.sidebar-country{font-size:16px;font-weight:700;color:var(--ink);margin-bottom:4px;}
.sidebar-daterange{font-size:13px;font-family:var(--font-mono);color:var(--ink-3);}
.sidebar-locs-header{padding:16px 20px 8px;font-size:11px;font-weight:700;color:var(--ink-4);letter-spacing:0.06em;text-transform:uppercase;}
.sidebar-loc-list{flex:1;}
.sidebar-loc-item{display:flex;align-items:center;gap:10px;padding:10px 20px;cursor:pointer;border-left:3px solid transparent;transition:all 0.12s;}
.sidebar-loc-item:hover{background:var(--surface-2);}
.sidebar-loc-item.active{border-left-color:var(--blue);background:var(--blue-soft);}
.sidebar-loc-pin{color:var(--ink-4);flex-shrink:0;}
.sidebar-loc-item.active .sidebar-loc-pin{color:var(--blue);}
.sidebar-loc-info{flex:1;min-width:0;}
.sidebar-loc-name{font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sidebar-loc-sub{font-size:11px;color:var(--ink-4);font-family:var(--font-mono);margin-top:1px;}
.sidebar-elev{font-size:11px;font-family:var(--font-mono);font-weight:500;padding:2px 7px;border-radius:6px;background:var(--surface-2);color:var(--ink-3);flex-shrink:0;}
.sidebar-footer{padding:16px 20px;border-top:1px solid var(--border);}
.share-generated-note{font-size:11px;color:var(--ink-4);}
.main-content{flex:1;overflow-y:auto;padding:28px 32px;min-width:0;}
.main-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:16px;}
.main-loc-info{flex:1;min-width:0;}
.main-loc-name{font-size:22px;font-weight:700;color:var(--ink);letter-spacing:-0.02em;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.main-loc-country{font-size:14px;font-weight:500;color:var(--ink-3);}
.main-loc-elev{font-size:12px;font-family:var(--font-mono);padding:3px 8px;border-radius:6px;background:var(--surface-2);color:var(--ink-3);}
.year-mode-pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;background:var(--teal-soft);color:var(--teal);letter-spacing:0.02em;}
.year-switcher{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:16px;}
.year-btn{padding:7px 13px;border-radius:var(--radius-sm);font-size:12px;font-weight:600;font-family:var(--font-mono);color:var(--ink-3);border:1.5px solid var(--border);background:var(--bg);transition:all 0.12s;}
.year-btn:hover{border-color:var(--blue);color:var(--blue);}
.year-btn.active{background:var(--blue);border-color:var(--blue);color:white;}
.chart-tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:20px;}
.chart-tab{padding:10px 20px;font-size:14px;font-weight:600;color:var(--ink-3);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.12s;cursor:pointer;}
.chart-tab:hover{color:var(--ink-2);}
.chart-tab.active{color:var(--blue);border-bottom-color:var(--blue);}
.chart-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;box-shadow:var(--shadow-2);margin-bottom:20px;}
.chart-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:16px;}
.chart-title{font-size:15px;font-weight:700;color:var(--ink);margin-bottom:3px;}
.chart-meta{font-size:12px;color:var(--ink-4);}
.chart-legend{display:flex;gap:16px;flex-wrap:wrap;justify-content:flex-end;}
.legend-item{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--ink-3);}
.legend-line{width:20px;height:2px;border-radius:1px;flex-shrink:0;}
.legend-line.dashed{background:repeating-linear-gradient(90deg,currentColor 0,currentColor 4px,transparent 4px,transparent 8px);}
.chart-svg-wrapper{width:100%;}
.chart-svg-wrapper svg{width:100%;overflow:visible;}
.stats-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;}
.stat-label{font-size:11px;font-weight:700;color:var(--ink-4);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:6px;}
.stat-value{font-size:20px;font-weight:700;color:var(--ink);letter-spacing:-0.02em;font-family:var(--font-mono);}
.stat-unit{font-size:12px;font-weight:500;color:var(--ink-4);margin-left:2px;}
.day-section-title{font-size:14px;font-weight:700;color:var(--ink);margin-bottom:12px;}
.day-cards-scroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:12px;scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent;}
.day-card{flex-shrink:0;width:90px;border-radius:var(--radius);padding:12px 10px;border:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column;align-items:center;gap:4px;}
.day-card.alert-cold{background:var(--red-soft);border-color:oklch(0.88 0.06 25);}
.day-card.alert-chilly{background:var(--amber-soft);border-color:oklch(0.88 0.08 75);}
.day-card.alert-comfortable{background:var(--green-soft);border-color:oklch(0.88 0.07 165);}
.day-card-dow{font-size:10px;font-weight:700;color:var(--ink-4);letter-spacing:0.06em;text-transform:uppercase;}
.day-card-date{font-size:11px;font-family:var(--font-mono);color:var(--ink-3);}
.day-card-temp{font-size:20px;font-weight:700;color:var(--ink);font-family:var(--font-mono);margin:4px 0;}
.day-card-feels{font-size:11px;color:var(--ink-3);font-weight:500;}
.day-card-rain{font-size:11px;color:var(--ink-3);font-family:var(--font-mono);}
.day-card-rain-bar{width:60px;height:3px;background:var(--surface-2);border-radius:2px;overflow:hidden;}
.day-card-rain-fill{height:100%;background:var(--blue);border-radius:2px;}
.day-card-badge{font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:2px 7px;border-radius:100px;margin-top:2px;}
.alert-cold .day-card-badge{background:var(--red);color:white;}
.alert-chilly .day-card-badge{background:var(--amber);color:white;}
.alert-comfortable .day-card-badge{background:var(--green);color:white;}
.day-card-clothing{font-size:10px;font-weight:600;color:var(--ink-3);text-align:center;margin-top:4px;line-height:1.3;}
.packing-summary{margin-top:28px;border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;}
.packing-summary-header{padding:18px 20px 14px;background:var(--surface);border-bottom:1px solid var(--border);}
.packing-summary-title{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px;}
.packing-range{font-size:12px;font-weight:500;font-family:var(--font-mono);color:var(--ink-3);}
.packing-summary-desc{font-size:13px;color:var(--ink-3);line-height:1.5;}
.packing-summary-desc strong{color:var(--ink-2);font-weight:700;}
.packing-tiers{display:flex;flex-wrap:wrap;}
.packing-tier{flex:1;min-width:180px;padding:16px 20px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);}
.packing-tier:last-child{border-right:none;}
.packing-tier-label{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--ink);margin-bottom:10px;}
.packing-tier-icon{font-size:16px;}
.packing-items{list-style:none;display:flex;flex-direction:column;gap:5px;}
.packing-items li{font-size:12px;color:var(--ink-2);padding-left:14px;position:relative;line-height:1.4;}
.packing-items li::before{content:'·';position:absolute;left:4px;color:var(--ink-4);}
.home-ref-banner{display:flex;align-items:center;gap:9px;background:oklch(0.96 0.025 200);border:1.5px solid oklch(0.88 0.06 200);border-radius:var(--radius);padding:12px 16px;margin-bottom:12px;font-size:15px;color:oklch(0.40 0.11 200);line-height:1.4;}
.home-ref-banner svg{flex-shrink:0;color:oklch(0.52 0.10 200);}
.home-ref-banner strong{font-weight:700;}
.home-ref-banner--nomatch{background:var(--surface);border-color:var(--border);color:var(--ink-3);}
.home-ref-banner--nomatch svg{color:var(--ink-4);}
`;

function generateShareHTML(session) {
  const { trip } = session;
  const locations = session.weatherData.map(loc => ({
    name: loc.name,
    country: loc.country,
    elevation: loc.elevation,
    allAvg: buildAllAvgServer(loc.years),
    years: loc.years,
  }));

  const sessionJSON = JSON.stringify({
    trip,
    homeCity: session.homeCity || null,
    savedAt: session.savedAt || new Date().toISOString(),
    locations,
  }).replace(/<\/script>/gi, '<\\/script>');

  const savedAt = session.savedAt
    ? new Date(session.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const locListHTML = locations.map((loc, i) =>
    `<div class="sidebar-loc-item${i === 0 ? ' active' : ''}" onclick="setLocation(${i})" data-loc="${i}">` +
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="sidebar-loc-pin"><circle cx="7" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M7 13C7 13 2 8.5 2 5.5a5 5 0 0110 0C12 8.5 7 13 7 13Z" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>` +
    `<div class="sidebar-loc-info"><div class="sidebar-loc-name">${loc.name}</div><div class="sidebar-loc-sub">#${String(i + 1).padStart(2, '0')} · ${loc.country}</div></div>` +
    (loc.elevation != null ? `<div class="sidebar-elev">${Math.round(loc.elevation)}m</div>` : '') +
    `</div>`
  ).join('');

  const yearBtnsHTML = ['all', ...trip.years].map(y =>
    `<button class="year-btn${y === 'all' ? ' active' : ''}" onclick="setYear('${y}')" data-year="${y}">${y === 'all' ? 'All avg' : y}</button>`
  ).join('');

  const clientJS = `
const SESSION = ${sessionJSON};
let activeLocIdx = 0, activeYear = 'all', activeChart = 'temperature';

function avg(arr) { const v = arr.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function fmt1(v) { return v == null ? '\\u2014' : v.toFixed(1); }
function fmtDate(s) { const [,m,d]=s.split('-'); const n=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return n[parseInt(m,10)-1]+' '+parseInt(d,10); }
function getDow(s) { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(s+'T12:00:00').getDay()]; }
const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthPartDesc(s) { const [,m,d]=s.split('-').map(Number); return (d<=10?'early':d<=20?'mid':'late')+' '+MONTH_NAMES[m-1]; }
function findHomeMatches(homeAvgData,destColdest,destWarmest,tolerance) {
  tolerance = tolerance || 2;
  if (!homeAvgData||!homeAvgData.length) return [];
  const lo=destColdest-tolerance, hi=destWarmest+tolerance;
  const runs=[]; let runDays=[], gap=0;
  for (const d of homeAvgData) {
    if (d.feels!=null&&d.feels>=lo&&d.feels<=hi) { runDays.push(d); gap=0; }
    else if (runDays.length>0) { gap++; if (gap>5) { if (runDays.length>=5) runs.push([...runDays]); runDays=[]; gap=0; } }
  }
  if (runDays.length>=5) runs.push(runDays);
  return runs.map(days => { const s=monthPartDesc(days[0].date), e=monthPartDesc(days[days.length-1].date); return {label:s===e?s:s+' \\u2013 '+e}; });
}
function getAlertLabel(feels,cold,chilly) { cold=cold||10; chilly=chilly||14; if (feels==null) return ''; if (feels<cold) return 'Cold alert'; if (feels<chilly) return 'Chilly'; return 'Comfortable'; }
function getAlertClass(feels,cold,chilly) { cold=cold||10; chilly=chilly||14; if (feels==null) return ''; if (feels<cold) return 'alert-cold'; if (feels<chilly) return 'alert-chilly'; return 'alert-comfortable'; }
function getClothingRec(feels) {
  if (feels==null) return null;
  if (feels<-10) return {short:'Arctic gear',icon:'\\u{1F9CA}',items:['Insulated parka','Thermal base layers (top + bottom)','Fleece mid-layer','Insulated waterproof boots','Balaclava','Thick gloves or mittens','Wool hat','Neck gaiter']};
  if (feels<0)   return {short:'Heavy winter',icon:'\\u{1F9E5}',items:['Heavy wool or down coat','Thermal base layers','Warm sweater','Wool hat','Scarf','Insulated gloves','Warm boots']};
  if (feels<5)   return {short:'Winter coat',icon:'\\u{1F9E5}',items:['Winter coat','Warm sweater or hoodie','Hat','Light gloves','Scarf','Warm socks']};
  if (feels<10)  return {short:'Heavy jacket',icon:'\\u{1F976}',items:['Heavy jacket or fleece','Woolens / thick sweater','Scarf','Light gloves recommended']};
  if (feels<14)  return {short:'Jacket + layer',icon:'\\u{1F9E3}',items:['Jacket','Light woolen or sweatshirt','Scarf optional']};
  if (feels<18)  return {short:'Light jacket',icon:'\\u{1F9E2}',items:['Light jacket or cardigan','Jeans or long trousers']};
  if (feels<22)  return {short:'Light layers',icon:'\\u{1F455}',items:['T-shirt','Light overshirt or thin cardigan','Comfortable trousers']};
  if (feels<26)  return {short:'Casual',icon:'\\u{1F455}',items:['T-shirt','Light trousers or chinos','Sunscreen advised']};
  return {short:'Summer wear',icon:'\\u{1F31E}',items:['Shorts or light dress','T-shirt or sleeveless top','Sunscreen','Hat for sun protection']};
}

const PAD={top:16,right:16,bottom:36,left:48};
const CHART_W=760, CHART_H=220;
function toX(i,n) { return PAD.left+(i/Math.max(n-1,1))*(CHART_W-PAD.left-PAD.right); }
function toY(v,yMin,yMax) { const h=CHART_H-PAD.top-PAD.bottom; return PAD.top+h-((v-yMin)/Math.max(yMax-yMin,0.001))*h; }

function buildAxesSVG(data,yMin,yMax,unit) {
  let g='<g>';
  for (let t=0;t<=5;t++) {
    const v=yMin+(yMax-yMin)*(t/5);
    const y=toY(v,yMin,yMax);
    g+='<line x1="'+PAD.left+'" y1="'+y.toFixed(1)+'" x2="'+(CHART_W-PAD.right)+'" y2="'+y.toFixed(1)+'" stroke="#e6eaf0" stroke-width="1"/>';
    g+='<text x="'+(PAD.left-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" fill="#aab3c2" font-size="10" font-family="IBM Plex Mono,monospace">'+v.toFixed(1)+unit+'</text>';
  }
  const step=Math.max(1,Math.floor(data.length/8));
  data.forEach((d,i) => {
    if (i%step!==0) return;
    const x=toX(i,data.length);
    g+='<text x="'+x.toFixed(1)+'" y="'+(CHART_H-4)+'" text-anchor="middle" fill="#aab3c2" font-size="10" font-family="IBM Plex Mono,monospace">'+fmtDate(d.date)+'</text>';
  });
  return g+'</g>';
}
function buildLineSVG(data,accessor,yMin,yMax,color,dashed) {
  const pts=data.map((d,i)=>{const v=accessor(d); return v==null?null:[toX(i,data.length),toY(v,yMin,yMax)];}).filter(Boolean);
  if (!pts.length) return '';
  return '<path d="M'+pts.map(([x,y])=>x.toFixed(1)+','+y.toFixed(1)).join('L')+'" stroke="'+color+'" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"'+(dashed?' stroke-dasharray="5,3"':'')+'/>';
}
function buildBarsSVG(data,yMin,yMax,color) {
  const bw=Math.max(2,(CHART_W-PAD.left-PAD.right)/data.length-2);
  return data.map((d,i)=>{
    const v=d.rain||0; if (!v) return '';
    const x=toX(i,data.length)-bw/2, y=toY(v,yMin,yMax), h=toY(yMin,yMin,yMax)-y;
    return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+color+'" rx="1"/>';
  }).join('');
}
function buildChartSVG(type,data) {
  const open='<svg width="100%" viewBox="0 0 '+CHART_W+' '+CHART_H+'" overflow="visible">';
  if (type==='temperature') {
    const vals=data.flatMap(d=>[d.min,d.max,d.avg].filter(v=>v!=null));
    if (!vals.length) return open+'</svg>';
    const yMin=Math.floor(Math.min(...vals)-2), yMax=Math.ceil(Math.max(...vals)+2);
    return open+buildAxesSVG(data,yMin,yMax,'\\u00b0')+buildLineSVG(data,d=>d.max,yMin,yMax,'#e05c5c')+buildLineSVG(data,d=>d.avg,yMin,yMax,'#4a8fe8')+buildLineSVG(data,d=>d.min,yMin,yMax,'#4a8fe8',true)+'</svg>';
  }
  if (type==='feels') {
    const vals=data.flatMap(d=>[d.avg,d.feels].filter(v=>v!=null));
    if (!vals.length) return open+'</svg>';
    const yMin=Math.floor(Math.min(...vals)-2), yMax=Math.ceil(Math.max(...vals)+2);
    return open+buildAxesSVG(data,yMin,yMax,'\\u00b0')+buildLineSVG(data,d=>d.avg,yMin,yMax,'#4a8fe8')+buildLineSVG(data,d=>d.feels,yMin,yMax,'#9b6dff',true)+'</svg>';
  }
  if (type==='rainfall') {
    const vals=data.map(d=>d.rain||0);
    const yMax=Math.ceil(Math.max(...vals,1)*1.1);
    return open+buildAxesSVG(data,0,yMax,'mm')+buildBarsSVG(data,0,yMax,'#4a8fe8')+'</svg>';
  }
  return open+'</svg>';
}

function buildLocHeaderHTML(loc,year) {
  const pill=year==='all'?'avg across all years':year+' data';
  const elev=loc.elevation!=null?'<span class="main-loc-elev">'+Math.round(loc.elevation)+'m</span>':'';
  return '<div class="main-loc-info"><div class="main-loc-name">'+loc.name+'<span class="main-loc-country">'+loc.country+'</span>'+elev+'</div><div style="margin-top:4px"><span class="year-mode-pill">'+pill+'</span></div></div>';
}
function buildChartHeaderHTML(loc,chartType,year) {
  const titles={temperature:'Temperature over time',feels:'Feels-like temperature',rainfall:'Daily rainfall'};
  const yearStr=year==='all'?SESSION.trip.years.join(', '):year;
  const legends={
    temperature:'<div class="legend-item"><div class="legend-line" style="background:#e05c5c"></div>Max</div><div class="legend-item"><div class="legend-line" style="background:#4a8fe8"></div>Avg</div><div class="legend-item"><div class="legend-line dashed" style="color:#4a8fe8"></div>Min</div>',
    feels:'<div class="legend-item"><div class="legend-line" style="background:#4a8fe8"></div>Actual avg</div><div class="legend-item"><div class="legend-line dashed" style="color:#9b6dff"></div>Feels like</div>',
    rainfall:'<div class="legend-item"><div class="legend-line" style="background:#4a8fe8"></div>Daily mm</div>',
  };
  return '<div><div class="chart-title">'+titles[chartType]+'</div><div class="chart-meta">'+SESSION.trip.startMD+' \\u2192 '+SESSION.trip.endMD+' \\u00b7 '+loc.country+' \\u00b7 '+yearStr+'</div></div><div class="chart-legend">'+legends[chartType]+'</div>';
}
function buildStatsHTML(data,type) {
  if (!data.length) return '';
  const cold=10;
  if (type==='temperature') {
    const avgs=data.map(d=>d.avg).filter(v=>v!=null);
    const coldAlerts=data.filter(d=>d.feels!=null&&d.feels<cold).length;
    return '<div class="stats-strip"><div class="stat-card"><div class="stat-label">Average</div><div class="stat-value">'+fmt1(avg(avgs))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Coldest</div><div class="stat-value">'+fmt1(Math.min(...avgs))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Warmest</div><div class="stat-value">'+fmt1(Math.max(...avgs))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Cold alerts</div><div class="stat-value"'+(coldAlerts>0?' style="color:var(--red)"':'')+'>'+coldAlerts+'<span class="stat-unit"> days</span></div></div></div>';
  }
  if (type==='feels') {
    const feelsArr=data.map(d=>d.feels).filter(v=>v!=null);
    const avgs=data.map(d=>d.avg).filter(v=>v!=null);
    const coldAlerts=feelsArr.filter(v=>v<cold).length;
    return '<div class="stats-strip"><div class="stat-card"><div class="stat-label">Average</div><div class="stat-value">'+fmt1(avg(feelsArr))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Coldest feels</div><div class="stat-value">'+fmt1(Math.min(...feelsArr))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Warmest</div><div class="stat-value">'+fmt1(Math.max(...avgs))+'<span class="stat-unit">\\u00b0C</span></div></div><div class="stat-card"><div class="stat-label">Cold alerts</div><div class="stat-value"'+(coldAlerts>0?' style="color:var(--red)"':'')+'>'+coldAlerts+'<span class="stat-unit"> days</span></div></div></div>';
  }
  if (type==='rainfall') {
    const rains=data.map(d=>d.rain).filter(v=>v!=null);
    const total=rains.reduce((a,b)=>a+b,0);
    return '<div class="stats-strip"><div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">'+Math.round(total)+'<span class="stat-unit"> mm</span></div></div><div class="stat-card"><div class="stat-label">Wet days</div><div class="stat-value">'+rains.filter(v=>v>1).length+'<span class="stat-unit"> days</span></div></div><div class="stat-card"><div class="stat-label">Wettest day</div><div class="stat-value">'+fmt1(Math.max(...rains,0))+'<span class="stat-unit"> mm</span></div></div><div class="stat-card"><div class="stat-label">Dry days</div><div class="stat-value">'+rains.filter(v=>v<=1).length+'<span class="stat-unit"> days</span></div></div></div>';
  }
  return '';
}
function buildDayCardsHTML(data) {
  if (!data.length) return '';
  const maxRain=Math.max(...data.map(d=>d.rain||0),1);
  const cards=data.map(d=>{
    const alertCls=getAlertClass(d.feels), alertLabel=getAlertLabel(d.feels), clothing=getClothingRec(d.feels);
    const rainPct=Math.min(100,((d.rain||0)/maxRain)*100);
    const badge=alertLabel?'<div class="day-card-badge">'+alertLabel+'</div>':'';
    const cloth=clothing?'<div class="day-card-clothing">'+clothing.icon+' '+clothing.short+'</div>':'';
    return '<div class="day-card '+alertCls+'"><div class="day-card-dow">'+getDow(d.date)+'</div><div class="day-card-date">'+fmtDate(d.date)+'</div><div class="day-card-temp">'+fmt1(d.avg)+'\\u00b0</div><div class="day-card-feels">feels '+fmt1(d.feels)+'\\u00b0</div><div class="day-card-rain">'+fmt1(d.rain)+' mm</div><div class="day-card-rain-bar"><div class="day-card-rain-fill" style="width:'+rainPct.toFixed(1)+'%"></div></div>'+badge+cloth+'</div>';
  }).join('');
  return '<div class="day-section-title">Day by day</div><div class="day-cards-scroll">'+cards+'</div>';
}
function buildPackingSummaryHTML(data) {
  const fv=data.map(d=>d.feels).filter(v=>v!=null);
  if (!fv.length) return '';
  const coldest=Math.min(...fv), warmest=Math.max(...fv), rec=getClothingRec(coldest);
  if (!rec) return '';
  const tierMap=new Map();
  data.forEach(d=>{const r=getClothingRec(d.feels); if (r&&!tierMap.has(r.short)) tierMap.set(r.short,r);});
  const tiersHTML=[...tierMap.values()].map(t=>'<div class="packing-tier"><div class="packing-tier-label"><span class="packing-tier-icon">'+t.icon+'</span>'+t.short+'</div><ul class="packing-items">'+t.items.map(item=>'<li>'+item+'</li>').join('')+'</ul></div>').join('');
  return '<div class="packing-summary"><div class="packing-summary-header"><div class="packing-summary-title"><span>What to pack</span><span class="packing-range">'+fmt1(coldest)+'\\u00b0 to '+fmt1(warmest)+'\\u00b0 feels-like</span></div><p class="packing-summary-desc">Based on the coldest feels-like temperature ('+fmt1(coldest)+'\\u00b0C), pack for <strong>'+rec.short+'</strong>. The full range across this period:</p></div><div class="packing-tiers">'+tiersHTML+'</div></div>';
}
function buildHomeBannerHTML(homeCity,data) {
  if (!homeCity||!homeCity.homeData) return '';
  const fv=data.map(d=>d.feels).filter(v=>v!=null);
  if (!fv.length) return '';
  const matches=findHomeMatches(homeCity.homeData,Math.min(...fv),Math.max(...fv));
  const icon='<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5L1.5 7V13H5.5V9.5H9.5V13H13.5V7L7.5 1.5Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg>';
  if (matches.length) return '<div class="home-ref-banner">'+icon+'<span>Feels like <strong>'+homeCity.name+'</strong> in <strong>'+matches.map(m=>m.label).join(' or ')+'</strong></span></div>';
  return '<div class="home-ref-banner home-ref-banner--nomatch">'+icon+'<span><strong>'+homeCity.name+'</strong> doesn\\'t typically reach this temperature range</span></div>';
}

function getCurrentData() { const loc=SESSION.locations[activeLocIdx]; return activeYear==='all'?loc.allAvg:(loc.years[activeYear]||[]); }
function render() {
  const loc=SESSION.locations[activeLocIdx], data=getCurrentData();
  document.querySelectorAll('[data-loc]').forEach(el=>el.classList.toggle('active',parseInt(el.dataset.loc)===activeLocIdx));
  document.querySelectorAll('[data-year]').forEach(el=>el.classList.toggle('active',el.dataset.year===activeYear));
  document.querySelectorAll('[data-chart]').forEach(el=>el.classList.toggle('active',el.dataset.chart===activeChart));
  document.getElementById('loc-header').innerHTML=buildLocHeaderHTML(loc,activeYear);
  document.getElementById('home-banner').innerHTML=buildHomeBannerHTML(SESSION.homeCity,data);
  document.getElementById('chart-header').innerHTML=buildChartHeaderHTML(loc,activeChart,activeYear);
  document.getElementById('chart-svg-wrap').innerHTML=buildChartSVG(activeChart,data);
  document.getElementById('stats-strip').innerHTML=buildStatsHTML(data,activeChart);
  document.getElementById('day-cards-wrap').innerHTML=buildDayCardsHTML(data)+buildPackingSummaryHTML(data);
}
function setLocation(i) { activeLocIdx=i; render(); }
function setYear(y) { activeYear=y; render(); }
function setChart(t) { activeChart=t; render(); }
render();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clomate — ${trip.country} ${trip.startMD}→${trip.endMD}</title>
<style>${SHARE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <div class="brand-bar">
    <div class="brand-identity">
      <div class="brand-mark">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5C4 1.5 1.5 4 1.5 7S4 12.5 7 12.5 12.5 10 12.5 7 10 1.5 7 1.5Z" stroke="white" stroke-width="1.5" fill="none"/>
          <path d="M7 4.5v5M4.5 7h5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="brand-name">Clomate</span>
    </div>
    <span class="brand-tagline">Historical Weather for Travellers · shared view</span>
  </div>
  <div class="dashboard">
    <div class="sidebar">
      <div class="sidebar-trip-info">
        <div class="sidebar-trip-label">Trip</div>
        <div class="sidebar-country">${trip.country}</div>
        <div class="sidebar-daterange">${trip.startMD} → ${trip.endMD}</div>
      </div>
      <div class="sidebar-locs-header">Locations ${locations.length}</div>
      <div class="sidebar-loc-list">${locListHTML}</div>
      <div class="sidebar-footer">
        <div class="share-generated-note">Shared via Clomate${savedAt ? ' · ' + savedAt : ''}</div>
      </div>
    </div>
    <div class="main-content">
      <div class="main-header" id="loc-header"></div>
      <div id="home-banner"></div>
      <div class="year-switcher">${yearBtnsHTML}</div>
      <div class="chart-tabs">
        <button class="chart-tab active" onclick="setChart('temperature')" data-chart="temperature">Temperature</button>
        <button class="chart-tab" onclick="setChart('feels')" data-chart="feels">Feels like</button>
        <button class="chart-tab" onclick="setChart('rainfall')" data-chart="rainfall">Rainfall</button>
      </div>
      <div class="chart-card">
        <div class="chart-header" id="chart-header"></div>
        <div class="chart-svg-wrapper" id="chart-svg-wrap"></div>
      </div>
      <div id="stats-strip"></div>
      <div id="day-cards-wrap"></div>
    </div>
  </div>
</div>
<script>${clientJS}</script>
</body>
</html>`;
}

app.post('/api/share/export', async (req, res) => {
  const session = req.body;
  if (!session.trip || !session.weatherData) return res.status(400).json({ error: 'Invalid session' });
  try {
    const html = generateShareHTML(session);
    const slug = session.trip.country.toLowerCase().replace(/\s+/g, '-');
    const filename = `clomate-share-${slug}-${session.trip.startMD}-${session.trip.endMD}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    console.error('Share export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
app.listen(PORT, () => console.log(`Clomate backend running on port ${PORT}`));
