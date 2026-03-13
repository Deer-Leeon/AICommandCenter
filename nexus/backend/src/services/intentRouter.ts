import { google } from 'googleapis';
import { getTokensForService, getGoogleAuthClient } from './tokenService.js';
import { supabase } from '../lib/supabase.js';
import * as slackService from './slackService.js';
import * as obsidianService from './obsidianService.js';

/**
 * Convert a wall-clock date+time in a specific timezone to a UTC Date.
 *
 * Example: localWallClockToUTC('2026-03-05', '18:00', 'Europe/Berlin')
 *   → Date representing 2026-03-05T17:00:00.000Z  (Berlin is UTC+1)
 *
 * The trick: treat the requested local time "as if" it were UTC to get an
 * approximate instant, then compute the TZ offset at that instant via Intl,
 * and subtract it.
 */
function localWallClockToUTC(dateStr: string, timeStr: string, tz: string): Date {
  // Build an approximate UTC instant by treating the local string as UTC
  const approx = new Date(`${dateStr}T${timeStr}:00.000Z`);

  // Format that instant in the target timezone — gives us what "local time" it corresponds to
  // sv-SE locale reliably gives "YYYY-MM-DD HH:MM:SS"
  const localStr = approx.toLocaleString('sv-SE', { timeZone: tz });
  // e.g. for Berlin (UTC+1): approx=18:00Z → localStr="2026-03-05 19:00:00"

  // Parse that local-time string as if it were UTC
  const localAsUTC = new Date(localStr.replace(' ', 'T') + 'Z');

  // offset = localAsUTC − approx  (positive for UTC+, negative for UTC−)
  const offsetMs = localAsUTC.getTime() - approx.getTime();

  // Subtract offset to get the true UTC instant for the requested wall-clock time
  return new Date(approx.getTime() - offsetMs);
}

interface AIIntent {
  intent: string;
  confidence: number;
  humanResponse: string;
  params: Record<string, unknown>;
  suggestedActions?: string[];
}

interface DispatchResult {
  result: unknown;
  widgetToFlash?: string;
}

async function getCalendarClient(userId: string) {
  const tokens = await getTokensForService(userId, 'google-calendar');
  if (!tokens) throw new Error('google_not_connected — visit /connect to link your Google account');
  const auth = getGoogleAuthClient(tokens);
  return google.calendar({ version: 'v3', auth });
}

async function getDocsClient(userId: string) {
  const tokens = await getTokensForService(userId, 'google-docs');
  if (!tokens) throw new Error('google_not_connected — visit /connect to link your Google account');
  const auth = getGoogleAuthClient(tokens);
  return google.docs({ version: 'v1', auth });
}

async function getSlackToken(userId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('user_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', 'slack')
    .single();
  return data?.access_token ?? undefined;
}

