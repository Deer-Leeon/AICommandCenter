import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import type { TaskItem } from '../../types';
import { wcRead, wcWrite, wcIsStale, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

interface Props {
  onClose: () => void;
}

function formatDue(due: string | null | undefined): string {
  if (!due) return '';
  // Google returns "YYYY-MM-DDT00:00:00.000Z" — parse just the date part
  const date = new Date(due);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, tomorrow)) return 'Tomorrow';

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function isOverdue(due: string | null | undefined): boolean {
  if (!due) return false;
  const dueDate = new Date(due);
  const now = new Date();
  // Compare just dates (not time)
  return dueDate.getFullYear() < now.getFullYear() ||
    (dueDate.getFullYear() === now.getFullYear() && dueDate.getMonth() < now.getMonth()) ||
    (dueDate.getFullYear() === now.getFullYear() && dueDate.getMonth() === now.getMonth() && dueDate.getDate() < now.getDate());
}

export function TasksWidget({ onClose: _onClose }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>(
    () => wcRead<TaskItem[]>(WC_KEY.TASKS)?.data ?? [],
  );
  const [loading, setLoading] = useState(
    () => wcRead(WC_KEY.TASKS) === null,
  );
  const [isStale, setIsStale] = useState(
    () => wcIsStale(WC_KEY.TASKS, WC_TTL.TASKS),
  );

  // hasLoaded: immediately true when cache exists (loading=false from init)
  const hasLoaded = !loading;
  useWidgetReady('tasks', hasLoaded);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);
  const [adding, setAdding] = useState(false);

  // Per-task action state
  const [completing, setCompleting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await awaitPrefetchOrFetch('/api/tasks', () => apiFetch('/api/tasks'));
      if (!res.ok) { setError('Failed to load'); return; }
      const data = await res.json() as { tasks: TaskItem[]; needsAuth?: boolean };
      if (data.needsAuth) { setNeedsAuth(true); return; }
      setTasks(data.tasks);
      wcWrite(WC_KEY.TASKS, data.tasks);
      setNeedsAuth(false);
      setError(null);
      setIsStale(false);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showAddRow) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAddRow]);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), dueDate: newDue || undefined }),
      });
      if (!res.ok) throw new Error('Failed to add');
      const created = await res.json() as TaskItem;
      setTasks((prev) => [...prev, created]);
      setNewTitle('');
      setNewDue('');
      setShowAddRow(false);
    } catch {
      setError('Failed to add task');
    } finally {
      setAdding(false);
    }
  };

  const handleComplete = async (id: string) => {
    setCompleting(id);
    try {
      const res = await apiFetch(`/api/tasks/${id}/complete`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed');
      // Remove from list with a brief checkmark animation delay
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError('Failed to complete task');
    } finally {
      setCompleting(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError('Failed to delete task');
    } finally {
      setDeleting(null);
    }
  };

  // ── Connect prompt ──────────────────────────────────────────────────────────
  if (needsAuth) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <span style={{ fontSize: '28px' }}>☑️</span>
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          Google Tasks not connected
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Go to Settings → Permissions to connect Google Tasks
        </p>
      </div>
    );
  }

  // ── Main widget ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ fontSize: '13px', position: 'relative' }}>
      {isStale && (
        <span
          title="Showing cached data — refreshing in background"
          style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, color: 'var(--text-faint)', opacity: 0.7, zIndex: 1 }}
        >
          ↻
        </span>
      )}
      {/* Error banner */}
      {error && (
        <div
          className="mx-3 mt-2 px-3 py-1.5 rounded-lg text-xs font-mono flex items-center justify-between"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          {error}
          <button onClick={() => setError(null)} style={{ cursor: 'pointer', opacity: 0.7 }}>✕</button>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto nexus-scroll px-3 pt-2 pb-1" style={{ minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '24px' }}>☑️</span>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>No tasks — add one below</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {tasks.map((task) => {
              const overdue = isOverdue(task.due);
              const dueLabel = formatDue(task.due);
              const isCompleting = completing === task.id;
              const isDeleting = deleting === task.id;

              return (
                <div
                  key={task.id}
                  className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg group"
                  style={{
                    background: 'var(--row-bg)',
                    border: '1px solid var(--border)',
                    opacity: isCompleting || isDeleting ? 0.4 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => !isCompleting && handleComplete(task.id)}
                    disabled={!!completing || !!deleting}
                    className="flex-shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                    style={{
                      borderColor: isCompleting ? 'var(--teal)' : 'var(--text-faint)',
                      background: isCompleting ? 'var(--teal-dim)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    title="Mark complete"
                  >
                    {isCompleting && (
                      <span style={{ fontSize: '9px', color: 'var(--teal)' }}>✓</span>
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="leading-snug break-words"
                      style={{ color: 'var(--text)', fontWeight: 450 }}
                    >
                      {task.title}
                    </p>
                    {dueLabel && (
                      <p
                        className="font-mono mt-0.5"
                        style={{
                          fontSize: '10px',
                          color: overdue ? 'var(--color-danger)' : 'var(--text-faint)',
                        }}
                      >
                        {overdue ? '⚠ ' : '📅 '}{dueLabel}
                      </p>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => !isDeleting && handleDelete(task.id)}
                    disabled={!!completing || !!deleting}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5"
                    style={{
                      color: 'var(--text-faint)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      lineHeight: 1,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-danger)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                    title="Delete task"
                  >
                    {isDeleting ? '…' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add area */}
      <div
        className="flex-shrink-0 border-t px-3 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        {showAddRow ? (
          <div className="flex flex-col gap-1.5">
            <input
              ref={inputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') { setShowAddRow(false); setNewTitle(''); setNewDue(''); }
              }}
              placeholder="Task title…"
              className="w-full rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none"
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--accent)',
                color: 'var(--text)',
              }}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="flex-1 rounded-lg px-2 py-1 text-xs font-mono outline-none"
                style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  color: newDue ? 'var(--text)' : 'var(--text-faint)',
                  minWidth: 0,
                }}
              />
              <button
                onClick={handleAdd}
                disabled={!newTitle.trim() || adding}
                className="nexus-teal-btn font-mono text-xs px-3 py-1 rounded-lg flex-shrink-0"
                style={{
                  opacity: !newTitle.trim() || adding ? 0.5 : 1,
                  cursor: !newTitle.trim() || adding ? 'not-allowed' : 'pointer',
                }}
              >
                {adding ? '…' : 'Add'}
              </button>
              <button
                onClick={() => { setShowAddRow(false); setNewTitle(''); setNewDue(''); }}
                className="font-mono text-xs px-2 py-1 rounded-lg flex-shrink-0"
                style={{
                  background: 'var(--row-bg)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddRow(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono"
            style={{
              background: 'var(--teal-dim)',
              color: 'var(--teal)',
              border: '1px solid rgba(var(--teal-rgb), 0.2)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.8')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            <span style={{ fontSize: '14px' }}>+</span> Add task
          </button>
        )}
      </div>
    </div>
  );
}
