import { google } from 'googleapis';
import { getAuthenticatedClient, loadTokens } from './googleAuthService.js';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  description?: string;
  colorId?: string;
}

export interface CreateEventParams {
  title: string;
  date: string;
  time: string;
  duration?: number;
  description?: string;
}

export async function listEvents(maxResults = 20): Promise<CalendarEvent[]> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: sevenDaysLater.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];
  return events.map((e) => {
    const start = e.start?.dateTime || e.start?.date || '';
    const dateObj = new Date(start);
    const date = dateObj.toISOString().split('T')[0];
    const time = e.start?.dateTime
      ? `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`
      : '00:00';

    let duration = 60;
    if (e.end?.dateTime && e.start?.dateTime) {
      const endDate = new Date(e.end.dateTime);
      const startDate = new Date(e.start.dateTime);
      duration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    }

    return {
      id: e.id || '',
      title: e.summary || 'Untitled',
      date,
      time,
      duration,
      description: e.description || undefined,
      colorId: e.colorId || undefined,
    };
  });
}

export async function createEvent(params: CreateEventParams): Promise<CalendarEvent> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const startDateTime = `${params.date}T${params.time}:00`;
  const durationMs = (params.duration || 60) * 60 * 1000;
  const startDate = new Date(startDateTime);
  const endDate = new Date(startDate.getTime() + durationMs);

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: params.title,
      description: params.description,
      start: { dateTime: startDate.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: endDate.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    },
  });

  const e = response.data;
  const dateObj = new Date(e.start?.dateTime || '');
  return {
    id: e.id || '',
    title: e.summary || params.title,
    date: dateObj.toISOString().split('T')[0],
    time: params.time,
    duration: params.duration || 60,
    description: e.description || undefined,
  };
}

export async function updateEvent(
  eventId: string,
  changes: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const patchBody: Record<string, unknown> = {};
  if (changes.title) patchBody.summary = changes.title;
  if (changes.description) patchBody.description = changes.description;

  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: patchBody,
  });

  const e = response.data;
  const dateObj = new Date(e.start?.dateTime || '');
  return {
    id: e.id || eventId,
    title: e.summary || '',
    date: dateObj.toISOString().split('T')[0],
    time: `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`,
    duration: 60,
  };
}

export async function deleteEvent(eventId: string): Promise<void> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

export async function checkConnection(): Promise<boolean> {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) return false;
    await listEvents(1);
    return true;
  } catch {
    return false;
  }
}
