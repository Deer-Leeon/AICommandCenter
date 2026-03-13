import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

// Allow the page to scroll by overriding the desktop overflow:hidden on html/body/#root
function useScrollableRoot() {
  useEffect(() => {
    const targets = [document.documentElement, document.body, document.getElementById('root')];
    const prev = targets.map(el => el ? el.style.overflow : '');
    targets.forEach(el => { if (el) el.style.overflow = 'auto'; });
    return () => { targets.forEach((el, i) => { if (el) el.style.overflow = prev[i]; }); };
  }, []);
}

export default function ConnectServicesPage({ onComplete }: { onComplete: () => void }) {
  useScrollableRoot();
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Calendar is the core service — once it's connected, unlock the dashboard
    if (params.get('google_calendar_connected') === 'true') {
      window.history.replaceState({}, '', '/');
      setStatuses((prev) => ({ ...prev, 'google-calendar': true }));
      setChecking(false);
      onComplete();
      return;
    }
    // Legacy combined flow
    if (params.get('google_connected') === 'true') {
      window.history.replaceState({}, '', '/');
      setStatuses({ 'google-calendar': true, 'google-tasks': true, 'google-docs': true, 'google-drive': true });
      setChecking(false);
      onComplete();
      return;
    }

    const paramMap: Record<string, string> = {
      google_tasks_connected: 'google-tasks',
      google_docs_connected:  'google-docs',
      google_drive_connected: 'google-drive',
      slack_connected:        'slack',
      spotify_connected:      'spotify',
    };
    let dirty = false;
    const updates: Record<string, boolean> = {};
    for (const [param, key] of Object.entries(paramMap)) {
      if (params.get(param) === 'true') { updates[key] = true; dirty = true; }
    }
    if (dirty) {
      window.history.replaceState({}, '', '/');
      setStatuses((prev) => ({ ...prev, ...updates }));
    }

    const errParam = params.get('google_error') ?? params.get('slack_error') ?? params.get('spotify_error') ?? params.get('auth_error');
    if (errParam) {
      setConnectError(decodeURIComponent(errParam));
      window.history.replaceState({}, '', '/');
    }

    checkStatuses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkStatuses = async () => {
    // Hard timeout: if the session lock or network is slow right after OAuth,
    // we never want to leave the user staring at a loading screen indefinitely.
    const timeoutMs = 6000;
    let settled = false;

    const run = async () => {
      try {
        const endpoints = [
          ['google-calendar', '/api/auth/google-calendar/status'],
          ['google-tasks',    '/api/auth/google-tasks/status'],
          ['google-docs',     '/api/auth/google-docs/status'],
          ['google-drive',    '/api/auth/google-drive/status'],
          ['slack',           '/api/auth/slack/status'],
          ['spotify',         '/api/auth/spotify/status'],
        ] as const;

        const results = await Promise.allSettled(endpoints.map(([, ep]) => apiFetch(ep)));
        const next: Record<string, boolean> = {};
        for (let i = 0; i < endpoints.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled' && r.value.ok) {
            const d = await r.value.json() as { connected: boolean };
            next[endpoints[i][0]] = d.connected;
          }
        }
        return next;
      } catch {
        return {};
      }
    };

    const timeoutPromise = new Promise<Record<string, boolean>>(resolve =>
      setTimeout(() => resolve({}), timeoutMs)
    );

    const next = await Promise.race([run(), timeoutPromise]);

    if (settled) return;
    settled = true;

    setStatuses(next);
    setChecking(false);

    if (next['google-calendar']) {
      onComplete();
    }
  };

  const initiateOAuth = useCallback(async (serviceId: string, endpoint: string) => {
    setConnecting(serviceId);
    setConnectError(null);
    try {
      const res = await apiFetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Unknown error');
      setConnecting(null);
    }
  }, []);

  const services = [
    {
      id: 'google-calendar',
      icon: '📅',
      name: 'Google Calendar',
      description: 'Create and manage calendar events',
      endpoint: '/api/auth/google-calendar/initiate',
      btnColor: '#4285f4',
      btnBg: 'rgba(66,133,244,0.15)',
      required: true,
    },
    {
      id: 'google-tasks',
      icon: '✅',
      name: 'Google Tasks',
      description: 'Sync to-do items with Google Tasks',
      endpoint: '/api/auth/google-tasks/initiate',
      btnColor: '#4285f4',
      btnBg: 'rgba(66,133,244,0.15)',
      optional: true,
    },
    {
      id: 'google-docs',
      icon: '📝',
      name: 'Google Docs',
      description: 'Read and write Google documents',
      endpoint: '/api/auth/google-docs/initiate',
      btnColor: '#4285f4',
      btnBg: 'rgba(66,133,244,0.15)',
      optional: true,
    },
    {
      id: 'google-drive',
      icon: '💾',
      name: 'Google Drive',
      description: 'List and browse Drive files',
      endpoint: '/api/auth/google-drive/initiate',
      btnColor: '#4285f4',
      btnBg: 'rgba(66,133,244,0.15)',
      optional: true,
    },
    {
      id: 'slack',
      icon: '💬',
      name: 'Slack',
      description: 'Read and send messages in your workspace',
      endpoint: '/api/auth/slack/initiate',
      btnColor: '#e01e5a',
      btnBg: 'rgba(74,21,75,0.3)',
      optional: true,
    },
    {
      id: 'spotify',
      icon: '🎵',
      name: 'Spotify',
      description: 'Control music playback from NEXUS',
      endpoint: '/api/auth/spotify/initiate',
      btnColor: '#1db954',
      btnBg: 'rgba(29,185,84,0.12)',
      optional: true,
    },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px' }}>
      <div
        className="rounded-2xl max-w-md w-full"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 'clamp(24px, 5vw, 40px)' }}
      >
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Connect your services
        </h2>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          Connect <strong style={{ color: 'var(--text)' }}>Google Calendar</strong> to unlock the dashboard.
          Every other service is optional and independent.
        </p>

        {connectError && (
          <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: 'rgba(234,67,53,0.1)', color: '#ea4335' }}>
            {connectError}
          </p>
        )}

        <div className="space-y-3">
          {services.map((svc) => {
            const isConnecting = connecting === svc.id;
            const isConnected = !!statuses[svc.id];
            return (
              <div
                key={svc.id}
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: '22px' }}>{svc.icon}</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                      {svc.name}
                      {svc.optional && (
                        <span
                          className="ml-2 text-xs font-normal font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)' }}
                        >
                          optional
                        </span>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {svc.description}
                    </p>
                  </div>
                </div>
                {checking ? (
                  <span className="text-xs font-mono animate-pulse" style={{ color: 'var(--text-faint)' }}>…</span>
                ) : isConnected ? (
                  <span className="text-sm font-mono font-medium" style={{ color: 'var(--teal)' }}>
                    ✓ Connected
                  </span>
                ) : (
                  <button
                    onClick={() => initiateOAuth(svc.id, svc.endpoint)}
                    disabled={!!connecting}
                    className="text-sm font-medium px-4 py-2 rounded-lg"
                    style={{
                      background: svc.btnBg,
                      color: connecting ? 'var(--text-muted)' : svc.btnColor,
                      cursor: connecting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isConnecting ? 'Redirecting…' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {checking ? (
          <p className="w-full mt-6 text-center text-xs font-mono animate-pulse" style={{ color: 'var(--text-faint)' }}>
            Checking your account…
          </p>
        ) : statuses['google-calendar'] ? (
          <button
            onClick={onComplete}
            className="w-full mt-6 font-semibold py-3 rounded-xl text-sm"
            style={{ background: 'var(--teal)', color: '#0a0a0f', cursor: 'pointer' }}
          >
            Go to NEXUS →
          </button>
        ) : (
          <button
            onClick={onComplete}
            className="w-full mt-6 py-2 text-sm"
            style={{
              background:   'transparent',
              border:       'none',
              color:        'var(--text-faint)',
              cursor:       'pointer',
              textDecoration: 'underline',
              textDecorationColor: 'var(--text-faint)',
              textUnderlineOffset: '3px',
            }}
          >
            Skip for now — go to dashboard →
          </button>
        )}
      </div>
    </div>
  );
}
