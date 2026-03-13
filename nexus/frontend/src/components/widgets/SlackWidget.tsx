import { useState, useCallback, useRef, useEffect } from 'react';
import { useSlack } from '../../hooks/useSlack';
import { useServiceState } from '../../store/useStore';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import { apiFetch } from '../../lib/api';

function getAvatarColor(username: string): string {
  const colors = [
    '#e8693f', '#4285f4', '#3de8b0', '#f59e0b', '#7c6aff',
    '#ec4899', '#06b6d4', '#84cc16',
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function relativeTime(timestamp: string): string {
  const ts = parseFloat(timestamp) * 1000;
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface SlackWidgetProps {
  onClose: () => void;
}

export function SlackWidget({ onClose: _onClose }: SlackWidgetProps) {
  const { messages, channels, activeChannel, switchChannel, isCacheStale, hasLoaded } = useSlack();
  const { isConnected, neverConnected, isStale } = useServiceState('slack');
  const [connecting, setConnecting] = useState(false);

  useWidgetReady('slack', hasLoaded);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

  const connectSlack = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await apiFetch('/api/auth/slack/initiate', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not connect');
      setConnecting(false);
    }
  }, []);

  if (neverConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center gap-3">
        <span style={{ fontSize: '28px' }}>💬</span>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
            Connect Slack
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Read and send messages in your workspace
          </p>
        </div>
        {connectError && (
          <p className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(234,67,53,0.12)', color: '#ea4335' }}>
            {connectError}
          </p>
        )}
        <button
          onClick={connectSlack}
          disabled={connecting}
          className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          style={{
            background: connecting ? 'rgba(255,255,255,0.05)' : 'rgba(74,21,75,0.4)',
            border: '1px solid rgba(224,30,90,0.4)',
            color: connecting ? 'var(--text-faint)' : '#e01e5a',
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Redirecting…' : 'Connect with Slack'}
        </button>
      </div>
    );
  }

  const displayName = activeChannel ? `#${activeChannel}` : '#default';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Channel picker bar */}
      <div
        className="flex items-center justify-between px-2 pt-1.5 pb-1 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {isStale && !isConnected && (
          <span className="text-xs font-mono" style={{ color: 'var(--color-warning)', opacity: 0.6, fontSize: '10px' }}>
            ↻ reconnecting
          </span>
        )}
        {isCacheStale && isConnected && (
          <span title="Showing cached data — refreshing" style={{ fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}>↻</span>
        )}
        <div className="flex-1" />

        {/* Channel selector */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono transition-colors"
            style={{
              background: pickerOpen ? 'var(--accent-dim)' : 'var(--row-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            {displayName}
            <span style={{ fontSize: '8px', opacity: 0.6 }}>▼</span>
          </button>

          {pickerOpen && channels.length > 0 && (
            <div
              className="absolute right-0 top-full mt-1 rounded-lg overflow-y-auto nexus-scroll"
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-popup)',
                zIndex: 50,
                minWidth: '160px',
                maxHeight: '200px',
              }}
            >
              {channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => { switchChannel(ch.name); setPickerOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono transition-colors"
                  style={{
                    color: ch.name === activeChannel ? 'var(--accent)' : 'var(--text-muted)',
                    background: ch.name === activeChannel ? 'var(--accent-dim)' : 'transparent',
                    cursor: 'pointer',
                    display: 'block',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--row-bg-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ch.name === activeChannel ? 'var(--accent-dim)' : 'transparent'; }}
                >
                  #{ch.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages list — flex-col-reverse keeps newest at bottom and auto-scrolls there */}
      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pt-2 pb-2 flex flex-col-reverse gap-1.5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>💭</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No messages</p>
          </div>
        ) : (
          messages.slice(0, 8).map((msg) => (
            <div
              key={msg.id}
              className="flex items-start gap-2 p-1.5 rounded-lg"
              style={{ background: 'var(--row-bg)' }}
            >
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{
                  background: getAvatarColor(msg.username) + '30',
                  color: getAvatarColor(msg.username),
                  fontSize: '10px',
                  fontWeight: 700,
                }}
              >
                {msg.username.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--accent)', fontSize: '11px' }}>
                    {msg.username}
                  </span>
                  <span className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                    {relativeTime(msg.timestamp)}
                  </span>
                </div>
                <p
                  className="text-xs leading-relaxed truncate"
                  style={{ color: 'var(--text-muted)', fontSize: '11px' }}
                >
                  {msg.text}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
