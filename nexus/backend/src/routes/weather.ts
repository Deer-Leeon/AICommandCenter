import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const weatherRouter = Router();

const ICON_MAP: Record<string, string> = {
  '01d': '☀️', '01n': '🌙',
  '02d': '⛅', '02n': '⛅',
  '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️',
  '10d': '🌦️', '10n': '🌦️',
  '11d': '⛈️', '11n': '⛈️',
  '13d': '❄️', '13n': '❄️',
  '50d': '🌫️', '50n': '🌫️',
};

weatherRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (!apiKey) {
    res.status(404).json({ error: 'OPENWEATHER_API_KEY not configured' });
    return;
  }

  try {
    const { lat, lon, city } = req.query as {
      lat?: string;
      lon?: string;
      city?: string;
    };

    // Build the OpenWeather URL — prefer coordinates when provided
    let weatherUrl: string;
    if (lat && lon) {
      weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    } else {
      const location = city || process.env.OPENWEATHER_DEFAULT_CITY || 'New York,US';
      weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}`;
    }

    const response = await fetch(weatherUrl, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      throw new Error(`OpenWeather API error: ${response.status}`);
    }

    const data = await response.json() as {
      name: string;
      main: { temp: number; feels_like: number; humidity: number };
      weather: Array<{ description: string; icon: string }>;
    };

    // Return the same WeatherData shape the frontend widget expects
    res.json({
      city: data.name,
      temp: data.main.temp,             // Kelvin — WeatherWidget converts to °F
      feelsLike: data.main.feels_like,
      humidity: data.main.humidity,
      description: data.weather[0]?.description ?? '',
      icon: ICON_MAP[data.weather[0]?.icon ?? '01d'] ?? '🌤',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Weather fetch failed';
    res.status(500).json({ error: msg });
  }
});
