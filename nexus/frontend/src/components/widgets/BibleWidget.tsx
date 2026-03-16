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
  { id: 'kjv',    short: 'KJV'  },
  { id: 'web',    short: 'WEB'  },
  { id: 'webbe',  short: 'WEBE' },
  { id: 'oeb-us', short: 'OEB'  },
  { id: 'bbe',    short: 'BBE'  },
];

const LS_KEY_TRANSLATION = 'nexus_bible_translation';
const LS_KEY_SAVED       = 'nexus_bible_saved_ids';

type View = 'verse' | 'saved';

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

// Font size scales so the full verse always fits without scrolling.
// Uses both width and height of the available text area.
function computeFontSize(textLen: number, widgetW: number, widgetH: number): number {
  // Available space: subtract tab bar (~32px), label (~22px), footer (~40px), padding (~16px)
  const usableH = Math.max(40, widgetH - 110);
  // Subtract left+right padding (40px)
  const usableW = Math.max(60, widgetW - 40);

  // DM Serif Display italic: avg char width ≈ 0.52 × font-size, line-height = 1.7
  for (let fs = 22; fs >= 9; fs -= 0.5) {
    const charsPerLine = Math.max(1, Math.floor(usableW / (fs * 0.52)));
    const lines        = Math.ceil(textLen / charsPerLine);
    const neededH      = lines * fs * 1.7;
    if (neededH <= usableH) return Math.round(fs * 2) / 2; // round to 0.5px
  }
  return 9;
}

// ── Main component ────────────────────────────────────────────────────────────

