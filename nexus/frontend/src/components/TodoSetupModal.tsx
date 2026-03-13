/**
 * TodoSetupModal — shown when the user drops a To-Do widget onto the grid.
 *
 * Step 1: Choose Personal or Shared.
 * Step 2 (Shared only): Choose which connected friend to share with.
 *
 * onConfirm(connectionId | null)
 *   null  → personal widget, place normally
 *   string → shared widget, bind to this connectionId
 */
import { useState } from 'react';
import { useConnections } from '../hooks/useConnections';

interface TodoSetupModalProps {
  onConfirm: (connectionId: string | null) => void;
  onCancel:  () => void;
  /** Callback to open the Connections settings panel */
  onOpenConnections: () => void;
}

type Step = 'choose' | 'pick-friend';

export function TodoSetupModal({ onConfirm, onCancel, onOpenConnections }: TodoSetupModalProps) {
  const [step, setStep] = useState<Step>('choose');
  const { active, loading } = useConnections(true);

  // ── Step 1 ───────────────────────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <Overlay onClickOutside={onCancel}>
        <ModalCard>
          <ModalHeader icon="✅" title="Set up your To-Do list" />

          <div className="p-5 flex flex-col gap-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Choose how you want to use this widget.
            </p>

            {/* Personal card */}
            <OptionCard
              icon="🔒"
              title="Personal"
              description="Just for you. Your private to-do list."
              accentColor="var(--teal)"
              onClick={() => onConfirm(null)}
            />

            {/* Shared card */}
            <OptionCard
              icon="🤝"
              title="Shared"
              description="Collaborate with a friend. You both see and edit the same list in real time."
              accentColor="#a78bfa"
              onClick={() => setStep('pick-friend')}
            />
          </div>

          <ModalFooter>
            <CancelButton onClick={onCancel} />
          </ModalFooter>
        </ModalCard>
      </Overlay>
    );
  }

  // ── Step 2 — Pick a friend ───────────────────────────────────────────────────
  const hasFriends = active.length > 0;

  return (
    <Overlay onClickOutside={onCancel}>
      <ModalCard>
        <ModalHeader icon="🤝" title="Choose a friend to share with" />

        <div className="p-5 flex flex-col gap-3">
          {loading ? (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Loading connections…</p>
          ) : !hasFriends ? (
            <NoFriendsState
              onOpenConnections={() => { onCancel(); onOpenConnections(); }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {active.map((conn) => {
                const p        = conn.partner;
                const isOnline = conn.presence?.isOnline ?? false;
                const name     = p?.displayName || (p?.username ? `@${p.username}` : 'Unknown');
                const username = p?.username ? `@${p.username}` : null;

                return (
                  <button
                    key={conn.connection_id}
                    onClick={() => onConfirm(conn.connection_id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{
                      background: 'var(--row-bg)',
                      border:     '1px solid var(--border)',
                      cursor:     'pointer',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = '#a78bfa60';
                      (e.currentTarget as HTMLElement).style.background  = 'rgba(167,139,250,0.07)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                      (e.currentTarget as HTMLElement).style.background  = 'var(--row-bg)';
                    }}
                  >
                    {/* Avatar circle */}
                    <div
                      className="flex items-center justify-center rounded-full flex-shrink-0 font-semibold text-xs"
                      style={{ width: 32, height: 32, background: '#a78bfa25', color: '#a78bfa' }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>

                    {/* Name + username */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{name}</p>
                      {username && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-faint)', fontFamily: 'monospace' }}>{username}</p>
                      )}
                    </div>

                    {/* Presence dot */}
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background:  isOnline ? '#22c55e' : 'var(--text-faint)',
                        boxShadow:   isOnline ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
                        display: 'inline-block',
                      }}
                      title={isOnline ? 'Online' : 'Offline'}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ModalFooter>
          <BackButton onClick={() => setStep('choose')} />
          <CancelButton onClick={onCancel} />
        </ModalFooter>
      </ModalCard>
    </Overlay>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Overlay({ children, onClickOutside }: { children: React.ReactNode; onClickOutside: () => void }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 62, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', pointerEvents: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClickOutside(); }}
    >
      {children}
    </div>
  );
}

function ModalCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)', width: 420, maxWidth: '90vw' }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function ModalHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span className="font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}>
        {title}
      </span>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pb-5 flex gap-2 justify-end">
      {children}
    </div>
  );
}

interface OptionCardProps {
  icon:         string;
  title:        string;
  description:  string;
  accentColor:  string;
  onClick:      () => void;
}

function OptionCard({ icon, title, description, accentColor, onClick }: OptionCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 px-4 py-3.5 rounded-xl text-left transition-all"
      style={{
        background: 'var(--row-bg)',
        border:     `1px solid var(--border)`,
        cursor:     'pointer',
        width:      '100%',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}60`;
        (e.currentTarget as HTMLElement).style.background  = `${accentColor}08`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.background  = 'var(--row-bg)';
      }}
    >
      <div
        className="flex items-center justify-center rounded-xl flex-shrink-0 mt-0.5"
        style={{ width: 36, height: 36, background: `${accentColor}18`, fontSize: 18 }}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{title}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{description}</p>
      </div>
    </button>
  );
}

function NoFriendsState({ onOpenConnections }: { onOpenConnections: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <span style={{ fontSize: 28 }}>👥</span>
      <p className="text-sm" style={{ color: 'var(--text)', lineHeight: 1.5 }}>
        You have no connected friends yet.
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Go to Settings → Connections to invite someone, then come back to add a shared list.
      </p>
      <button
        onClick={onOpenConnections}
        className="text-xs px-4 py-2 rounded-lg mt-1"
        style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)', cursor: 'pointer' }}
      >
        Open Connections →
      </button>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-xs px-4 py-2 rounded-lg"
      style={{ background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
    >
      ← Back
    </button>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-xs px-4 py-2 rounded-lg"
      style={{ background: 'transparent', color: 'var(--text-faint)', border: '1px solid var(--border)', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'; }}
    >
      Cancel
    </button>
  );
}
