import {
  useState, useEffect, useRef, useCallback, useMemo,
  type KeyboardEvent, type CSSProperties,
} from 'react';
import { apiFetch } from '../../lib/api';
import { nexusSSE } from '../../lib/nexusSSE';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GmailThread {
  threadId: string;
  snippet: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  date: string;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
  labelIds: string[];
  messageCount: number;
}

interface GmailMessage {
  messageId: string;
  threadId: string;
  labelIds: string[];
  senderName: string;
  senderEmail: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  attachments: { name: string; size: number; mimeType: string; attachmentId: string }[];
  unread: boolean;
  starred: boolean;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
  unreadCount: number;
  totalCount: number;
}

type GmailView = 'inbox' | 'labels' | 'search' | 'thread' | 'compose';

// ── Avatar colours ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#7c6aff','#3de8b0','#e86b4f','#4f9de8','#e8c44f',
  '#b44fe8','#4fe8a0','#e84f9d','#4fb4e8','#e84f4f',
  '#4fe8e8','#a0e84f',
];

function avatarColorFor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// ── Label colours ─────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  INBOX: 'var(--accent)',
  CATEGORY_SOCIAL: '#1a73e8',
  CATEGORY_PROMOTIONS: '#e8710a',
  CATEGORY_UPDATES: '#188038',
  STARRED: '#f4b400',
  SENT: 'var(--text-muted)',
  DRAFT: '#e8693f',
};

function labelColor(id: string): string {
  return LABEL_COLORS[id] ?? 'var(--text-muted)';
}