export function BibleWidget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });

  const [view, setView]      = useState<View>('verse');
  const [translation, setTr] = useState<string>(
    () => localStorage.getItem(LS_KEY_TRANSLATION) ?? 'kjv'
  );

  // Daily verse state
  const [verse, setVerse]       = useState<BibleVerse | null>(null);
  const [fadeIn, setFadeIn]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [verseError, setVerseError] = useState('');
  const [lastDayStr, setLastDayStr] = useState(localDayString);

  // Save system
  const [savedVerses, setSavedVerses] = useState<SavedVerse[]>([]);
  const [savedIds, setSavedIds]       = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY_SAVED) ?? '[]')); }
    catch { return new Set(); }
  });
  const [copyFlash, setCopyFlash] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

  // Floating panel for micro mode
  const [showPanel, setShowPanel] = useState(false);

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

  // ── Fetch daily verse ────────────────────────────────────────────────────────
  const fetchVerse = useCallback(async (tr: string) => {
    setLoading(true);
    setVerseError('');
    try {
      const res  = await apiFetch(`/api/bible/today?translation=${tr}`);
      const data = await res.json() as BibleVerse;
      setVerse(data);
      setFadeIn(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setFadeIn(true)));
    } catch {
      setVerseError('Could not load verse.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVerse(translation); }, [translation, fetchVerse]);

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

  const trShort = (id: string) => TRANSLATIONS.find(t => t.id === id)?.short ?? id.toUpperCase();

  const fontSize = verse ? computeFontSize(verse.text.length, size.w, size.h) : 16;

  // ── Verse view ────────────────────────────────────────────────────────────────
  const VerseContent = ({ fs }: { fs: number }) => (
    <>
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
        <p className="bv-text" style={{ fontSize: fs }}>{verse.text}</p>
      )}
    </>
  );

  // ── Micro mode ────────────────────────────────────────────────────────────────
  if (isMicro) {
    return (
      <div ref={containerRef} className="bv-root bv-micro" onClick={() => setShowPanel(p => !p)}>
        <div className="bv-micro-inner">
          {verse
            ? <div className="bv-micro-ref">{verse.reference}</div>
            : <div className="bv-micro-ref">✝</div>
          }
        </div>
        {showPanel && verse && (
          <>
            <div className="bv-panel-backdrop" onClick={e => { e.stopPropagation(); setShowPanel(false); }} />
            <div className="bv-float-panel" onClick={e => e.stopPropagation()}>
              <div className="bv-label">✦ VERSE OF THE DAY</div>
              <div className="bv-float-scroll">
                <p className="bv-text" style={{ fontSize: 14, textAlign: 'center' }}>{verse.text}</p>
              </div>
              <div className="bv-reference">
                <span className="bv-ref-dash">—</span>
                <span className="bv-ref-text">{verse.reference}</span>
                <span className="bv-tr-badge">{trShort(verse.translation)}</span>
              </div>
              <div className="bv-actions">
                <button className="bv-act-btn" onClick={handleCopy}>{copyFlash ? '✓ Copied' : '📋 Copy'}</button>
                <button className={`bv-act-btn ${isSaved ? 'bv-act-saved' : ''}`} onClick={handleSave}>
                  {saveFlash ? '✓ Saved' : isSaved ? '🔖 Saved' : '🔖 Save'}
                </button>
              </div>
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
            <div className="bv-slim-scroll">
              <p className="bv-text" style={{ fontSize: 13 }}>{verse.text}</p>
            </div>
            <div className="bv-reference" style={{ marginTop: 6 }}>
              <span className="bv-ref-dash">—</span>
              <span className="bv-ref-text">{verse.reference}</span>
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
              <p className="bv-text" style={{ fontSize: 12 }}>
                {verse.text.slice(0, 110)}{verse.text.length > 110 ? '…' : ''}
              </p>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  // ── Standard / Expanded ───────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="bv-root bv-standard">

      {/* Minimal header bar */}
      <div className="bv-tabs">
        <button
          className={`bv-tab ${view === 'verse' ? 'bv-tab-active' : ''}`}
          onClick={() => setView('verse')}
        >✝</button>
        <button
          className={`bv-tab ${view === 'saved' ? 'bv-tab-active' : ''}`}
          onClick={() => { setView('saved'); fetchSaved(); }}
        >🔖</button>
        <div className="bv-tab-spacer" />
        <select
          className="bv-tr-select"
          value={translation}
          onChange={e => setTr(e.target.value)}
        >
          {TRANSLATIONS.map(t => (
            <option key={t.id} value={t.id}>{t.short}</option>
          ))}
        </select>
      </div>

      {/* Verse view */}
      {view === 'verse' && (
        <div className={`bv-verse-view ${fadeIn ? 'bv-fade-in' : ''}`}>
          <div className="bv-label">✦ VERSE OF THE DAY</div>
          <div className="bv-verse-scroll">
            <VerseContent fs={fontSize} />
          </div>
          {verse && (
            <div className="bv-footer">
              <div className="bv-reference">
                <span className="bv-ref-dash">—</span>
                <span className="bv-ref-text">{verse.reference}</span>
              </div>
              <div className="bv-footer-actions">
                <button className="bv-act-btn" onClick={handleCopy} title="Copy">
                  {copyFlash ? '✓' : '📋'}
                </button>
                <button
                  className={`bv-act-btn ${isSaved ? 'bv-act-saved' : ''}`}
                  onClick={handleSave}
                  title={isSaved ? 'Remove bookmark' : 'Save'}
                >
                  {saveFlash ? '✓' : '🔖'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved view */}
      {view === 'saved' && (
        <div className="bv-saved-view">
          {savedVerses.length === 0 ? (
            <div className="bv-empty-state">
              <div style={{ fontSize: 26, marginBottom: 8 }}>🔖</div>
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
                    <span className="bv-tr-badge">{trShort(sv.translation)}</span>
                    <button className="bv-delete-btn" onClick={() => handleDeleteSaved(sv.id)}>✕</button>
                  </div>
                  <div className="bv-saved-text">{sv.text.slice(0, 110)}{sv.text.length > 110 ? '…' : ''}</div>
                  <div className="bv-saved-date">{daysSince(sv.saved_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
