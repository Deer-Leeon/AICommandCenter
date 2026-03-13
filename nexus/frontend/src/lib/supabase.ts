import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// ── Secure session storage ────────────────────────────────────────────────────
// PKCE is the most secure OAuth flow: a one-time code_verifier is generated
// client-side, hashed (S256) and sent as a code_challenge during the OAuth
// redirect. The raw verifier is required to exchange the returned auth code for
// a session — meaning a stolen code is useless without the verifier.
//
// The verifier is stored in BOTH localStorage AND a short-lived cookie so it
// survives any http:// → https:// hops (localStorage is origin-partitioned;
// cookies without the Secure flag are shared across both protocols on the same
// hostname). The cookie expires in 10 minutes — just long enough for the
// OAuth round-trip.

const COOKIE_MAX_AGE = 60 * 10; // 10 minutes

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

// Mirror small items (like the code_verifier) into a cookie as well as
// localStorage so they survive protocol changes during the OAuth redirect.
const secureStorage = {
  getItem(key: string): string | null {
    const fromCookie = cookieGet(key);
    if (fromCookie !== null) return fromCookie;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
    if (value.length < 3800) cookieSet(key, value);
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
    storage: secureStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/** Returns the OAuth redirect URL for the current context. */
export function getAuthRedirectUrl(): string {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
    return `chrome-extension://${chrome.runtime.id}/index.extension.html`;
  }
  const origin =
    window.location.protocol === 'http:' && window.location.hostname !== 'localhost'
      ? `https://${window.location.host}`
      : window.location.origin;
  return `${origin}/auth/callback`;
}
