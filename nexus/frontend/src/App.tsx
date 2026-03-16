import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useStore } from './store/useStore';
import { useRevealStore } from './store/useRevealStore';
import { useLayoutPersistence } from './hooks/useLayoutPersistence';
import { useAuth } from './hooks/useAuth';
import { Sidebar } from './components/Sidebar';
import { Grid } from './components/Grid';
import { WidgetCanvas } from './components/WidgetCanvas';
import { GridLayoutMode } from './components/GridLayoutMode';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { RevealOverlay } from './components/RevealOverlay';
import { DevCacheOverlay } from './components/DevCacheOverlay';
import { InviteToast } from './components/InviteToast';
import { TodoSetupModal }       from './components/TodoSetupModal';
import { ChessSetupModal }      from './components/ChessSetupModal';
import { SharedPhotoSetupModal }  from './components/SharedPhotoSetupModal';
import { SharedCanvasSetupModal } from './components/SharedCanvasSetupModal';
import { WidgetPickerModal }   from './components/WidgetPickerModal';
import { PageNavBar }          from './components/PageNavBar';
import { devBootCheck } from './lib/devUtils';
import { nexusSSE } from './lib/nexusSSE';
import { WIDGET_CONFIGS, type WidgetType } from './types';
import { prefetchConnections } from './hooks/useConnections';
import { prefetchProfile } from './hooks/useProfile';

const REVEAL_TIMEOUT = 1_200;

