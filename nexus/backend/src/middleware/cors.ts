import cors from 'cors';

// FRONTEND_URL can be a single URL or comma-separated list of URLs.
const envOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const staticOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow server-to-server / curl with no origin header
    if (!origin) return callback(null, true);
    // Allow all Chrome extension pages
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    // Allow explicitly configured origins
    const allowed = [...envOrigins, ...staticOrigins];
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
});
