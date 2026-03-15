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
import { SharedPhotoSetupModal } from './components/SharedPhotoSetupModal';
import { WidgetPickerModal }   from './components/WidgetPickerModal';
import { devBootCheck } from './lib/devUtils';
import { nexusSSE } from './lib/nexusSSE';
import { WIDGET_CONFIGS, type WidgetType } from './types';
import { prefetchConnections } from './hooks/useConnections';
import { prefetchProfile } from './hooks/useProfile';

// How long to wait before force-revealing regardless of widget readiness (ms)
const REVEAL_TIMEOUT = 1_200;

export default function App() {
  const { placeWidget, setWidgetConnection, refreshServiceStatus, layoutLoaded, grid } = useStore();
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

  // ── Global SSE connection (one per app, not per widget) ──────────────────
  useEffect(() => {
    if (!user) return;
    nexusSSE.start();
    return () => nexusSSE.stop();
  }, [user]);

  // ── Pre-fetch settings data in background so panels open instantly ────────
  useEffect(() => {
    if (!user) return;
    // Fire-and-forget — populates module-level caches used by Settings panels
    prefetchProfile();
    prefetchConnections();
  }, [user]);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load layout from server, scoped to the logged-in user.
  // Passing user?.id ensures that when accounts switch the grid is cleared
  // and reloaded from the new account's server-side layout.
  useLayoutPersistence(user?.id);

  // Once the layout is known, register every widget on the dashboard as
  // "pending" and start the hard-timeout fallback.
  // useLayoutEffect fires before the browser paints, in the same synchronous
  // phase as widgets' useLayoutEffect calls (children fire before parents).
  // This means widgets will have already called markReady() before initPending()
  // runs — so startReveal() fires immediately, before the first paint.
  useLayoutEffect(() => {
    if (!layoutLoaded) return;

    const widgetTypes = [...new Set(
      Object.values(grid).filter(Boolean)
    )] as WidgetType[];

    initPending(widgetTypes);

    // Hard timeout: reveal everything after timeout regardless of widget status.
    // Prevents an indefinitely-hidden dashboard if one widget's fetch hangs.
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

  // DEV-only: log cache boot report once the grid is known
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const widgetTypes = [...new Set(Object.values(grid).filter(Boolean))] as string[];
    devBootCheck(widgetTypes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded]);

  // Handle OAuth redirects that return to the main app
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

    if (widgetId === 'todo' || widgetId === 'shared_chess') {
      // Intercept — show the setup modal before committing the placement
      setPendingDrop({ widgetId, row, col, slotKey: cellKey });
      return;
    }

    placeWidget(widgetId, row, col);
  }

  const activeDragConfig = activeDragId
    ? WIDGET_CONFIGS.find((w) => w.id === activeDragId)
    : null;

  // layoutLoaded is set to true immediately if localStorage has a cached layout,
  // so this guard only blocks on the very first-ever visit (no cache yet).
  if (!layoutLoaded) return null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="flex h-screen w-screen overflow-hidden relative"
        style={{ background: 'var(--bg)', zIndex: 1 }}
      >
        {/* Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          onOpenSettings={() => { setSettingsInitialTab('account'); setShowSettings(true); }}
          onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
          layoutMode={showLayoutEditor}
          onExitLayout={() => setShowLayoutEditor(false)}
        />

        {/* Main area */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* Grid + Canvas
               - overflow: clip (not just hidden) hard-clips filter/blur effects to this box
               - isolation: isolate creates a self-contained stacking context so the
                 overlay's z-index:50 cannot escape to paint over the search bar below
               - containerType: size enables cqh units in child animations               */}
          <div
            className="flex-1 relative"
            ref={(el) => setGridRef(el)}
            style={{ containerType: 'size', overflow: 'clip', isolation: 'isolate' }}
          >
            <Grid onOpenPicker={(row, col) => setPickerCell({ row, col })} />
            <WidgetCanvas gridEl={gridRef} />
            {showLayoutEditor && <GridLayoutMode onClose={() => setShowLayoutEditor(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} initialTab={settingsInitialTab} />}
            {/* Widget picker — opens when clicking an empty cell "+" */}
            {pickerCell && (
              <WidgetPickerModal
                targetCell={pickerCell}
                onPlace={(widgetId, row, col) => {
                  const slotKey = `${row},${col}`;
                  if (widgetId === 'todo' || widgetId === 'shared_chess' || widgetId === 'shared_photo') {
                    setPendingDrop({ widgetId, row, col, slotKey });
                  } else {
                    placeWidget(widgetId, row, col);
                  }
                }}
                onClose={() => setPickerCell(null)}
              />
            )}

            {/* Widget setup modals — intercept shared widget drops before grid placement */}
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
            {/* Wave reveal — scoped to the widget grid only; sidebar + input bar stay visible */}
            <RevealOverlay />
          </div>


          <StatusBar onLayoutClick={showLayoutEditor ? undefined : () => setShowLayoutEditor(true)} />
        </div>
      </div>

      {/* Global invite toast — listens for SSE invite_received events */}
      <InviteToast
        onOpenConnections={() => { setSettingsInitialTab('connections'); setShowSettings(true); }}
      />

      {/* DEV-only cache diagnostics overlay */}
      <DevCacheOverlay />

      {/* Drag overlay */}
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
