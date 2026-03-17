import { useState, useEffect } from 'react';
import { useMobileCardOrder } from './useMobileCardOrder';
import { MobileCardStack } from './MobileCardStack';
import { MobileBottomBar } from './MobileBottomBar';
import { MobileSearchOverlay } from './MobileSearchOverlay';
import { MobileLayoutEditor } from './MobileLayoutEditor';
import { SettingsModal } from '../components/SettingsModal';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { isCapacitor } from '../lib/isCapacitor';
import { registerPushNotifications, onKeyboardShow, onKeyboardHide } from '../lib/capacitorBridge';
import { apiFetch } from '../lib/api';
import type { WidgetType } from '../types';

const BOTTOM_BAR_H = 56;

export default function MobileApp() {
  const { order, setOrder, lastAutoReorder } = useMobileCardOrder();
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const [showSearch, setShowSearch]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { pages, activePage, setActivePage } = useStore();
  const { user } = useAuth();

  // ── Capacitor: push notifications + keyboard avoidance ──────────────────
  useEffect(() => {
    if (!isCapacitor()) return;

    // Request push permission on first authenticated launch; send token to backend
    if (user) {
      registerPushNotifications().then(async (token) => {
        if (!token) return;
        try {
          await apiFetch('/api/push/register', {
            method: 'POST',
            body: JSON.stringify({ token, platform: 'ios' }),
          });
        } catch { /* non-fatal */ }
      });
    }

    // Shift card content up when keyboard appears so focused inputs stay visible
    onKeyboardShow((height) => setKeyboardHeight(height));
    onKeyboardHide(() => setKeyboardHeight(0));
  }, [user]);

  function handleLayoutSave(newOrder: WidgetType[], _newActiveIdx: number) {
    setOrder(newOrder);
  }

  return (
    <div
      className="nexus-mobile"
      style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top)',
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px 4px', flexShrink: 0, zIndex: 150,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--accent)', letterSpacing: '0.18em', fontWeight: 700,
          textShadow: '0 0 12px rgba(var(--accent-rgb),0.4)',
        }}>
          NEXUS
        </div>

        <button
          onClick={() => setShowLayoutEditor(true)}
          style={{
            background: 'rgba(var(--accent-rgb),0.1)',
            border: '1px solid rgba(var(--accent-rgb),0.25)',
            borderRadius: 10, padding: '6px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', minHeight: 36,
          }}
        >
          <span style={{ fontSize: 14 }}>⊞</span>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            Layout
          </span>
        </button>
      </div>

      {/* ── Page selector ───────────────────────────────────────────────── */}
      {pages.length > 1 && (
        <div style={{
          display: 'flex', overflowX: 'auto', gap: 6,
          padding: '0 14px 6px', scrollbarWidth: 'none', flexShrink: 0,
        }}>
          {pages.map((page) => {
            const isActive = page.id === activePage;
            return (
              <button
                key={page.id}
                onClick={() => setActivePage(page.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap',
                  border: isActive ? '1px solid rgba(var(--accent-rgb),0.5)' : '1px solid var(--border)',
                  background: isActive ? 'rgba(var(--accent-rgb),0.12)' : 'var(--surface)',
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 14 }}>{page.emoji}</span>
                {page.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Card stack ───────────────────────────────────────────────────── */}
      {/* paddingBottom shifts cards up when the iOS keyboard is open so
          focused inputs inside cards are never hidden behind the keyboard */}
      <div style={{
        flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        minHeight: 0, padding: '4px 0 4px',
        paddingBottom: keyboardHeight > 0 ? keyboardHeight : undefined,
        transition: 'padding-bottom 0.25s ease',
      }}>
        <MobileCardStack order={order} />
      </div>

      {/* ── Bottom bar ───────────────────────────────────────────────────── */}
      <MobileBottomBar
        onOpenSearch={() => setShowSearch(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      {showLayoutEditor && (
        <MobileLayoutEditor
          order={order}
          activeIdx={0}
          onConfirm={handleLayoutSave}
          onClose={() => setShowLayoutEditor(false)}
        />
      )}

      {showSearch && <MobileSearchOverlay onClose={() => setShowSearch(false)} />}

      {showSettings && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: '20px 20px 0 0',
              maxHeight: '90dvh', overflow: 'auto',
              paddingBottom: 'env(safe-area-inset-bottom)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-hover)' }} />
            </div>
            <SettingsModal onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}

      {/* Auto-reorder toast */}
      {lastAutoReorder && (
        <div style={{
          position: 'fixed',
          bottom: `calc(${BOTTOM_BAR_H}px + 12px + env(safe-area-inset-bottom))`,
          left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bar-bg)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--border)', borderRadius: 20,
          padding: '8px 16px', fontSize: 13, color: 'var(--text)',
          whiteSpace: 'nowrap', zIndex: 300,
          boxShadow: '0 4px 16px var(--side-shadow)',
          animation: 'mobileFadeToast 0.3s ease both',
        }}>
          {lastAutoReorder}
        </div>
      )}

      <style>{`
        @keyframes mobileFadeToast {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        /* ── Dark theme (default) ── */
        .nexus-mobile {
          --bg:           #0a0a0f;
          --surface:      #111118;
          --surface2:     #1a1a24;
          --surface3:     #22222e;
          --accent:       #7c6aff;
          --accent-dim:   rgba(124,106,255,0.15);
          --accent-rgb:   124,106,255;
          --teal:         #3de8b0;
          --teal-rgb:     61,232,176;
          --text:         #e8e8f0;
          --text-muted:   #7a7a90;
          --text-faint:   #3a3a50;
          --border:       rgba(255,255,255,0.07);
          --border-hover: rgba(255,255,255,0.14);
          --card-border:  rgba(255,255,255,0.09);
          --card-shadow:  rgba(0,0,0,0.55);
          --side-shadow:  rgba(0,0,0,0.35);
          --divider:      rgba(255,255,255,0.05);
          --bar-bg:       rgba(17,17,24,0.85);
        }

        /* ── Light theme override ── */
        @media (prefers-color-scheme: light) {
          .nexus-mobile {
            --bg:           #f0f0f6;
            --surface:      #ffffff;
            --surface2:     #f5f5fb;
            --surface3:     #ebebf4;
            --accent:       #6355e8;
            --accent-dim:   rgba(99,85,232,0.12);
            --accent-rgb:   99,85,232;
            --teal:         #10b981;
            --teal-rgb:     16,185,129;
            --text:         #111128;
            --text-muted:   #6b6b88;
            --text-faint:   #b0b0c8;
            --border:       rgba(0,0,0,0.07);
            --border-hover: rgba(0,0,0,0.14);
            --card-border:  rgba(0,0,0,0.08);
            --card-shadow:  rgba(0,0,0,0.14);
            --side-shadow:  rgba(0,0,0,0.10);
            --divider:      rgba(0,0,0,0.06);
            --bar-bg:       rgba(248,248,253,0.88);
          }
        }
      `}</style>
    </div>
  );
}
