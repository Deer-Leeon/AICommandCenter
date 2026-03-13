import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
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
import { isMobileDevice } from './mobile/useMobileDetect';

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
 */
const IS_EXTENSION =
  import.meta.env.VITE_IS_EXTENSION === 'true' ||
  (typeof chrome !== 'undefined' && !!chrome?.runtime?.id);

const AppRouter = IS_EXTENSION ? HashRouter : BrowserRouter;

// ── Service Worker registration (web only) ────────────────────────────────────
// Register after first paint so it never blocks the critical path.
// Not registered in extension builds — extension pages can't use SW this way.
if (!IS_EXTENSION && 'serviceWorker' in navigator) {
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
    const hasFlag   = localStorage.getItem('nexus_onboarding_done') === '1';
    const hasLayout = localStorage.getItem('nexus_layout_v2') !== null;
    return hasFlag || hasLayout;
  });

  const handleServicesComplete = () => {
    localStorage.setItem('nexus_onboarding_done', '1');
    setServicesConnected(true);
  };

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
        {/* /auth/callback is only needed on the web — in the extension, Supabase
            tokens are delivered in the hash of the main index.html URL and
            detectSessionInUrl handles them without a dedicated callback page. */}
        {!IS_EXTENSION && (
          <Route path="/auth/callback" element={<AuthCallback />} />
        )}
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
