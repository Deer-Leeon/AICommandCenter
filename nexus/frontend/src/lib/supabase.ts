import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// ── Cross-protocol storage ────────────────────────────────────────────────────
// The PKCE code_verifier is small (<100 bytes) and must survive an HTTP→HTTPS
// redirect. localStorage is per-origin (http:// ≠ https://), so the verifier
// stored during sign-in on http:// is invisible to the https:// callback page.
// Cookies ARE shared across protocols on the same hostname (without the Secure
// flag), so we store small items in both localStorage AND a cookie.
// When reading, the cookie takes priority — guaranteeing cross-protocol access.
// Large items (JWT tokens) only go to localStorage, which is fine because the
// session is only ever read after a successful HTTPS login.

const COOKIE_MAX_BYTES = 3800; // safe under the 4 KB per-cookie browser limit
const COOKIE_MAX_AGE   = 60 * 60 * 24; // 1 day in seconds

function cookieGet(key: string): string | null {
  const prefix = encodeURIComponent(key) + '=';
  for (const part of document.cookie.split(';')) {
    const c = part.trimStart();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}

function cookieSet(key: string, value: string) {
  document.cookie =
    `${encodeURIComponent(key)}=${encodeURIComponent(value)}` +
    `;path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
}

function cookieDel(key: string) {
  document.cookie = `${encodeURIComponent(key)}=;path=/;max-age=0;SameSite=Lax`;
}

const crossProtocolStorage = {
  getItem(key: string): string | null {
    // Cookies first — they are shared across http:// and https:// origins.
    const fromCookie = cookieGet(key);
    if (fromCookie !== null) return fromCookie;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
    // Also persist in a cookie if the value is small enough.
    if (value.length < COOKIE_MAX_BYTES) cookieSet(key, value);
  },
  removeItem(key: string): void {
    window.localStorage.removeItem(key);
    cookieDel(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'nexus-auth',
    storage: crossProtocolStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/**
 * Returns the correct OAuth redirect URL for the current context.
 *
 * Always uses HTTPS in production so the callback origin matches the
 * origin where the PKCE code_verifier was stored (even if the user
 * arrived on http://).
 */
export function getAuthRedirectUrl(): string {
  if (import.meta.env.VITE_IS_EXTENSION === 'true') {
    const extId = typeof chrome !== 'undefined' ? chrome?.runtime?.id : undefined;
    if (extId) return `chrome-extension://${extId}/index.extension.html`;
  }
  if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
    return `chrome-extension://${chrome.runtime.id}/index.extension.html`;
  }
  // Force HTTPS in production so the PKCE callback is always on the same origin.
  const origin =
    window.location.protocol === 'http:' && window.location.hostname !== 'localhost'
      ? `https://${window.location.host}`
      : window.location.origin;
  return `${origin}/auth/callback`;
}
