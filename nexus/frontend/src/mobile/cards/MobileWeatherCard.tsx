import { useState, useEffect, useCallback } from 'react';
import type { WeatherData } from '../../types';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';

const UNIT_KEY = 'nexus_weather_unit';
type Unit = 'F' | 'C';

function loadUnit(): Unit {
  try { return (localStorage.getItem(UNIT_KEY) as Unit) || 'F'; } catch { return 'F'; }
}
function saveUnit(u: Unit) {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* quota */ }
}

const toF = (k: number) => Math.round((k - 273.15) * 9 / 5 + 32);
const toC = (k: number) => Math.round(k - 273.15);
const convert = (k: number, unit: Unit) => unit === 'F' ? toF(k) : toC(k);

// ── Slick pill toggle ─────────────────────────────────────────────────────────
function UnitToggle({ unit, onToggle }: { unit: Unit; onToggle: () => void }) {
  return (
    <div
      onPointerDown={onToggle}
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid var(--border)',
        borderRadius: 999, padding: 3,
        cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      {(['F', 'C'] as const).map(u => (
        <div
          key={u}
          style={{
            minWidth: 38, padding: '5px 12px',
            borderRadius: 999, textAlign: 'center',
            fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700,
            letterSpacing: '0.04em',
            color: unit === u ? '#fff' : 'var(--text-muted)',
            background: unit === u ? 'var(--accent)' : 'transparent',
            transition: 'background 0.2s, color 0.2s',
            boxShadow: unit === u ? '0 2px 8px rgba(124,106,255,0.35)' : 'none',
          }}
        >
          °{u}
        </div>
      ))}
    </div>
  );
}

export function MobileWeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(
    () => wcRead<WeatherData>(WC_KEY.WEATHER)?.data ?? null,
  );
  const [error, setError] = useState(false);
  const [unit, setUnit] = useState<Unit>(loadUnit);

  const toggleUnit = () => {
    setUnit(prev => {
      const next: Unit = prev === 'F' ? 'C' : 'F';
      saveUnit(next);
      return next;
    });
  };

  const fetch_ = useCallback(async (lat?: number, lon?: number) => {
    try {
      const params = lat !== undefined ? `?lat=${lat}&lon=${lon}` : '';
      const res = await apiFetch(`/api/weather${params}`);
      if (res.ok) {
        const data: WeatherData = await res.json();
        setWeather(data);
        wcWrite(WC_KEY.WEATHER, data);
      } else setError(true);
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => fetch_(p.coords.latitude, p.coords.longitude),
        () => fetch_(),
      );
    } else fetch_();
  }, [fetch_]);

  const temp  = weather ? convert(weather.temp,      unit) : null;
  const feels = weather ? convert(weather.feelsLike, unit) : null;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      padding: '20px', alignItems: 'center', justifyContent: 'center', gap: 0,
    }}>
      {error && !weather && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
          Unable to load weather
        </div>
      )}
      {!weather && !error && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
      )}
      {weather && (
        <>
          {/* City */}
          <div style={{
            fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase',
          }}>
            {weather.city}
          </div>

          {/* Icon */}
          <div style={{ fontSize: 80, lineHeight: 1, marginBottom: 4 }}>{weather.icon}</div>

          {/* Temperature */}
          <div style={{
            fontSize: 72, fontWeight: 800, color: 'var(--text)',
            lineHeight: 1, marginBottom: 6,
          }}>
            {temp}°
          </div>

          {/* Description */}
          <div style={{
            fontSize: 18, color: 'var(--text-muted)', marginBottom: 20,
            textTransform: 'capitalize',
          }}>
            {weather.description}
          </div>

          {/* Details row */}
          <div style={{ display: 'flex', gap: 32, alignItems: 'center', marginBottom: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Feels Like</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{feels}°</div>
            </div>
            <div style={{ width: 1, height: 36, background: 'var(--border)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Humidity</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{weather.humidity}%</div>
            </div>
          </div>

          {/* Unit toggle */}
          <UnitToggle unit={unit} onToggle={toggleUnit} />
        </>
      )}
    </div>
  );
}
