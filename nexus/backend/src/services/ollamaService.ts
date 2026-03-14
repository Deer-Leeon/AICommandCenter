
interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export function buildSystemPrompt(userTimezone = 'UTC'): string {
  const now = new Date();

  const todayISO = now.toLocaleDateString('en-CA', { timeZone: userTimezone });
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowISO = tomorrowDate.toLocaleDateString('en-CA', { timeZone: userTimezone });

  const todayLabel = now.toLocaleDateString('en-US', {
    timeZone: userTimezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const tomorrowLabel = tomorrowDate.toLocaleDateString('en-US', {
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

export async function ollamaComplete(prompt: string, systemPrompt: string): Promise<string> {
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  const url = `${base}/api/generate`;

  console.log(`[Ollama] Calling ${url} with model ${model}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${systemPrompt}\n\nUser: ${prompt}`,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const hint = base.includes('localhost') || base.includes('127.0.0.1')
      ? 'Ollama is not reachable at localhost. Run `docker-compose --profile prod up -d` on your Mac and set OLLAMA_BASE_URL=https://ollama.lj-buchmiller.com in Railway.'
      : `Cannot reach Ollama at ${base}. Check that the Cloudflare tunnel is running on your Mac.`;
    throw new Error(hint);
  }

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as OllamaGenerateResponse;
  return data.response;
}

// TODO: implement streaming with SSE/WebSocket
export async function ollamaStream(
  prompt: string,
  systemPrompt: string,
  onChunk: (text: string) => void
): Promise<void> {
  const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL,
      prompt: `${systemPrompt}\n\nUser: ${prompt}`,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama streaming error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as OllamaGenerateResponse;
        if (parsed.response) onChunk(parsed.response);
      } catch {
        // Skip malformed lines
      }
    }
  }
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Robustly extract a JSON object from Ollama's response string.
 * Handles cases where the model wraps JSON in markdown code blocks or adds prose.
 */
export function extractJSON(text: string): Record<string, unknown> {
  // Try direct parse
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    // Try to extract JSON block from markdown or prose
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>;
      } catch {
        // Fall through to default
      }
    }
  }

  // Fallback: return a GENERAL_RESPONSE
  return {
    intent: 'GENERAL_RESPONSE',
    confidence: 0.5,
    humanResponse: text.trim() || "I couldn't process that request. Could you rephrase it?",
    params: {},
    suggestedActions: ['Try again', 'Rephrase'],
  };
}
