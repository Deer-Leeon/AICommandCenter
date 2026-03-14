import { useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { AIResponse } from '../types';
import { apiFetch } from '../lib/api';

const LOCAL_OLLAMA = 'http://localhost:11434';

// Cached availability — we re-check at most once per minute so the first
// call after Ollama starts working is still snappy.
let ollamaAvailable: boolean | null = null;
let ollamaCheckedAt = 0;
let ollamaModel = 'llama3.2:3b'; // updated from /api/ai/config on first use

async function isLocalOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (ollamaAvailable !== null && now - ollamaCheckedAt < 60_000) return ollamaAvailable;
  try {
    // Ollama responds to HEAD/GET /api/tags quickly; 2 s timeout
    const res = await fetch(`${LOCAL_OLLAMA}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  ollamaCheckedAt = now;
  return ollamaAvailable;
}

// Build the system prompt client-side — mirrors the backend's buildSystemPrompt()
// so inference works identically whether it runs locally or on the server.
function buildSystemPrompt(userTimezone: string): string {
  const now = new Date();
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: userTimezone });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toLocaleDateString('en-CA', { timeZone: userTimezone });
  const todayLabel = now.toLocaleDateString('en-US', {
    timeZone: userTimezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const tomorrowLabel = tomorrow.toLocaleDateString('en-US', {
    timeZone: userTimezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const currentLocalTime = now.toLocaleTimeString('en-US', {
    timeZone: userTimezone, hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return `You are NEXUS, an intelligent personal assistant controlling a unified workspace dashboard. You have access to the following tools: Google Calendar, Slack, Obsidian, Google Docs, and a To-Do list.

When the user gives you a message, you must respond with a JSON object ONLY — no markdown, no preamble — in this exact format:

{
  "intent": "<one of: CREATE_CALENDAR_EVENT | UPDATE_CALENDAR_EVENT | SLACK_MESSAGE | OBSIDIAN_APPEND | OBSIDIAN_CREATE | DOCS_EDIT | TODO_ADD | TODO_COMPLETE | WEATHER_QUERY | GENERAL_RESPONSE>",
  "confidence": <0.0–1.0>,
  "humanResponse": "<A short, friendly human-readable explanation of what you're doing>",
  "params": {},
  "suggestedActions": ["<short action label>"]
}

Intent-specific params:

CREATE_CALENDAR_EVENT:
  title: string, date: string (ISO 8601 YYYY-MM-DD), time: string (HH:MM 24-hour format in the USER'S LOCAL TIMEZONE), duration: number (minutes), description?: string

UPDATE_CALENDAR_EVENT:
  eventId: string, changes: object

SLACK_MESSAGE:
  channel?: string, userId?: string, message: string, isDM: boolean

OBSIDIAN_APPEND:
  file: string, content: string, heading?: string

OBSIDIAN_CREATE:
  file: string, content: string, folder?: string

TODO_ADD:
  text: string, dueDate?: string, priority?: "low"|"medium"|"high"

TODO_COMPLETE:
  text: string

GENERAL_RESPONSE:
  (no extra params needed)

THE USER'S TIMEZONE IS: ${userTimezone}
The current local time for the user is: ${currentLocalTime}
TODAY'S DATE (in the user's timezone) IS: ${todayISO}
TOMORROW'S DATE (in the user's timezone) IS: ${tomorrowISO}
Today is ${todayLabel}.
Tomorrow is ${tomorrowLabel}.

CRITICAL TIME RULES:
- All times in params.time MUST be in 24-hour HH:MM format representing the user's LOCAL time in ${userTimezone}.
- "6 PM" means 18:00. "8 AM" means 08:00. "noon" means 12:00. "midnight" means 00:00.
- When the user says "tomorrow" you MUST use exactly this date: ${tomorrowISO}.
- When the user says "today" you MUST use exactly this date: ${todayISO}.
- Never calculate dates yourself. Only use the exact ISO dates provided above.

Be smart about ambiguous messages — if confidence < 0.6, use GENERAL_RESPONSE and ask a clarifying question in humanResponse.
Always respond with valid JSON only. No markdown code blocks, no explanation outside the JSON.`;
}

function extractJSON(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (m) {
      try { return JSON.parse(m[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
    }
  }
  return {
    intent: 'GENERAL_RESPONSE',
    confidence: 0.5,
    humanResponse: text.trim() || "I couldn't process that request. Could you rephrase it?",
    params: {},
    suggestedActions: ['Try again', 'Rephrase'],
  };
}

// Run inference against local Ollama, then dispatch the intent via the backend.
async function runLocalInference(
  message: string,
  systemPrompt: string,
  contextHint: string,
  timezone: string,
  activeSlackChannel: string,
): Promise<AIResponse> {
  const res = await fetch(`${LOCAL_OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: `${systemPrompt}${contextHint}\n\nUser: ${message}`,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Local Ollama error: ${res.status} ${res.statusText}`);

  const data = await res.json() as { response: string };
  const parsed = extractJSON(data.response);

  // Dispatch the resolved intent through the backend (needs OAuth tokens)
  const dispatchRes = await apiFetch('/api/ai/dispatch', {
    method: 'POST',
    body: JSON.stringify({
      ...parsed,
      timezone,
      activeSlackChannel,
    }),
  });

  if (!dispatchRes.ok) {
    const err = await dispatchRes.json().catch(() => ({ error: 'Dispatch failed' }));
    throw new Error((err as { error?: string }).error || 'Dispatch failed');
  }

  return dispatchRes.json() as Promise<AIResponse>;
}

export function useAI() {
  const {
    isAILoading,
    lastAIResponse,
    setAILoading,
    setLastAIResponse,
    activeContexts,
    flashWidget,
    setCalendarEvents,
    setSlackMessages,
    setObsidianContent,
    calendarEvents,
    slackMessages,
    triggerCalendarRefetch,
    triggerTodosRefetch,
    addPendingCalendarEventId,
  } = useStore();

  // Fetch the configured model name once, lazily
  const modelFetched = useRef(false);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isAILoading) return;
      setAILoading(true);
      setLastAIResponse(null);

      try {
        // Lazily fetch the model name from the backend config
        if (!modelFetched.current) {
          try {
            const cfg = await apiFetch('/api/ai/config').then((r) => r.json()) as { model?: string };
            if (cfg.model) ollamaModel = cfg.model;
          } catch { /* keep default */ }
          modelFetched.current = true;
        }

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const activeSlackChannel = localStorage.getItem('nexus-slack-channel') ?? '';
        const contextHint = activeContexts?.length
          ? `\nActive contexts: ${activeContexts.join(', ')}`
          : '';

        let data: AIResponse;

        const localAvailable = await isLocalOllamaAvailable();

        if (localAvailable) {
          // ── Local path: browser → localhost:11434 → backend /dispatch ──────
          try {
            const systemPrompt = buildSystemPrompt(timezone);
            data = await runLocalInference(message, systemPrompt, contextHint, timezone, activeSlackChannel);
          } catch (localErr) {
            // Local Ollama is up but failed (e.g. model not pulled yet) —
            // fall back to the server/tunnel path automatically.
            console.warn('[NEXUS AI] Local Ollama failed, falling back to server:', localErr);
            ollamaAvailable = false; // reset cache so next call re-checks
            const res = await apiFetch('/api/ai', {
              method: 'POST',
              body: JSON.stringify({ message, activeContexts, timezone, activeSlackChannel }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Unknown error' }));
              throw new Error((err as { error?: string }).error || 'AI request failed');
            }
            data = await res.json() as AIResponse;
          }
        } else {
          // ── Server path: browser → Railway backend → OLLAMA_BASE_URL ───────
          // Used when local Ollama is unavailable (e.g. accessing from phone,
          // or model not yet pulled). Railway calls Ollama via the tunnel.
          const res = await apiFetch('/api/ai', {
            method: 'POST',
            body: JSON.stringify({ message, activeContexts, timezone, activeSlackChannel }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error((err as { error?: string }).error || 'AI request failed');
          }

          data = await res.json() as AIResponse;
        }

        setLastAIResponse(data);
        if (data.widgetToFlash) flashWidget(data.widgetToFlash);

        if (data.intent === 'CREATE_CALENDAR_EVENT') {
          if (data.result) {
            const newEvent = data.result as Parameters<typeof setCalendarEvents>[0][0];
            if (newEvent.id) addPendingCalendarEventId(newEvent.id);
            setCalendarEvents([...calendarEvents, newEvent]);
          }
          setTimeout(() => triggerCalendarRefetch(), 4000);
          setTimeout(() => triggerCalendarRefetch(), 10000);
          flashWidget('calendar');
        } else if (data.intent === 'SLACK_MESSAGE' && data.result) {
          const newMsg = data.result as Parameters<typeof setSlackMessages>[0][0];
          setSlackMessages([newMsg, ...slackMessages]);
          flashWidget('slack');
        } else if (
          (data.intent === 'OBSIDIAN_APPEND' || data.intent === 'OBSIDIAN_CREATE') &&
          data.result
        ) {
          setObsidianContent(data.result as string);
          flashWidget('obsidian');
        } else if (data.intent === 'TODO_ADD') {
          triggerTodosRefetch();
          flashWidget('todo');
        }
      } catch (err) {
        setLastAIResponse({
          intent: 'GENERAL_RESPONSE',
          humanResponse:
            err instanceof Error ? err.message : 'Something went wrong. Please try again.',
          params: {},
          suggestedActions: ['Try again', 'Check connection'],
        });
      } finally {
        setAILoading(false);
      }
    },
    [
      isAILoading,
      activeContexts,
      calendarEvents,
      slackMessages,
      setAILoading,
      setLastAIResponse,
      flashWidget,
      setCalendarEvents,
      setSlackMessages,
      setObsidianContent,
      triggerCalendarRefetch,
      triggerTodosRefetch,
      addPendingCalendarEventId,
    ],
  );

  return { sendMessage, isLoading: isAILoading, lastResponse: lastAIResponse };
}
