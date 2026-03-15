import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// Session is persisted in localStorage only — the site is HTTPS-only so PKCE
// code verifiers are safe in localStorage (origin-isolated to this domain).
// A previous cookie-hybrid storage caused sessions to be short-lived because
// the cookie's 10-minute max-age conflicted with Supabase's auto-refresh.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:    true,
    storageKey:        'nexus-auth',
    autoRefreshToken:  true,
    detectSessionInUrl: true,
    flowType:          'pkce',
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
