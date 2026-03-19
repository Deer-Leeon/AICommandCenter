import {
  useState, useRef, useEffect, useMemo,
  type KeyboardEvent, type CSSProperties,
} from 'react';
import { useAI } from '../hooks/useAI';
import { useOmnibarStore } from '../store/useOmnibarStore';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { isExtension, getExtensionId } from '../lib/platform';

const ALLOWED_AI_EMAILS = new Set(['lj.buchmiller@gmail.com']);

type Mode = 'google' | 'ai';

// ── Popular defaults shown when layers 1+2 produce < 3 results ───────────────
const POPULAR_SITES = [
  'youtube.com', 'github.com', 'gmail.com', 'drive.google.com', 'reddit.com',
  'netflix.com', 'spotify.com', 'notion.so', 'figma.com', 'twitter.com',
  'x.com', 'linkedin.com', 'amazon.com', 'wikipedia.org', 'chatgpt.com',
  'claude.ai', 'vercel.com', 'stripe.com', 'discord.com', 'twitch.tv',
  'google.com', 'stackoverflow.com', 'medium.com', 'dev.to', 'instagram.com',
  'facebook.com', 'tiktok.com', 'pinterest.com', 'apple.com', 'microsoft.com',
  'aws.amazon.com', 'cloudflare.com', 'digitalocean.com', 'heroku.com',
  'netlify.com', 'supabase.com', 'openai.com', 'anthropic.com',
  'huggingface.co', 'kaggle.com', 'zoom.us', 'meet.google.com', 'slack.com',
  'airtable.com', 'trello.com', 'asana.com', 'linear.app', 'shopify.com',
  'wordpress.com', 'tailwindcss.com',
].map((domain) => ({ domain, url: `https://${domain}` }));

