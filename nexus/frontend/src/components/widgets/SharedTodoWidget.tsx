/**
 * SharedTodoWidget — real-time collaborative to-do list shared between two
 * connected NEXUS users.  Visually identical to the personal TodoWidget with
 * three added touches:
 *   • A "Shared with @name 🟢/⚫" header bar showing the partner's presence.
 *   • A tiny coloured dot on each item indicating who created it (you vs partner).
 *   • A full-widget "connection ended" state if the connection is dissolved.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../lib/api';
import { nexusSSE } from '../../lib/nexusSSE';
import { useSharedChannel } from '../../hooks/useSharedChannel';
import { useConnections } from '../../hooks/useConnections';
import { useAuth } from '../../hooks/useAuth';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import type { SharedTodoItem } from '../../types';

interface SharedTodoWidgetProps {
  connectionId: string;
  slotKey:      string;
  onClose:      () => void;
}

// Accent colours for "me" vs "partner" item badges
const MY_COLOR      = 'var(--teal)';
const PARTNER_COLOR = '#a78bfa'; // purple — distinct from teal

export function SharedTodoWidget({ connectionId, onClose }: SharedTodoWidgetProps) {
  const { user } = useAuth();
  const myId     = user?.id ?? '';

  // Pull partner profile + live presence from the connections list
  const { active } = useConnections(true);
  const connection   = active.find(c => c.connection_id === connectionId) ?? null;
  const partner      = connection?.partner ?? null;
  const isOnline     = connection?.presence?.isOnline ?? false;
  const partnerName  = partner?.displayName || (partner?.username ? `@${partner.username}` : 'Friend');

  const [items,    setItems]    = useState<SharedTodoItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [newText,  setNewText]  = useState('');
  const [dissolved, setDissolved] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useWidgetReady('todo', !loading);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/shared-todo/${connectionId}`);
        if (cancelled) return;
        if (res.status === 403) { setDissolved(true); return; }
        if (!res.ok) { setError('Failed to load'); return; }
        const data = await res.json() as SharedTodoItem[];
        setItems(data);
      } catch {
        if (!cancelled) setError('Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [connectionId]);

  // ── SSE real-time handler — stable via ref pattern to avoid re-subscribing ──
  const handleEventRef = useRef<((e: Record<string, unknown>) => void) | null>(null);
  handleEventRef.current = (event: Record<string, unknown>) => {
    switch (event.type) {
      case 'todo:item_added': {
        const item = event.payload as SharedTodoItem;
        setItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)));
        break;
      }
      case 'todo:item_updated': {
        const updated = event.payload as SharedTodoItem;
        setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        break;
      }
      case 'todo:item_deleted': {
        const { itemId } = event.payload as { itemId: string };
        setItems(prev => prev.filter(i => i.id !== itemId));
        break;
      }
      case 'todo:reordered': {
        const { orderedIds } = event.payload as { orderedIds: string[] };
        setItems(prev => {
          const map = new Map(prev.map(i => [i.id, i]));
          return orderedIds.map((id, pos) => map.get(id) ? { ...map.get(id)!, position: pos } : null).filter(Boolean) as SharedTodoItem[];
        });
        break;
      }
    }
  };

  const stableHandler = useCallback((event: Record<string, unknown>) => {
    handleEventRef.current?.(event);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSharedChannel(connectionId, 'shared_todo', stableHandler as any);

  // ── Listen for connection dissolution ────────────────────────────────────────
  useEffect(() => {
    return nexusSSE.subscribe((ev) => {
      if (ev.type === 'connection:dissolved' && (ev as { connectionId?: string }).connectionId === connectionId) {
        setDissolved(true);
      }
    });
  }, [connectionId]);

  // ── Handlers with optimistic updates ────────────────────────────────────────
  async function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    setNewText('');

    const optimisticId = `opt-${Date.now()}`;
    const optimistic: SharedTodoItem = {
      id:           optimisticId,
      connectionId,
      text,
      completed:    false,
      createdBy:    myId,
      position:     items.length,
      createdAt:    new Date().toISOString(),
    };
    setItems(prev => [...prev, optimistic]);

    try {
      const res  = await apiFetch(`/api/shared-todo/${connectionId}`, {
        method: 'POST',
        body:   JSON.stringify({ text, position: items.length }),
      });
      if (!res.ok) throw new Error();
      const real = await res.json() as SharedTodoItem;
      setItems(prev => prev.map(i => i.id === optimisticId ? real : i));
    } catch {
      // Revert optimistic item on failure
      setItems(prev => prev.filter(i => i.id !== optimisticId));
    }
  }

  async function handleToggle(item: SharedTodoItem) {
    const next = { ...item, completed: !item.completed };
    setItems(prev => prev.map(i => i.id === item.id ? next : i));
    try {
      const res = await apiFetch(`/api/shared-todo/${connectionId}/${item.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ completed: next.completed }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json() as SharedTodoItem;
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? item : i));
    }
  }

  async function handleDelete(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await apiFetch(`/api/shared-todo/${connectionId}/${itemId}`, { method: 'DELETE' });
    } catch {
      // Best-effort — SSE broadcast will reconcile if needed
    }
  }

  // ── Connection dissolved state ───────────────────────────────────────────────
  if (dissolved) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
        <span style={{ fontSize: 28 }}>🔗</span>
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Shared list unavailable</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This connection has ended. The shared list can no longer be accessed.
        </p>
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg mt-1"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', cursor: 'pointer' }}
        >
          Remove widget
        </button>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (!loading && error) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{error}</p>
      </div>
    );
  }

  const activeTodos    = items.filter(i => !i.completed);
  const completedTodos = items.filter(i => i.completed);

  function renderItem(item: SharedTodoItem) {
    const isMe = item.createdBy === myId;
    return (
      <div
        key={item.id}
        className="flex items-start gap-2 px-2 py-1.5 rounded-lg mb-1 group transition-all"
        style={{ background: item.completed ? 'transparent' : 'var(--row-bg)' }}
      >
        {/* Checkbox */}
        <button
          onClick={() => handleToggle(item)}
          className="mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            borderColor: item.completed ? 'var(--teal)' : 'var(--border-hover)',
            background:  item.completed ? 'var(--teal-dim)' : 'transparent',
            cursor: 'pointer',
          }}
        >
          {item.completed && <span style={{ color: 'var(--teal)', fontSize: '10px' }}>✓</span>}
        </button>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <span
            className="text-xs leading-relaxed block"
            style={{
              color:          item.completed ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: item.completed ? 'line-through' : 'none',
              fontSize:       '12px',
            }}
          >
            {item.text}
          </span>
        </div>

        {/* Created-by dot: teal = me, purple = partner */}
        {!item.completed && (
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
            title={isMe ? 'Added by you' : `Added by ${partnerName}`}
            style={{ background: isMe ? MY_COLOR : PARTNER_COLOR, opacity: 0.8 }}
          />
        )}

        {/* Delete — visible on hover */}
        <button
          onClick={() => handleDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-faint)', fontSize: '11px', padding: '0 2px', lineHeight: 1,
          }}
          title="Delete"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Shared-with header */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}
      >
        {/* Presence dot */}
        <span
          style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background:  isOnline ? '#22c55e' : 'var(--text-faint)',
            boxShadow:   isOnline ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
            display: 'inline-block',
          }}
        />
        <span
          className="text-xs truncate"
          style={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'monospace' }}
        >
          Shared with <span style={{ color: 'var(--text)' }}>{partnerName}</span>
        </span>
        {/* Legend dots */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: MY_COLOR, display: 'inline-block' }} title="Your items" />
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PARTNER_COLOR, display: 'inline-block' }} title={`${partnerName}'s items`} />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pt-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          </div>
        ) : activeTodos.length === 0 && completedTodos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>✅</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing here yet — add the first item!</p>
          </div>
        ) : (
          <>
            {activeTodos.map(renderItem)}
            {completedTodos.length > 0 && (
              <>
                <div className="my-1.5 border-t" style={{ borderColor: 'var(--border)' }} />
                {completedTodos.slice(0, 3).map(renderItem)}
              </>
            )}
          </>
        )}
      </div>

      {/* Add area */}
      <div
        className="px-2 pb-2 pt-1 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Quick add…"
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)', border: 'none', caretColor: 'var(--teal)', fontSize: '12px' }}
          />
          <button
            onClick={handleAdd}
            className="text-xs px-2 py-0.5 rounded transition-colors"
            style={{
              background: newText.trim() ? 'var(--teal-dim)' : 'transparent',
              color:      newText.trim() ? 'var(--teal)' : 'var(--text-faint)',
              border: 'none', cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
