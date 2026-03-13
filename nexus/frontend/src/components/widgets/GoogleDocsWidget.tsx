import { useEffect, useCallback, useState } from 'react';
import { useStore, useServiceState } from '../../store/useStore';
import type { DocFile } from '../../types';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, wcIsStale, WC_KEY, WC_TTL } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface GoogleDocsWidgetProps {
  onClose: () => void;
}

export function GoogleDocsWidget({ onClose: _onClose }: GoogleDocsWidgetProps) {
  const { recentDocs, setRecentDocs } = useStore();
  const { isConnected, neverConnected, isStale } = useServiceState('googleDocs');
  const [connecting, setConnecting] = useState(false);
  const [isDataStale, setIsDataStale] = useState(
    () => wcIsStale(WC_KEY.DOCS_LIST, WC_TTL.DOCS),
  );
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.DOCS_LIST) !== null,
  );

  useWidgetReady('docs', hasLoaded);

  const connectGoogle = async () => {
    setConnecting(true);
    try {
      const res = await apiFetch('/api/auth/google/initiate', { method: 'POST' });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        window.location.href = url;
      } else {
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  };

  const fetchDocs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/docs/list');
      if (res.ok) {
        const data: DocFile[] = await res.json();
        setRecentDocs(data);
        wcWrite(WC_KEY.DOCS_LIST, data);
        setIsDataStale(false);
      }
    } catch {
      // keep cached data
    } finally {
      setHasLoaded(true);
    }
  }, [setRecentDocs]);

  useEffect(() => {
    fetchDocs();
    const interval = setInterval(fetchDocs, 300_000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  if (neverConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-3 text-center gap-2">
        <span style={{ fontSize: '24px' }}>📄</span>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not connected</p>
        <button
          onClick={connectGoogle}
          disabled={connecting}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'rgba(52,168,83,0.15)',
            color: connecting ? 'var(--text-muted)' : '#34a853',
            border: 'none',
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Redirecting…' : 'Connect Google'}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {isStale && !isConnected && (
        <div className="px-3 pt-1 flex-shrink-0 flex justify-end">
          <span className="text-xs font-mono" style={{ color: '#f59e0b', opacity: 0.6, fontSize: '10px' }}>
            ↻ reconnecting
          </span>
        </div>
      )}
      {isDataStale && isConnected && (
        <div className="px-3 pt-1 flex-shrink-0 flex justify-end">
          <span title="Showing cached data — refreshing" style={{ fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}>↻</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pt-2 pb-2 flex flex-col gap-1">
        {recentDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>📭</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No recent docs</p>
          </div>
        ) : (
          recentDocs.slice(0, 5).map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2 rounded-lg transition-colors no-underline group"
              style={{ background: 'rgba(255,255,255,0.02)', textDecoration: 'none' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(52, 168, 83, 0.08)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
              }}
            >
              <span style={{ fontSize: '14px', flexShrink: 0 }}>📄</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text)', fontSize: '12px' }}>
                  {doc.name}
                </p>
                <p className="font-mono text-xs" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                  {relativeTime(doc.modifiedTime)}
                </p>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
