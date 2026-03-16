import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Types ────────────────────────────────────────────────────────────────────

interface BibleVerse {
  reference: string;
  text: string;
  translation: string;
  translationName: string;
  book: string;
  chapter: number;
  verse: string;
  dayIndex: number | null;
}

interface SavedVerse {
  id: string;
  reference: string;
  text: string;
  translation: string;
  saved_at: string;
}

const TRANSLATIONS = [
  { id: 'kjv',    name: 'King James Version',           short: 'KJV'  },
  { id: 'web',    name: 'World English Bible',           short: 'WEB'  },
  { id: 'webbe',  name: 'World English Bible (British)', short: 'WEBE' },
  { id: 'oeb-us', name: 'Open English Bible (US)',       short: 'OEB'  },
  { id: 'bbe',    name: 'Bible in Basic English',        short: 'BBE'  },
];

const LS_KEY_TRANSLATION = 'nexus_bible_translation';
const LS_KEY_SAVED       = 'nexus_bible_saved_ids';

type View = 'verse' | 'saved' | 'lookup';

// ── Helpers ──────────────────────────────────────────────────────────────────

function localDayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

function computeFontSize(textLen: number, widgetH: number): number {
  const base = Math.max(13, Math.min(26, Math.floor(widgetH / 14)));
  if (textLen > 400) return Math.max(13, base - 4);
  if (textLen > 250) return Math.max(14, base - 2);
  if (textLen < 80)  return Math.min(26, base + 3);
  return base;
}

// ── Main component ────────────────────────────────────────────────────────────

