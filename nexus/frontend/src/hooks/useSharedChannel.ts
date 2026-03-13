/**
 * useSharedChannel — real-time channel for a single shared widget.
 *
 * Usage (3 lines):
 *   const { publish } = useSharedChannel(connectionId, 'chess', (event) => {
 *     setBoard(event.payload.board);
 *   });
 *
 * The hook subscribes to all SSE events matching (connectionId, widgetType)
 * and exposes a `publish(type, payload)` function that POSTs to the backend
 * which then calls broadcastToConnection.  The frontend never broadcasts
 * directly — all events go through the backend.
 */
import { useEffect, useCallback } from 'react';
import { nexusSSE, type NexusSSEEvent } from '../lib/nexusSSE';
import { apiFetch } from '../lib/api';

interface SharedWidgetEvent extends NexusSSEEvent {
  connectionId: string;
  widgetType:   string;
  payload:      Record<string, unknown>;
  sentBy:       string;
  timestamp:    string;
}

type EventHandler = (event: SharedWidgetEvent) => void;

export function useSharedChannel(
  connectionId: string | null | undefined,
  widgetType:   string,
  onEvent:      EventHandler,
) {
  // Subscribe to matching SSE events
  useEffect(() => {
    if (!connectionId) return;
    const unsub = nexusSSE.subscribe((raw) => {
      // Pass nexus: meta-events (like nexus:reconnected) through without filtering
      // so every widget can react to connection state changes.
      if (typeof raw.type === 'string' && raw.type.startsWith('nexus:')) {
        onEvent(raw as SharedWidgetEvent);
        return;
      }
      if (raw.connectionId === connectionId && raw.widgetType === widgetType) {
        onEvent(raw as SharedWidgetEvent);
      }
    });
    return unsub;
  }, [connectionId, widgetType, onEvent]);

  // Publish sends to the backend which calls broadcastToConnection
  const publish = useCallback(async (type: string, payload: Record<string, unknown>) => {
    if (!connectionId) return;
    await apiFetch(`/api/connections/${connectionId}/broadcast`, {
      method: 'POST',
      body:   JSON.stringify({ type, widgetType, payload }),
    });
  }, [connectionId, widgetType]);

  return { publish };
}
