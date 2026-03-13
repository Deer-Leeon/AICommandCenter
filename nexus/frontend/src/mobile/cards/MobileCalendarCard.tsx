import { useCalendar } from '../../hooks/useCalendar';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function fmtTime(iso?: string | null): string {
  if (!iso) return 'All day';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDateHeader(iso?: string | null, dateStr?: string): string {
  const d = iso ? new Date(iso) : new Date(dateStr + 'T12:00:00');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const eventDate = d.toLocaleDateString('en-CA', { timeZone: TZ });
  if (eventDate === today) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (eventDate === tomorrow.toLocaleDateString('en-CA', { timeZone: TZ })) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

const CALENDAR_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6c026', '6': '#f5511d', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d60000',
};

export function MobileCalendarCard() {
  const { events, hasLoaded } = useCalendar();

  const now = new Date();
  const upcoming = events
    .filter(e => {
      const d = e.startDateTime ? new Date(e.startDateTime) : new Date(e.date + 'T23:59:00');
      return d >= now;
    })
    .slice(0, 6);

  const todayStr = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 20px 12px' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Calendar
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
          {todayStr}
        </div>
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!hasLoaded && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 8 }}>Loading…</div>
        )}
        {hasLoaded && upcoming.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, paddingTop: 8 }}>
            No upcoming events 🎉
          </div>
        )}
        {upcoming.map(event => {
          const accent = CALENDAR_COLORS[event.colorId ?? ''] ?? '#4285f4';
          const header = fmtDateHeader(event.startDateTime, event.date);
          const time = fmtTime(event.startDateTime);
          return (
            <div key={event.id} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              background: 'rgba(255,255,255,0.04)', borderRadius: 12,
              padding: '12px 14px', borderLeft: `3px solid ${accent}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
                  {header} · {time}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {event.title}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
