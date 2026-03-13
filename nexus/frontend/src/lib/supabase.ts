import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'nexus-auth',
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/**
 * Returns the correct OAuth redirect URL for the current context.
 *
 * • Web:       https://nexus.lj-buchmiller.com/auth/callback
 * • Extension: chrome-extension://[extension-id]/index.html
 *
 * In extension context, Supabase appends the tokens as a URL hash fragment,
 * and `detectSessionInUrl: true` picks them up on page load — no separate
 * /auth/callback route is needed.
 */
export function getAuthRedirectUrl(): string {
  // Build-time flag (set by vite.extension.config.ts) takes priority
  if (import.meta.env.VITE_IS_EXTENSION === 'true') {
    // chrome.runtime.id is available on extension pages
    const extId =
      typeof chrome !== 'undefined' ? chrome?.runtime?.id : undefined;
    if (extId) return `chrome-extension://${extId}/index.extension.html`;
  }
  // Fallback: runtime detection (handles dev mode where the flag isn't set)
  if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
    return `chrome-extension://${chrome.runtime.id}/index.extension.html`;
  }
  return `${window.location.origin}/auth/callback`;
}
