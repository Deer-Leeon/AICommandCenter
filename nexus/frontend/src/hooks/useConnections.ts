/**
 * useConnections — fetches + keeps the current user's connection state in sync.
 *
 * Returns:
 *   active    — accepted connections with partner profile + presence
 *   outgoing  — pending invites sent by the current user
 *   incoming  — pending invites received by the current user
 *   loading   — initial fetch in progress
 *   refresh() — re-fetch from the server
 *
 * Real-time updates arrive via the global SSE manager; the hook subscribes
 * and re-fetches on any connection-related event.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { nexusSSE } from '../lib/nexusSSE';

export interface PartnerProfile {
  userId:      string;
  username:    string | null;
  displayName: string;
}

export interface PresenceInfo {
  isOnline: boolean;
  lastSeen: string;
}

export interface Connection {
  connection_id: string;
  user_id_a:     string;
  user_id_b:     string;
  status:        'pending' | 'accepted' | 'declined' | 'dissolved';
  invited_by:    string;
  created_at:    string;
  accepted_at:   string | null;
  partner:       PartnerProfile | null;
  presence:      PresenceInfo   | null;
}

interface ConnectionsState {
  active:   Connection[];
  outgoing: Connection[];
  incoming: Connection[];
}

export function useConnections(enabled = true) {
  const [state,   setState]   = useState<ConnectionsState>({ active: [], outgoing: [], incoming: [] });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const fetch = useCallback(async () => {
    if (!enabled || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res  = await apiFetch('/api/connections');
      if (!res.ok) throw new Error('Failed to load connections');
      const data = await res.json() as ConnectionsState;
      setState(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [enabled]);

  // Initial fetch
  useEffect(() => { if (enabled) fetch(); }, [fetch, enabled]);

  // Re-fetch on any connection-related SSE event
  useEffect(() => {
    if (!enabled) return;
    const unsub = nexusSSE.subscribe((event) => {
      if (event.type.startsWith('connection:') || event.type === 'connections:init') {
        fetch();
      }
      // Presence updates: patch in-place without a full re-fetch
      if (event.type === 'presence:update') {
        const { userId, isOnline, lastSeen } = event as unknown as {
          userId: string; isOnline: boolean; lastSeen: string;
        };
        setState(prev => ({
          ...prev,
          active: prev.active.map(c =>
            c.partner?.userId === userId
              ? { ...c, presence: { isOnline, lastSeen } }
              : c,
          ),
        }));
      }
    });
    return unsub;
  }, [enabled, fetch]);

  return { ...state, loading, error, refresh: fetch };
}
