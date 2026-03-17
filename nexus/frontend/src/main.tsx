import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// Silence all console output in production — nothing should be visible to end users
if (!import.meta.env.DEV) {
  const noop = () => {};
  console.log   = noop;
  console.warn  = noop;
  console.error = noop;
  console.debug = noop;
  console.info  = noop;
  console.group = noop;
  console.groupCollapsed = noop;
  console.groupEnd = noop;
}
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { useAuth } from './hooks/useAuth';
import { useProfile } from './hooks/useProfile';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import ConnectServicesPage from './pages/ConnectServicesPage';
import { UsernameOnboardingModal } from './components/UsernameOnboardingModal';
import { ProfileProvider } from './contexts/ProfileContext';
import App from './App';
import MobileApp from './mobile/MobileApp';
import PrivacyPage from './pages/PrivacyPage';
import { isMobileDevice } from './mobile/useMobileDetect';
import { TrayApp } from './components/TrayApp';
import { isElectron } from './lib/isElectron';

// Detect once at module load time (viewport/UA won't change mid-session)
const IS_MOBILE = isMobileDevice();

/**
 * In Chrome extension context:
 *   • Service workers cannot be registered on extension pages.
 *   • HashRouter is used instead of BrowserRouter so that SPA navigation
 *     works on chrome-extension:// origins (pushState paths like /auth/callback
 *     would 404 since there's no server to handle them).
 *   • Auth tokens land in window.location.hash after Google OAuth redirect;
 *     Supabase's detectSessionInUrl picks them up before the router renders.
 *
 * In Electron context:
 *   • The app is loaded as a local file:// URL in production, so BrowserRouter
 *     would break navigation (pushState has no dev server to handle paths).
 *     HashRouter keeps everything working on the file:// origin.
 *   • The /tray route renders TrayApp inside the menu-bar popover window.
 *     It must be excluded from the full app initialization and layout.
 */
const IS_EXTENSION =
  import.meta.env.VITE_IS_EXTENSION === 'true' ||
  (typeof chrome !== 'undefined' && !!chrome?.runtime?.id);

const IS_ELECTRON = isElectron();

// HashRouter for: extension pages, Electron (file:// origin)
const AppRouter = IS_EXTENSION || IS_ELECTRON ? HashRouter : BrowserRouter;

// ── Service Worker registration (web only) ────────────────────────────────────
// Register after first paint so it never blocks the critical path.
// Not registered in extension builds or Electron — can't use SW on those origins.
if (!IS_EXTENSION && !IS_ELECTRON && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failure is non-fatal
    });
  });
}

// ── Root component ────────────────────────────────────────────────────────────
function Root() {
  const { user, loading } = useAuth();

  // Skip ConnectServicesPage if:
  //   a) the explicit onboarding flag is set (set after first successful connect), OR
  //   b) the user already has a saved layout — they've been using the app, meaning
  //      they already went through onboarding. This handles existing users whose
  //      browser pre-dates the 'nexus_onboarding_done' flag.
  const [servicesConnected, setServicesConnected] = useState(() => {
    const hasFlag = localStorage.getItem('nexus_onboarding_done') === '1';
    // Check for a user-scoped layout key (nexus_layout_v2_<userId>) or the legacy key
    const hasLayout =
      Object.keys(localStorage).some((k) => k.startsWith('nexus_layout_v2') || k.startsWith('nexus_layout_v3')) ||
      localStorage.getItem('nexus_layout_v2') !== null;
    // Persist the flag so future checks are instant
    if (hasLayout && !hasFlag) localStorage.setItem('nexus_onboarding_done', '1');
    return hasFlag || hasLayout;
  });

  const handleServicesComplete = () => {
    localStorage.setItem('nexus_onboarding_done', '1');
    setServicesConnected(true);
  };

  // ── Electron: handle OAuth params forwarded by main process ─────────────
  // When the user completes a Google/Spotify OAuth flow in the Electron app,
  // main.ts intercepts the production redirect and forwards the query string
  // via IPC so we can process it without navigating away.
  useEffect(() => {
    if (!IS_ELECTRON || !window.electronAPI) return;
    window.electronAPI.onOAuthParams((qs: string) => {
      const params = new URLSearchParams(qs);
      const anySuccess =
        params.get('google_calendar_connected') === 'true' ||
        params.get('google_tasks_connected') === 'true'    ||
        params.get('google_docs_connected') === 'true'     ||
        params.get('google_drive_connected') === 'true'    ||
        params.get('google_gmail_connected') === 'true'    ||
        params.get('google_connected') === 'true'          ||
        params.get('slack_connected') === 'true';
      if (anySuccess) {
        handleServicesComplete();
      }
    });
  // Register once on mount — dependencies are stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The static #nexus-preload div from index.html covers the entire screen before
  // React runs. It must be removed as soon as auth resolves so the correct page
  // (LoginPage, ConnectServicesPage, or App) becomes visible.
  //
  // Removal cases:
  //   • !user              → LoginPage renders; RevealOverlay never mounts
  //   • user && !services  → ConnectServicesPage renders; RevealOverlay never mounts
  //   • user && services   → App renders; RevealOverlay mounts in the same render
  //                          cycle and creates its own cover, so removing preload here
  //                          is safe — RevealOverlay's div is already in the DOM before
  //                          the browser paints, so there is no flash of app chrome.
  useEffect(() => {
    if (!loading) {
      document.getElementById('nexus-preload')?.remove();
    }
  }, [loading]);

  // Returning users: loading=false immediately (session read from localStorage cache).
  // New visitors: loading=true for the ~50ms it takes Supabase to confirm no session.
  // We render the LoginPage shell already (with opacity 0) so there's no blank→page flash.
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0f' }}>
        <style>{`@media(prefers-color-scheme:light){div{background:#f0f0f8!important}}`}</style>
      </div>
    );
  }

  return (
    <AppRouter>
      <Routes>
        {/* ── Electron tray panel ─────────────────────────────────────────────
            Rendered in a separate frameless BrowserWindow by tray.ts.
            Must come BEFORE the wildcard route so it is matched first.
            No auth gate, no layout, no page switcher — just the mini-panel. */}
        {IS_ELECTRON && (
          <Route path="/tray" element={<TrayApp />} />
        )}

        {/* /auth/callback handles Google OAuth PKCE code exchange.
            Used by web and Electron (the main window navigates to Google and
            returns here). Excluded from Chrome extension where tokens arrive
            in the hash fragment and detectSessionInUrl handles them. */}
        {!IS_EXTENSION && (
          <Route path="/auth/callback" element={<AuthCallback />} />
        )}

        <Route path="/privacy" element={<PrivacyPage />} />
        <Route
          path="/*"
          element={
            !user ? (
              <LoginPage />
            ) : !servicesConnected ? (
              <ConnectServicesPage onComplete={handleServicesComplete} />
            ) : (
              <DashboardWithProfileGate />
            )
          }
        />
      </Routes>
    </AppRouter>
  );
}

function DashboardWithProfileGate() {
  const { profile, loading, refresh } = useProfile(true);
  return (
    <ProfileProvider profile={profile}>
      {IS_MOBILE ? <MobileApp /> : <App />}
      {!IS_MOBILE && !loading && profile && !profile.username && (
        <UsernameOnboardingModal displayName={profile.displayName} onComplete={refresh} />
      )}
    </ProfileProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