export default function App() {
  const {
    placeWidget, setWidgetConnection, refreshServiceStatus,
    layoutLoaded, grid,
    pages, activePage, setActivePage,
    pageTransitionDir,
  } = useStore();
  const { initPending, startReveal } = useRevealStore();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<WidgetType | null>(null);
  const [gridRef, setGridRef] = useState<HTMLElement | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ widgetId: WidgetType; row: number; col: number; slotKey: string } | null>(null);
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pickerCell, setPickerCell] = useState<{ row: number; col: number } | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'account' | 'permissions' | 'connections' | 'animation' | 'searchbar' | 'widgets'
  >('account');

  useEffect(() => {
    if (!user) return;
    nexusSSE.start();
    return () => nexusSSE.stop();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    prefetchProfile();
    prefetchConnections();
  }, [user]);

  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutPersistence(user?.id);

  useLayoutEffect(() => {
    if (!layoutLoaded) return;

    const widgetTypes = [...new Set(
      Object.values(grid).filter(Boolean)
    )] as WidgetType[];

    initPending(widgetTypes);

    revealTimeoutRef.current = setTimeout(startReveal, REVEAL_TIMEOUT);

    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  // Run once when layoutLoaded first becomes true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded]);

  useEffect(() => {
    refreshServiceStatus();
    const interval = setInterval(refreshServiceStatus, 60_000);
    return () => clearInterval(interval);
  }, [refreshServiceStatus]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const widgetTypes = [...new Set(Object.values(grid).filter(Boolean))] as string[];
    devBootCheck(widgetTypes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleCalOk    = params.get('google_calendar_connected') === 'true';
    const googleTasksOk  = params.get('google_tasks_connected') === 'true';
    const googleDocsOk   = params.get('google_docs_connected') === 'true';
    const googleDriveOk  = params.get('google_drive_connected') === 'true';
    const googleOk       = params.get('google_connected') === 'true';
    const slackOk        = params.get('slack_connected') === 'true';
    const anySuccess = googleCalOk || googleTasksOk || googleDocsOk || googleDriveOk || googleOk || slackOk;
    const hasOAuthParams = anySuccess ||
      params.has('google_error') || params.has('slack_error') || params.has('auth_error');

    if (hasOAuthParams) {
      window.history.replaceState({}, '', '/');
      refreshServiceStatus();
      if (anySuccess) setShowSettings(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts for page navigation ────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (pages.length <= 1) return;

      const curIdx = pages.findIndex((p) => p.id === activePage);

      // Ctrl+] or Ctrl+Tab → next page
      if (e.key === ']' || (e.key === 'Tab' && !e.shiftKey)) {
        // Don't intercept plain Ctrl+Tab (browser tab switching)
        if (e.key === ']') {
          e.preventDefault();
          const next = (curIdx + 1) % pages.length;
          setActivePage(pages[next].id);
        }
        return;
      }

      // Ctrl+[ or Ctrl+Shift+Tab → prev page
      if (e.key === '[' || (e.key === 'Tab' && e.shiftKey)) {
        if (e.key === '[') {
          e.preventDefault();
          const prev = (curIdx - 1 + pages.length) % pages.length;
          setActivePage(pages[prev].id);
        }
        return;
      }

      // Ctrl+1–9 → jump to page
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && pages[num - 1]) {
        e.preventDefault();
        setActivePage(pages[num - 1].id);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pages, activePage, setActivePage]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as WidgetType);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const widgetId = active.id as WidgetType;
    const cellKey  = over.id as string;
    const [rowStr, colStr] = cellKey.split(',');
    const row = parseInt(rowStr, 10);
    const col = parseInt(colStr, 10);

    if (isNaN(row) || isNaN(col)) return;

    if (widgetId === 'todo' || widgetId === 'shared_chess' || widgetId === 'shared_photo' || widgetId === 'shared_canvas') {
      setPendingDrop({ widgetId, row, col, slotKey: cellKey });
      return;
    }

    placeWidget(widgetId, row, col);
  }

  const activeDragConfig = activeDragId
    ? WIDGET_CONFIGS.find((w) => w.id === activeDragId)
    : null;

  if (!layoutLoaded) return null;

  // Is the active page empty?
  const isPageEmpty = Object.keys(grid).length === 0;

  // Page transition animation class for the active page key
  const pageClassName = pageTransitionDir
    ? `page-enter-${pageTransitionDir}`
    : '';

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="flex h-screen w-screen overflow-hidden relative"
        style={{ background: 'var(--bg)', zIndex: 1 }}
      >
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          onOpenSettings={() => { setSettingsInitialTab('account'); setShowSettings(true); }}
          onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
          layoutMode={showLayoutEditor}
          onExitLayout={() => setShowLayoutEditor(false)}
        />

        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div
            className="flex-1 relative"
            ref={(el) => setGridRef(el)}
            style={{ containerType: 'size', overflow: 'clip', isolation: 'isolate' }}
          >
            {/* Page content — keyed on activePage so widgets unmount/remount on switch.
                Only Grid and WidgetCanvas are inside the key boundary; modals and the
                RevealOverlay remain mounted outside it so they are unaffected. */}
            <div key={activePage} className={pageClassName} style={{ position: 'absolute', inset: 0 }}>
              <Grid onOpenPicker={(row, col) => setPickerCell({ row, col })} />
              <WidgetCanvas gridEl={gridRef} />

              {/* Empty-page hint — visible only when the current page has no widgets */}
              {isPageEmpty && (
                <div className="page-empty-hint">
                  <span style={{ fontSize: 40, color: 'var(--accent)', opacity: 0.7 }}>＋</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Add your first widget
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', opacity: 0.6 }}>
                    Open the sidebar → drag a widget here
                  </span>
                </div>
              )}
            </div>

            {showLayoutEditor && <GridLayoutMode onClose={() => setShowLayoutEditor(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} initialTab={settingsInitialTab} />}
            {pickerCell && (
              <WidgetPickerModal
                targetCell={pickerCell}
                onPlace={(widgetId, row, col) => {
                  const slotKey = `${row},${col}`;
                  if (widgetId === 'todo' || widgetId === 'shared_chess' || widgetId === 'shared_photo' || widgetId === 'shared_canvas') {
                    setPendingDrop({ widgetId, row, col, slotKey });
                  } else {
                    placeWidget(widgetId, row, col);
                  }
                }}
                onClose={() => setPickerCell(null)}
              />
            )}

            {pendingDrop?.widgetId === 'todo' && (
              <TodoSetupModal
                onConfirm={(connectionId) => {
                  placeWidget(pendingDrop.widgetId, pendingDrop.row, pendingDrop.col);
                  if (connectionId) setWidgetConnection(pendingDrop.slotKey, connectionId);
                  setPendingDrop(null);
                }}
                onCancel={() => setPendingDrop(null)}
                onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
              />
            )}
            {pendingDrop?.widgetId === 'shared_chess' && (
              <ChessSetupModal
                onConfirm={(connectionId) => {
                  placeWidget(pendingDrop.widgetId, pendingDrop.row, pendingDrop.col);
                  setWidgetConnection(pendingDrop.slotKey, connectionId);
                  setPendingDrop(null);
                }}
                onCancel={() => setPendingDrop(null)}
                onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
              />
            )}
            {pendingDrop?.widgetId === 'shared_photo' && (
              <SharedPhotoSetupModal
                onConfirm={(connectionId) => {
                  placeWidget(pendingDrop.widgetId, pendingDrop.row, pendingDrop.col);
                  setWidgetConnection(pendingDrop.slotKey, connectionId);
                  setPendingDrop(null);
                }}
                onCancel={() => setPendingDrop(null)}
                onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
              />
            )}
            {pendingDrop?.widgetId === 'shared_canvas' && (
              <SharedCanvasSetupModal
                onConfirm={(connectionId) => {
                  placeWidget(pendingDrop.widgetId, pendingDrop.row, pendingDrop.col);
                  setWidgetConnection(pendingDrop.slotKey, connectionId);
                  setPendingDrop(null);
                }}
                onCancel={() => setPendingDrop(null)}
                onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
              />
            )}

            {/* Wave reveal — scoped to the widget grid only */}
            <RevealOverlay />
          </div>

          <StatusBar onLayoutClick={showLayoutEditor ? undefined : () => setShowLayoutEditor(true)} />
        </div>
      </div>

      {/* Page navigation bar — floating pill at bottom center */}
      <PageNavBar />

      <InviteToast
        onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
      />
      <DevCacheOverlay />

      <DragOverlay>
        {activeDragConfig && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono pointer-events-none"
            style={{
              background: 'var(--surface2)',
              border: `1px solid ${activeDragConfig.accentColor}40`,
              transform: 'rotate(-2deg)',
              opacity: 0.85,
              boxShadow: 'var(--shadow-popup)',
              color: 'var(--text)',
            }}
          >
            <span className="text-lg">{activeDragConfig.icon}</span>
            <span>{activeDragConfig.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
