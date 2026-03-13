import { useState } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS } from '../types';

interface Props {
  order: WidgetType[];
  onConfirm: (newOrder: WidgetType[]) => void;
  onCancel: () => void;
}

export function MobileArrangeMode({ order, onConfirm, onCancel }: Props) {
  const [working, setWorking] = useState([...order]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function handleDragStart(i: number) { setDragging(i); }

  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragging === null || dragging === i) return;
    setDragOver(i);
  }

  function handleDrop(i: number) {
    if (dragging === null || dragging === i) { setDragging(null); setDragOver(null); return; }
    const next = [...working];
    const [moved] = next.splice(dragging, 1);
    next.splice(i, 0, moved);
    setWorking(next);
    setDragging(null);
    setDragOver(null);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onCancel} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: 14, cursor: 'pointer', padding: '8px 0', minWidth: 44, minHeight: 44,
        }}>Cancel</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          Arrange Cards
        </div>
        <button onClick={() => onConfirm(working)} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          padding: '8px 14px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14,
          minHeight: 44,
        }}>Done ✓</button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 20px 6px', fontFamily: 'var(--font-mono)' }}>
        Drag to reorder — leftmost card shows first
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {working.map((widgetType, i) => {
          const cfg = WIDGET_CONFIGS.find(c => c.id === widgetType);
          const isDraggingThis = dragging === i;
          const isDragOver = dragOver === i;
          return (
            <div
              key={widgetType}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragging(null); setDragOver(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 14, marginBottom: 6,
                background: isDragOver ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(255,255,255,0.04)',
                border: isDragOver ? '2px solid rgba(var(--accent-rgb),0.4)' : '2px solid transparent',
                opacity: isDraggingThis ? 0.4 : 1,
                cursor: 'grab',
                transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
                userSelect: 'none',
              }}
            >
              <span style={{ fontSize: 28 }}>{cfg?.icon ?? '🔧'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{cfg?.label ?? widgetType}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Position {i + 1}
                </div>
              </div>
              {/* Drag handle */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.4 }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{ width: 20, height: 2, background: 'var(--text-muted)', borderRadius: 1 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
