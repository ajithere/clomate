import { useState, useRef, useCallback } from 'react';

// ── helpers ──────────────────────────────────────────────────────────────────

function avg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmt1(v) {
  return v == null ? '—' : v.toFixed(1);
}

function fmtDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function getDow(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}

function buildAllAvg(yearData) {
  const allYears = Object.values(yearData);
  if (!allYears.length) return [];
  const len = allYears[0].length;
  const result = [];
  for (let i = 0; i < len; i++) {
    const rows = allYears.map(y => y[i]).filter(Boolean);
    result.push({
      date: allYears[0][i].date,
      min: avg(rows.map(r => r.min)),
      max: avg(rows.map(r => r.max)),
      avg: avg(rows.map(r => r.avg)),
      feels: avg(rows.map(r => r.feels)),
      rain: avg(rows.map(r => r.rain)),
    });
  }
  return result;
}

function getAlertClass(feels) {
  if (feels == null) return '';
  if (feels < 10) return 'alert-cold';
  if (feels < 14) return 'alert-chilly';
  return 'alert-comfortable';
}

function getAlertLabel(feels) {
  if (feels == null) return '';
  if (feels < 10) return 'Cold alert';
  if (feels < 14) return 'Chilly';
  return 'Comfortable';
}

function getClothingRec(feels) {
  if (feels == null) return null;
  if (feels < -10) return {
    short: 'Arctic gear',
    icon: '🧊',
    items: ['Insulated parka', 'Thermal base layers (top + bottom)', 'Fleece mid-layer', 'Insulated waterproof boots', 'Balaclava', 'Thick gloves or mittens', 'Wool hat', 'Neck gaiter'],
  };
  if (feels < 0) return {
    short: 'Heavy winter',
    icon: '🧥',
    items: ['Heavy wool or down coat', 'Thermal base layers', 'Warm sweater', 'Wool hat', 'Scarf', 'Insulated gloves', 'Warm boots'],
  };
  if (feels < 5) return {
    short: 'Winter coat',
    icon: '🧥',
    items: ['Winter coat', 'Warm sweater or hoodie', 'Hat', 'Light gloves', 'Scarf', 'Warm socks'],
  };
  if (feels < 10) return {
    short: 'Heavy jacket',
    icon: '🥶',
    items: ['Heavy jacket or fleece', 'Woolens / thick sweater', 'Scarf', 'Light gloves recommended'],
  };
  if (feels < 14) return {
    short: 'Jacket + layer',
    icon: '🧣',
    items: ['Jacket', 'Light woolen or sweatshirt', 'Scarf optional'],
  };
  if (feels < 18) return {
    short: 'Light jacket',
    icon: '🧢',
    items: ['Light jacket or cardigan', 'Jeans or long trousers'],
  };
  if (feels < 22) return {
    short: 'Light layers',
    icon: '👕',
    items: ['T-shirt', 'Light overshirt or thin cardigan', 'Comfortable trousers'],
  };
  if (feels < 26) return {
    short: 'Casual',
    icon: '👕',
    items: ['T-shirt', 'Light trousers or chinos', 'Sunscreen advised'],
  };
  return {
    short: 'Summer wear',
    icon: '🌞',
    items: ['Shorts or light dress', 'T-shirt or sleeveless top', 'Sunscreen', 'Hat for sun protection'],
  };
}

// ── SVG chart primitives ──────────────────────────────────────────────────────

const PAD = { top: 16, right: 16, bottom: 36, left: 48 };

function useChartInteraction(data, width, height) {
  const [hover, setHover] = useState(null);

  const onMouseMove = useCallback((e) => {
    if (!data.length || !width) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const chartW = width - PAD.left - PAD.right;
    const step = chartW / (data.length - 1 || 1);
    const idx = Math.round((mx - PAD.left) / step);
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    setHover(clamped);
  }, [data, width]);

  const onMouseLeave = useCallback(() => setHover(null), []);

  return { hover, onMouseMove, onMouseLeave };
}

