import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

// ── Capacitor native storage adapter ─────────────────────────────────────────
// WKWebView's localStorage on iOS is volatile — the OS can evict it under
// storage pressure or after an update, logging the user out unexpectedly.
// @capacitor/preferences wraps NSUserDefaults, which is persistent across
// restarts and immune to iOS storage eviction.
//
// Dynamic imports keep all @capacitor/* plugin registration out of the
// web/Electron bundle at module-load time (avoids the "Maximum update depth
// exceeded" crash that static Capacitor imports caused in non-native builds).

function isNativeCapacitor(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as unknown as Record<string, unknown>).Capacitor &&
    !!(((window as unknown as Record<string, unknown>).Capacitor) as Record<string, unknown>).isNativePlatform
  );
}

function createCapacitorStorage(): SupportedStorage {
  return {
    getItem: async (key: string): Promise<string | null> => {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    },
    setItem: async (key: string, value: string): Promise<void> => {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
    },
    removeItem: async (key: string): Promise<void> => {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
    },
  };
}

// Session is persisted in localStorage on web/Electron (origin-isolated,
// HTTPS-only, safe for PKCE verifiers).
// On iOS/Android, native Preferences storage is used instead.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:     true,
    storageKey:         'nexus-auth',
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    flowType:           'pkce',
    storage:            isNativeCapacitor() ? createCapacitorStorage() : undefined,
  },
});

/**
 * Returns the OAuth redirect URL for the current context:
 *   - Chrome extension → chrome-extension://<id>/index.extension.html
 *   - Capacitor → handled in useAuth.ts (redirectTo: 'nexus://auth/callback' passed directly)
 *   - Web / Electron → https://<origin>/auth/callback
 */
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
