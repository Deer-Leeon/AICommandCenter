import { useState, useRef } from 'react';
import { useTodos } from '../../hooks/useTodos';
import type { TodoItem } from '../../types';

function TodoRow({ item, onToggle, onDelete }: { item: TodoItem; onToggle: () => void; onDelete: () => void }) {
  const startXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, marginBottom: 6 }}
      onPointerDown={e => { startXRef.current = e.clientX; setSwiping(true); }}
      onPointerMove={e => {
        if (!swiping) return;
        const dx = e.clientX - startXRef.current;
        if (dx < 0) setSwipeX(dx);
      }}
      onPointerUp={() => {
        if (swipeX < -80) { onDelete(); }
        setSwipeX(0);
        setSwiping(false);
      }}
      onPointerLeave={() => { setSwipeX(0); setSwiping(false); }}
    >
      {/* Delete background */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        background: '#ef4444', display: 'flex', alignItems: 'center',
        paddingRight: 16, borderRadius: 10,
        opacity: Math.min(1, Math.abs(swipeX) / 80),
      }}>
        <span style={{ fontSize: 16 }}>🗑</span>
      </div>

      {/* Row content */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        transform: `translateX(${swipeX}px)`,
        transition: swiping ? 'none' : 'transform 0.2s ease',
        cursor: 'pointer',
      }}
        onClick={onToggle}
      >
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${item.completed ? 'var(--accent-teal)' : 'var(--border-hover)'}`,
          background: item.completed ? 'var(--accent-teal)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}>
          {item.completed && <span style={{ fontSize: 12, color: '#0a0a0f' }}>✓</span>}
        </div>
        <span style={{
          fontSize: 15, color: item.completed ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: item.completed ? 'line-through' : 'none',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.text}
        </span>
      </div>
    </div>
  );
}

export function MobileTodoCard() {
  const { todos, toggleTodo, removeTodo, createTodo } = useTodos();
  const [newText, setNewText] = useState('');

  const incomplete = todos.filter(t => !t.completed);
  const complete = todos.filter(t => t.completed).slice(0, 5);

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText('');
    await createTodo(text);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 20px 12px' }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        To-Do · {incomplete.length} remaining
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {incomplete.map(t => (
          <TodoRow key={t.id} item={t} onToggle={() => toggleTodo(t.id)} onDelete={() => removeTodo(t.id)} />
        ))}

        {complete.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', margin: '12px 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Completed
            </div>
            {complete.map(t => (
              <TodoRow key={t.id} item={t} onToggle={() => toggleTodo(t.id)} onDelete={() => removeTodo(t.id)} />
            ))}
          </>
        )}
      </div>

      {/* Add input */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Add a task…"
          style={{
            flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 12px', fontSize: 14, color: 'var(--text)',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleAdd}
          style={{
            background: 'var(--accent)', border: 'none', borderRadius: 10,
            width: 44, height: 44, fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}
        >+</button>
      </div>
    </div>
  );
}