function ChartAxes({ data, yMin, yMax, width, height, unit = '°C' }) {
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;
  const gridLines = 5;

  const xLabel = (i) => {
    const x = PAD.left + (i / (data.length - 1 || 1)) * chartW;
    const show = data.length <= 14 ? true : i % 2 === 0;
    if (!show) return null;
    return (
      <text
        key={i}
        x={x}
        y={height - PAD.bottom + 18}
        textAnchor="middle"
        fontSize={10}
        fill="var(--ink-4)"
        fontFamily="var(--font-mono)"
      >
        {fmtDate(data[i].date)}
      </text>
    );
  };

  return (
    <g>
      {Array.from({ length: gridLines + 1 }, (_, i) => {
        const val = yMin + (yRange * i) / gridLines;
        const y = PAD.top + chartH - (chartH * i) / gridLines;
        return (
          <g key={i}>
            <line
              x1={PAD.left} x2={width - PAD.right}
              y1={y} y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--ink-4)"
              fontFamily="var(--font-mono)"
            >
              {Math.round(val)}{unit}
            </text>
          </g>
        );
      })}
      {data.map((_, i) => xLabel(i))}
    </g>
  );
}

function LineSeries({ data, accessor, yMin, yMax, width, height, color, dashed = false, strokeWidth = 2 }) {
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;

  const toX = (i) => PAD.left + (i / (data.length - 1 || 1)) * chartW;
  const toY = (v) => PAD.top + chartH - ((v - yMin) / yRange) * chartH;

  const valid = data.filter(d => accessor(d) != null);
  if (!valid.length) return null;

  const path = data.reduce((acc, d, i) => {
    const v = accessor(d);
    if (v == null) return acc;
    const x = toX(i);
    const y = toY(v);
    return acc + (acc === '' ? `M ${x} ${y}` : ` L ${x} ${y}`);
  }, '');

  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? '5 4' : undefined}
    />
  );
}

function BarSeries({ data, accessor, yMin, yMax, width, height, color }) {
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;
  const barW = Math.max(4, chartW / data.length - 4);

  return data.map((d, i) => {
    const v = accessor(d);
    if (v == null || v <= 0) return null;
    const x = PAD.left + (i / (data.length - 1 || 1)) * chartW - barW / 2;
    const barH = ((v - yMin) / yRange) * chartH;
    const y = PAD.top + chartH - barH;
    return (
      <rect
        key={i}
        x={x} y={y}
        width={barW} height={barH}
        fill={color}
        rx={2}
        opacity={0.85}
      />
    );
  });
}

function Crosshair({ data, hover, yMin, yMax, width, height, series }) {
  if (hover == null || !data[hover]) return null;
  const d = data[hover];
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;
  const x = PAD.left + (hover / (data.length - 1 || 1)) * chartW;
  const toY = (v) => PAD.top + chartH - ((v - yMin) / yRange) * chartH;

  return (
    <g>
      <line
        x1={x} x2={x}
        y1={PAD.top} y2={PAD.top + chartH}
        stroke="var(--border-strong)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {series.map((s, i) => {
        const v = s.accessor(d);
        if (v == null) return null;
        return (
          <circle
            key={i}
            cx={x} cy={toY(v)}
            r={4}
            fill="white"
            stroke={s.color}
            strokeWidth={2}
          />
        );
      })}
    </g>
  );
}

