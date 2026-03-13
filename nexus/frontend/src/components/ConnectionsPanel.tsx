/**
 * ConnectionsPanel — rendered inside SettingsModal when the "Connections" tab
 * is active.  Handles the full invite / pending / active connection lifecycle.
 *
 * Design principles:
 *  - Invite input is ALWAYS visible so you can add more friends any time
 *  - Active connections are the focal point — prominent cards
 *  - Pending requests are compact, low-key rows — visible but not in your face
 */
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { useConnections, type Connection } from '../hooks/useConnections';
import { nexusSSE } from '../lib/nexusSSE';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function lastSeenLabel(lastSeen: string | null): string {
  if (!lastSeen) return 'never seen';
  return `last seen ${timeAgo(lastSeen)}`;
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

// ── Presence dot ─────────────────────────────────────────────────────────────

function PresenceDotInline({ isOnline, lastSeen }: { isOnline: boolean; lastSeen: string | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        display:      'inline-block',
        width:        7, height: 7,
        borderRadius: '50%',
        background:   isOnline ? '#3de8b0' : 'var(--text-faint)',
        boxShadow:    isOnline ? '0 0 0 2px rgba(61,232,176,0.22)' : 'none',
        animation:    isOnline ? 'nexusPresencePulse 2s ease-in-out infinite' : 'none',
        flexShrink:   0,
      }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {isOnline ? 'Online' : lastSeenLabel(lastSeen)}
      </span>
    </span>
  );
}

// ── Disconnect confirm modal ──────────────────────────────────────────────────

function DisconnectModal({ partnerName, onConfirm, onCancel, loading }: {
  partnerName: string; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)',
               display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 16, padding: 28, width: 400, maxWidth: '92vw',
                    boxShadow: 'var(--shadow-modal)' }}>
        <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 10 }}>
          Disconnect from {partnerName}?
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
          This will permanently remove the connection and all shared widget data.
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
            background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} style={{ padding: '7px 16px', borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer', background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', fontSize: 13, opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Active connection card ────────────────────────────────────────────────────

function ActiveCard({ conn, onDisconnected }: { conn: Connection; onDisconnected: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [dissolving,  setDissolving]  = useState(false);

  const dissolve = async () => {
    setDissolving(true);
    await apiFetch(`/api/connections/${conn.connection_id}`, { method: 'DELETE' });
    setDissolving(false);
    setShowConfirm(false);
    onDisconnected();
  };

  const { partner, presence } = conn;
  const isOnline = presence?.isOnline ?? false;
  const ini = initials(partner?.displayName ?? '?');

  return (
    <>
      {showConfirm && (
        <DisconnectModal
          partnerName={partner?.displayName ?? 'this user'}
          onConfirm={dissolve} onCancel={() => setShowConfirm(false)} loading={dissolving}
        />
      )}
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '12px 14px', marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Avatar */}
        <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(61,232,176,0.18)', border: '1px solid rgba(61,232,176,0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: 'var(--teal)', letterSpacing: '0.02em' }}>
          {ini}
        </div>
        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {partner?.displayName ?? 'Unknown'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {partner?.username && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>@{partner.username}</span>
            )}
            <PresenceDotInline isOnline={isOnline} lastSeen={presence?.lastSeen ?? null} />
          </div>
        </div>
        {/* Disconnect */}
        <button
          onClick={() => setShowConfirm(true)}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                   background: 'transparent', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.07)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
        >
          Disconnect
        </button>
      </div>
    </>
  );
}

// ── Compact incoming request row ──────────────────────────────────────────────

function IncomingRow({ conn, onAction }: { conn: Connection; onAction: () => void }) {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  const accept = async () => {
    setAccepting(true);
    await apiFetch(`/api/connections/${conn.connection_id}/accept`, { method: 'POST' });
    setAccepting(false);
    onAction();
  };

  const decline = async () => {
    setDeclining(true);
    await apiFetch(`/api/connections/${conn.connection_id}/decline`, { method: 'POST' });
    setDeclining(false);
    onAction();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                  borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          {conn.partner?.displayName ?? 'Someone'}
        </span>
        {conn.partner?.username && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 5 }}>
            @{conn.partner.username}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 5 }}>
          · {timeAgo(conn.created_at)}
        </span>
      </div>
      <button
        onClick={accept} disabled={accepting || declining}
        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                 background: 'rgba(61,232,176,0.12)', border: '1px solid rgba(61,232,176,0.35)',
                 color: 'var(--teal)', opacity: accepting ? 0.6 : 1 }}
      >
        {accepting ? '…' : 'Accept'}
      </button>
      <button
        onClick={decline} disabled={accepting || declining}
        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                 background: 'transparent', border: '1px solid var(--border)',
                 color: 'var(--text-muted)', opacity: declining ? 0.6 : 1 }}
      >
        {declining ? '…' : 'Decline'}
      </button>
    </div>
  );
}

// ── Compact outgoing request row ──────────────────────────────────────────────

