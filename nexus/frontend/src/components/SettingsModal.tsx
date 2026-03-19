import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { useStore } from '../store/useStore';
import { useRevealStore } from '../store/useRevealStore';
import { useOmnibarStore } from '../store/useOmnibarStore';
import { useAuth } from '../hooks/useAuth';
import { useProfile, invalidateProfileCache } from '../hooks/useProfile';
import { useProfileContext } from '../contexts/ProfileContext';
import { ConnectionsPanel } from './ConnectionsPanel';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsTab = 'account' | 'permissions' | 'connections' | 'animation' | 'searchbar' | 'widgets' | 'desktop';

interface NavItem {
  id: SettingsTab;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'account',     icon: '👤', label: 'Account'     },
  { id: 'permissions', icon: '🔑', label: 'Permissions' },
  { id: 'connections', icon: '⇆',  label: 'Connections' },
  { id: 'animation',   icon: '✦',  label: 'Animation'   },
  { id: 'searchbar',   icon: '🔍', label: 'Search Bar'  },
  { id: 'widgets',     icon: '⊞',  label: 'Widgets'     },
  { id: 'desktop',     icon: '🖥',  label: 'Desktop App' },
];

// ─── AccountPanel ──────────────────────────────────────────────────────────────

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function AccountPanel() {
  const { user } = useAuth();
  // Use the already-loaded ProfileContext as the instant initial value;
  // useProfile deduplicates the fetch so there's no double request.
  const contextProfile = useProfileContext();
  const { profile: fetchedProfile, loading, refresh } = useProfile(true);
  const profile = fetchedProfile ?? contextProfile;
  const _ = { invalidateProfileCache }; void _; // keep import used
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameValue, setUsernameValue] = useState('');
  const [usernameCheck, setUsernameCheck] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Password section
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Detect whether the user already has an email/password identity
  const hasPasswordLogin = user?.identities?.some((id) => id.provider === 'email') ?? false;

  const handleSetPassword = useCallback(async () => {
    setPasswordError(null);
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }
    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) { setPasswordError(error.message); return; }
    setPasswordSuccess(true);
    setShowPasswordForm(false);
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSuccess(false), 3000);
  }, [newPassword, confirmPassword]);

  useEffect(() => {
    if (profile?.username) setUsernameValue(profile.username);
  }, [profile?.username]);

  useEffect(() => {
    if (!editingUsername || usernameValue.length < 3) {
      setUsernameCheck('idle');
      return;
    }
    if (!USERNAME_REGEX.test(usernameValue)) {
      setUsernameCheck('invalid');
      return;
    }
    if (usernameValue === profile?.username) {
      setUsernameCheck('available');
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setUsernameCheck('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/profiles/check?username=${encodeURIComponent(usernameValue)}`);
        const d = await res.json() as { available: boolean; reason?: string };
        setUsernameCheck(d.available ? 'available' : (d.reason === 'invalid_format' ? 'invalid' : 'taken'));
      } catch { setUsernameCheck('idle'); }
      debounceRef.current = undefined;
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [editingUsername, usernameValue, profile?.username]);

  const handleSaveUsername = useCallback(async () => {
    if (usernameValue.length < 3 || !USERNAME_REGEX.test(usernameValue) || usernameCheck !== 'available') return;
    setSaving(true); setSaveError(null);
    try {
      const res = await apiFetch('/api/profiles/me/username', {
        method: 'PATCH',
        body: JSON.stringify({ username: usernameValue }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      await refresh();
      setEditingUsername(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [usernameValue, usernameCheck, refresh]);

  const handleCancelUsername = useCallback(() => {
    setEditingUsername(false);
    setUsernameValue(profile?.username ?? '');
    setUsernameCheck('idle');
    setSaveError(null);
  }, [profile?.username]);

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center" style={{ height: '200px' }}>
        <p className="font-mono text-xs animate-pulse" style={{ color: 'var(--text-faint)' }}>Loading…</p>
      </div>
    );
  }

  const sectionHeader = (label: string) => (
    <h3 className="font-mono text-xs font-semibold uppercase mb-3" style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}>
      {label}
    </h3>
  );

  return (
    <div className="flex flex-col gap-6">
      {sectionHeader('Account')}

      {/* Google email */}
      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <img src="https://www.google.com/s2/favicons?domain=google.com&sz=32" width={18} height={18} alt="" style={{ borderRadius: 2 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Google email</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Used to sign in — cannot be changed</p>
          </div>
        </div>
        <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--text-faint)' }}>{user?.email ?? '—'}</span>
      </div>

      {/* Display name */}
      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Display name</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>From your Google account</p>
        </div>
        <span className="text-xs" style={{ color: 'var(--text)' }}>{profile.displayName}</span>
      </div>

      {/* Username */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Username</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Your username is how others invite you to connect — changing it means they will need to use your new username
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {editingUsername ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>@</span>
                  <input
                    value={usernameValue}
                    onChange={(e) => setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="username"
                    maxLength={20}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') handleCancelUsername(); }}
                    autoFocus
                    style={{
                      width: 140, padding: '5px 8px', fontSize: 12, fontFamily: "'Roboto Mono', monospace",
                      background: 'var(--surface)', border: `1px solid ${usernameCheck === 'taken' || usernameCheck === 'invalid' ? 'rgba(239,68,68,0.4)' : usernameCheck === 'available' ? 'rgba(61,232,176,0.4)' : 'var(--border)'}`,
                      borderRadius: 6, color: 'var(--text)', outline: 'none',
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {usernameCheck === 'available' && <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: "'Roboto Mono', monospace" }}>✓ Available</span>}
                  {usernameCheck === 'taken' && <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>Taken</span>}
                  {usernameCheck === 'invalid' && usernameValue.length >= 3 && <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>Invalid format</span>}
                  <button onClick={handleSaveUsername} disabled={saving || usernameCheck !== 'available'} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(61,232,176,0.2)', color: 'var(--teal)', border: '1px solid rgba(61,232,176,0.4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {saving ? '…' : 'Save'}
                  </button>
                  <button onClick={handleCancelUsername} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 13, color: 'var(--text)' }}>
                  @{profile.username ?? '—'}
                </span>
                <button onClick={() => { setEditingUsername(true); setUsernameValue(profile.username ?? ''); setUsernameCheck('idle'); setSaveError(null); }} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'transparent', color: 'var(--text-faint)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>
        {saveSuccess && <p style={{ fontSize: 11, color: 'var(--teal)' }}>✓ Username updated</p>}
        {saveError && <p style={{ fontSize: 11, color: 'var(--color-danger)' }}>{saveError}</p>}
      </div>

      {/* ── Password ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Password</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {hasPasswordLogin
                ? 'A password is set — you can sign in with email and password'
                : 'No password set — sign in with Google only'}
            </p>
          </div>
          <button
            onClick={() => { setShowPasswordForm((v) => !v); setPasswordError(null); setNewPassword(''); setConfirmPassword(''); }}
            style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, background: 'transparent', color: 'var(--text-faint)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, marginLeft: 12 }}
          >
            {showPasswordForm ? 'Cancel' : hasPasswordLogin ? 'Change' : 'Set password'}
          </button>
        </div>

        {showPasswordForm && (
          <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoFocus
                style={{
                  padding: '7px 10px', fontSize: 13, borderRadius: 8,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSetPassword(); }}
                style={{
                  padding: '7px 10px', fontSize: 13, borderRadius: 8,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            {passwordError && <p style={{ fontSize: 11, color: 'var(--color-danger)' }}>{passwordError}</p>}
            <button
              onClick={handleSetPassword}
              disabled={passwordSaving}
              style={{
                alignSelf: 'flex-start', padding: '6px 16px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                background: 'rgba(61,232,176,0.15)', color: 'var(--teal)',
                border: '1px solid rgba(61,232,176,0.35)', fontFamily: 'inherit',
                opacity: passwordSaving ? 0.6 : 1,
              }}
            >
              {passwordSaving ? 'Saving…' : hasPasswordLogin ? 'Update password' : 'Set password'}
            </button>
          </div>
        )}

        {passwordSuccess && <p style={{ fontSize: 11, color: 'var(--teal)' }}>✓ Password {hasPasswordLogin ? 'updated' : 'set'} — you can now sign in with email and password</p>}
      </div>
    </div>
  );
}

// ─── PermissionsPanel ─────────────────────────────────────────────────────────

function PermissionsPanel() {
  const { refreshServiceStatus } = useStore();
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const STATUSES_CACHE_KEY = 'nexus_perm_statuses';

  const checkStatuses = useCallback(async () => {
    // Show cached statuses immediately — no spinner if we have them
    try {
      const cached = sessionStorage.getItem(STATUSES_CACHE_KEY);
      if (cached) { setStatuses(JSON.parse(cached) as Record<string, boolean>); setChecking(false); }
    } catch { /* ignore */ }

    try {
      const endpoints = [
        ['google-calendar', '/api/auth/google-calendar/status'],
        ['google-tasks',    '/api/auth/google-tasks/status'],
        ['google-docs',     '/api/auth/google-docs/status'],
        ['google-drive',    '/api/auth/google-drive/status'],
        ['slack',           '/api/auth/slack/status'],
        ['plaid',           '/api/plaid/status'],
        ['spotify',         '/api/auth/spotify/status'],
      ] as const;

      const results = await Promise.allSettled(endpoints.map(([, ep]) => apiFetch(ep)));
      const next: Record<string, boolean> = {};
      for (let i = 0; i < endpoints.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.ok) {
          const d = (await r.value.json()) as { connected: boolean };
          next[endpoints[i][0]] = d.connected;
        }
      }
      setStatuses(next);
      sessionStorage.setItem(STATUSES_CACHE_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const showSuccess = (msg: string, updates: Record<string, boolean> = {}) => {
      window.history.replaceState({}, '', '/');
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 5000);
      if (Object.keys(updates).length) setStatuses((prev) => ({ ...prev, ...updates }));
      refreshServiceStatus();
    };

    if (params.get('google_calendar_connected') === 'true') {
      showSuccess('✓ Google Calendar connected', { 'google-calendar': true });
    } else if (params.get('google_tasks_connected') === 'true') {
      showSuccess('✓ Google Tasks connected', { 'google-tasks': true });
    } else if (params.get('google_docs_connected') === 'true') {
      showSuccess('✓ Google Docs connected', { 'google-docs': true });
    } else if (params.get('google_drive_connected') === 'true') {
      showSuccess('✓ Google Drive connected', { 'google-drive': true });
    } else if (params.get('google_connected') === 'true') {
      // Legacy combined flow
      showSuccess('✓ Google reconnected — all permissions active', {
        'google-calendar': true, 'google-tasks': true, 'google-docs': true, 'google-drive': true,
      });
    } else if (params.get('slack_connected') === 'true') {
      showSuccess('✓ Slack connected', { slack: true });
    } else if (params.get('spotify_connected') === 'true') {
      showSuccess('✓ Spotify connected', { spotify: true });
    }

    const errParam = params.get('google_error') ?? params.get('slack_error') ?? params.get('spotify_error') ?? params.get('auth_error');
    if (errParam) {
      window.history.replaceState({}, '', '/');
      setError(decodeURIComponent(errParam));
    }

    checkStatuses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initiateOAuth = useCallback(async (serviceId: string, endpoint: string) => {
    setConnecting(serviceId);
    setError(null);
    try {
      const res = await apiFetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setConnecting(null);
    }
  }, []);

  const handleDisconnect = useCallback(async (serviceId: string) => {
    setDisconnecting(serviceId);
    setConfirming(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/auth/token/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setStatuses((prev) => ({ ...prev, [serviceId]: false }));
      setSuccessMsg(`✓ ${serviceId} disconnected`);
      setTimeout(() => setSuccessMsg(null), 4000);
      refreshServiceStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setDisconnecting(null);
    }
  }, [refreshServiceStatus]);

  if (checking) {
    return (
      <div className="flex items-center justify-center" style={{ height: '200px' }}>
        <p className="font-mono text-xs animate-pulse" style={{ color: 'var(--text-faint)' }}>
          Checking connections…
        </p>
      </div>
    );
  }

  const services = [
    {
      id: 'google-calendar',
      icon: '📅',
      name: 'Google Calendar',
      description: 'Create and manage calendar events',
      scopes: 'calendar',
      connected: !!statuses['google-calendar'],
      onConnect: () => initiateOAuth('google-calendar', '/api/auth/google-calendar/initiate'),
    },
    {
      id: 'google-tasks',
      icon: '✅',
      name: 'Google Tasks',
      description: 'Sync to-do items as Google Tasks',
      scopes: 'tasks',
      connected: !!statuses['google-tasks'],
      onConnect: () => initiateOAuth('google-tasks', '/api/auth/google-tasks/initiate'),
    },
    {
      id: 'google-docs',
      icon: '📝',
      name: 'Google Docs',
      description: 'Read and write Google documents',
      scopes: 'documents',
      optional: true,
      connected: !!statuses['google-docs'],
      onConnect: () => initiateOAuth('google-docs', '/api/auth/google-docs/initiate'),
    },
    {
      id: 'google-drive',
      icon: '💾',
      name: 'Google Drive',
      description: 'List and browse Drive files',
      scopes: 'drive.readonly',
      optional: true,
      connected: !!statuses['google-drive'],
      onConnect: () => initiateOAuth('google-drive', '/api/auth/google-drive/initiate'),
    },
    {
      id: 'slack',
      icon: '💬',
      name: 'Slack',
      description: 'Read and send messages in your workspace',
      scopes: 'channels · messages · DMs',
      optional: true,
      connected: !!statuses['slack'],
      onConnect: () => initiateOAuth('slack', '/api/auth/slack/initiate'),
    },
    {
      id: 'spotify',
      icon: '🎵',
      name: 'Spotify',
      description: 'Control music playback from your dashboard',
      scopes: 'playback · library · playlists',
      optional: true,
      connected: !!statuses['spotify'],
      onConnect: () => initiateOAuth('spotify', '/api/auth/spotify/initiate'),
    },
  ];

  // Plaid is checked separately (not an OAuth redirect flow — it uses Plaid Link)
  const plaidConnected = !!statuses['plaid'];

  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div>
        <h3
          className="font-mono text-xs font-semibold uppercase mb-1"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}
        >
          Connected Services
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Use <strong style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Reconnect</strong> to
          re-authorize Google or Slack and grant any new permissions added since you last connected.
        </p>
      </div>

      {/* Feedback banner */}
      {(error ?? successMsg) && (
        <div
          className="px-3 py-2 rounded-lg text-xs font-mono"
          style={{
            background: error ? 'var(--color-danger-bg)' : 'var(--teal-dim)',
            color: error ? 'var(--color-danger)' : 'var(--teal)',
            border: `1px solid ${error ? 'rgba(239,68,68,0.2)' : 'rgba(var(--teal-rgb),0.25)'}`,
          }}
        >
          {error ?? successMsg}
        </div>
      )}

      {/* OAuth services */}
      {services.map((svc) => {
        const isConnecting = connecting === svc.id;
        return (
          <div
            key={svc.id}
            className="flex items-center justify-between p-4 rounded-xl"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
          >
            {/* Left: status dot + icon + info */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background: svc.connected ? 'var(--teal)' : 'var(--text-faint)',
                  boxShadow: svc.connected ? '0 0 6px var(--teal)' : 'none',
                }}
              />
              <span style={{ fontSize: '20px', flexShrink: 0 }}>{svc.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {svc.name}
                  </p>
                  {svc.optional && (
                    <span
                      className="font-mono px-1.5 rounded"
                      style={{
                        background: 'var(--row-bg)',
                        color: 'var(--text-faint)',
                        fontSize: '10px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      optional
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {svc.description}
                </p>
                <p
                  className="font-mono mt-0.5"
                  style={{ color: 'var(--text-faint)', fontSize: '10px' }}
                >
                  {svc.scopes}
                </p>
              </div>
            </div>

            {/* Right: action button(s) */}
            <div className="flex-shrink-0 ml-4 flex items-center gap-2">
              {svc.connected ? (
                confirming === svc.id ? (
                  // ── Inline disconnect confirmation ──
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs" style={{ color: 'var(--color-warning)' }}>
                      Disconnect?
                    </span>
                    <button
                      onClick={() => handleDisconnect(svc.id)}
                      disabled={disconnecting === svc.id}
                      className="font-mono text-xs px-2.5 py-1 rounded-lg"
                      style={{
                        background: 'rgba(239,68,68,0.12)',
                        color: 'var(--color-danger)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        cursor: 'pointer',
                      }}
                    >
                      {disconnecting === svc.id ? '…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="font-mono text-xs px-2.5 py-1 rounded-lg"
                      style={{
                        background: 'var(--row-bg)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  // ── Normal connected state ──
                  <>
                    <span className="font-mono text-xs" style={{ color: 'var(--teal)' }}>
                      ✓ Connected
                    </span>
                    <button
                      onClick={() => setConfirming(svc.id)}
                      disabled={!!connecting || !!disconnecting}
                      className="font-mono text-xs px-2.5 py-1 rounded-lg"
                      style={{
                        background: 'rgba(239,68,68,0.08)',
                        color: 'var(--color-danger)',
                        border: '1px solid rgba(239,68,68,0.15)',
                        cursor: (connecting || disconnecting) ? 'not-allowed' : 'pointer',
                        opacity: (connecting || disconnecting) ? 0.5 : 1,
                      }}
                    >
                      Disconnect
                    </button>
                    <button
                      onClick={svc.onConnect}
                      disabled={!!connecting || !!disconnecting}
                      className="nexus-teal-btn font-mono text-xs px-2.5 py-1 rounded-lg"
                      style={{
                        cursor: (connecting || disconnecting) ? 'not-allowed' : 'pointer',
                        opacity: (connecting || disconnecting) ? 0.6 : 1,
                      }}
                      title="Re-run OAuth to grant any new permissions"
                    >
                      {isConnecting ? 'Opening…' : 'Reconnect'}
                    </button>
                  </>
                )
              ) : (
                <button
                  onClick={svc.onConnect}
                  disabled={!!connecting || !!disconnecting}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={{
                    background: 'var(--color-google-blue-bg)',
                    color: (connecting || disconnecting) ? 'var(--text-muted)' : 'var(--color-google-blue)',
                    border: '1px solid rgba(66,133,244,0.2)',
                    cursor: (connecting || disconnecting) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isConnecting ? 'Opening…' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Plaid — uses Plaid Link, not standard OAuth redirect */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: plaidConnected ? 'var(--teal)' : 'var(--text-faint)',
              boxShadow: plaidConnected ? '0 0 6px var(--teal)' : 'none',
            }}
          />
          <span style={{ fontSize: '20px', flexShrink: 0 }}>💳</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Finance (Plaid)</p>
              <span className="font-mono px-1.5 rounded"
                style={{ background: 'var(--row-bg)', color: 'var(--text-faint)', fontSize: '10px', border: '1px solid var(--border)' }}>
                optional
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Bank balances, transactions, and investments
            </p>
            <p className="font-mono mt-0.5" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
              Connected via Plaid Link · bank-level encryption
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 ml-4 flex items-center gap-2">
          {plaidConnected ? (
            confirming === 'plaid' ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs" style={{ color: 'var(--color-warning)' }}>Disconnect?</span>
                <button
                  onClick={() => handleDisconnect('plaid')}
                  disabled={disconnecting === 'plaid'}
                  className="font-mono text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                >
                  {disconnecting === 'plaid' ? '…' : 'Yes'}
                </button>
                <button onClick={() => setConfirming(null)}
                  className="font-mono text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className="font-mono text-xs" style={{ color: 'var(--teal)' }}>✓ Connected</span>
                <button
                  onClick={() => setConfirming('plaid')}
                  disabled={!!connecting || !!disconnecting}
                  className="font-mono text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer' }}
                >
                  Disconnect
                </button>
              </>
            )
          ) : (
            <span className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
              Connect via Finance widget
            </span>
          )}
        </div>
      </div>

      {/* Obsidian — local, no OAuth */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          opacity: 0.7,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.6)' }}
          />
          <span style={{ fontSize: '20px' }}>🔮</span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                Obsidian
              </p>
              <span
                className="font-mono px-1.5 rounded"
                style={{
                  background: 'rgba(245,158,11,0.1)',
                  color: 'var(--color-warning)',
                  fontSize: '10px',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}
              >
                LOCAL
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Local REST API — no OAuth required
            </p>
            <p className="font-mono mt-0.5" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
              Configure OBSIDIAN_API_KEY in .env
            </p>
          </div>
        </div>
        <span className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
          Local only
        </span>
      </div>
    </div>
  );
}

// ─── AnimationPanel ───────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.22s ease',
        background: enabled
          ? 'linear-gradient(90deg, rgba(80,55,210,0.9), rgba(30,190,140,0.85))'
          : 'var(--surface2)',
        boxShadow: enabled ? '0 0 8px rgba(80,55,210,0.35)' : 'none',
        outline: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: enabled ? '#fff' : 'var(--text-faint)',
          left: enabled ? '23px' : '3px',
          transition: 'left 0.22s ease, background 0.22s ease',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        }}
      />
    </button>
  );
}

function AnimationPanel() {
  const { animationEnabled, setAnimationEnabled } = useRevealStore();

  return (
    <div className="flex flex-col gap-6">
      {/* Section header */}
      <div>
        <h3
          className="font-mono text-xs font-semibold uppercase mb-1"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}
        >
          Dashboard Animation
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Controls the wave reveal animation that plays when your dashboard loads.
          This setting is saved permanently in your browser.
        </p>
      </div>

      {/* Toggle row */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: '20px' }}>✦</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              Wave Reveal Animation
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {animationEnabled
                ? 'Plays a wave animation when the dashboard loads'
                : 'Dashboard loads instantly without animation'}
            </p>
          </div>
        </div>
        <Toggle enabled={animationEnabled} onChange={setAnimationEnabled} />
      </div>

      {/* Status note */}
      <p className="text-xs" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
        Changes take effect on the next page load or tab refresh.
      </p>
    </div>
  );
}

// ─── SearchBarPanel ───────────────────────────────────────────────────────────

const ENGINES = [
  { id: 'google',     name: 'Google',     domain: 'google.com'        },
  { id: 'duckduckgo', name: 'DuckDuckGo', domain: 'duckduckgo.com'    },
  { id: 'bing',       name: 'Bing',       domain: 'bing.com'          },
  { id: 'perplexity', name: 'Perplexity', domain: 'perplexity.ai'     },
];

function SettingsToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        flexShrink: 0, transition: 'background 0.22s ease',
        background: enabled
          ? 'linear-gradient(90deg, rgba(80,55,210,0.9), rgba(30,190,140,0.85))'
          : 'var(--surface2)',
        boxShadow: enabled ? '0 0 8px rgba(80,55,210,0.35)' : 'none',
        outline: 'none',
      }}
    >
      <span style={{
        position: 'absolute', width: 18, height: 18, borderRadius: '50%',
        background: enabled ? '#fff' : 'var(--text-faint)',
        left: enabled ? 23 : 3,
        transition: 'left 0.22s ease, background 0.22s ease',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
      }} />
    </button>
  );
}

interface ShortcutRowProps {
  id: string;
  trigger: string;
  url: string;
  onUpdate: (id: string, trigger: string, url: string) => void;
  onDelete: (id: string) => void;
}

function ShortcutRow({ id, trigger, url, onUpdate, onDelete }: ShortcutRowProps) {
  const [editing, setEditing] = useState(false);
  const [eTrigger, setETrigger] = useState(trigger);
  const [eUrl, setEUrl] = useState(url);

  function commitEdit() {
    if (eTrigger.trim() && eUrl.trim()) {
      onUpdate(id, eTrigger.trim(), eUrl.trim());
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--row-bg)', borderRadius: 8, border: '1px solid rgba(66,133,244,0.3)' }}>
        <input
          value={eTrigger}
          onChange={(e) => setETrigger(e.target.value)}
          placeholder="trigger"
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          style={{
            width: 70, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '3px 7px', fontSize: 12, color: 'var(--text)',
            fontFamily: 'var(--font-mono, monospace)', outline: 'none',
          }}
        />
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>→</span>
        <input
          value={eUrl}
          onChange={(e) => setEUrl(e.target.value)}
          placeholder="https://..."
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '3px 7px', fontSize: 12, color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button onClick={commitEdit} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'rgba(66,133,244,0.15)', color: 'rgba(66,133,244,0.9)', border: '1px solid rgba(66,133,244,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Save
        </button>
        <button onClick={() => setEditing(false)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'rgba(99,160,255,0.9)', fontWeight: 600, minWidth: 40 }}>
        {trigger}
      </span>
      <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>→</span>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {url}
      </span>
      <button
        onClick={() => { setETrigger(trigger); setEUrl(url); setEditing(true); }}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'transparent', color: 'var(--text-faint)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
      >
        Edit
      </button>
      <button
        onClick={() => onDelete(id)}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.07)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}

function SearchBarPanel() {
  const load           = useOmnibarStore((s) => s.load);
  const settings       = useOmnibarStore((s) => s.settings);
  const shortcuts      = useOmnibarStore((s) => s.shortcuts);
  const saveSettings   = useOmnibarStore((s) => s.saveSettings);
  const addShortcut    = useOmnibarStore((s) => s.addShortcut);
  const updateShortcut = useOmnibarStore((s) => s.updateShortcut);
  const deleteShortcut = useOmnibarStore((s) => s.deleteShortcut);
  const clearHistory   = useOmnibarStore((s) => s.clearHistory);

  const [addingShortcut, setAddingShortcut] = useState(false);
  const [newTrigger, setNewTrigger]         = useState('');
  const [newUrl, setNewUrl]                 = useState('');
  const [addError, setAddError]             = useState('');
  const [savingShortcut, setSavingShortcut] = useState(false);
  const [confirmClear, setConfirmClear]     = useState(false);
  const [clearing, setClearing]             = useState(false);
  const [clearDone, setClearDone]           = useState(false);

  const newTriggerRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [load]);

  async function handleAddShortcut() {
    setAddError('');
    if (!newTrigger.trim()) { setAddError('Trigger cannot be empty'); return; }
    if (!newUrl.trim())     { setAddError('URL cannot be empty'); return; }
    setSavingShortcut(true);
    const result = await addShortcut(newTrigger.trim(), newUrl.trim());
    setSavingShortcut(false);
    if (!result) { setAddError('Trigger already exists or save failed'); return; }
    setNewTrigger('');
    setNewUrl('');
    setAddingShortcut(false);
  }

  async function handleClearHistory() {
    setClearing(true);
    await clearHistory();
    setClearing(false);
    setConfirmClear(false);
    setClearDone(true);
    setTimeout(() => setClearDone(false), 3000);
  }

  const sectionHeader = (label: string) => (
    <h3 className="font-mono text-xs font-semibold uppercase mb-3"
      style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}>
      {label}
    </h3>
  );

  const settingRow = (icon: string, label: string, desc: string, key: keyof typeof settings, value: boolean) => (
    <div className="flex items-center justify-between p-4 rounded-xl"
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
        </div>
      </div>
      <SettingsToggle enabled={value} onChange={(v) => saveSettings({ [key]: v })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* ── Default Search Engine ── */}
      <div>
        {sectionHeader('Default Search Engine')}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ENGINES.map((eng) => {
            const active = settings.searchEngine === eng.id;
            return (
              <button
                key={eng.id}
                onClick={() => saveSettings({ searchEngine: eng.id })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
                  border: active ? '1px solid rgba(66,133,244,0.55)' : '1px solid var(--border)',
                  background: active ? 'rgba(66,133,244,0.1)' : 'var(--surface2)',
                  color: active ? 'rgba(99,160,255,0.95)' : 'var(--text-muted)',
                  fontSize: 13, transition: 'all 0.15s',
                  fontFamily: 'inherit',
                  boxShadow: active ? '0 0 0 1px rgba(66,133,244,0.2)' : 'none',
                }}
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${eng.domain}&sz=32`}
                  width={14} height={14} style={{ borderRadius: 2, flexShrink: 0 }}
                />
                {eng.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Behaviour toggles ── */}
      <div>
        {sectionHeader('Behaviour')}
        <div className="flex flex-col gap-2">
          {settingRow('🔗', 'Smart URL Detection',
            'Detect URLs and navigate directly instead of searching',
            'smartUrl', settings.smartUrl)}
          {settingRow('🪟', 'Open in New Tab',
            'Links open in a new browser tab rather than the same tab',
            'openNewTab', settings.openNewTab)}
          {settingRow('💡', 'Show Autocomplete',
            'Display shortcut, history, and popular site suggestions while typing',
            'showSuggestions', settings.showSuggestions)}
        </div>
      </div>

      {/* ── Quick Launch ── */}
      <div>
        {sectionHeader('Quick Launch Mode')}
        <div className="flex items-center justify-between p-4 rounded-xl"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Quick Launch</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Navigate instantly on Enter if the input exactly matches a shortcut or a domain you've visited more than 10 times
              </p>
            </div>
          </div>
          <SettingsToggle enabled={settings.quickLaunch} onChange={(v) => saveSettings({ quickLaunch: v })} />
        </div>
      </div>

      {/* ── Keyword Shortcuts ── */}
      <div>
        {sectionHeader('Keyword Shortcuts')}
        <div className="flex flex-col gap-2">
          {shortcuts.map((sc) => (
            <ShortcutRow
              key={sc.id}
              id={sc.id}
              trigger={sc.trigger}
              url={sc.url}
              onUpdate={updateShortcut}
              onDelete={deleteShortcut}
            />
          ))}

          {/* Add shortcut form */}
          {addingShortcut ? (
            <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(66,133,244,0.3)', background: 'var(--row-bg)' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: addError ? 6 : 8 }}>
                <input
                  ref={newTriggerRef}
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  placeholder="trigger"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddShortcut(); if (e.key === 'Escape') setAddingShortcut(false); }}
                  autoFocus
                  style={{
                    width: 90, background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--text)',
                    fontFamily: 'var(--font-mono, monospace)', outline: 'none',
                  }}
                />
                <span style={{ color: 'var(--text-faint)', fontSize: 13, alignSelf: 'center' }}>→</span>
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddShortcut(); if (e.key === 'Escape') setAddingShortcut(false); }}
                  style={{
                    flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--text)', outline: 'none',
                  }}
                />
              </div>
              {addError && (
                <p style={{ fontSize: 11, color: 'var(--color-danger)', marginBottom: 6 }}>{addError}</p>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleAddShortcut}
                  disabled={savingShortcut}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, background: 'rgba(66,133,244,0.15)', color: 'rgba(66,133,244,0.9)', border: '1px solid rgba(66,133,244,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {savingShortcut ? '…' : 'Save'}
                </button>
                <button
                  onClick={() => { setAddingShortcut(false); setAddError(''); setNewTrigger(''); setNewUrl(''); }}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setAddingShortcut(true); setAddError(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                borderRadius: 8, border: '1px dashed rgba(66,133,244,0.3)',
                background: 'rgba(66,133,244,0.04)', color: 'rgba(99,160,255,0.8)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
              Add shortcut
            </button>
          )}
        </div>
      </div>

      {/* ── Navigation History ── */}
      <div>
        {sectionHeader('Navigation History')}
        <div className="flex items-center justify-between p-4 rounded-xl"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Clear Navigation History</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Removes all your personal autocomplete suggestions from the Recent layer
            </p>
          </div>
          <div className="flex-shrink-0 ml-4">
            {clearDone ? (
              <span className="font-mono text-xs" style={{ color: 'var(--teal)' }}>✓ Cleared</span>
            ) : confirmClear ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="font-mono text-xs" style={{ color: 'var(--color-warning)' }}>Sure?</span>
                <button
                  onClick={handleClearHistory}
                  disabled={clearing}
                  className="font-mono text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                >
                  {clearing ? '…' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="font-mono text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="font-mono text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer' }}
              >
                Clear History
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── WidgetsPanel ─────────────────────────────────────────────────────────────

function WidgetsPanel() {
  const { swapNotifyEnabled, setSwapNotifyEnabled } = useStore();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3
          className="font-mono text-xs font-semibold uppercase mb-1"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}
        >
          Widget Interactions
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Controls for drag-and-drop behaviour and swap confirmation prompts.
        </p>
      </div>

      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: '20px' }}>⇄</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              Size-change swap warning
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {swapNotifyEnabled
                ? 'Shows a confirmation dialog when swapping widgets of different sizes'
                : 'Swaps widgets of any size instantly without confirmation'}
            </p>
          </div>
        </div>
        <Toggle enabled={swapNotifyEnabled} onChange={setSwapNotifyEnabled} />
      </div>
    </div>
  );
}

// ─── DesktopAppPanel ──────────────────────────────────────────────────────────

function GatekeeperFix() {
  const [copied, setCopied] = useState(false);
  const cmd = 'xattr -cr /Applications/NEXUS.app && open /Applications/NEXUS.app';

  function handleCopy() {
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '8px 12px',
      }}
    >
      <code style={{ flex: 1, fontSize: '12px', fontFamily: 'var(--font-sans)', color: 'var(--text)', userSelect: 'all' }}>
        {cmd}
      </code>
      <button
        onClick={handleCopy}
        style={{
          flexShrink: 0,
          padding: '4px 10px',
          background: copied ? 'rgba(var(--accent-rgb),0.15)' : 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          fontSize: '11px',
          color: copied ? 'var(--accent)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          transition: 'all 0.15s',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

const DMG_DOWNLOAD_URL_ARM   = 'https://github.com/Deer-Leeon/AICommandCenter/releases/latest/download/NEXUS-1.0.0-arm64.dmg';
const DMG_DOWNLOAD_URL_INTEL = 'https://github.com/Deer-Leeon/AICommandCenter/releases/latest/download/NEXUS-1.0.0-x64.dmg';

function DesktopAppPanel() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText('https://nexus.lj-buchmiller.com').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Hero */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.08) 0%, rgba(var(--accent-rgb),0.02) 100%)',
          border: '1px solid rgba(var(--accent-rgb),0.18)',
          borderRadius: '16px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '32px' }}>🖥</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>NEXUS for Mac</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Native desktop app · Menu bar tray · Global shortcut · Auto-updates
            </div>
          </div>
        </div>
      </div>

      {/* Download buttons */}
      <div>
        <div
          style={{ fontSize: '11px', fontFamily: 'var(--font-sans)', letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}
        >
          Download
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <a
            href={DMG_DOWNLOAD_URL_ARM}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: '14px',
              background: 'var(--accent)',
              borderRadius: '12px',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '14px',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <span>⬇ Download for Mac</span>
            <span style={{ fontSize: '11px', opacity: 0.75, fontWeight: 400 }}>Apple Silicon (M1/M2/M3)</span>
          </a>
          <a
            href={DMG_DOWNLOAD_URL_INTEL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: '14px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              color: 'var(--text)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '14px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface3, var(--surface2))')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
          >
            <span>⬇ Download for Mac</span>
            <span style={{ fontSize: '11px', opacity: 0.6, fontWeight: 400 }}>Intel (x64)</span>
          </a>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
          macOS 12 Monterey or later required
        </div>
      </div>

      {/* Installation steps */}
      <div>
        <div
          style={{ fontSize: '11px', fontFamily: 'var(--font-sans)', letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}
        >
          How to Install
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { n: '1', text: 'Download the .dmg file above' },
            { n: '2', text: 'Open the .dmg and drag NEXUS into Applications' },
            { n: '3', text: 'Open NEXUS from Launchpad or Applications' },
            { n: '4', text: 'Sign in with your existing NEXUS account — all your widgets and pages are already there' },
          ].map(({ n, text }) => (
            <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span
                style={{
                  width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-sans)',
                }}
              >
                {n}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text)', paddingTop: '2px' }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Gatekeeper warning */}
        <div
          style={{
            marginTop: '12px',
            padding: '12px 14px',
            background: 'rgba(255, 180, 0, 0.08)',
            border: '1px solid rgba(255, 180, 0, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
              Seeing "NEXUS is damaged" on first open?
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
            macOS quarantines unsigned apps downloaded from the internet. Run this once in <strong>Terminal</strong> to fix it:
          </div>
          <GatekeeperFix />
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Open <strong>Terminal</strong> (press <strong>⌘ Space</strong>, type <em>Terminal</em>, press Enter) → paste the command above → press Enter. Then open NEXUS normally.
          </div>
        </div>
      </div>

      {/* Features list */}
      <div>
        <div
          style={{ fontSize: '11px', fontFamily: 'var(--font-sans)', letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}
        >
          Desktop Features
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            { icon: '⌘', text: 'Global shortcut Cmd+Shift+N — open NEXUS from anywhere' },
            { icon: '🔔', text: 'Native Mac notifications for Pomodoro, Chess, shared widgets' },
            { icon: '🗂', text: 'Menu bar tray — Spotify, Pomodoro, calendar at a glance' },
            { icon: '🔄', text: 'Auto-updates silently in the background' },
            { icon: '🔒', text: 'Same account, same widgets, same data as the web app' },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', background: 'var(--surface2)', borderRadius: '8px' }}>
              <span style={{ fontSize: '15px', flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Web fallback note */}
      <div
        style={{
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '16px', flexShrink: 0 }}>🌐</span>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>
            Prefer the browser?
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              nexus.lj-buchmiller.com
            </span>
            <button
              onClick={handleCopy}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '11px', color: 'var(--accent)', padding: '0',
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────

interface SettingsModalProps {
  onClose:     () => void;
  initialTab?: SettingsTab;
}

export function SettingsModal({ onClose, initialTab }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'account');

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: 'var(--overlay-bg)',
        zIndex: 60,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      // Click backdrop to close
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-modal)',
          width: '680px',
          maxWidth: '95vw',
          height: '820px',
          maxHeight: '94vh',
        }}
      >
        {/* ── Title bar ── */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}
        >
          <span
            className="font-mono text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}
          >
            Settings
          </span>
          <button
            onClick={onClose}
            className="nexus-teal-btn text-xs px-3 py-1 rounded-lg font-mono"
            style={{ cursor: 'pointer' }}
          >
            Done
          </button>
        </div>

        {/* ── Body: left nav + right content ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <div
            className="flex flex-col gap-1 p-2 flex-shrink-0 overflow-y-auto nexus-scroll"
            style={{
              width: '160px',
              background: 'var(--surface)',
              borderRight: '1px solid var(--border)',
            }}
          >
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left w-full"
                style={{
                  background: activeTab === item.id ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${activeTab === item.id ? `rgba(var(--accent-rgb), 0.2)` : 'transparent'}`,
                  color: activeTab === item.id ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== item.id) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--row-bg)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== item.id) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                  }
                }}
              >
                <span style={{ fontSize: '15px', flexShrink: 0 }}>{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}

            {/* Privacy policy link — pinned at bottom of sidebar */}
            <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  padding: '6px 12px',
                  fontSize: '11px',
                  color: 'var(--text-faint)',
                  textDecoration: 'none',
                  borderRadius: 6,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'; }}
              >
                Privacy Policy
              </a>
            </div>
          </div>

          {/* Right content — all panels mount immediately so API calls fire
              in parallel; CSS visibility hides inactive panels instantly */}
          <div className="flex-1 overflow-y-auto nexus-scroll p-5" style={{ position: 'relative' }}>
            {(['account', 'permissions', 'connections', 'animation', 'searchbar', 'widgets', 'desktop'] as const).map((tab) => (
              <div key={tab} style={{ display: activeTab === tab ? 'block' : 'none' }}>
                {tab === 'account'     && <AccountPanel />}
                {tab === 'permissions' && <PermissionsPanel />}
                {tab === 'connections' && <ConnectionsPanel />}
                {tab === 'animation'   && <AnimationPanel />}
                {tab === 'searchbar'   && <SearchBarPanel />}
                {tab === 'widgets'     && <WidgetsPanel />}
                {tab === 'desktop'     && <DesktopAppPanel />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