function Tooltip({ data, hover, series, width, height }) {
  if (hover == null || !data[hover]) return null;
  const d = data[hover];
  const chartW = width - PAD.left - PAD.right;
  const x = PAD.left + (hover / (data.length - 1 || 1)) * chartW;
  const left = Math.max(60, Math.min(width - 60, x));

  return (
    <div
      className="chart-tooltip"
      style={{ left, top: 8 }}
    >
      <div className="chart-tooltip-date">{fmtDate(d.date)}</div>
      {series.map((s, i) => {
        const v = s.accessor(d);
        if (v == null) return null;
        return (
          <div key={i} className="chart-tooltip-row">
            <div className="tooltip-dot" style={{ background: s.color }} />
            <span>{s.label}: {fmt1(v)}{s.unit || '°C'}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

const CHART_HEIGHT = 220;

function useWidth(ref) {
  const [width, setWidth] = useState(600);
  const ro = useRef(null);

  const attach = useCallback((el) => {
    if (!el) return;
    ref.current = el;
    setWidth(el.clientWidth || 600);
    ro.current = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    ro.current.observe(el);
  }, []);

  return [width, attach];
}

function TempChart({ data }) {
  const wrapRef = useRef(null);
  const [width, attachRef] = useWidth(wrapRef);
  const { hover, onMouseMove, onMouseLeave } = useChartInteraction(data, width, CHART_HEIGHT);

  if (!data.length) return null;

  const vals = data.flatMap(d => [d.min, d.max, d.avg].filter(v => v != null));
  const yMin = Math.floor(Math.min(...vals) - 2);
  const yMax = Math.ceil(Math.max(...vals) + 2);

  const series = [
    { label: 'Max', accessor: d => d.max, color: '#e05c5c' },
    { label: 'Avg', accessor: d => d.avg, color: 'var(--blue)' },
    { label: 'Min', accessor: d => d.min, color: 'var(--blue)', dashed: true },
  ];

  return (
    <div className="chart-svg-wrapper" ref={attachRef}>
      <svg height={CHART_HEIGHT} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        <ChartAxes data={data} yMin={yMin} yMax={yMax} width={width} height={CHART_HEIGHT} />
        {series.map((s, i) => (
          <LineSeries
            key={i}
            data={data}
            accessor={s.accessor}
            yMin={yMin} yMax={yMax}
            width={width} height={CHART_HEIGHT}
            color={s.color}
            dashed={s.dashed}
          />
        ))}
        <Crosshair
          data={data} hover={hover}
          yMin={yMin} yMax={yMax}
          width={width} height={CHART_HEIGHT}
          series={series}
        />
      </svg>
      <Tooltip data={data} hover={hover} series={series} width={width} height={CHART_HEIGHT} />
    </div>
  );
}

function FeelsChart({ data }) {
  const wrapRef = useRef(null);
  const [width, attachRef] = useWidth(wrapRef);
  const { hover, onMouseMove, onMouseLeave } = useChartInteraction(data, width, CHART_HEIGHT);

  if (!data.length) return null;

  const vals = data.flatMap(d => [d.avg, d.feels].filter(v => v != null));
  const yMin = Math.floor(Math.min(...vals) - 2);
  const yMax = Math.ceil(Math.max(...vals) + 2);

  const series = [
    { label: 'Actual avg', accessor: d => d.avg, color: 'var(--blue)' },
    { label: 'Feels like', accessor: d => d.feels, color: '#9b6dff', dashed: true },
  ];

  return (
    <div className="chart-svg-wrapper" ref={attachRef}>
      <svg height={CHART_HEIGHT} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        <ChartAxes data={data} yMin={yMin} yMax={yMax} width={width} height={CHART_HEIGHT} />
        {series.map((s, i) => (
          <LineSeries
            key={i}
            data={data}
            accessor={s.accessor}
            yMin={yMin} yMax={yMax}
            width={width} height={CHART_HEIGHT}
            color={s.color}
            dashed={s.dashed}
          />
        ))}
        <Crosshair
          data={data} hover={hover}
          yMin={yMin} yMax={yMax}
          width={width} height={CHART_HEIGHT}
          series={series}
        />
      </svg>
      <Tooltip data={data} hover={hover} series={series} width={width} height={CHART_HEIGHT} />
    </div>
  );
}

function RainChart({ data }) {
  const wrapRef = useRef(null);
  const [width, attachRef] = useWidth(wrapRef);
  const { hover, onMouseMove, onMouseLeave } = useChartInteraction(data, width, CHART_HEIGHT);

  if (!data.length) return null;

  const vals = data.map(d => d.rain).filter(v => v != null);
  const yMin = 0;
  const yMax = Math.ceil(Math.max(...vals, 1) + 2);

  const series = [
    { label: 'Rain', accessor: d => d.rain, color: 'var(--blue)', unit: 'mm' },
  ];

  return (
    <div className="chart-svg-wrapper" ref={attachRef}>
      <svg height={CHART_HEIGHT} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        <ChartAxes data={data} yMin={yMin} yMax={yMax} width={width} height={CHART_HEIGHT} unit="mm" />
        <BarSeries
          data={data}
          accessor={d => d.rain}
          yMin={yMin} yMax={yMax}
          width={width} height={CHART_HEIGHT}
          color="var(--blue)"
        />
        <Crosshair
          data={data} hover={hover}
          yMin={yMin} yMax={yMax}
          width={width} height={CHART_HEIGHT}
          series={series}
        />
      </svg>
      <Tooltip data={data} hover={hover} series={series} width={width} height={CHART_HEIGHT} />
    </div>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatsStrip({ data, tab }) {
  if (!data.length) return null;

  if (tab === 'temperature') {
    const avgs = data.map(d => d.avg).filter(v => v != null);
    const feels = data.map(d => d.feels).filter(v => v != null);
    const coldAlerts = data.filter(d => d.feels != null && d.feels < 10).length;
    return (
      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-label">Average</div>
          <div className="stat-value">{fmt1(avg(avgs))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Coldest</div>
          <div className="stat-value">{fmt1(Math.min(...avgs))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Warmest</div>
          <div className="stat-value">{fmt1(Math.max(...avgs))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cold alerts</div>
          <div className="stat-value" style={{ color: coldAlerts > 0 ? 'var(--red)' : undefined }}>
            {coldAlerts}<span className="stat-unit"> days</span>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'feels') {
    const feelsArr = data.map(d => d.feels).filter(v => v != null);
    const avgs = data.map(d => d.avg).filter(v => v != null);
    const coldAlerts = data.filter(d => d.feels != null && d.feels < 10).length;
    return (
      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-label">Average</div>
          <div className="stat-value">{fmt1(avg(feelsArr))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Coldest feels</div>
          <div className="stat-value">{fmt1(Math.min(...feelsArr))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Warmest</div>
          <div className="stat-value">{fmt1(Math.max(...avgs))}<span className="stat-unit">°C</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cold alerts</div>
          <div className="stat-value" style={{ color: coldAlerts > 0 ? 'var(--red)' : undefined }}>
            {coldAlerts}<span className="stat-unit"> days</span>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'rainfall') {
    const rains = data.map(d => d.rain).filter(v => v != null);
    const total = rains.reduce((a, b) => a + b, 0);
    const wetDays = rains.filter(v => v > 1).length;
    const dryDays = rains.filter(v => v <= 1).length;
    const wettest = Math.max(...rains, 0);
    return (
      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{Math.round(total)}<span className="stat-unit"> mm</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Wet days</div>
          <div className="stat-value">{wetDays}<span className="stat-unit"> days</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Wettest day</div>
          <div className="stat-value">{fmt1(wettest)}<span className="stat-unit"> mm</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Dry days</div>
          <div className="stat-value">{dryDays}<span className="stat-unit"> days</span></div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Day cards ─────────────────────────────────────────────────────────────────

function PackingSummary({ data }) {
  if (!data.length) return null;

  const feelsValues = data.map(d => d.feels).filter(v => v != null);
  if (!feelsValues.length) return null;
  const coldest = Math.min(...feelsValues);
  const warmest = Math.max(...feelsValues);
  const rec = getClothingRec(coldest);
  if (!rec) return null;

  // collect unique clothing tiers across all days
  const tierMap = new Map();
  data.forEach(d => {
    const r = getClothingRec(d.feels);
    if (r && !tierMap.has(r.short)) tierMap.set(r.short, r);
  });
  const tiers = [...tierMap.values()];

  return (
    <div className="packing-summary">
      <div className="packing-summary-header">
        <div className="packing-summary-title">
          <span>What to pack</span>
          <span className="packing-range">
            {fmt1(coldest)}° to {fmt1(warmest)}° feels-like
          </span>
        </div>
        <p className="packing-summary-desc">
          Based on the coldest feels-like temperature ({fmt1(coldest)}°C), pack for <strong>{rec.short}</strong>. The full range across this period:
        </p>
      </div>
      <div className="packing-tiers">
        {tiers.map((tier, i) => (
          <div key={i} className="packing-tier">
            <div className="packing-tier-label">
              <span className="packing-tier-icon">{tier.icon}</span>
              {tier.short}
            </div>
            <ul className="packing-items">
              {tier.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCards({ data }) {
  if (!data.length) return null;
  const maxRain = Math.max(...data.map(d => d.rain || 0), 1);

  return (
    <div>
      <div className="day-section-title">Day by day</div>
      <div className="day-cards-scroll">
        {data.map((d, i) => {
          const alertCls = getAlertClass(d.feels);
          const alertLabel = getAlertLabel(d.feels);
          const clothing = getClothingRec(d.feels);
          const rainPct = Math.min(100, ((d.rain || 0) / maxRain) * 100);

          return (
            <div key={i} className={`day-card ${alertCls}`}>
              <div className="day-card-dow">{getDow(d.date)}</div>
              <div className="day-card-date">{fmtDate(d.date)}</div>
              <div className="day-card-temp">{fmt1(d.avg)}°</div>
              <div className="day-card-feels">feels {fmt1(d.feels)}°</div>
              <div className="day-card-rain">{fmt1(d.rain)} mm</div>
              <div className="day-card-rain-bar">
                <div className="day-card-rain-fill" style={{ width: `${rainPct}%` }} />
              </div>
              {alertLabel && (
                <div className="day-card-badge">{alertLabel}</div>
              )}
              {clothing && (
                <div className="day-card-clothing">
                  <span>{clothing.icon}</span> {clothing.short}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PackingSummary data={data} />
    </div>
  );
}

// ── Main chart section ────────────────────────────────────────────────────────

function ChartSection({ location, trip }) {
  const [tab, setTab] = useState('temperature');
  const [activeYear, setActiveYear] = useState('all');

  const allAvgData = buildAllAvg(location.years);
  const currentData = activeYear === 'all'
    ? allAvgData
    : (location.years[activeYear] || []);

  const tabLabels = [
    { key: 'temperature', label: 'Temperature' },
    { key: 'feels', label: 'Feels like' },
    { key: 'rainfall', label: 'Rainfall' },
  ];

  const yearMode = activeYear === 'all' ? 'avg across all years' : `${activeYear} data`;

  return (
    <div>
      {/* Header */}
      <div className="main-header">
        <div className="main-loc-info">
          <div className="main-loc-name">
            {location.name}
            <span className="main-loc-country">{location.country}</span>
            {location.elevation != null && (
              <span className="main-loc-elev">{Math.round(location.elevation)}m</span>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            <span className="year-mode-pill">{yearMode}</span>
          </div>
        </div>

        {/* Year switcher */}
        <div className="year-switcher">
          <button
            className={`year-btn${activeYear === 'all' ? ' active' : ''}`}
            onClick={() => setActiveYear('all')}
          >
            All avg
          </button>
          {trip.years.map(y => (
            <button
              key={y}
              className={`year-btn${activeYear === y ? ' active' : ''}`}
              onClick={() => setActiveYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="chart-tabs">
        {tabLabels.map(t => (
          <button
            key={t.key}
            className={`chart-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart card */}
      <div className="chart-card">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              {tab === 'temperature' && 'Temperature over time'}
              {tab === 'feels' && 'Feels-like temperature'}
              {tab === 'rainfall' && 'Daily rainfall'}
            </div>
            <div className="chart-meta">
              {trip.startMD} → {trip.endMD} · {location.country}
              {activeYear !== 'all' ? ` · ${activeYear}` : ` · ${trip.years.join(', ')}`}
            </div>
          </div>

          {/* Legend */}
          <div className="chart-legend">
            {tab === 'temperature' && <>
              <div className="legend-item">
                <div className="legend-line" style={{ background: '#e05c5c' }} />
                Max
              </div>
              <div className="legend-item">
                <div className="legend-line" style={{ background: 'var(--blue)' }} />
                Avg
              </div>
              <div className="legend-item">
                <div className="legend-line dashed" style={{ color: 'var(--blue)' }} />
                Min
              </div>
            </>}
            {tab === 'feels' && <>
              <div className="legend-item">
                <div className="legend-line" style={{ background: 'var(--blue)' }} />
                Actual avg
              </div>
              <div className="legend-item">
                <div className="legend-line dashed" style={{ color: '#9b6dff' }} />
                Feels like
              </div>
            </>}
            {tab === 'rainfall' && (
              <div className="legend-item">
                <div className="legend-line" style={{ background: 'var(--blue)' }} />
                Daily mm
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        {tab === 'temperature' && <TempChart data={currentData} />}
        {tab === 'feels' && <FeelsChart data={currentData} />}
        {tab === 'rainfall' && <RainChart data={currentData} />}
      </div>

      {/* Stats */}
      <StatsStrip data={currentData} tab={tab} />

      {/* Day cards */}
      <DayCards data={currentData} />
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="sidebar-loc-pin">
      <path d="M7 1C4.8 1 3 2.8 3 5c0 3.5 4 8 4 8s4-4.5 4-8c0-2.2-1.8-4-4-4Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
      <circle cx="7" cy="5" r="1.2" fill="currentColor"/>
    </svg>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function saveSession(trip, weatherData) {
  const session = { trip, weatherData };

  // save to project folder via backend
  try {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
  } catch {
    // backend save failed — still proceed with download
  }

  // also download locally
  const full = { version: 1, savedAt: new Date().toISOString(), ...session };
  const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = trip.country.toLowerCase().replace(/\s+/g, '-');
  a.href = url;
  a.download = `clomate-${slug}-${trip.startMD}-${trip.endMD}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard({ trip, weatherData, onEditTrip }) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (!weatherData.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
        No weather data available. All locations failed to load.
        <br />
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onEditTrip}>
          Edit trip setup
        </button>
      </div>
    );
  }

  const location = weatherData[activeIdx] || weatherData[0];

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-trip-info">
          <div className="sidebar-trip-label">Trip</div>
          <div className="sidebar-country">{trip.country}</div>
          <div className="sidebar-daterange">
            {trip.startMD} → {trip.endMD}
          </div>
        </div>

        <div className="sidebar-locs-header">
          Locations {weatherData.length}
        </div>

        <div className="sidebar-loc-list">
          {weatherData.map((loc, i) => (
            <div
              key={i}
              className={`sidebar-loc-item${i === activeIdx ? ' active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              <PinIcon />
              <div className="sidebar-loc-info">
                <div className="sidebar-loc-name">{loc.name}</div>
                <div className="sidebar-loc-sub">
                  #{String(i + 1).padStart(2, '0')} · {loc.country}
                </div>
              </div>
              {loc.elevation != null && (
                <div className="sidebar-elev">{Math.round(loc.elevation)}m</div>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="sidebar-footer-link" onClick={onEditTrip}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M9.5 1.5L11.5 3.5L4.5 10.5H2.5V8.5L9.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            Edit trip setup
          </button>
          <button className="sidebar-footer-link" onClick={() => saveSession(trip, weatherData)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 8.5V1.5M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 9.5v1a1 1 0 001 1h7a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Save session
          </button>
          <button className="sidebar-footer-link" onClick={() => alert('Share — coming soon')}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="10" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="3" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.5 7.3l4 1.7M4.5 5.7l4-1.7" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Share with travellers
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="main-content">
        <ChartSection key={activeIdx} location={location} trip={trip} />
      </div>
    </div>
  );
}