export async function dispatchIntent(parsed: AIIntent, userId: string, userTimezone = 'UTC', activeSlackChannel = ''): Promise<DispatchResult> {
  const { intent, params } = parsed;

  switch (intent) {
    case 'CREATE_CALENDAR_EVENT': {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const todayISO = today.toISOString().split('T')[0];
      const tomorrowISO = tomorrow.toISOString().split('T')[0];

      const rawDate = params.date as string;
      const resolvedDate = rawDate && rawDate < todayISO ? tomorrowISO : rawDate;

      const cal = await getCalendarClient(userId);
      const timeParam = (params.time as string) || '09:00';
      const durationMs = ((params.duration as number) || 60) * 60 * 1000;
      // Convert the user's wall-clock time to the correct UTC instant
      const startDate = localWallClockToUTC(resolvedDate, timeParam, userTimezone);
      const endDate = new Date(startDate.getTime() + durationMs);

      const response = await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: params.title as string,
          description: params.description as string | undefined,
          start: { dateTime: startDate.toISOString(), timeZone: userTimezone },
          end: { dateTime: endDate.toISOString(), timeZone: userTimezone },
        },
      });

      const e = response.data;
      return {
        result: {
          id: e.id || '',
          title: e.summary || (params.title as string),
          startDateTime: e.start?.dateTime ?? null,  // raw ISO — frontend converts
          date: '',
          time: '',
          duration: (params.duration as number) || 60,
        },
        widgetToFlash: 'calendar',
      };
    }

    case 'UPDATE_CALENDAR_EVENT': {
      const cal = await getCalendarClient(userId);
      const patchBody: Record<string, unknown> = {};
      const changes = params.changes as Record<string, unknown> | undefined;
      if (changes?.title) patchBody.summary = changes.title;
      if (changes?.description) patchBody.description = changes.description;

      const response = await cal.events.patch({
        calendarId: 'primary',
        eventId: params.eventId as string,
        requestBody: patchBody,
      });

      const e = response.data;
      const dateObj = new Date(e.start?.dateTime || '');
      return {
        result: {
          id: e.id || (params.eventId as string),
          title: e.summary || '',
          date: dateObj.toISOString().split('T')[0],
          time: `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`,
        },
        widgetToFlash: 'calendar',
      };
    }

    case 'SLACK_MESSAGE': {
      const slackToken = await getSlackToken(userId);
      if (params.isDM && params.userId) {
        await slackService.sendDM(params.userId as string, params.message as string, slackToken);
      } else if (params.isDM && params.username) {
        const user = await slackService.findUserByName(params.username as string, slackToken);
        if (!user) throw new Error(`Could not find Slack user: ${params.username}`);
        await slackService.sendDM(user.id, params.message as string, slackToken);
      } else {
        // Priority: AI-specified channel → widget's active channel → env default → 'general'
        const channel =
          (params.channel as string) ||
          activeSlackChannel ||
          process.env.SLACK_DEFAULT_CHANNEL ||
          'general';
        await slackService.sendMessage(channel, params.message as string, slackToken);
      }
      return {
        result: {
          id: Date.now().toString(),
          userId: 'nexus-bot',
          username: 'NEXUS',
          text: params.message as string,
          timestamp: (Date.now() / 1000).toString(),
          channel: (params.channel as string) || 'general',
        },
        widgetToFlash: 'slack',
      };
    }

    case 'OBSIDIAN_APPEND': {
      const filePath = (params.file as string) || (process.env.OBSIDIAN_GROCERY_FILE || 'Shopping/Groceries.md');
      await obsidianService.appendToFile(filePath, params.content as string, params.heading as string | undefined);
      const newContent = await obsidianService.getFile(filePath);
      return { result: newContent, widgetToFlash: 'obsidian' };
    }

    case 'OBSIDIAN_CREATE': {
      const folder = (params.folder as string) || (process.env.OBSIDIAN_NOTES_FOLDER || 'NEXUS Notes');
      const filePath = `${folder}/${params.file as string}`;
      await obsidianService.createNote(filePath, params.content as string);
      return { result: filePath, widgetToFlash: 'obsidian' };
    }

    case 'TODO_ADD': {
      // Save to Supabase so it persists
      const { data, error } = await supabase
        .from('user_todos')
        .insert({
          user_id: userId,
          text: params.text as string,
          completed: false,
          priority: (params.priority as string) || 'medium',
          due_date: (params.dueDate as string) || null,
          due_time: (params.dueTime as string) || null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { result: data, widgetToFlash: 'todo' };
    }

    case 'TODO_COMPLETE': {
      return { result: { text: params.text }, widgetToFlash: 'todo' };
    }

    case 'DOCS_EDIT': {
      if (params.docId) {
        const docs = await getDocsClient(userId);
        await docs.documents.batchUpdate({
          documentId: params.docId as string,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: `\n${params.text as string}`,
                },
              },
            ],
          },
        });
      }
      return { result: null, widgetToFlash: 'docs' };
    }

    case 'WEATHER_QUERY': {
      return { result: null, widgetToFlash: 'weather' };
    }

    default:
      return { result: null };
  }
}
