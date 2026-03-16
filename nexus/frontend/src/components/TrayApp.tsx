'use client';
/**
 * TrayApp — the mini-dashboard rendered inside the Electron tray popover panel.
 * Loaded at route /#/tray (HashRouter) inside a frameless 320×440 BrowserWindow.
 *
 * Shows at-a-glance:
 *  • Spotify: currently playing track
 *  • Pomodoro: session countdown + controls
 *  • Calendar: next upcoming event
 *  • Habits: today's habit checkboxes
 *  • Quick actions row
 *  • "Open NEXUS" button
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// ── Pomodoro localStorage ─────────────────────────────────────────────────────
const POMO_STATE_KEY = 'nexus_pomodoro_v1';

interface PomoState {
  timeLeft: number;
  isRunning: boolean;
  sessionType: 'focus' | 'short_break' | 'long_break';
  startTimestamp: number | null;
}

function loadPomo(): PomoState | null {
  try {
    const raw = localStorage.getItem(POMO_STATE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PomoState;
    if (p.isRunning && p.startTimestamp) {
      const elapsed = Math.floor((Date.now() - p.startTimestamp) / 1000);
      p.timeLeft = Math.max(0, p.timeLeft - elapsed);
    }
    return p;
  } catch {
    return null;
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpotifyNow {
  isPlaying: boolean;
  name: string;
  artists: string;
  albumArt: string;
}

interface CalEvent {
  id: string;
  title: string;
  startTime: string; // ISO
  endTime: string;
}

interface Habit {
  id: string;
  name: string;
  completedToday: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TrayApp() {
  const { user } = useAuth();
  const [spotify, setSpotify] = useState<SpotifyNow | null>(null);
  const [pomo, setPomo] = useState<PomoState | null>(loadPomo);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [togglingHabit, setTogglingHabit] = useState<string | null>(null);

  // ── Spotify polling ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchSpotify() {
      try {
        const res = await apiFetch('/api/spotify/now-playing');
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.name) {
            setSpotify({
              isPlaying: data.isPlaying ?? false,
              name: data.name,
              artists: data.artists ?? '',
              albumArt: data.albumArt ?? '',
            });
          } else {
            setSpotify(null);
          }
        }
      } catch { /* Spotify not connected — ignore */ }
    }

    fetchSpotify();
    const id = setInterval(fetchSpotify, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // ── Pomodoro: read localStorage + sync every second ───────────────────────
  useEffect(() => {
    const tick = () => {
      const p = loadPomo();
      if (p?.isRunning && p.timeLeft > 0) {
        p.timeLeft -= 1; // local interpolation
      }
      setPomo(p);
    };
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Calendar: next event ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchEvents() {
      try {
        const res = await apiFetch('/api/calendar/events?limit=3');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setEvents((data.events ?? []).slice(0, 3));
        }
      } catch { /* calendar not connected */ }
    }

    fetchEvents();
    const id = setInterval(fetchEvents, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // ── Habits ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchHabits() {
      try {
        const res = await apiFetch('/api/habits/today');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setHabits(data.habits ?? []);
        }
      } catch { /* habits not available */ }
    }

    fetchHabits();
  }, [user]);

  const toggleHabit = useCallback(async (id: string, completed: boolean) => {
    setTogglingHabit(id);
    try {
      await apiFetch(`/api/habits/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !completed }),
      });
      setHabits((prev) =>
        prev.map((h) => (h.id === id ? { ...h, completedToday: !completed } : h))
      );
    } catch { /* ignore */ } finally {
      setTogglingHabit(null);
    }
  }, []);

  const openMainWindow = () => {
    window.electronAPI?.openMainWindow();
  };

  const nextEvent = events[0] ?? null;
  const minutesUntilNext = nextEvent
    ? Math.max(0, Math.round((new Date(nextEvent.startTime).getTime() - Date.now()) / 60_000))
    : null;

  const pomoColor =
    pomo?.sessionType === 'focus'
      ? '#7c6aff'
      : pomo?.sessionType === 'short_break'
        ? '#3de8b0'
        : '#f59e0b';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="tray-root">
      {/* ── Spotify ── */}
      {spotify && (
        <section className="tray-section tray-spotify">
          {spotify.albumArt && (
            <img src={spotify.albumArt} alt="" className="tray-album-art" />
          )}
          <div className="tray-spotify-text">
            <span className="tray-track">{spotify.name}</span>
            <span className="tray-artist">{spotify.artists}</span>
          </div>
          <div className="tray-spotify-icon">{spotify.isPlaying ? '▶' : '⏸'}</div>
        </section>
      )}

      {/* ── Pomodoro ── */}
      {pomo && (
        <section className="tray-section tray-pomo">
          <div className="tray-pomo-label" style={{ color: pomoColor }}>
            {pomo.sessionType === 'focus'
              ? 'FOCUS'
              : pomo.sessionType === 'short_break'
                ? 'SHORT BREAK'
                : 'LONG BREAK'}
          </div>
          <div className="tray-pomo-time" style={{ color: pomoColor }}>
            {formatTime(pomo.timeLeft)}
          </div>
          <div className="tray-pomo-actions">
            <button
              className="tray-btn-outline"
              onClick={() => window.electronAPI?.showNotification('Pomodoro', pomo.isRunning ? 'Paused from tray' : 'Started from tray')}
            >
              {pomo.isRunning ? '⏸ Pause' : '▶ Start'}
            </button>
          </div>
        </section>
      )}

      {!pomo && (
        <section className="tray-section tray-pomo">
          <span className="tray-empty-label">No focus session running</span>
          <button className="tray-btn-accent" onClick={() => window.electronAPI?.openMainWindow()}>
            Start Focus
          </button>
        </section>
      )}

      {/* ── Next calendar event ── */}
      {nextEvent && minutesUntilNext !== null && (
        <section className="tray-section tray-cal">
          <span className="tray-cal-icon">📅</span>
          <div className="tray-cal-text">
            <span className="tray-cal-title">{nextEvent.title}</span>
            <span className="tray-cal-time">
              {minutesUntilNext === 0
                ? 'Now'
                : minutesUntilNext < 60
                  ? `in ${minutesUntilNext} min`
                  : `in ${Math.round(minutesUntilNext / 60)}h`}
            </span>
          </div>
        </section>
      )}

      {/* ── Habits ── */}
      {habits.length > 0 && (
        <section className="tray-section tray-habits">
          <span className="tray-section-label">Today's Habits</span>
          <div className="tray-habit-list">
            {habits.slice(0, 5).map((h) => (
              <button
                key={h.id}
                className={`tray-habit-item ${h.completedToday ? 'completed' : ''}`}
                onClick={() => toggleHabit(h.id, h.completedToday)}
                disabled={togglingHabit === h.id}
              >
                <span className="tray-habit-check">
                  {h.completedToday ? '✓' : '○'}
                </span>
                <span className="tray-habit-name">{h.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Quick actions ── */}
      <section className="tray-section tray-actions">
        {[
          { icon: '➕', label: 'Task', action: () => window.electronAPI?.openMainWindow() },
          { icon: '🔍', label: 'Search', action: () => window.electronAPI?.openMainWindow() },
          { icon: '⚙️', label: 'Settings', action: () => window.electronAPI?.openMainWindow() },
        ].map(({ icon, label, action }) => (
          <button key={label} className="tray-action-btn" onClick={action} title={label}>
            {icon}
          </button>
        ))}
      </section>

      {/* ── Open NEXUS ── */}
      <section className="tray-footer">
        <button className="tray-open-btn" onClick={openMainWindow}>
          Open NEXUS ↗
        </button>
      </section>
    </div>
  );
}
