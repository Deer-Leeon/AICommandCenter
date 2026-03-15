import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

export interface Profile {
  userId: string;
  username: string | null;
  displayName: string;
  createdAt: string;
}

// Module-level cache — survives re-mounts within the same session
let _cachedProfile: Profile | null = null;
let _fetchPromise: Promise<Profile | null> | null = null;

async function fetchProfile(): Promise<Profile | null> {
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = apiFetch('/api/profiles/me')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Profile;
      _cachedProfile = d;
      return d;
    })
    .catch(() => null)
    .finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}

export function invalidateProfileCache() {
  _cachedProfile = null;
}

export function prefetchProfile() {
  if (!_cachedProfile && !_fetchPromise) fetchProfile();
}

export function useProfile(enabled: boolean) {
  const [profile, setProfile] = useState<Profile | null>(_cachedProfile);
  const [loading, setLoading] = useState(_cachedProfile === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && _cachedProfile) { setProfile(_cachedProfile); setLoading(false); return; }
    if (force) { _cachedProfile = null; _fetchPromise = null; }
    setLoading(true);
    setError(null);
    const d = await fetchProfile();
    if (d) { setProfile(d); setError(null); }
    else setError('Failed to load profile');
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  return { profile, loading, error, refresh: () => refresh(true) };
}
