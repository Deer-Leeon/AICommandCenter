import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://nexus-api.lj-buchmiller.com';

// ── Types ──────────────────────────────────────────────────────────────────────

type Category = 'politics' | 'technology' | 'ai';
type SSEStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl: string | null;
  isBreaking: boolean;
  _addedAt?: number; // local monotonic timestamp for NEW badge lifetime
}

type ArticleMap = Partial<Record<Category, Article[]>>;

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS: { id: Category; label: string }[] = [
  { id: 'politics',   label: 'Politics'   },
  { id: 'technology', label: 'Technology' },
  { id: 'ai',         label: 'AI'         },
];

const NEW_BADGE_TTL_MS = 30_000; // badge fades after 30 s

const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
  'NYT':          { bg: 'rgba(100,100,100,0.22)', fg: '#b0b0b0'  },
  'WaPo':         { bg: 'rgba(50,110,220,0.20)',  fg: '#7aaaf8'  },
  'Ars Technica': { bg: 'rgba(220,60,40,0.20)',   fg: '#f08070'  },
  'TechCrunch':   { bg: 'rgba(40,170,80,0.20)',   fg: '#60d080'  },
  'Wired':        { bg: 'rgba(190,155,0,0.22)',   fg: '#d4b840'  },
};
const SOURCE_COLORS_DEFAULT = { bg: 'rgba(120,120,120,0.18)', fg: '#a0a0a0' };

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 30)  return 'just now';
  if (m < 1)   return `${s}s ago`;
  if (m < 60)  return `${m}m ago`;
  if (h < 24)  return `${h}h ago`;
  return `${d}d ago`;
}

// ── CSS injected once ──────────────────────────────────────────────────────────

const STYLE_ID = 'nexus-news-styles';
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes nwsLivePulse {
      0%,100% { opacity: 1; transform: scale(1);   box-shadow: 0 0 0 0 rgba(61,232,176,0.5); }
      50%     { opacity: .6; transform: scale(.75); box-shadow: 0 0 0 4px rgba(61,232,176,0);   }
    }
    @keyframes nwsReconnectPulse {
      0%,100% { opacity: 1; }
      50%     { opacity: .3; }
    }
    @keyframes nwsSlideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to   { opacity: 1; transform: translateY(0);     }
    }
    @keyframes nwsBadgeFade {
      0%,70%  { opacity: 1; }
      100%    { opacity: 0; }
    }
    @keyframes nwsImgLoad {
      from { opacity: 0; } to { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

// ── ArticleCard ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<Category, string> = {
  politics: 'Politics', technology: 'Technology', ai: 'AI',
};

function ArticleCard({ article, isNew, categoryLabel }: {
  article: Article; isNew: boolean; categoryLabel?: Category;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sc = SOURCE_COLORS[article.source] ?? SOURCE_COLORS_DEFAULT;
  const [, forceUpdate] = useState(0);

  // Re-render every minute so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => forceUpdate(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', gap: 10, padding: '10px 12px', textDecoration: 'none',
        borderBottom: '1px solid var(--border)',
        background: isNew ? 'rgba(61,232,176,0.04)' : 'transparent',
        transition: 'background 0.2s',
        animation: isNew ? 'nwsSlideDown 0.35s ease-out' : 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--row-bg)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isNew ? 'rgba(61,232,176,0.04)' : 'transparent'; }}
    >
      {/* Text block */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Row 1: badges + timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{
            padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700,
            fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
            background: sc.bg, color: sc.fg,
          }}>
            {article.source}
          </span>

          {categoryLabel && (
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)',
            }}>
              {CATEGORY_LABELS[categoryLabel]}
            </span>
          )}

          {isNew && (
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'rgba(61,232,176,0.2)', color: 'var(--teal)',
              animation: `nwsBadgeFade ${NEW_BADGE_TTL_MS}ms ease-out forwards`,
            }}>
              NEW
            </span>
          )}

          <span style={{
            fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)',
            marginLeft: 'auto', whiteSpace: 'nowrap',
          }}>
            {timeAgo(article.publishedAt)}
          </span>
        </div>

        {/* Headline */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {article.title}
        </div>

        {/* Summary */}
        {article.summary && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {article.summary}
          </div>
        )}
      </div>

      {/* Thumbnail */}
      {article.imageUrl && !imgFailed && (
        <img
          src={article.imageUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{
            width: 58, height: 58, flexShrink: 0, borderRadius: 6,
            objectFit: 'cover', alignSelf: 'flex-start',
            animation: 'nwsImgLoad 0.3s ease',
          }}
        />
      )}
    </a>
  );
}

// ── NewsWidget ─────────────────────────────────────────────────────────────────

