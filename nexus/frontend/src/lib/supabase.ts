import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// ── Cross-protocol cookie storage ─────────────────────────────────────────────
// The PKCE code_verifier must survive the OAuth redirect chain. We store it in
// BOTH localStorage AND a cookie so it is readable even if the sign-in page
// and the callback page run on different protocols (http:// vs https://).
// Cookies without the Secure flag are shared across both protocols on the same
// hostname, bridging the gap while localStorage is origin-partitioned.

const COOKIE_MAX_AGE = 60 * 10; // 10 minutes — only needed for the auth round-trip

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
    // Cookie first — survives http:// → https:// redirect.
    const fromCookie = cookieGet(key);
    if (fromCookie !== null) return fromCookie;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
    // Mirror small values (like the code_verifier) into a cookie.
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
  // Force HTTPS so the callback is always on the same origin as the session storage.
  const origin =
    window.location.protocol === 'http:' && window.location.hostname !== 'localhost'
      ? `https://${window.location.host}`
      : window.location.origin;
  return `${origin}/auth/callback`;
}
