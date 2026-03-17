import { useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { AIResponse } from '../types';
import { apiFetch } from '../lib/api';


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

  // Fetch the configured model name once, lazily (informational)
  const modelFetched = useRef(false);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isAILoading) return;
      setAILoading(true);
      setLastAIResponse(null);

      try {
        modelFetched.current = true;

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const activeSlackChannel = localStorage.getItem('nexus-slack-channel') ?? '';

        // All AI inference goes through the Railway backend, which calls Ollama
        // via the Cloudflare tunnel (ollama.lj-buchmiller.com → local Docker container).
        const res = await apiFetch('/api/ai', {
          method: 'POST',
          body: JSON.stringify({ message, activeContexts, timezone, activeSlackChannel }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error((err as { error?: string }).error || 'AI request failed');
        }

        const data: AIResponse = await res.json();
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