const SEARCH_URLS: Record<string, string> = {
  google:     'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing:       'https://www.bing.com/search?q=',
  perplexity: 'https://www.perplexity.ai/search?q=',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// ── Suggestion type ───────────────────────────────────────────────────────────

interface Suggestion {
  type:   'shortcut' | 'history' | 'popular';
  label:  string;   // trigger for shortcuts, domain for others
  url:    string;
  domain: string;
}

const SOURCE_LABEL: Record<Suggestion['type'], string> = {
  shortcut: 'Shortcut',
  history:  'Recent',
  popular:  'Popular',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AIInputBar() {
  const { user } = useAuth();
  const hasAIAccess = ALLOWED_AI_EMAILS.has((user?.email ?? '').toLowerCase());

  const [mode, setMode]               = useState<Mode>('google');
  const [input, setInput]             = useState('');
  const [focused, setFocused]         = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Track resolved theme (respects manual dark/light/auto selection)
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const inputRef          = useRef<HTMLInputElement>(null);
  const containerRef      = useRef<HTMLDivElement>(null);
  const userInteractedRef = useRef(false);
  const bufferFlushedRef  = useRef(false);

  const { sendMessage, isLoading } = useAI();

  // Pull from shared omnibar store
  const load           = useOmnibarStore((s) => s.load);
  const settings       = useOmnibarStore((s) => s.settings);
  const shortcuts      = useOmnibarStore((s) => s.shortcuts);
  const history        = useOmnibarStore((s) => s.history);
  const recordHistory  = useOmnibarStore((s) => s.recordHistory);

  // Load omnibar data on first mount
  useEffect(() => { load(); }, [load]);

  // Drain the pre-React type-ahead buffer (window.__nexusTypeBuffer).
  // Called on every focus attempt; safe to call multiple times — guard ref
  // ensures only the first call actually flushes and sets the input value.
  function drainTypeBuffer() {
    if (bufferFlushedRef.current) return;
    bufferFlushedRef.current = true;

    const w = window as unknown as {
      __nexusTypeBuffer?: string;
      __nexusTypeBufferActive?: boolean;
    };
    w.__nexusTypeBufferActive = false; // stop buffering — input owns keys now
    const buffered = w.__nexusTypeBuffer ?? '';
    delete w.__nexusTypeBuffer;

    if (buffered) {
      setInput(buffered);
      // Place cursor at end of the replayed text
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(buffered.length, buffered.length);
      });
    }
  }

  // Auto-focus — fires immediately, then again at 150 ms and 700 ms.
  // The 700 ms retry is the decisive one: it outlasts every lazy-loaded widget
  // (TypingWidget, NotesWidget, etc.) that tries to steal focus on mount.
  // It only fires if the user hasn't deliberately clicked/tapped anything first.
  useEffect(() => {
    const markInteracted = () => { userInteractedRef.current = true; };
    document.addEventListener('pointerdown', markInteracted, { capture: true, once: true });

    const raf = requestAnimationFrame(() => { inputRef.current?.focus(); drainTypeBuffer(); });
    const t1  = setTimeout(() => { inputRef.current?.focus(); drainTypeBuffer(); }, 150);
    const t2  = setTimeout(() => {
      if (!userInteractedRef.current) { inputRef.current?.focus(); drainTypeBuffer(); }
    }, 700);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener('pointerdown', markInteracted, { capture: true });
    };
  // drainTypeBuffer is defined in render scope — stable reference via ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suggestions ───────────────────────────────────────────────────────────
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!input.trim() || mode !== 'google' || !settings.showSuggestions) return [];
    const q    = input.toLowerCase().trim();
    const out: Suggestion[] = [];
    const seen = new Set<string>();

    // Layer 1 — keyword shortcuts matching prefix
    for (const sc of shortcuts) {
      if (sc.trigger.startsWith(q)) {
        const domain = extractDomain(sc.url);
        out.push({ type: 'shortcut', label: sc.trigger, url: sc.url, domain });
        seen.add(domain);
        if (out.length >= 6) return out;
      }
    }

    // Layer 2 — personal navigation history
    for (const h of history) {
      if (!seen.has(h.domain) && (h.domain.includes(q) || h.url.includes(q))) {
        out.push({ type: 'history', label: h.domain, url: h.url, domain: h.domain });
        seen.add(h.domain);
        if (out.length >= 6) return out;
      }
    }

    // Layer 3 — popular defaults (only if fewer than 3 results so far)
    if (out.length < 3) {
      for (const p of POPULAR_SITES) {
        if (!seen.has(p.domain) && p.domain.includes(q)) {
          out.push({ type: 'popular', label: p.domain, url: p.url, domain: p.domain });
          seen.add(p.domain);
          if (out.length >= 6) break;
        }
      }
    }

    return out;
  }, [input, shortcuts, history, settings.showSuggestions, mode]);

  // Reset selection to first entry whenever the suggestion list changes
  const firstLabel = suggestions[0]?.label ?? '';
  useEffect(() => { setSelectedIdx(0); }, [firstLabel, suggestions.length]);

  // Show / hide dropdown based on focus + suggestions
  useEffect(() => {
    setShowDropdown(focused && suggestions.length > 0);
  }, [focused, suggestions.length]);

  // Re-measure dropdown anchor position whenever it opens or input changes
  useEffect(() => {
    if (showDropdown && containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
  }, [showDropdown, input]);

  // ── Mode switch ───────────────────────────────────────────────────────────
  function switchMode(next?: Mode) {
    setMode((prev) => next ?? (prev === 'google' ? 'ai' : 'google'));
    setShowDropdown(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ── Navigation helpers ────────────────────────────────────────────────────
  function goTo(url: string, record = true) {
    const full = url.startsWith('http') ? url : `https://${url}`;
    if (record) recordHistory(full);
    setInput('');
    setShowDropdown(false);
    if (settings.openNewTab) window.open(full, '_blank');
    else window.location.href = full;
  }

  function isLikelyUrl(val: string): boolean {
    if (!settings.smartUrl) return false;
    if (/^https?:\/\//i.test(val)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(val)) return true; // IP address
    if (/^[^\s.]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(val) && !val.includes(' ')) return true;
    return false;
  }

  // ── Google mode submit ────────────────────────────────────────────────────
  function handleGoogleSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Quick Launch: exact shortcut or heavily-visited domain → instant nav
    if (settings.quickLaunch) {
      const exact = shortcuts.find((s) => s.trigger === trimmed);
      if (exact) { goTo(exact.url); return; }
      const freq = history.find((h) => h.domain === extractDomain(trimmed));
      if (freq && freq.visitCount > 10) { goTo(freq.url); return; }
    }

    // Use highlighted suggestion if dropdown is open
    if (showDropdown && suggestions.length > 0) {
      const target = suggestions[selectedIdx] ?? suggestions[0];
      goTo(target.url);
      return;
    }

    // Intent classification
    const exact = shortcuts.find((s) => s.trigger === trimmed);
    if (exact) { goTo(exact.url); return; }

    if (isLikelyUrl(trimmed)) {
      goTo(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      return;
    }

    // Default: search
    setInput('');
    setShowDropdown(false);

    // ── Extension search (chrome.search.query via externally_connectable) ──────
    // The thin loader redirects to this website as the top-level page, so
    // chrome.search.query is NOT directly available here (wrong origin).
    // Instead we use chrome.runtime.sendMessage(extensionId, ...) which is
    // allowed because manifest.json declares externally_connectable for this
    // origin. The background service worker receives the message and calls
    // chrome.search.query, which respects the user's default Chrome engine.
    //
    // The extension ID is embedded in the redirect URL by newtab.js:
    //   nexus.lj-buchmiller.com?source=extension&extid=<chrome.runtime.id>
    if (isExtension() && settings.searchEngine === 'google') {
      const extId = getExtensionId();
      if (extId && typeof chrome !== 'undefined') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chrome as any).runtime.sendMessage(extId, {
            type: 'NEXUS_SEARCH',
            query: trimmed,
            disposition: settings.openNewTab ? 'NEW_TAB' : 'CURRENT_TAB',
          });
          return;
        } catch {
          // If message passing fails for any reason, fall through to URL nav
        }
      }
    }

    // ── iframe mode (future / fallback) ─────────────────────────────────────
    // Only fires if the extension somehow loads the website in an iframe instead
    // of a redirect. Guard: window !== window.top ensures we're actually in a frame.
    if (isExtension() && settings.searchEngine === 'google' && window !== window.top) {
      window.parent.postMessage(
        {
          type: 'NEXUS_SEARCH_REQUEST',
          query: trimmed,
          disposition: settings.openNewTab ? 'NEW_TAB' : 'CURRENT_TAB',
        },
        '*',
      );
      return;
    }

    // Explicit engine override or non-extension fallback (web / Electron / iOS)
    const base      = SEARCH_URLS[settings.searchEngine] ?? SEARCH_URLS.google;
    const searchUrl = base + encodeURIComponent(trimmed);
    if (settings.openNewTab) window.open(searchUrl, '_blank');
    else window.location.href = searchUrl;
  }

  function handleSubmit() {
    if (!input.trim()) return;
    if (mode === 'google') { handleGoogleSubmit(input); return; }
    if (isLoading) return;
    sendMessage(input.trim());
    setInput('');
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // AI mode — minimal handling
    if (mode === 'ai') {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
      else if (e.key === 'Tab' && !input.trim()) { e.preventDefault(); switchMode(); }
      return;
    }

    // Google mode
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showDropdown) setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showDropdown) setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' && input.trim() && suggestions.length > 0) {
      e.preventDefault();
      const top = suggestions[0];
      setInput(top.type === 'shortcut' ? top.label : top.domain);
    } else if (e.key === 'Tab' && !input.trim()) {
      e.preventDefault();
      switchMode();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      setSelectedIdx(0);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGoogleSubmit(input);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isDisabled  = mode === 'ai' && isLoading;
  const placeholder = mode === 'google'
    ? 'Ask Google'
    : (isLoading ? 'Processing…' : 'Ask NEXUS…');

  const borderRgb  = mode === 'google' ? '66,133,244' : '124,106,255';
  const caretColor = mode === 'google' ? '#4285f4' : 'var(--accent)';

  // Inverted palette: light background in dark mode, dark background in light mode
  const barBg      = isDark ? 'rgba(240,240,248,0.88)' : 'rgba(18,18,26,0.82)';
  const textColor  = isDark ? '#0d0d18' : '#f0f0f8';
  const mutedColor = isDark ? 'rgba(13,13,24,0.45)' : 'rgba(240,240,248,0.5)';
  const iconColor  = isDark ? 'rgba(13,13,24,0.4)'  : 'rgba(240,240,248,0.4)';

  const pillStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', height: isDark ? 47 : 54,
    borderRadius: mode === 'google' ? 30 : 12,
    transition: 'border 0.2s, box-shadow 0.2s, background 0.2s, border-radius 0.2s',
    background: barBg,
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border: focused
      ? `1.5px solid rgba(${borderRgb},0.6)`
      : `1px solid rgba(${borderRgb},0.12)`,
    boxShadow: focused
      ? `0 4px 24px rgba(0,0,0,0.3), 0 0 0 3px rgba(${borderRgb},0.09)`
      : `0 2px 12px rgba(0,0,0,0.22)`,
    paddingLeft: 18, paddingRight: 18, gap: 12,
  };

  return (
    <>
      <div ref={containerRef} style={{ width: '100%' }}>
        {/* ── Pill bar ── */}
        <div style={pillStyle}>
          {/* Search icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke={iconColor} strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>

          {/* Input */}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={isDisabled}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 16, fontWeight: 400, color: textColor, caretColor,
              fontFamily: 'inherit',
              // Override browser placeholder colour to match the inverted palette
              ['--placeholder-color' as string]: mutedColor,
            }}
            className="nexus-omnibar-input"
          />

          {/* AI Mode toggle pill — only visible to allowed users */}
          {hasAIAccess && <button
            onClick={() => switchMode()}
            title={mode === 'google' ? 'Switch to NEXUS AI (Tab)' : 'Switch to Google Search (Tab)'}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 9999, cursor: 'pointer',
              border: mode === 'ai'
                ? '1px solid rgba(124,106,255,0.5)'
                : `1px solid ${isDark ? 'rgba(13,13,24,0.18)' : 'rgba(240,240,248,0.18)'}`,
              background: mode === 'ai'
                ? 'rgba(124,106,255,0.15)'
                : `${isDark ? 'rgba(13,13,24,0.08)' : 'rgba(240,240,248,0.08)'}`,
              color: mode === 'ai' ? 'var(--accent)' : mutedColor,
              fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              transition: 'background 0.2s, color 0.2s, border 0.2s',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ position: 'relative', width: 12, height: 12, flexShrink: 0 }}>
              {/* Clock icon — AI mode */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ position: 'absolute', inset: 0, opacity: mode === 'ai' ? 1 : 0, transition: 'opacity 0.2s' }}>
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 8v4l3 3"/>
              </svg>
              {/* Sun icon — Google mode */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ position: 'absolute', inset: 0, opacity: mode === 'google' ? 1 : 0, transition: 'opacity 0.2s' }}>
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
            </span>
            AI Mode
          </button>}

          {/* Loading spinner */}
          {isLoading && (
            <span style={{
              flexShrink: 0, display: 'block', width: 15, height: 15,
              borderRadius: '50%', border: `2px solid ${isDark ? 'rgba(13,13,24,0.15)' : 'rgba(240,240,248,0.15)'}`,
              borderTopColor: 'var(--accent)', animation: 'spin 0.7s linear infinite',
            }} />
          )}
        </div>
      </div>

      {/* ── Autocomplete dropdown ────────────────────────────────────────────
          Rendered at position:fixed to escape all stacking contexts.
          onMouseDown with preventDefault keeps input focused so blur doesn't
          fire before the navigation click resolves.
      ── */}
      {showDropdown && dropdownPos && suggestions.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top:      dropdownPos.top,
            left:     dropdownPos.left,
            width:    dropdownPos.width,
            zIndex:   9999,
            background: isDark ? 'rgba(245,245,252,0.97)' : 'rgba(16,16,24,0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: isDark ? '1px solid rgba(13,13,24,0.1)' : '1px solid rgba(255,255,255,0.09)',
            borderRadius: 14,
            boxShadow: isDark
              ? '0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(66,133,244,0.08)'
              : '0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(66,133,244,0.07)',
            overflow: 'hidden',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={`${s.type}-${s.label}`}
              onMouseDown={(e) => { e.preventDefault(); goTo(s.url); }}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', cursor: 'pointer',
                background: i === selectedIdx
                  ? isDark ? 'rgba(66,133,244,0.1)' : 'rgba(66,133,244,0.12)'
                  : 'transparent',
                borderBottom: i < suggestions.length - 1
                  ? isDark ? '1px solid rgba(13,13,24,0.07)' : '1px solid rgba(255,255,255,0.05)'
                  : 'none',
                transition: 'background 0.08s',
              }}
            >
              {/* Icon / Favicon */}
              {s.type === 'shortcut' ? (
                <span style={{
                  fontSize: 12, width: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, color: 'rgba(66,133,244,0.8)',
                }}>
                  ⚡
                </span>
              ) : (
                <img
                  src={faviconUrl(s.domain)}
                  width={16} height={16}
                  style={{ flexShrink: 0, borderRadius: 3 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}

              {/* Main label */}
              <span style={{
                flex: 1, fontSize: 13.5,
                color: isDark ? '#0d0d18' : 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {s.type === 'shortcut' ? (
                  <>
                    <span style={{ color: 'rgba(66,133,244,0.95)', fontWeight: 600 }}>
                      {s.label}
                    </span>
                    <span style={{
                      color: isDark ? 'rgba(13,13,24,0.5)' : 'var(--text-muted)',
                      marginLeft: 8, fontSize: 12,
                    }}>
                      → {s.domain}
                    </span>
                  </>
                ) : s.label}
              </span>

              {/* Source badge */}
              <span style={{
                flexShrink: 0, fontSize: 10,
                color: isDark ? 'rgba(13,13,24,0.4)' : 'var(--text-faint)',
                fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.07em',
              }}>
                {SOURCE_LABEL[s.type]}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .nexus-omnibar-input::placeholder { color: var(--placeholder-color, rgba(255,255,255,0.35)); }
      `}</style>
    </>
  );
}