function OutgoingRow({ conn, onCancelled }: { conn: Connection; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    await apiFetch(`/api/connections/${conn.connection_id}/cancel`, { method: 'DELETE' });
    setCancelling(false);
    onCancelled();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                  borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text)' }}>
          {conn.partner?.displayName ?? 'Unknown'}
        </span>
        {conn.partner?.username && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 5 }}>
            @{conn.partner.username}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 5 }}>
          · {timeAgo(conn.created_at)}
        </span>
      </div>
      <button
        onClick={cancel} disabled={cancelling}
        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                 background: 'transparent', border: '1px solid var(--border)',
                 color: 'var(--text-muted)', opacity: cancelling ? 0.5 : 1 }}
      >
        {cancelling ? '…' : 'Cancel'}
      </button>
    </div>
  );
}

// ── Collapsible pending section ───────────────────────────────────────────────

function PendingSection({ incoming, outgoing, onAction }: {
  incoming: Connection[]; outgoing: Connection[]; onAction: () => void;
}) {
  const total = incoming.length + outgoing.length;
  const [open, setOpen] = useState(true); // default open so requests aren't hidden

  if (total === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      {/* Compact header — acts as toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                 cursor: 'pointer', padding: 0, marginBottom: open ? 6 : 0, width: '100%' }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                       color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Pending requests
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)',
                       background: 'rgba(61,232,176,0.12)', border: '1px solid rgba(61,232,176,0.25)',
                       borderRadius: 10, padding: '1px 6px', lineHeight: 1.5 }}>
          {total}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto', transition: 'transform 0.15s',
                       transform: open ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>
          ▾
        </span>
      </button>

      {open && (
        <div>
          {/* Incoming label if both types exist */}
          {incoming.length > 0 && outgoing.length > 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '4px 0 0',
                        fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Incoming ({incoming.length})
            </p>
          )}
          {incoming.map(c => (
            <IncomingRow key={c.connection_id} conn={c} onAction={onAction} />
          ))}

          {outgoing.length > 0 && incoming.length > 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '10px 0 0',
                        fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Sent ({outgoing.length})
            </p>
          )}
          {outgoing.map(c => (
            <OutgoingRow key={c.connection_id} conn={c} onCancelled={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ConnectionsPanel() {
  const { active, outgoing, incoming, loading, refresh } = useConnections(true);

  const [query,      setQuery]      = useState('');
  const [sending,    setSending]    = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sendInvite = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSending(true);
    setSendResult(null);
    try {
      const res  = await apiFetch('/api/connections/invite', {
        method: 'POST',
        body:   JSON.stringify({ usernameOrEmail: q }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setSendResult({ ok: false, msg: data.error ?? 'Something went wrong' });
      } else {
        setSendResult({ ok: true, msg: 'Invite sent!' });
        setQuery('');
        refresh();
        setTimeout(() => setSendResult(null), 3000);
      }
    } catch {
      setSendResult({ ok: false, msg: 'Network error' });
    } finally {
      setSending(false);
    }
  }, [query, refresh]);

  // Re-fetch on SSE connection events
  useEffect(() => {
    return nexusSSE.subscribe((e) => {
      if (e.type.startsWith('connection:') || e.type === 'connections:init') refresh();
    });
  }, [refresh]);

  const inputStyle: CSSProperties = {
    flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', outline: 'none',
  };

  const btnStyle: CSSProperties = {
    padding: '8px 16px', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer',
    background: 'rgba(61,232,176,0.12)', border: '1px solid rgba(61,232,176,0.35)',
    color: 'var(--teal)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
    opacity: sending ? 0.6 : 1,
  };

  return (
    <div>
      <style>{`
        @keyframes nexusPresencePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(61,232,176,0.4); }
          50%       { box-shadow: 0 0 0 5px rgba(61,232,176,0); }
        }
      `}</style>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  color: 'var(--text-faint)', textTransform: 'uppercase',
                  letterSpacing: '0.12em', margin: '0 0 4px' }}>
        Connections
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
        Connect with NEXUS users to share widgets in real time.
      </p>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Loading…</p>
      ) : (
        <>
          {/* ── Invite input — always visible ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSendResult(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !sending) sendInvite(); }}
              placeholder="@username or email"
              style={inputStyle}
              onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = 'rgba(61,232,176,0.5)')}
              onBlur={(e)  => ((e.target as HTMLInputElement).style.borderColor = 'var(--border)')}
            />
            <button onClick={sendInvite} disabled={sending || !query.trim()} style={btnStyle}>
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {sendResult && (
            <p style={{ fontSize: 12, margin: '0 0 14px',
                        color: sendResult.ok ? 'var(--teal)' : 'var(--color-danger)' }}>
              {sendResult.msg}
            </p>
          )}

          {/* ── Active connections ── */}
          {active.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                          color: 'var(--text-faint)', textTransform: 'uppercase',
                          letterSpacing: '0.12em', margin: '16px 0 8px' }}>
                Connected{active.length > 1 ? ` (${active.length})` : ''}
              </p>
              {active.map(c => (
                <ActiveCard key={c.connection_id} conn={c} onDisconnected={refresh} />
              ))}
            </>
          )}

          {/* ── Pending requests — compact & collapsible ── */}
          <PendingSection incoming={incoming} outgoing={outgoing} onAction={refresh} />

          {/* ── Empty state ── */}
          {active.length === 0 && outgoing.length === 0 && incoming.length === 0 && !sendResult && (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
              No connections yet. Send an invite above to get started.
            </p>
          )}
        </>
      )}
    </div>
  );
}
