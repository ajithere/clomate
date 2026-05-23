import { useState, useRef } from 'react';
import SetupFlow from './components/SetupFlow.jsx';
import Dashboard from './components/Dashboard.jsx';

function BrandBar({ onLoadSession, onHome }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const session = JSON.parse(ev.target.result);
        if (!session.version || !session.trip || !session.weatherData) {
          alert('Invalid session file.');
          return;
        }
        onLoadSession(session);
      } catch {
        alert('Could not read session file — make sure it is a valid .clomate.json file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="brand-bar">
      <div className="brand-identity brand-identity-link" onClick={onHome} title="Go to home">
        <div className="brand-mark">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1.5C4 1.5 1.5 4 1.5 7S4 12.5 7 12.5 12.5 10 12.5 7 10 1.5 7 1.5Z" stroke="white" strokeWidth="1.5" fill="none"/>
            <path d="M7 4.5v5M4.5 7h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <span className="brand-name">Clomate</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="brand-tagline">Historical Weather for Travellers</span>
        <button
          className="btn-load-session"
          onClick={() => fileInputRef.current.click()}
          title="Load a saved .clomate.json session"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 8.5V1.5M4 4l2.5-2.5L9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 9.5v1a1 1 0 001 1h7a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Load session
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.clomate.json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}

function LoadingScreen({ trip, onReady }) {
  const [items, setItems] = useState(() =>
    trip.places.map(p => ({ name: p, status: 'pending', geo: null }))
  );
  const [started, setStarted] = useState(false);

  const updateItem = (index, patch) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const run = async () => {
    setStarted(true);
    const results = [];

    for (let i = 0; i < trip.places.length; i++) {
      const placeName = trip.places[i];
      updateItem(i, { status: 'geocoding' });

      let geo = null;
      try {
        const r = await fetch(
          `/api/geocode?place=${encodeURIComponent(placeName)}&country=${encodeURIComponent(trip.country)}`
        );
        if (r.status === 429) {
          const msg = (await r.json()).error || 'Rate limit reached';
          updateItem(i, { status: 'geo-error', errMsg: msg });
          continue;
        }
        if (!r.ok) throw new Error('Not found');
        geo = await r.json();
        updateItem(i, { status: 'fetching', geo });
      } catch (err) {
        updateItem(i, { status: 'geo-error', errMsg: err.message });
        continue;
      }

      try {
        const yearsParam = trip.years.join(',');
        const r = await fetch(
          `/api/weather?lat=${geo.lat}&lon=${geo.lon}&start=${trip.startMD}&end=${trip.endMD}&years=${yearsParam}`
        );
        if (r.status === 429) {
          const msg = (await r.json()).error || 'Rate limit reached';
          updateItem(i, { status: 'weather-error', errMsg: msg });
          results.push({ name: geo.name || placeName, lat: geo.lat, lon: geo.lon, elevation: geo.elevation, country: geo.country, years: {}, failed: true });
          continue;
        }
        if (!r.ok) throw new Error('Weather failed');
        const weather = await r.json();
        const cacheSource = weather.cachedYears === weather.totalYears
          ? 'cache'
          : weather.cachedYears === 0
            ? 'api'
            : 'mixed';
        updateItem(i, { status: 'done', cacheSource, cachedYears: weather.cachedYears, totalYears: weather.totalYears });
        results.push({
          name: geo.name || placeName,
          lat: geo.lat,
          lon: geo.lon,
          elevation: geo.elevation,
          country: geo.country,
          years: weather.years,
        });
      } catch (err) {
        updateItem(i, { status: 'weather-error', errMsg: err.message });
        results.push({ name: geo.name || placeName, lat: geo.lat, lon: geo.lon, elevation: geo.elevation, country: geo.country, years: {}, failed: true });
      }
    }

    onReady(results);
  };

  if (!started) {
    run();
  }

  const total = items.length * 2;
  const done = items.reduce((acc, it) => {
    if (it.status === 'done') return acc + 2;
    if (it.status === 'fetching') return acc + 1;
    if (it.status === 'geo-error' || it.status === 'weather-error') return acc + 1;
    return acc;
  }, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="loading-screen">
      <h2 className="loading-title">Fetching weather data</h2>
      <p className="loading-sub">
        Geocoding {items.length} location{items.length !== 1 ? 's' : ''} and pulling historical records
      </p>
      <div className="loading-progress-bar">
        <div className="loading-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-items">
        {items.map((item, i) => {
          const isGeoErr = item.status === 'geo-error';
          const isWeatherErr = item.status === 'weather-error';
          const isDone = item.status === 'done';
          const isFetching = item.status === 'fetching';
          const isGeocoding = item.status === 'geocoding';
          const isPending = item.status === 'pending';

          let cls = 'loading-item';
          let label = item.name;
          let suffix = '';

          if (isPending) {
            cls += '';
            suffix = '';
          } else if (isGeocoding) {
            cls += ' active';
            suffix = ' — geocoding...';
          } else if (isGeoErr) {
            cls += ' error';
            suffix = ` — ${item.errMsg || 'not found'}, skipped`;
          } else if (isFetching) {
            cls += ' active';
            suffix = ` (${item.geo?.name || item.name}) — fetching weather...`;
          } else if (isWeatherErr) {
            cls += ' error';
            suffix = ` (${item.geo?.name || item.name}) — ${item.errMsg || 'fetch failed'}`;
          } else if (isDone) {
            cls += ' done';
            suffix = ` (${item.geo?.name || item.name}) ✓`;
          }

          const cacheBadge = isDone ? item.cacheSource : null;

          return (
            <div key={i} className={cls}>
              <div className="loading-dot" />
              <span>{label}{suffix}</span>
              {cacheBadge === 'cache' && (
                <span className="cache-badge cache-badge--hit">from cache</span>
              )}
              {cacheBadge === 'api' && (
                <span className="cache-badge cache-badge--api">live API</span>
              )}
              {cacheBadge === 'mixed' && (
                <span className="cache-badge cache-badge--mixed">{item.cachedYears}/{item.totalYears} cached</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SavedSessionsPanel({ onLoad }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    try {
      const r = await fetch('/api/sessions');
      setSessions(await r.json());
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useState(() => { fetchSessions(); }, []);

  const handleLoad = async (filename) => {
    const r = await fetch(`/api/sessions/${filename}`);
    if (!r.ok) { alert('Could not load session.'); return; }
    onLoad(await r.json());
  };

  const handleDelete = async (e, filename) => {
    e.stopPropagation();
    if (!confirm('Delete this saved session?')) return;
    await fetch(`/api/sessions/${filename}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.filename !== filename));
  };

  const fmtSavedAt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="saved-sessions-panel">
      <div className="saved-sessions-header">
        <span className="saved-sessions-title">Saved sessions</span>
        <span className="saved-sessions-count">{sessions.length}</span>
      </div>

      {loading && (
        <div className="saved-sessions-empty">Loading...</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="saved-sessions-empty">
          No saved sessions yet. Complete a trip setup and hit "Save session" in the dashboard.
        </div>
      )}

      <div className="saved-sessions-list">
        {sessions.map((s) => (
          <div key={s.filename} className="saved-session-card" onClick={() => handleLoad(s.filename)}>
            <div className="saved-session-card-top">
              <div className="saved-session-country">{s.country}</div>
              <button
                className="saved-session-delete"
                onClick={(e) => handleDelete(e, s.filename)}
                title="Delete"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="saved-session-dates">
              {s.startMD} → {s.endMD}
            </div>
            <div className="saved-session-meta">
              <span>{s.locationCount} location{s.locationCount !== 1 ? 's' : ''}</span>
              <span className="saved-session-dot">·</span>
              <span>{s.years?.join(', ')}</span>
            </div>
            <div className="saved-session-time">Saved {fmtSavedAt(s.savedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState('setup');
  const [trip, setTrip] = useState(null);
  const [weatherData, setWeatherData] = useState([]);
  const [savedHomeCity, setSavedHomeCity] = useState(null);
  const [setupKey, setSetupKey] = useState(0);

  const handleSetupComplete = (tripData) => {
    setTrip(tripData);
    setPhase('loading');
    setWeatherData([]);
  };

  const handleReady = (data) => {
    setWeatherData(data);
    setPhase('dashboard');
  };

  const handleEditTrip = () => {
    setPhase('setup');
    setWeatherData([]);
  };

  const handleClear = () => {
    setTrip(null);
    setWeatherData([]);
    setPhase('setup');
    setSetupKey(k => k + 1);
  };

  const handleLoadSession = (session) => {
    setTrip(session.trip);
    setWeatherData(session.weatherData);
    setSavedHomeCity(session.homeCity || null);
    setPhase('dashboard');
  };

  return (
    <div className="app-shell">
      <BrandBar onLoadSession={handleLoadSession} onHome={handleEditTrip} />
      {phase === 'setup' && (
        <div className="setup-layout">
          <div className="setup-layout-main">
            <SetupFlow key={setupKey} initialTrip={trip} onComplete={handleSetupComplete} onLoadSession={handleLoadSession} onClear={handleClear} />
          </div>
          <SavedSessionsPanel onLoad={handleLoadSession} />
        </div>
      )}
      {phase === 'loading' && (
        <LoadingScreen trip={trip} onReady={handleReady} />
      )}
      {phase === 'dashboard' && (
        <Dashboard
          trip={trip}
          weatherData={weatherData}
          onEditTrip={handleEditTrip}
          initialHomeCity={savedHomeCity}
        />
      )}
    </div>
  );
}