export function NewsWidget({ onClose: _onClose }: { onClose: () => void }) {
  useEffect(() => injectStyles(), []);

  const [activeTab, setActiveTab]   = useState<Category>('politics');
  // Seed from cache so articles are visible on first paint while SSE reconnects
  const [articles, setArticles]     = useState<ArticleMap>(
    () => wcRead<ArticleMap>(WC_KEY.NEWS_ARTICLES)?.data ?? {},
  );
  const [newIds, setNewIds]         = useState<Set<string>>(new Set());
  const [sseStatus, setSseStatus]   = useState<SSEStatus>('connecting');
  const [_failCount, setFailCount]   = useState(0);
  // hasLoaded is immediately true when we have cached articles
  const [hasLoaded, setHasLoaded]   = useState(
    () => wcRead(WC_KEY.NEWS_ARTICLES) !== null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const esRef              = useRef<EventSource | null>(null);
  const reconnectRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef       = useRef(0);
  const newIdsTimersRef    = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useWidgetReady('news', hasLoaded);

  // ── SSE connection ──────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    // Clean up any previous connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setSseStatus(failCountRef.current > 0 ? 'reconnecting' : 'connecting');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSseStatus('error');
      return;
    }

    const url = `${API_BASE}/api/news/stream?token=${encodeURIComponent(session.access_token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('news:init', (e: MessageEvent) => {
      try {
        const { category, articles: arts } = JSON.parse(e.data) as {
          category: Category; articles: Article[];
        };
        setArticles(prev => {
          const next = { ...prev, [category]: arts };
          // Write combined map to cache after each category arrives
          wcWrite(WC_KEY.NEWS_ARTICLES, next);
          return next;
        });
        setHasLoaded(true);
        failCountRef.current = 0;
        setFailCount(0);
        setSseStatus('live');
      } catch { /* malformed — ignore */ }
    });

    es.addEventListener('news:update', (e: MessageEvent) => {
      try {
        const { category, newArticles } = JSON.parse(e.data) as {
          category: Category; newArticles: Article[];
        };
        const stamped = newArticles.map(a => ({ ...a, _addedAt: Date.now() }));
        const ids = new Set(stamped.map(a => a.id));

        setArticles(prev => {
          const next = {
            ...prev,
            [category]: [...stamped, ...(prev[category] ?? [])].slice(0, 20),
          };
          // Keep the cache current so the next page load shows fresh articles
          const cacheable = Object.fromEntries(
            Object.entries(next).map(([k, v]) => [
              k,
              // Strip the ephemeral _addedAt so cache stays clean
              (v ?? []).map(({ _addedAt: _a, ...rest }) => rest),
            ]),
          );
          wcWrite(WC_KEY.NEWS_ARTICLES, cacheable);
          return next;
        });

        setNewIds(prev => {
          const next = new Set([...prev, ...ids]);
          return next;
        });

        // Fade NEW badges after TTL
        ids.forEach(id => {
          const existing = newIdsTimersRef.current.get(id);
          if (existing) clearTimeout(existing);
          const t = setTimeout(() => {
            setNewIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            newIdsTimersRef.current.delete(id);
          }, NEW_BADGE_TTL_MS);
          newIdsTimersRef.current.set(id, t);
        });
      } catch { /* malformed */ }
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      failCountRef.current += 1;
      setFailCount(failCountRef.current);

      if (failCountRef.current > 3) {
        setSseStatus('error');
        return;
      }

      setSseStatus('reconnecting');
      const backoff = Math.min(2 ** failCountRef.current * 1000, 30_000);
      reconnectRef.current = setTimeout(connect, backoff);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      newIdsTimersRef.current.forEach(t => clearTimeout(t));
    };
  }, [connect]);

  // ── Manual retry ────────────────────────────────────────────────────────────

  function retry() {
    failCountRef.current = 0;
    setFailCount(0);
    setSseStatus('connecting');
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    connect();
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const currentArticles = articles[activeTab] ?? [];
  const isLoading = sseStatus === 'connecting' && currentArticles.length === 0;

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const searchResults: (Article & { _category: Category })[] = trimmedQuery
    ? ((['politics', 'technology', 'ai'] as Category[]).flatMap(cat =>
        (articles[cat] ?? [])
          .filter(a =>
            a.title.toLowerCase().includes(trimmedQuery) ||
            a.summary.toLowerCase().includes(trimmedQuery) ||
            a.source.toLowerCase().includes(trimmedQuery)
          )
          .map(a => ({ ...a, _category: cat }))
      ))
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    : [];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface)', overflow: 'hidden',
      fontFamily: 'var(--font-mono)',
    }}>

      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px 0', flexShrink: 0,
      }}>
        {/* Live / reconnect dot */}
        <LiveDot status={sseStatus} />

        <span style={{
          fontSize: 9, color: sseStatus === 'live' ? 'var(--teal)' : 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700,
          transition: 'color 0.3s',
        }}>
          {sseStatus === 'live'         ? 'Live'
            : sseStatus === 'reconnecting' ? 'Reconnecting…'
            : sseStatus === 'error'        ? 'Disconnected'
            : 'Connecting…'}
        </span>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 2, padding: '8px 12px 0', flexShrink: 0,
        borderBottom: trimmedQuery ? 'none' : '1px solid var(--border)',
      }}>
        {TABS.map(tab => {
          const isActive = tab.id === activeTab;
          const catArticles = articles[tab.id];
          const newCount = catArticles
            ? catArticles.filter(a => newIds.has(a.id)).length
            : 0;

          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSearchQuery(''); }}
              style={{
                padding: '5px 10px 7px', border: 'none', cursor: 'pointer',
                background: 'transparent', borderRadius: '4px 4px 0 0',
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: isActive ? 700 : 400,
                color: isActive ? 'var(--text)' : 'var(--text-faint)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s',
                position: 'relative',
              }}
            >
              {tab.label}
              {newCount > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--teal)', display: 'block',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Search bar ── */}
      <div style={{
        padding: '8px 12px', flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        position: 'relative',
      }}>
        {/* Search icon */}
        <svg
          viewBox="0 0 16 16" fill="none"
          style={{
            position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
            width: 11, height: 11, pointerEvents: 'none',
          }}
        >
          <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-faint)" strokeWidth="1.5"/>
          <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>

        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search all news…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            paddingLeft: 24, paddingRight: searchQuery ? 24 : 8,
            paddingTop: 5, paddingBottom: 5,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 5, outline: 'none',
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--text)',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />

        {/* Clear button */}
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
            style={{
              position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-faint)', fontSize: 13, lineHeight: 1,
              padding: '0 2px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* ── Article list ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {trimmedQuery ? (
          searchResults.length === 0 ? (
            <SearchEmptyState query={trimmedQuery} />
          ) : (
            searchResults.map(article => (
              <ArticleCard
                key={article.id + article._category}
                article={article}
                isNew={newIds.has(article.id)}
                categoryLabel={article._category}
              />
            ))
          )
        ) : sseStatus === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : isLoading ? (
          <LoadingState />
        ) : currentArticles.length === 0 ? (
          <EmptyState category={activeTab} />
        ) : (
          currentArticles.map(article => (
            <ArticleCard
              key={article.id}
              article={article}
              isNew={newIds.has(article.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LiveDot({ status }: { status: SSEStatus }) {
  const color =
    status === 'live'         ? '#3de8b0' :
    status === 'reconnecting' ? '#f59e0b' : '#555';

  const anim =
    status === 'live'         ? 'nwsLivePulse 2s ease-in-out infinite' :
    status === 'reconnecting' ? 'nwsReconnectPulse 1s ease-in-out infinite' : 'none';

  return (
    <div style={{
      width: 7, height: 7, borderRadius: '50%',
      background: color, flexShrink: 0,
      animation: anim,
      transition: 'background 0.4s',
    }} />
  );
}

function LoadingState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          padding: '10px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 10,
        }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              height: 9, width: '30%', borderRadius: 3,
              background: 'var(--surface2)',
              animation: `nwsReconnectPulse 1.5s ${i * 0.1}s ease-in-out infinite`,
            }} />
            <div style={{
              height: 11, width: '90%', borderRadius: 3,
              background: 'var(--surface2)',
              animation: `nwsReconnectPulse 1.5s ${i * 0.12}s ease-in-out infinite`,
            }} />
            <div style={{
              height: 11, width: '65%', borderRadius: 3,
              background: 'var(--surface2)',
              animation: `nwsReconnectPulse 1.5s ${i * 0.14}s ease-in-out infinite`,
            }} />
          </div>
          <div style={{
            width: 58, height: 58, borderRadius: 6, flexShrink: 0,
            background: 'var(--surface2)',
            animation: `nwsReconnectPulse 1.5s ${i * 0.16}s ease-in-out infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ category }: { category: Category }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 8, padding: 24,
    }}>
      <span style={{ fontSize: 28 }}>📰</span>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        No {category} news yet.<br />Articles will appear as they arrive.
      </div>
    </div>
  );
}

function SearchEmptyState({ query }: { query: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 8, padding: 24,
    }}>
      <span style={{ fontSize: 26 }}>🔍</span>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        No results for <span style={{ color: 'var(--text)', fontWeight: 600 }}>"{query}"</span>
        <br />Try a different keyword or source name.
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry(): void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 10, padding: 24,
    }}>
      <span style={{ fontSize: 28 }}>📡</span>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5,
      }}>
        Could not connect to news stream.<br />Check your connection and try again.
      </div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 4, padding: '5px 14px', borderRadius: 5, cursor: 'pointer',
          background: 'rgba(61,232,176,0.1)', border: '1px solid rgba(61,232,176,0.3)',
          color: 'var(--teal)', fontSize: 10, fontFamily: 'var(--font-mono)',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        Retry
      </button>
    </div>
  );
}
