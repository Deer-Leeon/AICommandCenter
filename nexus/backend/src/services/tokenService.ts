import { supabase } from '../lib/supabase.js';
import { google } from 'googleapis';

export interface UserTokenRow {
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  updated_at: string;
}

/** @deprecated use getTokensForService instead */
export async function getUserTokens(userId: string): Promise<UserTokenRow | null> {
  const { data, error } = await supabase
    .from('user_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (error) return null;
  return data as UserTokenRow;
}

export type GoogleService = 'google-calendar' | 'google-tasks' | 'google-docs' | 'google-drive';

/**
 * Ordered fallback chains for each Google service.
 */
const GOOGLE_TOKEN_FALLBACKS: Record<GoogleService, string[]> = {
  'google-calendar': ['google-calendar', 'google'],
  'google-tasks':    ['google-tasks', 'google-calendar', 'google'],
  'google-docs':     ['google-docs', 'google'],
  'google-drive':    ['google-drive', 'google-docs', 'google'],
};

// ── In-memory token-row cache ─────────────────────────────────────────────────
// Avoids repeated Supabase round-trips when the same user makes multiple
// requests within the cache window (e.g. calendar polling every 10 s).
//
// Key format:
//   "svc:{userId}:{service}"    → UserTokenRow (from getTokensForService)
//   "str:{userId}:{provider}"   → string access_token (from getCachedProviderToken)
//
// Both are invalidated by saveTokensForProvider when tokens change.

const TOKEN_CACHE_TTL = 5 * 60_000; // 5 minutes

interface TokenRowEntry {
  row: UserTokenRow;
  expiresAt: number;
}
interface TokenStrEntry {
  token: string;
  expiresAt: number;
}

const tokenRowCache = new Map<string, TokenRowEntry>();
const tokenStrCache = new Map<string, TokenStrEntry>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch tokens for a specific Google service with in-memory caching.
 * Walks the fallback chain so existing users aren't broken after a scope split.
 */
export async function getTokensForService(
  userId: string,
  service: GoogleService
): Promise<UserTokenRow | null> {
  const cacheKey = `svc:${userId}:${service}`;
  const hit = tokenRowCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.row;

  for (const provider of GOOGLE_TOKEN_FALLBACKS[service]) {
    const { data } = await supabase
      .from('user_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();
    if (data) {
      const row = data as UserTokenRow;
      tokenRowCache.set(cacheKey, { row, expiresAt: Date.now() + TOKEN_CACHE_TTL });
      return row;
    }
  }
  return null;
}

/**
 * Fetch a raw access_token string for any provider (e.g. Slack) with caching.
 * Use this instead of querying Supabase directly in route handlers.
 */
export async function getCachedProviderToken(
  userId: string,
  provider: string,
): Promise<string | null> {
  const cacheKey = `str:${userId}:${provider}`;
  const hit = tokenStrCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.token;

  const { data } = await supabase
    .from('user_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();

  const token = data?.access_token ?? null;
  if (token) {
    tokenStrCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_CACHE_TTL });
  }
  return token;
}

/** Save tokens under any provider key (service-specific or legacy). */
export async function saveTokensForProvider(
  userId: string,
  provider: string,
  tokens: {
    access_token: string;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }
): Promise<void> {
  await supabase.from('user_tokens').upsert(
    {
      user_id: userId,
      provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expiry_date ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  // Invalidate all service caches that include this provider in their fallback chain
  for (const [svc, fallbacks] of Object.entries(GOOGLE_TOKEN_FALLBACKS)) {
    if (fallbacks.includes(provider)) {
      tokenRowCache.delete(`svc:${userId}:${svc}`);
    }
  }
  // Invalidate the string-token cache for this provider directly
  tokenStrCache.delete(`str:${userId}:${provider}`);
}

/** @deprecated use saveTokensForProvider('google', ...) instead */
export async function saveUserTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }
): Promise<void> {
  await saveTokensForProvider(userId, 'google', tokens);
}

export function getGoogleAuthClient(tokens: {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expires_at ?? undefined,
  });
  return oauth2Client;
}
