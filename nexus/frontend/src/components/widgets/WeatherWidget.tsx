import { useState, useEffect, useRef, useCallback } from 'react';
import type { WeatherData } from '../../types';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, wcIsStale, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

interface WeatherWidgetProps {
  onClose: () => void;
}

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
        borderRadius: 999, padding: 2,
        cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      {(['F', 'C'] as const).map(u => (
        <div
          key={u}
          style={{
            minWidth: 26, padding: '3px 8px',
            borderRadius: 999, textAlign: 'center',
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            letterSpacing: '0.04em',
            color: unit === u ? '#fff' : 'var(--text-muted)',
            background: unit === u ? 'var(--accent)' : 'transparent',
            transition: 'background 0.2s, color 0.2s',
            boxShadow: unit === u ? '0 1px 6px rgba(124,106,255,0.4)' : 'none',
          }}
        >
          °{u}
        </div>
      ))}
    </div>
  );
}

export function WeatherWidget({ onClose: _onClose }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(
    () => wcRead<WeatherData>(WC_KEY.WEATHER)?.data ?? null,
  );
  const [isStale, setIsStale] = useState(
    () => wcIsStale(WC_KEY.WEATHER, WC_TTL.WEATHER),
  );
  const [hasError, setHasError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.WEATHER) !== null,
  );
  const [unit, setUnit] = useState<Unit>(loadUnit);

  const toggleUnit = () => {
    setUnit(prev => {
      const next: Unit = prev === 'F' ? 'C' : 'F';
      saveUnit(next);
      return next;
    });
  };

  const hasFetchedOnce = useRef(weather !== null);

  useWidgetReady('weather', hasLoaded);

  const fetchWeather = useCallback(async (lat: number | null, lon: number | null) => {
    try {
      const params = lat !== null && lon !== null ? `?lat=${lat}&lon=${lon}` : '';
      const endpoint = `/api/weather${params}`;
      const res = !params
        ? await awaitPrefetchOrFetch('/api/weather', () => apiFetch(endpoint))
        : await apiFetch(endpoint);
      if (res.ok) {
        const data: WeatherData = await res.json();
        setWeather(data);
        wcWrite(WC_KEY.WEATHER, data);
        setHasError(false);
        setIsStale(false);
        hasFetchedOnce.current = true;
      } else if (!hasFetchedOnce.current) {
        setHasError(true);
      }
    } catch {
      if (!hasFetchedOnce.current) setHasError(true);
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          fetchWeather(latitude, longitude);
        },
        () => fetchWeather(null, null),
        { timeout: 5000 }
      );
    } else {
      fetchWeather(null, null);
    }

    const interval = setInterval(() => fetchWeather(null, null), 600_000);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  if (hasError || !weather) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-3 text-center gap-2">
        <span style={{ fontSize: '24px' }}>🌤</span>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not available</p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Add OPENWEATHER_API_KEY to .env
        </p>
      </div>
    );
  }

  const temp   = convert(weather.temp,      unit);
  const feelsT = convert(weather.feelsLike, unit);

  return (
    <div className="h-full flex flex-col items-center justify-center p-3 gap-1" style={{ position: 'relative' }}>
      {isStale && (
        <span
          title="Showing cached data — refreshing in background"
          style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}
        >
          ↻
        </span>
      )}

      <p className="font-mono text-xs" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
        {weather.city}
      </p>

      <div className="flex items-end gap-2">
        <span style={{ fontSize: '32px', lineHeight: 1 }}>{weather.icon}</span>
        <span
          className="font-mono"
          style={{ color: 'var(--color-warning)', fontSize: '28px', fontWeight: 700, lineHeight: 1 }}
        >
          {temp}°
        </span>
      </div>

      <p className="text-xs capitalize" style={{ color: 'var(--text)', fontSize: '12px' }}>
        {weather.description}
      </p>

      <div className="flex items-center gap-3 mt-1">
        <span className="font-mono text-xs" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
          Feels {feelsT}°
        </span>
        <span className="font-mono text-xs" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
          Humidity {weather.humidity}%
        </span>
      </div>

      {/* Unit toggle */}
      <div style={{ marginTop: 6 }}>
        <UnitToggle unit={unit} onToggle={toggleUnit} />
      </div>
    </div>
  );
}
