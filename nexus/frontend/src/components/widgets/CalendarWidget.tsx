import { useState } from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import { useServiceState } from '../../store/useStore';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import { apiFetch } from '../../lib/api';

// Use the browser's local timezone so the widget is correct for every user
const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

/** Return the event's calendar date as YYYY-MM-DD in the user's local timezone. */
function getEventDateStr(event: { startDateTime?: string | null; date: string }): string {
  if (event.startDateTime) {
    return new Date(event.startDateTime).toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
  }
  // All-day event: date string is already timezone-agnostic (YYYY-MM-DD)
  return event.date;
}

/** Return the event's start time as a human-readable string in the user's local timezone. */
function getEventTimeStr(event: { startDateTime?: string | null; time: string }): string {
  if (event.startDateTime) {
    return new Date(event.startDateTime).toLocaleTimeString('en-US', {
      timeZone: USER_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  // Legacy fallback for optimistic events that still carry a HH:MM time string
  if (!event.time) return '';
  const [h, m] = event.time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function formatDate(event: { startDateTime?: string | null; date: string }) {
  // For timed events, derive the display date from the raw ISO string in local timezone
  if (event.startDateTime) {
    return new Date(event.startDateTime).toLocaleDateString('en-US', {
      timeZone: USER_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  // All-day events: parse as local date (append noon to avoid UTC off-by-one)
  return new Date(event.date + 'T12:00:00').toLocaleDateString('en-US', {
    timeZone: USER_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

interface CalendarWidgetProps {
  onClose: () => void;
}

export function CalendarWidget({ onClose: _onClose }: CalendarWidgetProps) {
  const { events, isCacheStale, hasLoaded } = useCalendar();
  const { isConnected, neverConnected, isStale } = useServiceState('googleCalendar');
  const [connecting, setConnecting] = useState(false);

  // Signal the reveal orchestrator once we have data (or a definitive empty/error state)
  useWidgetReady('calendar', hasLoaded);

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

  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();

  const todayLabel = new Date().toLocaleDateString('en-US', {
    timeZone: USER_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Only show the "not connected" empty state if this service has never succeeded
  if (neverConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-3 text-center gap-2">
        <span style={{ fontSize: '24px' }}>📅</span>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not connected</p>
        <button
          onClick={connectGoogle}
          disabled={connecting}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'var(--color-google-blue-bg)',
            color: connecting ? 'var(--text-muted)' : 'var(--color-google-blue)',
            border: 'none',
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Redirecting…' : 'Connect Google'}
        </button>
      </div>
    );
  }

  const todayEvents = events.filter((e) => getEventDateStr(e) === todayStr);
  const tomorrowEvents = events.filter((e) => getEventDateStr(e) === tomorrowStr);
  const upcomingEvents = events
    .filter((e) => getEventDateStr(e) > tomorrowStr)
    .slice(0, 3);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Date header */}
      <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0 flex items-center justify-between">
        <p className="font-mono text-xs" style={{ color: 'var(--color-google-blue)', fontSize: '11px' }}>
          {todayLabel}
        </p>
        {isStale && !isConnected && (
          <span className="text-xs font-mono" style={{ color: 'var(--color-warning)', opacity: 0.6, fontSize: '10px' }}>
            ↻ reconnecting
          </span>
        )}
        {isCacheStale && isConnected && (
          <span title="Showing cached data — refreshing" style={{ fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}>↻</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pb-2">
        {todayEvents.length === 0 && tomorrowEvents.length === 0 && upcomingEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>📭</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No events today</p>
          </div>
        ) : (
          <>
            {todayEvents.length > 0 && (
              <div className="mb-2">
                <p className="font-mono text-xs mb-1.5 px-1" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                  TODAY
                </p>
                {todayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 p-2 rounded-lg mb-1"
                    style={{ background: 'var(--surface2)' }}
                  >
                    <span
                      className="font-mono text-xs flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--color-google-blue)', fontSize: '11px', minWidth: '52px' }}
                    >
                      {getEventTimeStr(event)}
                    </span>
                    <span className="text-xs leading-relaxed" style={{ color: 'var(--text)', fontSize: '12px' }}>
                      {event.title}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {tomorrowEvents.length > 0 && (
              <div className="mb-2">
                <p className="font-mono text-xs mb-1.5 px-1" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                  TOMORROW
                </p>
                {tomorrowEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 p-2 rounded-lg mb-1"
                    style={{ background: 'var(--surface2)' }}
                  >
                    <span
                      className="font-mono text-xs flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--color-google-blue)', fontSize: '11px', minWidth: '52px' }}
                    >
                      {getEventTimeStr(event)}
                    </span>
                    <span className="text-xs leading-relaxed" style={{ color: 'var(--text)', fontSize: '12px' }}>
                      {event.title}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {upcomingEvents.length > 0 && (
              <div>
                <p className="font-mono text-xs mb-1.5 px-1" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                  UPCOMING
                </p>
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 p-2 rounded-lg mb-1"
                    style={{ background: 'var(--row-bg)' }}
                  >
                    <div className="flex-shrink-0 mt-0.5" style={{ minWidth: '52px' }}>
                      <span className="font-mono text-xs block" style={{ color: 'var(--color-google-blue)', fontSize: '10px' }}>
                        {formatDate(event)}
                      </span>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                        {getEventTimeStr(event)}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {event.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
