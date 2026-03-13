import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { ollamaComplete, buildSystemPrompt, extractJSON } from '../services/ollamaService.js';
import { dispatchIntent } from '../services/intentRouter.js';

export const aiRouter = Router();

// ── GET /api/ai/config ────────────────────────────────────────────────────────
// Returns the configured Ollama model name so the browser can call local Ollama
// directly without the model name being hardcoded on the client side.
aiRouter.get('/config', requireAuth, (_req, res: Response) => {
  res.json({ model: process.env.OLLAMA_MODEL || 'llama3.2' });
});

// ── POST /api/ai/dispatch ─────────────────────────────────────────────────────
// Accepts a pre-parsed AI intent (already resolved by local Ollama on the
// client) and executes the corresponding action (calendar, Slack, Obsidian…).
// This lets the user's own machine handle LLM inference while Railway handles
// the privileged API calls that require stored OAuth tokens.
aiRouter.post('/dispatch', requireAuth, async (req: AuthRequest, res: Response) => {
  const { intent, confidence, humanResponse, params, suggestedActions, timezone, activeSlackChannel } = req.body as {
    intent: string;
    confidence: number;
    humanResponse: string;
    params: Record<string, unknown>;
    suggestedActions?: string[];
    timezone?: string;
    activeSlackChannel?: string;
  };

  if (!intent) {
    res.status(400).json({ error: 'intent is required' });
    return;
  }

  const userId = req.user!.id;
  const userTimezone = timezone || process.env.USER_TIMEZONE || 'UTC';

  let result: unknown = null;
  let widgetToFlash: string | undefined;
  let dispatchError: string | undefined;

  try {
    const dispatchResult = await dispatchIntent(
      { intent, confidence, humanResponse, params, suggestedActions },
      userId,
      userTimezone,
      activeSlackChannel,
    );
    result = dispatchResult.result;
    widgetToFlash = dispatchResult.widgetToFlash;
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : 'Action failed';
  }

  res.json({
    intent,
    humanResponse: dispatchError
      ? `${humanResponse} (Note: Action failed — ${dispatchError})`
      : humanResponse,
    params,
    result,
    suggestedActions: suggestedActions || [],
    widgetToFlash,
    ...(dispatchError ? { dispatchError } : {}),
  });
});

// ── POST /api/ai ──────────────────────────────────────────────────────────────
// Full server-side path: calls OLLAMA_BASE_URL (for self-hosted / local-network
// setups). Falls back automatically when the client can't reach localhost:11434.
aiRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { message, activeContexts, timezone, activeSlackChannel } = req.body as {
    message: string;
    activeContexts: string[];
    timezone?: string;
    activeSlackChannel?: string;
  };

  // Fall back to the server env var if the client didn't send one
  const userTimezone = timezone || process.env.USER_TIMEZONE || 'UTC';

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const userId = req.user!.id;

  try {
    const systemPrompt = buildSystemPrompt(userTimezone);
    const contextHint = activeContexts?.length
      ? `\nActive contexts (services the user has enabled): ${activeContexts.join(', ')}`
      : '';
    const slackHint = activeSlackChannel
      ? `\nThe user currently has the Slack channel "#${activeSlackChannel}" open in their widget. When sending a Slack message and no channel is explicitly mentioned, default to "#${activeSlackChannel}".`
      : '';

    const rawResponse = await ollamaComplete(message, systemPrompt + contextHint + slackHint);
    const parsed = extractJSON(rawResponse);

    let result: unknown = null;
    let widgetToFlash: string | undefined;
    let dispatchError: string | undefined;

    try {
      const dispatchResult = await dispatchIntent(
        parsed as {
          intent: string;
          confidence: number;
          humanResponse: string;
          params: Record<string, unknown>;
        },
        userId,
        userTimezone,
        activeSlackChannel,
      );
      result = dispatchResult.result;
      widgetToFlash = dispatchResult.widgetToFlash;
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : 'Action failed';
      (parsed as Record<string, unknown>).humanResponse =
        `${parsed.humanResponse || ''} (Note: Action failed — ${dispatchError})`;
    }

    res.json({
      intent: parsed.intent,
      humanResponse: parsed.humanResponse,
      params: parsed.params,
      result,
      suggestedActions: parsed.suggestedActions || [],
      widgetToFlash,
      ...(dispatchError ? { dispatchError } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
      error: message,
      intent: 'GENERAL_RESPONSE',
      humanResponse: `I couldn't connect to the AI. Make sure Ollama is running: \`ollama serve\``,
      params: {},
      suggestedActions: ['Check Ollama', 'Retry'],
    });
  }
});
