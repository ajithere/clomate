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
      { params }
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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
app.listen(PORT, () => console.log(`Clomate backend running on port ${PORT}`));
