import { useState, useEffect, useRef, useMemo } from 'react';
import { WIDGET_CONFIGS, type WidgetConfig, type WidgetType } from '../types';

const CATEGORY_ORDER: WidgetConfig['category'][] = ['Work', 'Music', 'Finance', 'Games', 'Info', 'Tools'];

const CATEGORY_DESCRIPTIONS: Record<WidgetConfig['category'], string> = {
  Work:    'Stay on top of tasks and schedule',
  Music:   'Music and ambient sound',
  Finance: 'Track spending and markets',
  Games:   'Games and skill training',
  Info:    'Weather and news at a glance',
  Tools:   'Notes, links, and knowledge',
};

interface WidgetPickerModalProps {
  targetCell: { row: number; col: number } | null;
  onPlace: (widgetId: WidgetType, row: number, col: number) => void;
  onClose: () => void;
}

export function WidgetPickerModal({ targetCell, onPlace, onClose }: WidgetPickerModalProps) {
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WIDGET_CONFIGS;
    return WIDGET_CONFIGS.filter(
      c => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<WidgetConfig['category'], WidgetConfig[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const c of filtered) map.get(c.category)?.push(c);
    return map;
  }, [filtered]);

  const hasResults = filtered.length > 0;

  function handlePlace(widgetId: WidgetType) {
    if (!targetCell) return;
    onPlace(widgetId, targetCell.row, targetCell.col);
    onClose();
  }

  return (
    <>
      <style>{`
        @keyframes pickerFadeIn {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
        .widget-picker-card:hover {
          background: var(--surface3) !important;
          transform: translateY(-1px);
        }
        .widget-picker-card {
          transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 201,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
          pointerEvents: 'none',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            pointerEvents: 'auto',
            width: '100%', maxWidth: '620px',
            height: '75vh',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            animation: 'pickerFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '20px 20px 0',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  Add Widget
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  Click a widget to place it on the dashboard
                </p>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: '8px', width: '28px', height: '28px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--text-faint)', fontSize: '14px',
                  flexShrink: 0, transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--surface3)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--surface2)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)';
                }}
              >
                ✕
              </button>
            </div>

            {/* Search bar */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <span style={{
                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '14px', color: 'var(--text-faint)', pointerEvents: 'none', lineHeight: 1,
              }}>
                🔍
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search widgets…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '10px 12px 10px 36px',
                  fontSize: '13px', color: 'var(--text)',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,106,255,0.12)';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-faint)', fontSize: '12px', padding: '2px 4px',
                    borderRadius: '4px', lineHeight: 1,
                  }}
                >✕</button>
              )}
            </div>

            {/* Thin rule */}
            <div style={{ height: '1px', background: 'var(--border)', margin: '0 -20px' }} />
          </div>

          {/* Scrollable widget list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }} className="nexus-scroll">
            {!hasResults && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: '13px' }}>
                No widgets match "{query}"
              </div>
            )}

            {CATEGORY_ORDER.map(cat => {
              const configs = grouped.get(cat) ?? [];
              if (configs.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: '22px' }}>
                  {/* Category header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: 'var(--text-faint)', fontFamily: 'var(--font-mono)',
                    }}>
                      {cat}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                    <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                      {CATEGORY_DESCRIPTIONS[cat]}
                    </span>
                  </div>

                  {/* Widget cards */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: '8px',
                  }}>
                    {configs.map(config => (
                      <button
                        key={config.id}
                        className="widget-picker-card"
                        onClick={() => handlePlace(config.id)}
                        onMouseEnter={() => setHoveredId(config.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '10px 12px',
                          background: 'var(--surface2)',
                          border: `1px solid ${hoveredId === config.id ? config.accentColor + '40' : 'var(--border)'}`,
                          borderRadius: '10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          boxShadow: hoveredId === config.id
                            ? `0 0 0 3px ${config.accentColor}12, 0 4px 12px rgba(0,0,0,0.2)`
                            : 'none',
                        }}
                      >
                        {/* Icon */}
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '8px',
                          background: config.accentColor + '18',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '16px', flexShrink: 0,
                          border: `1px solid ${config.accentColor}20`,
                        }}>
                          {config.icon}
                        </div>
                        {/* Label */}
                        <div style={{ minWidth: 0 }}>
                          <p style={{
                            margin: 0, fontSize: '12px', fontWeight: 600,
                            color: 'var(--text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {config.label}
                          </p>
                          <p style={{
                            margin: '1px 0 0', fontSize: '10px',
                            color: config.accentColor,
                            fontFamily: 'var(--font-mono)',
                            opacity: 0.8,
                          }}>
                            {cat}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
