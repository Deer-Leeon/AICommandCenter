/**
 * useTheme — dark / light / auto mode manager.
 *
 * Persists to localStorage under THEME_KEY.  Applies `data-theme="dark"` or
 * `data-theme="light"` on <html> so pure-CSS overrides in index.css can
 * react without waiting for a React render.  "auto" removes the attribute
 * entirely, letting the @media(prefers-color-scheme) rule take over.
 *
 * A module-level side-effect applies the attribute synchronously the instant
 * this module is imported — before any React paint — preventing FOUC.
 */

import { useState, useEffect } from 'react';

export type ThemeMode = 'dark' | 'light' | 'auto';

export const THEME_KEY = 'nexus_theme';
const THEME_EVENT = 'nexus:theme-change';

// ── Prevent flash-of-wrong-theme (FOWT) ─────────────────────────────────────
// Runs synchronously at import time, before the first React render.
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null;
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

function readSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'auto';
  });

  // Track OS preference so resolvedTheme is correct in auto mode
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return readSystemTheme();
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sync with other useTheme instances in the same tab when any one of them calls setTheme
  useEffect(() => {
    const handler = (e: Event) => setThemeState((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(THEME_EVENT, handler);
    return () => window.removeEventListener(THEME_EVENT, handler);
  }, []);

  // Sync data-theme attribute on <html> whenever the user's choice changes
  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const resolvedTheme: 'dark' | 'light' = theme === 'auto' ? systemTheme : theme;

  const setTheme = (next: ThemeMode) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    // Notify every other useTheme instance in this tab so they re-render immediately
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: next }));
  };

  return { theme, resolvedTheme, setTheme };
}
