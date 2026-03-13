import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// Use implicit flow: the access_token arrives in the URL hash on the callback
// page — no code_verifier is generated, so there is no cross-origin
// localStorage problem (http:// verifier vs https:// callback).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'nexus-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
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
