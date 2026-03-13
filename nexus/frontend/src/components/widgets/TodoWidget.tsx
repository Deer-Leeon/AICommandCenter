import { useState, useEffect } from 'react';
import { useTodos } from '../../hooks/useTodos';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import type { TodoItem } from '../../types';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3de8b0',
};

const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

function formatDue(dueDate: string, dueTime?: string): { label: string; overdue: boolean } {
  const today = getTodayStr();
  const overdue = dueDate < today;

  const dateObj = new Date(dueDate + 'T00:00:00');
  const label = dateObj.toLocaleDateString('en-US', {
    timeZone: USER_TIMEZONE,
    month: 'short',
    day: 'numeric',
  });

  if (dueTime) {
    const [h, m] = dueTime.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return { label: `${label} ${hour}:${m.toString().padStart(2, '0')} ${ampm}`, overdue };
  }

  return { label, overdue };
}

interface TodoWidgetProps {
  onClose: () => void;
}

export function TodoWidget({ onClose: _onClose }: TodoWidgetProps) {
  const { todos, createTodo, toggleTodo, removeTodo, hasLoaded } = useTodos();
  useWidgetReady('todo', hasLoaded);

  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDueTime, setNewDueTime] = useState('');
  const [showDateRow, setShowDateRow] = useState(false);
  // 'synced' | 'needsScope' | null
  const [calSyncStatus, setCalSyncStatus] = useState<'synced' | 'needsScope' | null>(null);

  // Auto-clear the calendar sync banner after 4 seconds
  useEffect(() => {
    if (!calSyncStatus) return;
    const t = setTimeout(() => setCalSyncStatus(null), 4000);
    return () => clearTimeout(t);
  }, [calSyncStatus]);

  async function handleAdd() {
    if (!newText.trim()) return;
    const result = await createTodo(
      newText.trim(),
      newPriority,
      newDueDate || undefined,
      newDueTime || undefined
    );
    setNewText('');
    setNewDueDate('');
    setNewDueTime('');
    setShowDateRow(false);
    setNewPriority('medium');

    if (newDueDate) {
      setCalSyncStatus(result.needsGoogleScope ? 'needsScope' : 'synced');
    }
  }

  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);

  function renderTodo(todo: TodoItem) {
    const due = todo.dueDate ? formatDue(todo.dueDate, todo.dueTime) : null;

    return (
      <div
        key={todo.id}
        className="flex items-start gap-2 px-2 py-1.5 rounded-lg mb-1 group transition-all"
        style={{ background: todo.completed ? 'transparent' : 'var(--row-bg)' }}
      >
        {/* Checkbox */}
        <button
          onClick={() => toggleTodo(todo.id)}
          className="mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            borderColor: todo.completed ? 'var(--teal)' : 'var(--border-hover)',
            background: todo.completed ? 'var(--teal-dim)' : 'transparent',
            cursor: 'pointer',
          }}
        >
          {todo.completed && <span style={{ color: 'var(--teal)', fontSize: '10px' }}>✓</span>}
        </button>

        {/* Text + due date */}
        <div className="flex-1 min-w-0">
          <span
            className="text-xs leading-relaxed block"
            style={{
              color: todo.completed ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: todo.completed ? 'line-through' : 'none',
              fontSize: '12px',
            }}
          >
            {todo.text}
          </span>

          {due && !todo.completed && (
            <span
              className="font-mono"
              style={{
                fontSize: '10px',
                color: due.overdue ? 'var(--color-danger)' : 'var(--text-faint)',
              }}
            >
              {due.overdue ? '⚠ ' : '📅 '}
              {due.label}
            </span>
          )}
        </div>

        {/* Priority dot */}
        {!todo.completed && todo.priority && (
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
            style={{ background: PRIORITY_COLORS[todo.priority] ?? 'var(--text-faint)' }}
          />
        )}

        {/* Delete — visible on hover */}
        <button
          onClick={() => removeTodo(todo.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-faint)',
            fontSize: '11px',
            padding: '0 2px',
            lineHeight: 1,
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
      {/* List */}
      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pt-2">
        {activeTodos.length === 0 && completedTodos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>✅</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>All done!</p>
          </div>
        ) : (
          <>
            {activeTodos.map(renderTodo)}
            {completedTodos.length > 0 && (
              <>
                <div className="my-1.5 border-t" style={{ borderColor: 'var(--border)' }} />
                {completedTodos.slice(0, 3).map(renderTodo)}
              </>
            )}
          </>
        )}
      </div>

      {/* Add area */}
      <div
        className="px-2 pb-2 pt-1 flex-shrink-0 flex flex-col gap-1"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {/* Calendar sync feedback banner */}
        {calSyncStatus && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
            style={{
              background: calSyncStatus === 'synced' ? 'var(--teal-dim)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${calSyncStatus === 'synced' ? 'rgba(var(--teal-rgb),0.3)' : 'rgba(245,158,11,0.3)'}`,
              fontSize: '10px',
              color: calSyncStatus === 'synced' ? 'var(--teal)' : 'var(--color-warning)',
              fontFamily: 'monospace',
            }}
          >
            {calSyncStatus === 'synced' ? (
              <>✓ Added to Google Calendar Tasks</>
            ) : (
              <>⚠ Reconnect Google to enable Calendar sync</>
            )}
          </div>
        )}

        {/* Date / time / priority rows — shown when calendar icon is clicked */}
        {showDateRow && (
          <>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="flex-1 min-w-0 bg-transparent outline-none"
                style={{
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: '11px',
                }}
              />
              <input
                type="time"
                value={newDueTime}
                onChange={(e) => setNewDueTime(e.target.value)}
                className="bg-transparent outline-none"
                style={{
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: '11px',
                  width: '80px',
                  flexShrink: 0,
                }}
              />
            </div>
            {/* Google Calendar sync hint */}
            {newDueDate && (
              <div
                className="flex items-center gap-1"
                style={{ color: 'var(--color-google-blue)', fontSize: '10px', fontFamily: 'monospace', opacity: 0.8 }}
              >
                📅 → Google Calendar Task
              </div>
            )}

            {/* Priority — compact H / M / L toggle buttons */}
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-faint)', fontSize: '10px' }}>Priority:</span>
              {(['high', 'medium', 'low'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    border: `1px solid ${PRIORITY_COLORS[p]}`,
                    background: newPriority === p ? `${PRIORITY_COLORS[p]}25` : 'transparent',
                    color: PRIORITY_COLORS[p],
                    cursor: 'pointer',
                    fontWeight: newPriority === p ? 600 : 400,
                  }}
                >
                  {p[0].toUpperCase()}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Main input row */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Quick add..."
            className="flex-1 bg-transparent outline-none text-xs"
            style={{
              color: 'var(--text)',
              border: 'none',
              caretColor: 'var(--teal)',
              fontSize: '12px',
            }}
          />

          {/* Calendar toggle */}
          <button
            onClick={() => setShowDateRow((v) => !v)}
            title="Set due date"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              opacity: showDateRow ? 1 : 0.4,
              padding: '0 2px',
              lineHeight: 1,
            }}
          >
            📅
          </button>

          {/* Add button */}
          <button
            onClick={handleAdd}
            className="text-xs px-2 py-0.5 rounded transition-colors"
            style={{
              background: newText.trim() ? 'var(--teal-dim)' : 'transparent',
              color: newText.trim() ? 'var(--teal)' : 'var(--text-faint)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
