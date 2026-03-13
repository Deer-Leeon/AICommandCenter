import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCachedProviderToken } from '../services/tokenService.js';
import * as slackService from '../services/slackService.js';

export const slackRouter = Router();

// ── Server-side response cache ────────────────────────────────────────────────
// Caches Slack message lists per user + channel + limit.
// Eliminates the Slack API round-trip (~100-300 ms) on repeated requests.
// Invalidated immediately when any message is sent via this backend.

const SLACK_MESSAGES_TTL = 2 * 60_000; // 2 minutes

interface SlackMessageCacheEntry {
  messages: object[];
  expiresAt: number;
}
const slackMessageCache = new Map<string, SlackMessageCacheEntry>();

/** Invalidate all cached message lists for a given user. */
function burstSlackCache(userId: string): void {
  for (const key of slackMessageCache.keys()) {
    if (key.startsWith(`${userId}:`)) slackMessageCache.delete(key);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

slackRouter.get('/messages', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel =
      (req.query.channel as string) || process.env.SLACK_DEFAULT_CHANNEL || 'general';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const cacheKey = `${userId}:${channel}:${limit}`;

    // Serve from cache when fresh — avoids both Supabase + Slack round-trips
    const cached = slackMessageCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.json(cached.messages);
      return;
    }

    const token = await getCachedProviderToken(userId, 'slack') ?? undefined;
    const messages = await slackService.getChannelMessages(channel, limit, token);

    slackMessageCache.set(cacheKey, { messages, expiresAt: Date.now() + SLACK_MESSAGES_TTL });
    res.json(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch messages';
    res.status(500).json({ error: msg });
  }
});

slackRouter.post('/messages', requireAuth, async (req: AuthRequest, res: Response) => {
  const { channel, text, userId: targetUserId, isDM } = req.body as {
    channel?: string;
    text: string;
    userId?: string;
    isDM?: boolean;
  };
  try {
    const userId = req.user!.id;
    const token = await getCachedProviderToken(userId, 'slack') ?? undefined;
    if (isDM && targetUserId) {
      await slackService.sendDM(targetUserId, text, token);
    } else {
      await slackService.sendMessage(
        channel || process.env.SLACK_DEFAULT_CHANNEL || 'general',
        text,
        token,
      );
    }
    // Message sent — bust the cache so the next poll reflects the new message
    burstSlackCache(userId);
    res.status(201).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send message';
    res.status(500).json({ error: msg });
  }
});

slackRouter.get('/channels', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const token = await getCachedProviderToken(req.user!.id, 'slack') ?? undefined;
    const channels = await slackService.listChannels(token);
    res.json(channels);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list channels';
    res.status(500).json({ error: msg });
  }
});

slackRouter.get('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const token = await getCachedProviderToken(req.user!.id, 'slack') ?? undefined;
    const users = await slackService.listUsers(token);
    res.json(users);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list users';
    res.status(500).json({ error: msg });
  }
});
