/**
 * useConnectionRefresh — subscribe to connection-state SSE events.
 *
 * Call this in any widget or component that needs to re-sync its data when a
 * connection is established or removed.  The callback is held in a ref so the
 * subscription is never torn down on re-renders — add this to a widget in
 * three lines and it "just works" with the global SSE channel.
 *
 * Usage:
 *   useConnectionRefresh(useCallback(() => { refetch(); }, [refetch]));
 */
import { useEffect, useRef } from 'react';
import { nexusSSE } from '../lib/nexusSSE';

// All SSE event types that mean "the set of active connections changed"
const CONNECTION_CHANGE_EVENTS = new Set([
  'connection:invite_accepted', // inviter side: their invite was accepted
  'connection:state_updated',   // acceptor side: they just accepted
  'connection:dissolved',       // either side: connection was removed
  'connections:init',           // SSE reconnect — full state re-push
]);

export function useConnectionRefresh(onChanged: () => void): void {
  const callbackRef = useRef(onChanged);
  callbackRef.current = onChanged; // always points to latest without re-subscribing

  useEffect(() => {
    return nexusSSE.subscribe(event => {
      if (CONNECTION_CHANGE_EVENTS.has(event.type)) {
        callbackRef.current();
      }
    });
  }, []); // single subscription for the lifetime of the component
}
