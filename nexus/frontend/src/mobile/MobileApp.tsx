import { useState, useEffect, useCallback } from 'react';
import { useMobileCardOrder } from './useMobileCardOrder';
import { MobileCardStack } from './MobileCardStack';
import { MobileBottomBar } from './MobileBottomBar';
import { MobileSearchOverlay } from './MobileSearchOverlay';
import { MobileLayoutEditor, LAUNCH_FULLSCREEN_KEY } from './MobileLayoutEditor';
import { MobileCardContent } from './cards/MobileCardRegistry';
import { SettingsModal } from '../components/SettingsModal';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { isCapacitor } from '../lib/isCapacitor';
import { registerPushNotifications, onKeyboardShow, onKeyboardHide } from '../lib/capacitorBridge';
import { apiFetch } from '../lib/api';
import type { WidgetType } from '../types';

export default function MobileApp() {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';

  const { order, setOrder } = useMobileCardOrder();
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const [showSearch, setShowSearch]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsVisible, setFsVisible]       = useState(false); // drives enter/exit CSS animation
  const [activeWidget, setActiveWidget] = useState<WidgetType>(order[0]);
  const { pages, activePage, setActivePage } = useStore();
  const { user } = useAuth();

  const handleActiveWidgetChange = useCallback((w: WidgetType) => {
    setActiveWidget(w);
  }, []);

  const enterFullscreen = useCallback(() => {
    setIsFullscreen(true);
    requestAnimationFrame(() => setFsVisible(true));
  }, []);

  const exitFullscreen = useCallback(() => {
    setFsVisible(false);
    setTimeout(() => setIsFullscreen(false), 380);
  }, []);

  // Apply launch-fullscreen preference on first mount
  useEffect(() => {
    try {
      if (localStorage.getItem(LAUNCH_FULLSCREEN_KEY) === 'true') {
        enterFullscreen();
      }
    } catch { /* ignore */ }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {/* ── Top bar (slides off top in fullscreen) ───────────────────────── */}
      <div style={{
        flexShrink: 0, overflow: 'hidden',
        transform: isFullscreen ? 'translateY(-100%)' : 'translateY(0)',
        opacity: isFullscreen ? 0 : 1,
        transition: 'transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.3s ease',
        pointerEvents: isFullscreen ? 'none' : undefined,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px 4px', zIndex: 150,
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

        {/* ── Page selector ─────────────────────────────────────────────── */}
        {pages.length > 1 && (
          <div style={{
            display: 'flex', overflowX: 'auto', gap: 6,
            padding: '0 14px 6px', scrollbarWidth: 'none',
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
      </div>

      {/* ── Card stack ───────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        minHeight: 0, padding: '4px 0 4px',
        paddingBottom: keyboardHeight > 0 ? keyboardHeight : undefined,
        transition: 'padding-bottom 0.25s ease',
      }}>
        <MobileCardStack
          order={order}
          onActiveWidgetChange={handleActiveWidgetChange}
        />
      </div>

      {/* ── Bottom bar (slides off bottom in fullscreen) ──────────────────── */}
      <div style={{
        flexShrink: 0,
        transform: isFullscreen ? 'translateY(100%)' : 'translateY(0)',
        opacity: isFullscreen ? 0 : 1,
        transition: 'transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.3s ease',
        pointerEvents: isFullscreen ? 'none' : undefined,
      }}>
        <MobileBottomBar
          onOpenSearch={() => setShowSearch(true)}
          onOpenSettings={() => setShowSettings(true)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={isFullscreen ? exitFullscreen : enterFullscreen}
        />
      </div>

      {/* ── Fullscreen widget overlay ─────────────────────────────────────── */}
      {isFullscreen && activeWidget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 400,
            background: 'var(--bg)',
            display: 'flex', flexDirection: 'column',
            // Entry: scale up from 90% + fade; Exit: scale down + fade
            transform: fsVisible ? 'scale(1)' : 'scale(0.92)',
            opacity: fsVisible ? 1 : 0,
            transition: 'transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.32s ease',
            borderRadius: fsVisible ? 0 : 22,
          }}
        >
          {/* Widget fills the entire overlay */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <MobileCardContent widgetType={activeWidget} />
          </div>

          {/* Floating restore button — bottom-right corner */}
          <button
            onPointerDown={exitFullscreen}
            style={{
              position: 'absolute',
              bottom: `calc(20px + env(safe-area-inset-bottom))`,
              right: 18,
              width: 46, height: 46,
              borderRadius: 23,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.16)',
              color: 'rgba(255,255,255,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              // Delay appearance so it doesn't flash during entry animation
              opacity: fsVisible ? 1 : 0,
              transition: 'opacity 0.3s ease 0.2s',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
            aria-label="Exit fullscreen"
          >
            {/* Collapse arrows SVG */}
            <svg width="18" height="18" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 1v5H1M6 6L1.5 1.5" />
              <path d="M11 1v5h5M11 6l4.5-4.5" />
              <path d="M6 16v-5H1M6 11l-4.5 4.5" />
              <path d="M11 16v-5h5M11 11l4.5 4.5" />
            </svg>
          </button>
        </div>
      )}

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

      <style>{`
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

        ${isLight ? `
        /* ── Light theme override (driven by useTheme, not media query) ── */
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
        ` : ''}
      `}</style>
    </div>
  );
}
