import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://nexus-api.lj-buchmiller.com';

interface Article {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  isBreaking: boolean;
}

type Category = 'politics' | 'technology' | 'ai';
const TABS: { id: Category; label: string }[] = [
  { id: 'politics', label: 'Politics' },
  { id: 'technology', label: 'Tech' },
  { id: 'ai', label: 'AI' },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SOURCE_COLORS: Record<string, string> = {
  'NYT': '#888', 'WaPo': '#7aaaf8', 'Ars Technica': '#f08070',
  'TechCrunch': '#60d080', 'Wired': '#d4b840',
};

export function MobileNewsCard() {
  const [tab, setTab] = useState<Category>('technology');
  const [articles, setArticles] = useState<Article[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    setArticles([]);

    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      const es = new EventSource(`${API_BASE}/api/news/stream?category=${tab}&token=${token}`);
      esRef.current = es;
      es.addEventListener('snapshot', (e) => {
        try { setArticles(JSON.parse((e as MessageEvent).data) as Article[]); } catch { /* ignore */ }
      });
      es.addEventListener('article', (e) => {
        try {
          const a = JSON.parse((e as MessageEvent).data) as Article;
          setArticles(prev => [a, ...prev.filter(x => x.id !== a.id)].slice(0, 20));
        } catch { /* ignore */ }
      });
    });

    return () => { esRef.current?.close(); };
  }, [tab]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '16px 16px 0', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 14px', borderRadius: 20,
            background: tab === t.id ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: 'none', color: tab === t.id ? '#fff' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Articles */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {articles.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 8 }}>Loading…</div>
        )}
        {articles.map(a => (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{
            display: 'block', padding: '12px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,0.04)', textDecoration: 'none',
            border: a.isBreaking ? '1px solid rgba(239,68,68,0.4)' : '1px solid transparent',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: 'rgba(120,120,120,0.18)',
                color: SOURCE_COLORS[a.source] ?? '#a0a0a0',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              }}>
                {a.source}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {timeAgo(a.publishedAt)}
              </span>
              {a.isBreaking && (
                <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  BREAKING
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
              {a.title}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