export function BibleWidget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize]       = useState({ w: 300, h: 300 });

  const [view, setView]       = useState<View>('verse');
  const [translation, setTr]  = useState<string>(
    () => localStorage.getItem(LS_KEY_TRANSLATION) ?? 'kjv'
  );

  // Daily verse state
  const [verse, setVerse]             = useState<BibleVerse | null>(null);
  const [tomorrowRef, setTomorrowRef] = useState<string | null>(null);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [fadeIn, setFadeIn]           = useState(false);
  const [loading, setLoading]         = useState(true);
  const [verseError, setVerseError]   = useState('');
  const [lastDayStr, setLastDayStr]   = useState(localDayString);

  // Save system
  const [savedVerses, setSavedVerses] = useState<SavedVerse[]>([]);
  const [savedIds, setSavedIds]       = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY_SAVED) ?? '[]')); }
    catch { return new Set(); }
  });
  const [copyFlash, setCopyFlash]     = useState(false);
  const [saveFlash, setSaveFlash]     = useState(false);

  // Lookup state
  const [lookupRef, setLookupRef]     = useState('');
  const [lookupVerse, setLookupVerse] = useState<BibleVerse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupTranslation, setLookupTr] = useState<string>('kjv');
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Floating panel for micro mode
  const [showPanel, setShowPanel]     = useState(false);

  const isReady = !loading || !!verse;
  useWidgetReady('bible', isReady);

  // ── ResizeObserver ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isMicro    = size.w < 140 || size.h < 140;
  const isSlimPort = !isMicro && size.w < 200 && size.h >= size.w;
  const isSlimLand = !isMicro && size.h < 180 && size.w > size.h;
  const isStandard = !isMicro && !isSlimPort && !isSlimLand;
  const isExpanded = isStandard && size.w >= 350 && size.h >= 350;

  // ── Fetch daily verse ────────────────────────────────────────────────────────
  const fetchVerse = useCallback(async (tr: string, quiet = false) => {
    if (!quiet) setLoading(true);
    setVerseError('');
    try {
      const res  = await apiFetch(`/api/bible/today?translation=${tr}`);
      const data = await res.json() as BibleVerse;
      setVerse(data);
      setFadeIn(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setFadeIn(true)));

      // Tomorrow's verse reference (dayIndex + 1)
      if (data.dayIndex != null) {
        const tomorrowRes  = await apiFetch(`/api/bible/today?translation=${tr}&dayOffset=1`);
        if (tomorrowRes.ok) {
          const td = await tomorrowRes.json() as BibleVerse;
          setTomorrowRef(td.reference);
        }
      }
    } catch {
      setVerseError('Could not load verse. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVerse(translation); }, [translation, fetchVerse]);

  // Save translation preference
  useEffect(() => {
    localStorage.setItem(LS_KEY_TRANSLATION, translation);
  }, [translation]);

  // ── Midnight reset ───────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      const cur = localDayString();
      if (cur !== lastDayStr) {
        setLastDayStr(cur);
        setFadeIn(false);
        setTimeout(() => fetchVerse(translation), 450);
      }
    }, 30_000);
    return () => clearInterval(tick);
  }, [lastDayStr, translation, fetchVerse]);

  // ── Saved verses ─────────────────────────────────────────────────────────────
  const fetchSaved = useCallback(async () => {
    try {
      const res  = await apiFetch('/api/bible/saved');
      const data = await res.json() as SavedVerse[];
      setSavedVerses(data);
      const ids = new Set(data.map(v => `${v.reference}:${v.translation}`));
      setSavedIds(ids);
      localStorage.setItem(LS_KEY_SAVED, JSON.stringify([...ids]));
    } catch { /* offline — keep cached */ }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const isSaved = verse
    ? savedIds.has(`${verse.reference}:${verse.translation}`)
    : false;

  const handleSave = async () => {
    if (!verse) return;
    if (isSaved) {
      const found = savedVerses.find(
        v => v.reference === verse.reference && v.translation === verse.translation
      );
      if (found) {
        await apiFetch(`/api/bible/saved/${found.id}`, { method: 'DELETE' });
        await fetchSaved();
      }
    } else {
      await apiFetch('/api/bible/saved', {
        method: 'POST',
        body: JSON.stringify({
          reference:   verse.reference,
          text:        verse.text,
          translation: verse.translation,
        }),
      });
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
      await fetchSaved();
    }
  };

  const handleCopy = async () => {
    if (!verse) return;
    try {
      await navigator.clipboard.writeText(`"${verse.text}" — ${verse.reference} (${verse.translation.toUpperCase()})`);
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1500);
    } catch { /* clipboard denied */ }
  };

  const handleDeleteSaved = async (id: string) => {
    await apiFetch(`/api/bible/saved/${id}`, { method: 'DELETE' });
    await fetchSaved();
  };

  // ── Lookup ───────────────────────────────────────────────────────────────────
  const handleLookupInput = (val: string) => {
    setLookupRef(val);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (!val.trim()) { setLookupVerse(null); return; }
    const refPattern = /^[a-z1-9]/i;
    if (!refPattern.test(val)) return;
    lookupTimer.current = setTimeout(async () => {
      setLookupLoading(true);
      setLookupError('');
      try {
        const res  = await apiFetch(`/api/bible/verse?ref=${encodeURIComponent(val)}&translation=${lookupTranslation}`);
        if (!res.ok) { setLookupError('Verse not found. Try a reference like "Romans 8:28"'); return; }
        const data = await res.json() as BibleVerse;
        setLookupVerse(data);
      } catch {
        setLookupError('Could not fetch verse.');
      } finally {
        setLookupLoading(false);
      }
    }, 500);
  };

  // Translation short label helper
  const trShort = (id: string) => TRANSLATIONS.find(t => t.id === id)?.short ?? id.toUpperCase();

  // ── Verse text font size ─────────────────────────────────────────────────────
  const fontSize = verse ? computeFontSize(verse.text.length, size.h) : 18;

  // ── Shared action bar ────────────────────────────────────────────────────────
  const ActionBar = ({ v }: { v: BibleVerse }) => (
    <div className="bv-actions">
      <button className="bv-act-btn" onClick={handleCopy} title="Copy verse">
        {copyFlash ? '✓' : '📋'}
      </button>
      <button
        className={`bv-act-btn ${isSaved ? 'bv-act-saved' : ''}`}
        onClick={handleSave}
        title={isSaved ? 'Remove bookmark' : 'Save verse'}
      >
        {saveFlash ? '✓' : '🔖'}
      </button>
      <button className="bv-act-btn" onClick={() => setView('lookup')} title="Lookup verse">
        🔍
      </button>
      {v.translation && (
        <span className="bv-tr-badge">{trShort(v.translation)}</span>
      )}
    </div>
  );

  // ── Views ─────────────────────────────────────────────────────────────────────

  const VerseView = () => (
    <div className={`bv-verse-view ${fadeIn ? 'bv-fade-in' : ''}`}>
      <div className="bv-label">✦ VERSE OF THE DAY</div>

      {loading && !verse && (
        <div className="bv-loading">
          <div className="bv-shimmer" />
          <div className="bv-shimmer bv-shimmer-sm" />
          <div className="bv-shimmer bv-shimmer-xs" />
        </div>
      )}

      {verseError && (
        <div className="bv-error">
          {verseError}
          <button className="bv-retry" onClick={() => fetchVerse(translation)}>Retry</button>
        </div>
      )}

      {verse && !verseError && (
        <>
          <div className="bv-quote-wrap" style={{ fontSize }}>
            <span className="bv-quote-mark bv-quote-open">"</span>
            <p className="bv-text">{verse.text}</p>
            <span className="bv-quote-mark bv-quote-close">"</span>
          </div>

          <div className="bv-reference">
            <span className="bv-ref-dash">—</span>
            <span className="bv-ref-text">{verse.reference}</span>
          </div>

          {isStandard && <ActionBar v={verse} />}

          {isExpanded && (
            <div className="bv-tomorrow-row">
              <button
                className="bv-tomorrow-toggle"
                onClick={() => setShowTomorrow(t => !t)}
              >
                {showTomorrow ? '▾' : '▸'} Tomorrow's verse
              </button>
              {showTomorrow && tomorrowRef && (
                <span className="bv-tomorrow-ref">{tomorrowRef}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  const SavedView = () => (
    <div className="bv-saved-view">
      <div className="bv-saved-header">
        <button className="bv-back-btn" onClick={() => setView('verse')}>← Back</button>
        <span className="bv-label" style={{ margin: 0 }}>Saved Verses</span>
      </div>
      {savedVerses.length === 0 ? (
        <div className="bv-empty-state">
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔖</div>
          <div>No saved verses yet</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>
            Tap 🔖 on any verse to save it
          </div>
        </div>
      ) : (
        <div className="bv-saved-list">
          {savedVerses.map(sv => (
            <div key={sv.id} className="bv-saved-card">
              <div className="bv-saved-card-top">
                <span className="bv-saved-ref">{sv.reference}</span>
                <span className="bv-tr-badge" style={{ marginLeft: 6 }}>{trShort(sv.translation)}</span>
                <button
                  className="bv-delete-btn"
                  onClick={() => handleDeleteSaved(sv.id)}
                  title="Remove"
                >✕</button>
              </div>
              <div className="bv-saved-text">{sv.text.slice(0, 120)}{sv.text.length > 120 ? '…' : ''}</div>
              <div className="bv-saved-date">{daysSince(sv.saved_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const LookupView = () => (
    <div className="bv-lookup-view">
      <div className="bv-saved-header">
        <button className="bv-back-btn" onClick={() => { setView('verse'); setLookupRef(''); setLookupVerse(null); }}>← Back</button>
        <span className="bv-label" style={{ margin: 0 }}>Verse Lookup</span>
      </div>
      <div className="bv-lookup-row">
        <input
          className="bv-lookup-input"
          placeholder="e.g. Romans 8:28"
          value={lookupRef}
          onChange={e => handleLookupInput(e.target.value)}
          autoFocus
        />
        <select
          className="bv-tr-select"
          value={lookupTranslation}
          onChange={e => { setLookupTr(e.target.value); handleLookupInput(lookupRef); }}
        >
          {TRANSLATIONS.map(t => (
            <option key={t.id} value={t.id}>{t.short}</option>
          ))}
        </select>
      </div>
      {lookupLoading && <div className="bv-lookup-loading">Searching…</div>}
      {lookupError  && <div className="bv-error" style={{ marginTop: 8 }}>{lookupError}</div>}
      {lookupVerse && !lookupLoading && (
        <div className="bv-lookup-result">
          <div className="bv-quote-wrap" style={{ fontSize: Math.min(16, fontSize) }}>
            <span className="bv-quote-mark bv-quote-open">"</span>
            <p className="bv-text">{lookupVerse.text}</p>
            <span className="bv-quote-mark bv-quote-close">"</span>
          </div>
          <div className="bv-reference">
            <span className="bv-ref-dash">—</span>
            <span className="bv-ref-text">{lookupVerse.reference}</span>
          </div>
        </div>
      )}
    </div>
  );

  // ── Micro mode: just reference + floating panel ───────────────────────────────
  if (isMicro) {
    return (
      <div ref={containerRef} className="bv-root bv-micro" onClick={() => setShowPanel(p => !p)}>
        <div className="bv-micro-inner">
          {verse ? (
            <>
              <div className="bv-micro-ref">{verse.reference}</div>
              <div className="bv-label" style={{ marginTop: 4, fontSize: 9 }}>✦ VERSE OF THE DAY</div>
            </>
          ) : (
            <div className="bv-micro-ref">✝</div>
          )}
        </div>
        {showPanel && verse && (
          <>
            <div className="bv-panel-backdrop" onClick={e => { e.stopPropagation(); setShowPanel(false); }} />
            <div className="bv-float-panel" onClick={e => e.stopPropagation()}>
              <div className="bv-label">✦ VERSE OF THE DAY</div>
              <div className="bv-quote-wrap" style={{ fontSize: 14 }}>
                <span className="bv-quote-mark bv-quote-open">"</span>
                <p className="bv-text">{verse.text}</p>
                <span className="bv-quote-mark bv-quote-close">"</span>
              </div>
              <div className="bv-reference">
                <span className="bv-ref-dash">—</span>
                <span className="bv-ref-text">{verse.reference}</span>
              </div>
              <ActionBar v={verse} />
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Slim portrait ─────────────────────────────────────────────────────────────
  if (isSlimPort) {
    return (
      <div ref={containerRef} className="bv-root bv-slim-port">
        {verse ? (
          <>
            <div className="bv-label">✦ VERSE OF THE DAY</div>
            <div className="bv-slim-text">{verse.text}</div>
            <div className="bv-reference" style={{ marginTop: 'auto' }}>
              <span className="bv-ref-dash">—</span>
              <span className="bv-ref-text">{verse.reference}</span>
              <span className="bv-tr-badge" style={{ marginLeft: 6 }}>{trShort(verse.translation)}</span>
            </div>
          </>
        ) : loading ? (
          <div className="bv-loading"><div className="bv-shimmer" /></div>
        ) : null}
      </div>
    );
  }

  // ── Slim landscape ────────────────────────────────────────────────────────────
  if (isSlimLand) {
    return (
      <div ref={containerRef} className="bv-root bv-slim-land">
        {verse ? (
          <>
            <div className="bv-slim-land-inner">
              <div className="bv-reference">
                <span className="bv-ref-dash">—</span>
                <span className="bv-ref-text">{verse.reference}</span>
              </div>
              <div className="bv-slim-land-text">{verse.text.slice(0, 100)}{verse.text.length > 100 ? '…' : ''}</div>
            </div>
            <span className="bv-tr-badge">{trShort(verse.translation)}</span>
          </>
        ) : null}
      </div>
    );
  }

  // ── Standard / Expanded ───────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="bv-root bv-standard">
      {/* Tab bar */}
      <div className="bv-tabs">
        <button
          className={`bv-tab ${view === 'verse' ? 'bv-tab-active' : ''}`}
          onClick={() => setView('verse')}
        >✝</button>
        <button
          className={`bv-tab ${view === 'saved' ? 'bv-tab-active' : ''}`}
          onClick={() => { setView('saved'); fetchSaved(); }}
        >🔖</button>
        <button
          className={`bv-tab ${view === 'lookup' ? 'bv-tab-active' : ''}`}
          onClick={() => setView('lookup')}
        >🔍</button>
        <div className="bv-tab-spacer" />
        <select
          className="bv-tr-select bv-tr-select-sm"
          value={translation}
          onChange={e => setTr(e.target.value)}
        >
          {TRANSLATIONS.map(t => (
            <option key={t.id} value={t.id}>{t.short}</option>
          ))}
        </select>
      </div>

      {view === 'verse'  && <VerseView />}
      {view === 'saved'  && <SavedView />}
      {view === 'lookup' && <LookupView />}
    </div>
  );
}
