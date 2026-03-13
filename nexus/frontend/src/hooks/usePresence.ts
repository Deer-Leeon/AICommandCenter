/**
 * usePresence — returns live presence status for the partner in a connection.
 *
 *   const { isOnline, lastSeen } = usePresence(connectionId);
 */
import { useState, useEffect } from 'react';
import { nexusSSE } from '../lib/nexusSSE';
import { useConnections } from './useConnections';

export interface PresenceState {
  isOnline: boolean;
  lastSeen: Date | null;
}

export function usePresence(connectionId: string | null | undefined): PresenceState {
  const { active } = useConnections(!!connectionId);
  const connection = active.find(c => c.connection_id === connectionId) ?? null;

  const [state, setState] = useState<PresenceState>(() => ({
    isOnline: connection?.presence?.isOnline ?? false,
    lastSeen: connection?.presence?.lastSeen ? new Date(connection.presence.lastSeen) : null,
  }));

  // Sync when the connection list updates (e.g. initial fetch)
  useEffect(() => {
    if (!connection) return;
    setState({
      isOnline: connection.presence?.isOnline ?? false,
      lastSeen: connection.presence?.lastSeen ? new Date(connection.presence.lastSeen) : null,
    });
  }, [connection]);

  // Listen for real-time presence events
  useEffect(() => {
    if (!connectionId) return;
    const unsub = nexusSSE.subscribe((event) => {
      if (event.type !== 'presence:update') return;
      const { userId, isOnline, lastSeen } = event as unknown as {
        userId: string; isOnline: boolean; lastSeen: string;
      };
      if (userId === connection?.partner?.userId) {
        setState({ isOnline, lastSeen: new Date(lastSeen) });
      }
    });
    return unsub;
  }, [connectionId, connection?.partner?.userId]);

  return state;
}
