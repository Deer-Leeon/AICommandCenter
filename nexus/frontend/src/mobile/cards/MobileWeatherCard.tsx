import { useState, useEffect, useCallback } from 'react';
import type { WeatherData } from '../../types';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';

const WEATHER_ICONS: Record<string, string> = {
  '01d': '☀️', '01n': '🌙', '02d': '⛅', '02n': '⛅',
  '03d': '☁️', '03n': '☁️', '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️', '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️', '13d': '❄️', '13n': '❄️',
  '50d': '🌫️', '50n': '🌫️',
};

export function MobileWeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(
    () => wcRead<WeatherData>(WC_KEY.WEATHER)?.data ?? null,
  );
  const [error, setError] = useState(false);

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

  const icon = WEATHER_ICONS[weather?.icon ?? ''] ?? '🌤';
  const temp = weather ? Math.round(weather.temp) : null;
  const feels = weather ? Math.round(weather.feelsLike) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px', alignItems: 'center', justifyContent: 'center' }}>
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
          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
            {weather.city}
          </div>

          {/* Icon + Temp */}
          <div style={{ fontSize: 80, lineHeight: 1, marginBottom: 4 }}>{icon}</div>
          <div style={{ fontSize: 72, fontWeight: 800, color: 'var(--text)', lineHeight: 1, marginBottom: 8 }}>
            {temp}°
          </div>

          {/* Description */}
          <div style={{ fontSize: 18, color: 'var(--text-muted)', marginBottom: 20, textTransform: 'capitalize' }}>
            {weather.description}
          </div>

          {/* Details row */}
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
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
        </>
      )}
    </div>
  );
}
