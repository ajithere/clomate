import { useState, useRef, useCallback, useEffect } from 'react';

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

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthPartDesc(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  const part = d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late';
  return `${part} ${MONTH_NAMES[m - 1]}`;
}

function findHomeMatches(homeAvgData, destColdest, destWarmest, tolerance = 2) {
  if (!homeAvgData?.length) return [];
  const lo = destColdest - tolerance;
  const hi = destWarmest + tolerance;
  const runs = [];
  let runDays = [];
  let gap = 0;
  for (const d of homeAvgData) {
    if (d.feels != null && d.feels >= lo && d.feels <= hi) {
      runDays.push(d);
      gap = 0;
    } else if (runDays.length > 0) {
      gap++;
      if (gap > 5) {
        if (runDays.length >= 5) runs.push([...runDays]);
        runDays = [];
        gap = 0;
      }
    }
  }
  if (runDays.length >= 5) runs.push(runDays);
  return runs.map(days => {
    const start = monthPartDesc(days[0].date);
    const end = monthPartDesc(days[days.length - 1].date);
    return { label: start === end ? start : `${start} – ${end}` };
  });
}

function getAlertClass(feels, cold = 10, chilly = 14) {
  if (feels == null) return '';
  if (feels < cold) return 'alert-cold';
  if (feels < chilly) return 'alert-chilly';
  return 'alert-comfortable';
}