function labelDisplayName(label: GmailLabel): string {
  return label.name
    .replace('CATEGORY_', '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', alignItems: 'center' }}>
      <div className="gmail-shimmer" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="gmail-shimmer" style={{ height: 12, width: '55%', borderRadius: 4 }} />
        <div className="gmail-shimmer" style={{ height: 11, width: '75%', borderRadius: 4 }} />
        <div className="gmail-shimmer" style={{ height: 10, width: '90%', borderRadius: 4 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div className="gmail-shimmer" style={{ height: 10, width: 36, borderRadius: 4 }} />
        <div className="gmail-shimmer" style={{ height: 14, width: 14, borderRadius: '50%' }} />
      </div>
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number; y: number;
  thread: GmailThread;
  onAction: (action: string, threadId: string) => void;
  onClose: () => void;
}

function ContextMenu({ x, y, thread, onAction, onClose }: ContextMenuProps) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  const items = [
    { label: thread.unread ? 'Mark as Read' : 'Mark as Unread', action: thread.unread ? 'read' : 'unread' },
    { label: thread.starred ? 'Unstar' : 'Star', action: thread.starred ? 'unstar' : 'star' },
    { label: 'Archive', action: 'archive' },
    { label: 'Delete', action: 'delete', danger: true },
  ];

  return (
    <div
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 10, boxShadow: 'var(--shadow-popup)',
        padding: '4px 0', minWidth: 160,
      }}
      onClick={e => e.stopPropagation()}
    >
      {items.map(item => (
        <button
          key={item.action}
          onClick={() => { onAction(item.action, thread.threadId); onClose(); }}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '8px 14px', background: 'none', border: 'none',
            fontSize: 13, cursor: 'pointer',
            color: item.danger ? 'var(--color-danger)' : 'var(--text)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Thread Row ────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  thread: GmailThread;
  onOpen: (thread: GmailThread) => void;
  onAction: (action: string, threadId: string) => void;
  compact?: boolean;
}

function ThreadRow({ thread, onOpen, onAction, compact = false }: ThreadRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const color = avatarColorFor(thread.senderEmail);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dy > 20) { setSwipeX(0); return; }
    if (dx < 0) setSwipeX(Math.max(dx, -120));
  }

  function handleTouchEnd() {
    if (swipeX < -60) {
      // Swiped left enough — keep revealed
    } else {
      setSwipeX(0);
    }
  }

  const rowStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: compact ? 'center' : 'flex-start',
    gap: 10,
    padding: compact ? '8px 12px' : '10px 12px',
    cursor: 'pointer',
    transition: 'background 0.2s',
    background: thread.unread ? 'rgba(var(--accent-rgb), 0.04)' : 'transparent',
    borderLeft: thread.unread ? '3px solid var(--accent)' : '3px solid transparent',
    transform: `translateX(${swipeX}px)`,
    overflow: 'hidden',
  };

  return (
    <>
      {/* Swipe-reveal actions */}
      {swipeX < -10 && (
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex', zIndex: 0 }}>
          <button
            onClick={() => { onAction('archive', thread.threadId); setSwipeX(0); }}
            style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '0 18px', cursor: 'pointer', fontSize: 12 }}
          >Archive</button>
          <button
            onClick={() => { onAction('delete', thread.threadId); setSwipeX(0); }}
            style={{ background: 'var(--color-danger)', color: '#fff', border: 'none', padding: '0 18px', cursor: 'pointer', fontSize: 12 }}
          >Delete</button>
        </div>
      )}

      <div
        style={rowStyle}
        onClick={() => onOpen(thread)}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseEnter={e => (e.currentTarget.style.background = thread.unread ? 'rgba(var(--accent-rgb), 0.07)' : 'var(--row-bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = thread.unread ? 'rgba(var(--accent-rgb), 0.04)' : 'transparent')}
      >
        {/* Avatar */}
        <div style={{
          width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: '50%',
          background: color, color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: compact ? 10 : 12, fontWeight: 700,
          flexShrink: 0, fontFamily: 'Space Mono, monospace',
        }}>
          {initials(thread.senderName || thread.senderEmail)}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: compact ? 12 : 13,
            fontWeight: thread.unread ? 700 : 400,
            color: thread.unread ? 'var(--text)' : 'var(--text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {thread.senderName || thread.senderEmail}
            {thread.messageCount > 1 && (
              <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text-muted)', marginLeft: 4 }}>
                {thread.messageCount}
              </span>
            )}
          </div>
          {!compact && (
            <>
              <div style={{
                fontSize: 12, fontWeight: thread.unread ? 600 : 400,
                color: thread.unread ? 'var(--text)' : 'var(--text-muted)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {thread.subject}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-muted)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {thread.snippet}
              </div>
            </>
          )}
          {compact && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {thread.subject}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace', whiteSpace: 'nowrap' }}>
            {formatDate(thread.date)}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {thread.hasAttachment && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>📎</span>}
            <span
              style={{ fontSize: 13, color: thread.starred ? '#f4b400' : 'var(--text-faint)', cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); onAction(thread.starred ? 'unstar' : 'star', thread.threadId); }}
            >
              {thread.starred ? '★' : '☆'}
            </span>
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          thread={thread}
          onAction={onAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Thread reading view ───────────────────────────────────────────────────────

interface MessageCardProps {
  message: GmailMessage;
  defaultExpanded: boolean;
  onReply: (message: GmailMessage) => void;
}

function MessageCard({ message, defaultExpanded, onReply }: MessageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showImages, setShowImages] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const color = avatarColorFor(message.senderEmail);

  useEffect(() => {
    if (!expanded || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const body = message.bodyHtml || `<pre style="white-space:pre-wrap;font-family:system-ui">${message.bodyPlain}</pre>`;
    const darkStyle = `
      <style>
        body { background: transparent !important; color: var(--text, #e8e8f0) !important;
               font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.6;
               margin: 0; padding: 0; }
        a { color: #7c6aff; }
        img { max-width: 100%; ${!showImages ? 'display:none !important;' : ''} }
      </style>
    `;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(darkStyle + body);
    doc.close();

    const resize = () => {
      if (iframe.contentDocument?.body) {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + 'px';
      }
    };
    setTimeout(resize, 100);
    try {
      new ResizeObserver(resize).observe(iframe.contentDocument.body);
    } catch { /* fallback */ }
  }, [expanded, message.bodyHtml, message.bodyPlain, showImages]);

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10,
      background: 'var(--surface2)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: color,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {initials(message.senderName || message.senderEmail)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
            {message.senderName}
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
              &lt;{message.senderEmail}&gt;
            </span>
          </div>
          {!expanded && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {message.bodyPlain.slice(0, 80)}
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'Space Mono, monospace' }}>
          {formatDate(message.date)}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Recipients */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            <span>To: {message.to}</span>
            {message.cc && (
              <>
                {!showCc ? (
                  <button onClick={() => setShowCc(true)} style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    fontSize: 11, cursor: 'pointer', marginLeft: 8,
                  }}>+cc</button>
                ) : (
                  <span style={{ marginLeft: 8 }}>Cc: {message.cc}</span>
                )}
              </>
            )}
          </div>

          {/* Body */}
          {message.bodyHtml ? (
            <>
              {!showImages && message.bodyHtml.includes('<img') && (
                <button
                  onClick={() => setShowImages(true)}
                  style={{
                    marginBottom: 8, padding: '4px 10px',
                    background: 'var(--surface3)', border: '1px solid var(--border)',
                    borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >Show images</button>
              )}
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                style={{ width: '100%', border: 'none', minHeight: 60, display: 'block' }}
                title="email-body"
              />
            </>
          ) : (
            <pre style={{
              whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text)',
              fontFamily: 'Space Mono, monospace', lineHeight: 1.6, margin: 0,
            }}>
              {message.bodyPlain}
            </pre>
          )}

          {/* Attachments */}
          {message.attachments.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {message.attachments.map(att => (
                <div key={att.attachmentId} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', background: 'var(--surface3)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  fontSize: 11, color: 'var(--text)',
                }}>
                  <span>📎</span>
                  <span>{att.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{formatBytes(att.size)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Reply button */}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button
              onClick={() => onReply(message)}
              style={{
                padding: '6px 14px', background: 'var(--surface3)',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 12, color: 'var(--text)', cursor: 'pointer',
              }}
            >↩ Reply</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compose form ──────────────────────────────────────────────────────────────

interface ComposeProps {
  onSent: () => void;
  initialTo?: string;
  initialSubject?: string;
  replyToMessageId?: string;
  threadId?: string;
  quotedBody?: string;
}

function ComposeForm({ onSent, initialTo = '', initialSubject = '', replyToMessageId, threadId, quotedBody }: ComposeProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(quotedBody ? `\n\n--- Original Message ---\n${quotedBody}` : '');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch('/api/gmail/send', {
        method: 'POST',
        body: JSON.stringify({ to, subject, body: body.replace(/\n/g, '<br>'), cc, bcc, replyToMessageId, threadId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSent(true);
      setTimeout(onSent, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', background: 'var(--surface3)',
    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  if (sent) return (
    <div style={{ textAlign: 'center', padding: 32, color: 'var(--accent)', fontSize: 14 }}>
      ✓ Message sent
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input placeholder="To" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <button onClick={() => setShowCc(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>Cc</button>
        <button onClick={() => setShowBcc(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>Bcc</button>
      </div>
      {showCc && <input placeholder="Cc" value={cc} onChange={e => setCc(e.target.value)} style={inputStyle} />}
      {showBcc && <input placeholder="Bcc" value={bcc} onChange={e => setBcc(e.target.value)} style={inputStyle} />}
      <input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
      <textarea
        ref={bodyRef}
        placeholder="Write your message…"
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
        style={{
          ...inputStyle,
          minHeight: 120, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
        }}
      />
      {error && (
        <div style={{ fontSize: 12, color: 'var(--color-danger)', display: 'flex', gap: 8 }}>
          <span>{error}</span>
          <button onClick={handleSend} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>Try again</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onSent} style={{ padding: '7px 16px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          Discard
        </button>
        <button
          onClick={handleSend}
          disabled={sending || !to.trim() || !body.trim()}
          style={{
            padding: '7px 18px', background: 'var(--accent)', border: 'none',
            borderRadius: 8, fontSize: 13, color: '#fff', cursor: 'pointer',
            opacity: (sending || !to.trim() || !body.trim()) ? 0.5 : 1,
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'right' }}>⌘ Enter to send</div>
    </div>
  );
}

// ── Need-auth prompt ──────────────────────────────────────────────────────────

function NeedsAuthPrompt() {
  async function reconnect() {
    try {
      const res = await apiFetch('/api/auth/google-gmail/initiate', { method: 'POST' });
      const { url } = await res.json();
      window.location.href = url;
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 20, textAlign: 'center' }}>
      <span style={{ fontSize: 32 }}>✉️</span>
      <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>Connect Gmail</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Allow NEXUS to access your Gmail inbox.
      </div>
      <button
        onClick={reconnect}
        style={{
          padding: '8px 20px', background: 'var(--accent)', border: 'none',
          borderRadius: 8, color: '#fff', fontSize: 13, cursor: 'pointer',
        }}
      >
        Connect Gmail
      </button>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function GmailWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  const [view, setView] = useState<GmailView>('inbox');
  const [prevView, setPrevView] = useState<GmailView>('inbox');

  // Data state
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GmailThread[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [openThread, setOpenThread] = useState<{ id: string; messages: GmailMessage[] } | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [newMessageBanner, setNewMessageBanner] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nexus-gmail-recent-searches') ?? '[]'); }
    catch { return []; }
  });
  const [needsAuth, setNeedsAuth] = useState(false);
  const [replyTarget, setReplyTarget] = useState<GmailMessage | null>(null);

  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();
  const listRef = useRef<HTMLDivElement>(null);
  const prevUnread = useRef(0);

  // ── ResizeObserver ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      setWidth(w); setHeight(h);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const cols = width >= 480 ? 3 : width >= 320 ? 2 : 1;
  const rows = height >= 480 ? 3 : height >= 320 ? 2 : 1;
  const isMicro = cols === 1 && rows === 1;
  const isSlim = (cols === 1 && rows === 2) || (cols === 2 && rows === 1);
  const isSplit = cols >= 3 && rows >= 3;

  // ── Watch registration (one-time, renews automatically) ──────────────────
  useEffect(() => {
    apiFetch('/api/gmail/watch', { method: 'POST' }).catch(() => {});
  }, []);

  // ── Fetch threads ────────────────────────────────────────────────────────
  const fetchThreads = useCallback(async (labelId = activeLabel, reset = true) => {
    if (reset) setLoadingThreads(true);
    try {
      const res = await apiFetch(`/api/gmail/threads?labelIds=${labelId}&maxResults=20`);
      if (res.status === 403) { setNeedsAuth(true); return; }
      const data = await res.json();
      setThreads(reset ? data.threads : prev => [...prev, ...data.threads]);
      setNextPageToken(data.nextPageToken);
    } catch { /* ignore */ }
    finally { setLoadingThreads(false); }
  }, [activeLabel]);

  // ── Fetch unread count ───────────────────────────────────────────────────
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await apiFetch('/api/gmail/unread-count');
      if (!res.ok) return;
      const { unreadCount: count } = await res.json();
      setUnreadCount(count);
      window.electronAPI?.setDockBadge(count || null);
      if (prevUnread.current > 0 && count > prevUnread.current) {
        setNewMessageBanner(count - prevUnread.current);
      }
      prevUnread.current = count;
    } catch { /* ignore */ }
  }, []);

  // ── Fetch labels ─────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/gmail/labels')
      .then(r => r.json())
      .then(d => setLabels(d.labels ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchThreads(activeLabel, true); }, [activeLabel]);
  useEffect(() => { fetchUnreadCount(); }, [fetchUnreadCount]);

  // ── SSE real-time updates ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = nexusSSE.subscribe((event: { type: string; unreadCount?: number }) => {
      if (event.type === 'gmail:update') {
        fetchThreads(activeLabel, true);
        if (event.unreadCount !== undefined) {
          setUnreadCount(event.unreadCount);
          window.electronAPI?.setDockBadge(event.unreadCount || null);
        }
        fetchUnreadCount();
      }
    });
    return unsub;
  }, [activeLabel, fetchThreads, fetchUnreadCount]);

  // ── Infinite scroll ──────────────────────────────────────────────────────
  function handleScroll() {
    if (!listRef.current || loadingMore || !nextPageToken) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) loadMore();
  }

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch(`/api/gmail/threads?labelIds=${activeLabel}&maxResults=20&pageToken=${nextPageToken}`);
      const data = await res.json();
      setThreads(prev => [...prev, ...data.threads]);
      setNextPageToken(data.nextPageToken);
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }

  // ── Thread actions ───────────────────────────────────────────────────────
  async function handleAction(action: string, threadId: string) {
    const endpoint = action === 'delete'
      ? `/api/gmail/threads/${threadId}`
      : `/api/gmail/threads/${threadId}/${action}`;
    const method = action === 'delete' ? 'DELETE' : 'POST';
    await apiFetch(endpoint, { method });

    setThreads(prev => prev.map(t => {
      if (t.threadId !== threadId) return t;
      if (action === 'read') return { ...t, unread: false };
      if (action === 'unread') return { ...t, unread: true };
      if (action === 'star') return { ...t, starred: true };
      if (action === 'unstar') return { ...t, starred: false };
      return t;
    }).filter(t => {
      if (action === 'delete' && t.threadId === threadId) return false;
      if (action === 'archive' && t.threadId === threadId) return false;
      return true;
    }));

    if (action === 'read' || action === 'unread') {
      setUnreadCount(prev => action === 'read' ? Math.max(0, prev - 1) : prev + 1);
    }
  }

  // ── Open thread ──────────────────────────────────────────────────────────
  async function openThread_(thread: GmailThread) {
    setThreadLoading(true);
    setPrevView(view);
    setView('thread');
    // Mark as read optimistically
    if (thread.unread) handleAction('read', thread.threadId);
    try {
      const res = await apiFetch(`/api/gmail/threads/${thread.threadId}`);
      const data = await res.json();
      setOpenThread({ id: thread.threadId, messages: data.messages });
    } catch { /* ignore */ }
    finally { setThreadLoading(false); }
  }

  // ── Search ───────────────────────────────────────────────────────────────
  function handleSearchChange(q: string) {
    setSearchQuery(q);
    clearTimeout(searchDebounce.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiFetch(`/api/gmail/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchResults(data.threads ?? []);
      } catch { /* ignore */ }
      finally { setSearchLoading(false); }
    }, 500);
  }

  function saveRecentSearch(q: string) {
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 8);
    setRecentSearches(updated);
    localStorage.setItem('nexus-gmail-recent-searches', JSON.stringify(updated));
  }

  // ── Compose reply ────────────────────────────────────────────────────────
  function handleReply(message: GmailMessage) {
    setReplyTarget(message);
    setPrevView(view);
    setView('compose');
  }

  // ── Unread badge ─────────────────────────────────────────────────────────
  const badgeLabel = unreadCount > 99 ? '99+' : unreadCount.toString();

  // ── Micro mode ───────────────────────────────────────────────────────────
  if (isMicro) {
    const topThread = threads.find(t => t.unread) ?? threads[0];
    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4 }}>
        {unreadCount > 0 ? (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)', fontFamily: 'Space Mono, monospace', lineHeight: 1 }}>
              {badgeLabel}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>unread</div>
            {topThread && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {topThread.senderName}: {topThread.subject}
              </div>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 22 }}>✉️</span>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Inbox zero</div>
          </>
        )}
      </div>
    );
  }

  if (needsAuth) return <div ref={containerRef} style={{ width: '100%', height: '100%' }}><NeedsAuthPrompt /></div>;

  // ── Thread list (shared across inbox/labels/search) ───────────────────────
  function renderThreadList(threadList: GmailThread[], loading: boolean) {
    if (loading) return (
      <div>{Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}</div>
    );
    if (!threadList.length) return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>✉️</div>
        Your inbox is empty
      </div>
    );
    return (
      <>
        {newMessageBanner > 0 && (
          <div
            onClick={() => { listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setNewMessageBanner(0); }}
            style={{
              background: 'var(--accent)', color: '#fff', textAlign: 'center',
              padding: '6px 12px', fontSize: 12, cursor: 'pointer',
              borderRadius: 8, margin: '4px 8px',
            }}
          >
            {newMessageBanner} new message{newMessageBanner > 1 ? 's' : ''} — tap to view
          </div>
        )}
        {threadList.map(t => (
          <ThreadRow
            key={t.threadId}
            thread={t}
            onOpen={openThread_}
            onAction={handleAction}
            compact={isSlim}
          />
        ))}
        {loadingMore && <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}
      </>
    );
  }

  // ── Thread reading view ──────────────────────────────────────────────────
  function renderThreadView() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setView(prevView)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}
          >←</button>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {openThread?.messages[0]?.subject || '…'}
          </div>
          {openThread && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => handleAction('archive', openThread.id)} title="Archive"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>📥</button>
              <button onClick={() => handleAction('delete', openThread.id)} title="Delete"
                style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14 }}>🗑</button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {threadLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
          ) : openThread?.messages.map((msg, i) => (
            <MessageCard
              key={msg.messageId}
              message={msg}
              defaultExpanded={i === (openThread.messages.length - 1)}
              onReply={handleReply}
            />
          ))}
        </div>

        {/* Reply bar */}
        {!replyTarget && openThread?.messages.length && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => handleReply(openThread.messages[openThread.messages.length - 1])}
              style={{
                width: '100%', padding: '8px 14px', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 8,
                textAlign: 'left', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
              }}
            >
              ↩ Reply…
            </button>
          </div>
        )}

        {replyTarget && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <ComposeForm
              onSent={() => { setReplyTarget(null); }}
              initialTo={replyTarget.senderEmail}
              initialSubject={`Re: ${replyTarget.subject}`}
              replyToMessageId={replyTarget.messageId}
              threadId={replyTarget.threadId}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabs: { id: GmailView; icon: string; label: string }[] = [
    { id: 'inbox', icon: '📥', label: 'Inbox' },
    { id: 'labels', icon: '🏷️', label: 'Labels' },
    { id: 'search', icon: '🔍', label: 'Search' },
    { id: 'compose', icon: '✏️', label: 'Compose' },
  ];

  // ── Split mode layout ────────────────────────────────────────────────────
  if (isSplit) {
    const rightPanel = view === 'thread' ? renderThreadView()
      : view === 'compose' ? (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <ComposeForm
            onSent={() => setView('inbox')}
            initialTo={replyTarget?.senderEmail}
            initialSubject={replyTarget ? `Re: ${replyTarget.subject}` : ''}
            replyToMessageId={replyTarget?.messageId}
            threadId={replyTarget?.threadId}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
          Select an email to read
        </div>
      );

    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)}
              style={{
                background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer',
                fontSize: 12, color: view === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: view === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span>{tab.icon}</span> {tab.label}
            </button>
          ))}
          {unreadCount > 0 && (
            <div style={{ marginLeft: 'auto', marginRight: 8, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontFamily: 'Space Mono, monospace' }}>
              {badgeLabel}
            </div>
          )}
        </div>
        {/* Split body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: thread list */}
          <div ref={listRef} onScroll={handleScroll} style={{ width: '40%', borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
            {view === 'search' ? (
              <div style={{ padding: '8px 12px' }}>
                <input
                  autoFocus
                  placeholder="Search mail…"
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && searchQuery) saveRecentSearch(searchQuery); }}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ) : view === 'labels' ? (
              <div style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {labels.filter(l => ['INBOX','CATEGORY_SOCIAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','STARRED','SENT','DRAFT'].includes(l.id) || l.type === 'user').map(l => (
                    <button key={l.id} onClick={() => { setActiveLabel(l.id); setView('inbox'); }}
                      style={{
                        padding: '3px 10px', borderRadius: 20, border: `1px solid ${labelColor(l.id)}`,
                        background: activeLabel === l.id ? `${labelColor(l.id)}22` : 'transparent',
                        color: labelColor(l.id), fontSize: 11, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                      {labelDisplayName(l)}
                      {l.unreadCount > 0 && <span style={{ fontSize: 9 }}>{l.unreadCount}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {renderThreadList(view === 'search' ? searchResults : threads, view === 'search' ? searchLoading : loadingThreads)}
          </div>
          {/* Right: reading/compose pane */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rightPanel}
          </div>
        </div>
      </div>
    );
  }

  // ── Standard (non-split) layout ──────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Tab bar (hidden in slim mode / thread/compose views) */}
      {view !== 'thread' && view !== 'compose' && !isSlim && (
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '0 6px', flexShrink: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)}
              style={{
                background: 'none', border: 'none', padding: '7px 10px', cursor: 'pointer',
                fontSize: 11, color: view === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: view === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
              <span>{tab.icon}</span>
              {cols >= 2 && <span>{tab.label}</span>}
            </button>
          ))}
          {unreadCount > 0 && (
            <div style={{ marginLeft: 'auto', marginRight: 6, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontFamily: 'Space Mono, monospace' }}>
              {badgeLabel}
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div ref={listRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Inbox */}
        {view === 'inbox' && renderThreadList(threads, loadingThreads)}

        {/* Labels */}
        {view === 'labels' && (
          <div>
            <div style={{ display: 'flex', overflowX: 'auto', gap: 6, padding: '8px 12px', scrollbarWidth: 'none' }}>
              {labels.filter(l => ['INBOX','CATEGORY_SOCIAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','STARRED','SENT','DRAFT'].includes(l.id) || l.type === 'user').map(l => (
                <button key={l.id}
                  onClick={() => { setActiveLabel(l.id); setView('inbox'); }}
                  style={{
                    flexShrink: 0, padding: '4px 12px', borderRadius: 20,
                    border: `1px solid ${labelColor(l.id)}`,
                    background: activeLabel === l.id ? `${labelColor(l.id)}22` : 'transparent',
                    color: labelColor(l.id), fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  {labelDisplayName(l)}
                  {l.unreadCount > 0 && <span style={{ marginLeft: 4, fontSize: 9 }}>{l.unreadCount}</span>}
                </button>
              ))}
            </div>
            {renderThreadList(threads, loadingThreads)}
          </div>
        )}

        {/* Search */}
        {view === 'search' && (
          <div style={{ padding: '8px 12px' }}>
            <input
              autoFocus
              placeholder="Search mail…"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchQuery) saveRecentSearch(searchQuery); }}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>
              Tip: try from:, has:attachment, is:unread
            </div>
            {/* Recent searches */}
            {!searchQuery && recentSearches.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {recentSearches.map(s => (
                  <button key={s} onClick={() => { setSearchQuery(s); handleSearchChange(s); }}
                    style={{ padding: '3px 10px', borderRadius: 20, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {searchLoading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>Searching…</div>}
            {!searchLoading && searchQuery && searchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>No results</div>
            )}
            {renderThreadList(searchResults, false)}
          </div>
        )}

        {/* Thread view */}
        {view === 'thread' && (
          <div style={{ height: '100%' }}>{renderThreadView()}</div>
        )}

        {/* Compose */}
        {view === 'compose' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => setView(prevView)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 18 }}>←</button>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New Message</span>
            </div>
            <ComposeForm
              onSent={() => { setView('inbox'); setReplyTarget(null); }}
              initialTo={replyTarget?.senderEmail}
              initialSubject={replyTarget ? `Re: ${replyTarget.subject}` : ''}
              replyToMessageId={replyTarget?.messageId}
              threadId={replyTarget?.threadId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
