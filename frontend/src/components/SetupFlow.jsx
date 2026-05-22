import { useState, useRef } from 'react';

const POPULAR_COUNTRIES = [
  'Iceland', 'Japan', 'Portugal', 'New Zealand',
  'Norway', 'Vietnam', 'Switzerland', 'India',
];

const YEAR_OPTIONS = ['2020', '2021', '2022', '2023', '2024', '2025'];

const MD_REGEX = /^\d{2}-\d{2}$/;

function Step1({ country, onChange, homeCityName, onHomeCityName }) {
  return (
    <div>
      <div className="home-city-setup">
        <div className="home-city-setup-label">Your home city</div>
        <p className="home-city-setup-desc">
          Where are you travelling <em>from</em>? We'll match the destination's climate to familiar days at home.
        </p>
        <input
          className="home-city-setup-input"
          value={homeCityName}
          onChange={e => onHomeCityName(e.target.value)}
          placeholder="e.g. Mumbai, London, Toronto…"
          autoFocus
        />
      </div>

      <div className="home-city-setup-divider" />

      <h2 className="setup-step-title">Where are you travelling?</h2>
      <p className="setup-step-desc">Enter the country you plan to visit.</p>
      <input
        className="input-large"
        value={country}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. Switzerland"
      />
      <div className="chip-row">
        {POPULAR_COUNTRIES.map(c => (
          <button
            key={c}
            className={`chip${country === c ? ' selected' : ''}`}
            onClick={() => onChange(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2({ startMD, endMD, years, onStartMD, onEndMD, onYears, errors }) {
  const toggleYear = (y) => {
    if (years.includes(y)) {
      if (years.length === 1) return;
      onYears(years.filter(x => x !== y));
    } else {
      onYears([...years, y].sort());
    }
  };

  return (
    <div>
      <h2 className="setup-step-title">When are you travelling?</h2>
      <p className="setup-step-desc">Enter your travel window (MM-DD format) and select years to compare.</p>

      <div className="section-label" style={{ marginTop: 0 }}>Date range</div>
      <div className="date-row">
        <input
          className={`input-md${errors.startMD ? ' error' : ''}`}
          value={startMD}
          onChange={e => onStartMD(e.target.value)}
          placeholder="MM-DD"
          maxLength={5}
        />
        <span className="date-sep">—</span>
        <input
          className={`input-md${errors.endMD ? ' error' : ''}`}
          value={endMD}
          onChange={e => onEndMD(e.target.value)}
          placeholder="MM-DD"
          maxLength={5}
        />
      </div>
      {(errors.startMD || errors.endMD) && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
          Use MM-DD format, e.g. 06-15
        </p>
      )}

      <div className="section-label">Years to compare</div>
      <div className="year-chip-row">
        {YEAR_OPTIONS.map(y => (
          <button
            key={y}
            className={`year-chip${years.includes(y) ? ' selected' : ''}`}
            onClick={() => toggleYear(y)}
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

function Step3({ places, onChange }) {
  const addPlace = () => {
    if (places.length >= 20) return;
    onChange([...places, '']);
  };

  const updatePlace = (i, val) => {
    const next = [...places];
    next[i] = val;
    onChange(next);
  };

  const removePlace = (i) => {
    if (places.length === 1) return;
    onChange(places.filter((_, idx) => idx !== i));
  };

  return (
    <div>
      <h2 className="setup-step-title">Which places do you want to check?</h2>
      <p className="setup-step-desc">
        Add up to 20 locations. Be specific — city, village, or region names work best.
      </p>
      <div className="places-list">
        {places.map((p, i) => (
          <div key={i} className="place-row">
            <div className="place-index">{String(i + 1).padStart(2, '0')}</div>
            <input
              className="place-input"
              value={p}
              onChange={e => updatePlace(i, e.target.value)}
              placeholder={`Place ${i + 1}`}
              autoFocus={i === places.length - 1 && p === ''}
            />
            <button
              className="btn-remove"
              onClick={() => removePlace(i)}
              disabled={places.length === 1}
              title="Remove"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
      {places.length < 20 && (
        <button className="btn-add-place" onClick={addPlace}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Add place
        </button>
      )}
    </div>
  );
}

function Step4({ trip, onEdit }) {
  const { country, startMD, endMD, years, places } = trip;
  const validPlaces = places.filter(p => p.trim());
  const estimate = `Will fetch ${validPlaces.length} location${validPlaces.length !== 1 ? 's' : ''} × ${years.length} year${years.length !== 1 ? 's' : ''} of daily history`;

  return (
    <div>
      <h2 className="setup-step-title">Review your trip</h2>
      <p className="setup-step-desc">Everything look right? Hit "Fetch weather" to load the data.</p>

      <div className="review-grid">
        <div className="review-card">
          <div className="review-card-label">
            Country
            <a onClick={() => onEdit(0)}>Edit</a>
          </div>
          <div className="review-card-value">{country || '—'}</div>
        </div>

        <div className="review-card">
          <div className="review-card-label">
            Date window
            <a onClick={() => onEdit(1)}>Edit</a>
          </div>
          <div className="review-card-value" style={{ fontFamily: 'var(--font-mono)' }}>
            {startMD} → {endMD}
          </div>
        </div>

        <div className="review-card">
          <div className="review-card-label">
            Years
            <a onClick={() => onEdit(1)}>Edit</a>
          </div>
          <div className="review-years">
            {years.map(y => (
              <span key={y} className="review-year-chip">{y}</span>
            ))}
          </div>
        </div>

        <div className="review-card">
          <div className="review-card-label">
            Locations ({validPlaces.length})
            <a onClick={() => onEdit(2)}>Edit</a>
          </div>
          <div className="review-places">
            {validPlaces.map((p, i) => (
              <div key={i} className="review-place">
                <span className="review-place-num">{String(i + 1).padStart(2, '0')}</span>
                {p}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="review-estimate">{estimate}</div>
    </div>
  );
}

export default function SetupFlow({ initialTrip, onComplete, onLoadSession, onClear }) {
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState(initialTrip?.country || '');
  const [startMD, setStartMD] = useState(initialTrip?.startMD || '');
  const [endMD, setEndMD] = useState(initialTrip?.endMD || '');
  const [years, setYears] = useState(initialTrip?.years || ['2022', '2023', '2024']);
  const [places, setPlaces] = useState(initialTrip?.places || ['']);
  const [homeCityName, setHomeCityName] = useState(() => {
    if (initialTrip?.homeCityName) return initialTrip.homeCityName;
    const saved = localStorage.getItem('clomate-home-city');
    if (!saved) return '';
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.name) {
        localStorage.setItem('clomate-home-city', parsed.name);
        return parsed.name;
      }
    } catch {}
    return saved;
  });
  const [errors, setErrors] = useState({});

  const handleHomeCityName = (val) => {
    setHomeCityName(val);
    if (val.trim()) localStorage.setItem('clomate-home-city', val.trim());
    else localStorage.removeItem('clomate-home-city');
  };

  const STEPS = [
    { num: '01', label: 'Destination' },
    { num: '02', label: 'Dates & Years' },
    { num: '03', label: 'Locations' },
    { num: '04', label: 'Review' },
  ];

  const validate = () => {
    if (step === 0) return country.trim().length > 0;
    if (step === 1) {
      const sErr = !MD_REGEX.test(startMD);
      const eErr = !MD_REGEX.test(endMD);
      setErrors({ startMD: sErr, endMD: eErr });
      return !sErr && !eErr && years.length > 0;
    }
    if (step === 2) return places.some(p => p.trim());
    return true;
  };

  const handleContinue = () => {
    if (!validate()) return;
    if (step < 3) {
      setStep(step + 1);
    } else {
      onComplete({
        country: country.trim(),
        startMD,
        endMD,
        years,
        places: places.filter(p => p.trim()),
        homeCityName: homeCityName.trim(),
      });
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const jumpToStep = (s) => setStep(s);

  const canContinue = () => {
    if (step === 0) return country.trim().length > 0;
    if (step === 1) return MD_REGEX.test(startMD) && MD_REGEX.test(endMD) && years.length > 0;
    if (step === 2) return places.some(p => p.trim());
    return true;
  };

  const trip = { country, startMD, endMD, years, places, homeCityName };
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
        alert('Could not read file — make sure it is a valid .clomate.json file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div>
      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div
            key={i}
            className={`stepper-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
          >
            <span className="step-num">{s.num}</span>
            <span className="step-label">{s.label}</span>
          </div>
        ))}
        {onClear && initialTrip?.country && (
          <button className="stepper-clear-btn" onClick={onClear} title="Clear all and start over">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M8.5 2.5L2.5 8.5M2.5 2.5l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Start fresh
          </button>
        )}
      </div>

      {/* Step body */}
      <div className="setup-body">
        {step === 0 && (
          <>
            <Step1
              country={country}
              onChange={setCountry}
              homeCityName={homeCityName}
              onHomeCityName={handleHomeCityName}
            />
            <div className="session-load-divider">
              <span>or</span>
            </div>
            <div className="session-load-card" onClick={() => fileInputRef.current.click()}>
              <div className="session-load-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 13V4M7 7l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div className="session-load-title">Load a saved session</div>
                <div className="session-load-desc">Upload a .clomate.json file to jump straight to your dashboard</div>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.clomate.json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </>
        )}
        {step === 1 && (
          <Step2
            startMD={startMD}
            endMD={endMD}
            years={years}
            onStartMD={setStartMD}
            onEndMD={setEndMD}
            onYears={setYears}
            errors={errors}
          />
        )}
        {step === 2 && <Step3 places={places} onChange={setPlaces} />}
        {step === 3 && <Step4 trip={trip} onEdit={jumpToStep} />}
      </div>

      {/* Footer */}
      <div className="setup-footer">
        <button
          className="btn-back"
          onClick={handleBack}
          style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
        >
          Back
        </button>
        <button
          className="btn-primary"
          onClick={handleContinue}
          disabled={!canContinue()}
        >
          {step === 3 ? 'Fetch weather' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