function getAlertLabel(feels, cold = 10, chilly = 14) {
  if (feels == null) return '';
  if (feels < cold) return 'Cold alert';
  if (feels < chilly) return 'Chilly';
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

// ── Location colours (comparison) ────────────────────────────────────────────
const LOC_COLORS = ['#4a8fe8', '#e07a3c', '#3daa7a', '#9b6dff'];

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

function StatsStrip({ data, tab, thresholds }) {
  if (!data.length) return null;
  const { cold } = thresholds;

  if (tab === 'temperature') {
    const avgs = data.map(d => d.avg).filter(v => v != null);
    const feels = data.map(d => d.feels).filter(v => v != null);
    const coldAlerts = data.filter(d => d.feels != null && d.feels < cold).length;
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
    const coldAlerts = data.filter(d => d.feels != null && d.feels < cold).length;
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

function DayCards({ data, thresholds }) {
  if (!data.length) return null;
  const maxRain = Math.max(...data.map(d => d.rain || 0), 1);
  const { cold, chilly } = thresholds;

  return (
    <div>
      <div className="day-section-title">Day by day</div>
      <div className="day-cards-scroll">
        {data.map((d, i) => {
          const alertCls = getAlertClass(d.feels, cold, chilly);
          const alertLabel = getAlertLabel(d.feels, cold, chilly);
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

function ChartSection({ location, trip, thresholds, homeCity }) {
  const [tab, setTab] = useState('temperature');
  const [activeYear, setActiveYear] = useState('all');

  const allAvgData = buildAllAvg(location.years);
  const currentData = activeYear === 'all'
    ? allAvgData
    : (location.years[activeYear] || []);

  const feelsVals = currentData.map(d => d.feels).filter(v => v != null);
  const destColdest = feelsVals.length ? Math.min(...feelsVals) : null;
  const destWarmest = feelsVals.length ? Math.max(...feelsVals) : null;

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

      {/* Home city reference banner */}
      {homeCity?.homeData && destColdest != null && (() => {
        const matches = findHomeMatches(homeCity.homeData, destColdest, destWarmest);
        return (
          <div className={`home-ref-banner${!matches.length ? ' home-ref-banner--nomatch' : ''}`}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M7.5 1.5L1.5 7V13H5.5V9.5H9.5V13H13.5V7L7.5 1.5Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
            </svg>
            {matches.length
              ? <span>Feels like <strong>{homeCity.name}</strong> in <strong>{matches.map(m => m.label).join(' or ')}</strong></span>
              : <span><strong>{homeCity.name}</strong> doesn't typically reach this temperature range</span>
            }
          </div>
        );
      })()}

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
      <StatsStrip data={currentData} tab={tab} thresholds={thresholds} />

      {/* Day cards */}
      <DayCards data={currentData} thresholds={thresholds} />
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

async function saveSession(trip, weatherData, homeCity) {
  const session = { trip, weatherData, homeCity: homeCity || null };

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

// ── Comparison chart primitives ───────────────────────────────────────────────

function CompareCrosshair({ hover, seriesList, accessor, yMin, yMax, width, height }) {
  const refData = seriesList[0]?.data;
  if (!refData || hover == null || !refData[hover]) return null;
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const yRange = yMax - yMin || 1;
  const x = PAD.left + (hover / (refData.length - 1 || 1)) * chartW;
  const toY = v => PAD.top + chartH - ((v - yMin) / yRange) * chartH;
  return (
    <g>
      <line x1={x} x2={x} y1={PAD.top} y2={PAD.top + chartH}
        stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
      {seriesList.map((s, i) => {
        const v = accessor(s.data[hover]);
        if (v == null) return null;
        return <circle key={i} cx={x} cy={toY(v)} r={4} fill="white" stroke={s.color} strokeWidth={2} />;
      })}
    </g>
  );
}

function CompareTooltip({ hover, seriesList, accessor, unit, width }) {
  const refData = seriesList[0]?.data;
  if (!refData || hover == null || !refData[hover]) return null;
  const chartW = width - PAD.left - PAD.right;
  const x = PAD.left + (hover / (refData.length - 1 || 1)) * chartW;
  const left = Math.max(70, Math.min(width - 70, x));
  return (
    <div className="chart-tooltip" style={{ left, top: 8 }}>
      <div className="chart-tooltip-date">{fmtDate(refData[hover].date)}</div>
      {seriesList.map((s, i) => {
        const v = accessor(s.data[hover]);
        if (v == null) return null;
        return (
          <div key={i} className="chart-tooltip-row">
            <div className="tooltip-dot" style={{ background: s.color }} />
            <span>{s.name}: {fmt1(v)}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompareChart({ seriesList, accessor, unit = '°C' }) {
  const wrapRef = useRef(null);
  const [width, attachRef] = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const refData = seriesList[0]?.data || [];

  const onMouseMove = useCallback((e) => {
    if (!refData.length || !width) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const chartW = width - PAD.left - PAD.right;
    const step = chartW / (refData.length - 1 || 1);
    const idx = Math.round((mx - PAD.left) / step);
    setHover(Math.max(0, Math.min(refData.length - 1, idx)));
  }, [refData, width]);

  const onMouseLeave = useCallback(() => setHover(null), []);

  if (!refData.length) return null;

  const allVals = seriesList.flatMap(s => s.data.map(d => accessor(d))).filter(v => v != null);
  if (!allVals.length) return null;
  const yMin = unit === 'mm' ? 0 : Math.floor(Math.min(...allVals) - 2);
  const yMax = unit === 'mm'
    ? Math.ceil(Math.max(...allVals, 1) + 2)
    : Math.ceil(Math.max(...allVals) + 2);

  return (
    <div className="chart-svg-wrapper" ref={attachRef}>
      <svg height={CHART_HEIGHT} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        <ChartAxes data={refData} yMin={yMin} yMax={yMax} width={width} height={CHART_HEIGHT} unit={unit} />
        {seriesList.map((s, i) => (
          <LineSeries
            key={i}
            data={s.data}
            accessor={accessor}
            yMin={yMin} yMax={yMax}
            width={width} height={CHART_HEIGHT}
            color={s.color}
            strokeWidth={2.5}
          />
        ))}
        <CompareCrosshair
          hover={hover} seriesList={seriesList} accessor={accessor}
          yMin={yMin} yMax={yMax} width={width} height={CHART_HEIGHT}
        />
      </svg>
      <CompareTooltip hover={hover} seriesList={seriesList} accessor={accessor} unit={unit} width={width} />
    </div>
  );
}

// ── Comparison stats ──────────────────────────────────────────────────────────

function CompareStats({ seriesList, tab, thresholds }) {
  return (
    <div className="compare-stats">
      {seriesList.map((s, i) => {
        if (tab === 'rainfall') {
          const rains = s.data.map(d => d.rain).filter(v => v != null);
          const total = rains.reduce((a, b) => a + b, 0);
          const wetDays = rains.filter(v => v > 1).length;
          const dryDays = rains.filter(v => v <= 1).length;
          const wettest = Math.max(...rains, 0);
          return (
            <div key={i} className="compare-stat-col" style={{ borderTopColor: s.color }}>
              <div className="compare-stat-loc">{s.name}</div>
              <div className="compare-stat-row"><span>Total</span><strong>{Math.round(total)} mm</strong></div>
              <div className="compare-stat-row"><span>Wet days</span><strong>{wetDays}</strong></div>
              <div className="compare-stat-row"><span>Wettest day</span><strong>{fmt1(wettest)} mm</strong></div>
              <div className="compare-stat-row"><span>Dry days</span><strong>{dryDays}</strong></div>
            </div>
          );
        }
        const vals = (tab === 'feels' ? s.data.map(d => d.feels) : s.data.map(d => d.avg)).filter(v => v != null);
        const coldAlerts = s.data.filter(d => d.feels != null && d.feels < thresholds.cold).length;
        return (
          <div key={i} className="compare-stat-col" style={{ borderTopColor: s.color }}>
            <div className="compare-stat-loc">{s.name}</div>
            <div className="compare-stat-row"><span>Average</span><strong>{fmt1(avg(vals))}°C</strong></div>
            <div className="compare-stat-row"><span>Coldest</span><strong>{fmt1(Math.min(...vals))}°C</strong></div>
            <div className="compare-stat-row"><span>Warmest</span><strong>{fmt1(Math.max(...vals))}°C</strong></div>
            <div className="compare-stat-row">
              <span>Cold alerts</span>
              <strong style={{ color: coldAlerts > 0 ? 'var(--red)' : undefined }}>{coldAlerts} days</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Comparison view ───────────────────────────────────────────────────────────

function ComparisonView({ locations, trip, thresholds }) {
  const [tab, setTab] = useState('temperature');
  const [activeYear, setActiveYear] = useState('all');

  const getLocData = loc =>
    activeYear === 'all' ? buildAllAvg(loc.years) : (loc.years[activeYear] || []);

  const seriesList = locations.map((loc, i) => ({
    data: getLocData(loc),
    color: LOC_COLORS[i % LOC_COLORS.length],
    name: loc.name,
  }));

  const tabLabels = [
    { key: 'temperature', label: 'Temperature' },
    { key: 'feels', label: 'Feels like' },
    { key: 'rainfall', label: 'Rainfall' },
  ];

  const accessorMap = {
    temperature: d => d.avg,
    feels: d => d.feels,
    rainfall: d => d.rain,
  };
  const unitMap = { temperature: '°C', feels: '°C', rainfall: 'mm' };
  const titleMap = {
    temperature: 'Average temperature — comparison',
    feels: 'Feels-like temperature — comparison',
    rainfall: 'Daily rainfall — comparison',
  };

  const yearMode = activeYear === 'all' ? 'avg across all years' : `${activeYear} data`;

  return (
    <div>
      <div className="main-header">
        <div className="main-loc-info">
          <div className="main-loc-name">Comparing {locations.length} locations</div>
          <div style={{ marginTop: 4 }}>
            <span className="year-mode-pill">{yearMode}</span>
          </div>
        </div>
        <div className="year-switcher">
          <button className={`year-btn${activeYear === 'all' ? ' active' : ''}`} onClick={() => setActiveYear('all')}>
            All avg
          </button>
          {trip.years.map(y => (
            <button key={y} className={`year-btn${activeYear === y ? ' active' : ''}`} onClick={() => setActiveYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="compare-loc-legend">
        {locations.map((loc, i) => (
          <div key={i} className="compare-loc-legend-item">
            <div className="compare-loc-dot" style={{ background: LOC_COLORS[i % LOC_COLORS.length] }} />
            <span className="compare-loc-name">{loc.name}</span>
            {loc.elevation != null && (
              <span className="compare-loc-elev">{Math.round(loc.elevation)}m</span>
            )}
          </div>
        ))}
      </div>

      <div className="chart-tabs">
        {tabLabels.map(t => (
          <button key={t.key} className={`chart-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <div>
            <div className="chart-title">{titleMap[tab]}</div>
            <div className="chart-meta">
              {trip.startMD} → {trip.endMD} · {trip.country}
              {activeYear !== 'all' ? ` · ${activeYear}` : ` · ${trip.years.join(', ')}`}
            </div>
          </div>
          <div className="chart-legend">
            {locations.map((loc, i) => (
              <div key={i} className="legend-item">
                <div className="legend-line" style={{ background: LOC_COLORS[i % LOC_COLORS.length] }} />
                {loc.name}
              </div>
            ))}
          </div>
        </div>
        <CompareChart seriesList={seriesList} accessor={accessorMap[tab]} unit={unitMap[tab]} />
      </div>

      <CompareStats seriesList={seriesList} tab={tab} thresholds={thresholds} />
    </div>
  );
}

// ── Threshold settings ────────────────────────────────────────────────────────

function ThresholdSettings({ thresholds, onChange }) {
  const { cold, chilly } = thresholds;

  const setCold = (v) => {
    const val = Math.max(-10, Math.min(chilly - 1, v));
    onChange({ cold: val, chilly });
  };

  const setChilly = (v) => {
    const val = Math.max(cold + 1, Math.min(30, v));
    onChange({ cold, chilly: val });
  };

  return (
    <div className="threshold-settings">
      <div className="threshold-settings-title">Comfort thresholds</div>
      <div className="threshold-row">
        <div className="threshold-label">
          <span className="threshold-swatch swatch-cold" />
          Cold alert
        </div>
        <div className="threshold-control">
          <button className="threshold-btn" onClick={() => setCold(cold - 1)}>−</button>
          <span className="threshold-val">{cold}°C</span>
          <button className="threshold-btn" onClick={() => setCold(cold + 1)}>+</button>
        </div>
      </div>
      <div className="threshold-row">
        <div className="threshold-label">
          <span className="threshold-swatch swatch-chilly" />
          Chilly
        </div>
        <div className="threshold-control">
          <button className="threshold-btn" onClick={() => setChilly(chilly - 1)}>−</button>
          <span className="threshold-val">{chilly}°C</span>
          <button className="threshold-btn" onClick={() => setChilly(chilly + 1)}>+</button>
        </div>
      </div>
      <div className="threshold-hint">
        ≥ {chilly}°C feels-like → Comfortable
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard({ trip, weatherData, onEditTrip, initialHomeCity }) {
  const [activeIdx, setActiveIdx] = useState(() => {
    const first = weatherData.findIndex(loc => !loc.failed);
    return first >= 0 ? first : 0;
  });
  const [compareMode, setCompareMode] = useState(false);
  const [compareIdxs, setCompareIdxs] = useState([]);
  const [thresholds, setThresholds] = useState(() => {
    try {
      const saved = localStorage.getItem('clomate-thresholds');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { cold: 10, chilly: 14 };
  });

  const handleThresholdChange = (t) => {
    setThresholds(t);
    try { localStorage.setItem('clomate-thresholds', JSON.stringify(t)); } catch {}
  };

  const [homeCity, setHomeCity] = useState(initialHomeCity || null);
  const [shareLoading, setShareLoading] = useState(false);

  const handleShare = async () => {
    setShareLoading(true);
    try {
      const session = { version: 1, savedAt: new Date().toISOString(), trip, weatherData, homeCity: homeCity || null };
      const res = await fetch('/api/share/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
      if (!res.ok) { alert('Share failed — could not generate page.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clomate-share-${trip.country.toLowerCase().replace(/\s+/g, '-')}-${trip.startMD}-${trip.endMD}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Share failed.'); }
    finally { setShareLoading(false); }
  };

  useEffect(() => {
    // fall back to localStorage so sessions saved before homeCityName was
    // added to the trip object still show the banner
    const name = trip.homeCityName?.trim() || localStorage.getItem('clomate-home-city') || '';
    if (!name) { setHomeCity(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const gr = await fetch(`/api/geocode?place=${encodeURIComponent(name)}`);
        if (!gr.ok || cancelled) return;
        const geo = await gr.json();
        const wr = await fetch(`/api/weather?lat=${geo.lat}&lon=${geo.lon}&start=01-01&end=12-31&years=2023,2024`);
        if (!wr.ok || cancelled) return;
        const wj = await wr.json();
        if (!cancelled) setHomeCity({ name: geo.name, country: geo.country, homeData: buildAllAvg(wj.years) });
      } catch { /* silently — banner just won't show */ }
    };
    load();
    return () => { cancelled = true; };
  }, [trip.homeCityName]);

  const toggleCompareIdx = (i) => {
    setCompareIdxs(prev =>
      prev.includes(i)
        ? prev.filter(x => x !== i)
        : prev.length < 4 ? [...prev, i] : prev
    );
  };

  const exitCompare = () => {
    setCompareMode(false);
    setCompareIdxs([]);
  };

  const hasAnyData = weatherData.some(loc => !loc.failed);

  if (!weatherData.length || !hasAnyData) {
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

        <ThresholdSettings thresholds={thresholds} onChange={handleThresholdChange} />

        <div className="sidebar-locs-header">
          <span>Locations {weatherData.length}</span>
          {weatherData.length >= 2 && (
            <button
              className={`sidebar-compare-btn${compareMode ? ' active' : ''}`}
              onClick={() => compareMode ? exitCompare() : setCompareMode(true)}
            >
              {compareMode ? 'Exit' : 'Compare'}
            </button>
          )}
        </div>

        <div className="sidebar-loc-list">
          {weatherData.map((loc, i) => {
            const colorIdx = compareIdxs.indexOf(i);
            const isCompareSelected = colorIdx !== -1;
            const isFailed = !!loc.failed;
            const cls = `sidebar-loc-item${isFailed ? ' failed' : compareMode
              ? (isCompareSelected ? ' compare-selected' : '')
              : (i === activeIdx ? ' active' : '')}`;
            return (
              <div
                key={i}
                className={cls}
                onClick={() => {
                  if (isFailed) return;
                  compareMode ? toggleCompareIdx(i) : setActiveIdx(i);
                }}
              >
                {compareMode && !isFailed && (
                  <div
                    className={`compare-checkbox${isCompareSelected ? ' checked' : ''}`}
                    style={isCompareSelected ? { background: LOC_COLORS[colorIdx % LOC_COLORS.length], borderColor: 'transparent' } : {}}
                  >
                    {isCompareSelected && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                )}
                <PinIcon />
                <div className="sidebar-loc-info">
                  <div className="sidebar-loc-name">{loc.name}</div>
                  <div className="sidebar-loc-sub">
                    {isFailed ? 'unavailable' : `#${String(i + 1).padStart(2, '0')} · ${loc.country}`}
                  </div>
                </div>
                {!isFailed && loc.elevation != null && (
                  <div className="sidebar-elev">{Math.round(loc.elevation)}m</div>
                )}
                {isFailed && (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, color: 'var(--ink-4)' }}>
                    <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M6.5 4v3M6.5 9v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <button className="sidebar-footer-link" onClick={onEditTrip}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M9.5 1.5L11.5 3.5L4.5 10.5H2.5V8.5L9.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            Edit trip setup
          </button>
          <button className="sidebar-footer-link" onClick={() => saveSession(trip, weatherData, homeCity)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 8.5V1.5M4 5l2.5 2.5L9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 9.5v1a1 1 0 001 1h7a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Save session
          </button>
          <button className="sidebar-footer-link" onClick={handleShare} disabled={shareLoading}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="10" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="3" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.5 7.3l4 1.7M4.5 5.7l4-1.7" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            {shareLoading ? 'Generating…' : 'Share with travellers'}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="main-content">
        {compareMode && compareIdxs.length >= 2
          ? <ComparisonView
              key={compareIdxs.join(',')}
              locations={compareIdxs.map(i => weatherData[i])}
              trip={trip}
              thresholds={thresholds}
            />
          : compareMode
            ? <div className="compare-empty">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <rect x="2" y="8" width="14" height="20" rx="3" stroke="var(--border-strong)" strokeWidth="1.8"/>
                  <rect x="20" y="8" width="14" height="20" rx="3" stroke="var(--border-strong)" strokeWidth="1.8"/>
                  <path d="M9 16h4M9 20h4M23 16h4M23 20h4" stroke="var(--border-strong)" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                <span>Select 2 – 4 locations from the sidebar to compare</span>
              </div>
            : location.failed
            ? <div className="loc-unavailable">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="14" stroke="var(--border-strong)" strokeWidth="1.8"/>
                  <path d="M16 10v8M16 22v1" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <div className="loc-unavailable-name">{location.name}</div>
                <div className="loc-unavailable-msg">Weather data could not be fetched for this location. Save this session — the location is preserved and data will appear next time it can be retrieved.</div>
              </div>
            : <ChartSection key={activeIdx} location={location} trip={trip} thresholds={thresholds} homeCity={homeCity} />
        }
      </div>
    </div>
  );
}
