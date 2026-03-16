/**
 * Gmail API routes for NEXUS
 *
 * ── Google Cloud Pub/Sub setup (required for push notifications) ──────────────
 *
 * 1. Enable Gmail API and Cloud Pub/Sub API in Google Cloud Console
 * 2. Create a Pub/Sub topic: projects/{GOOGLE_CLOUD_PROJECT_ID}/topics/nexus-gmail
 * 3. Grant publish permission: add gmail-api-push@system.gserviceaccount.com
 *    as a Publisher on that topic
 * 4. Create a push subscription pointing to:
 *    https://your-backend.com/api/gmail/push
 * 5. Add GOOGLE_CLOUD_PROJECT_ID to your .env file
 *
 * Without these steps, push webhooks won't fire but all other Gmail features
 * (inbox, read/send/archive, search) will still work via on-demand fetching.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getTokensForService, getGoogleAuthClient } from '../services/tokenService.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToUser } from '../lib/sseRegistry.js';

export const gmailRouter = Router();

// ── In-process response cache ─────────────────────────────────────────────────

interface CacheEntry { data: unknown; expiresAt: number }
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}
function cacheSet(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
function cacheInvalidateUser(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`gmail:${userId}:`)) cache.delete(key);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decode base64url to plain string */
function decodeBase64url(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Get the plain-text value of a header by name (case-insensitive) */
function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Deterministically pick an avatar colour from a sender email */
export function avatarColor(email: string): string {
  const COLORS = [
    '#7c6aff','#3de8b0','#e86b4f','#4f9de8','#e8c44f',
    '#b44fe8','#4fe8a0','#e84f9d','#4fb4e8','#e84f4f',
    '#4fe8e8','#a0e84f',
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Parse a Gmail message part tree into { html, plain } body strings */
function extractBody(payload: {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
}): { html: string; plain: string } {
  function walk(part: {
    mimeType?: string | null;
    body?: { data?: string | null } | null;
    parts?: unknown[] | null;
  }): { html: string; plain: string } {
    const mime = part.mimeType ?? '';
    if (mime === 'text/html' && part.body?.data)
      return { html: decodeBase64url(part.body.data), plain: '' };
    if (mime === 'text/plain' && part.body?.data)
      return { html: '', plain: decodeBase64url(part.body.data) };
    if (part.parts) {
      let html = '', plain = '';
      for (const p of part.parts as typeof part[]) {
        const r = walk(p);
        if (r.html) html = r.html;
        if (r.plain) plain = r.plain;
      }
      return { html, plain };
    }
    return { html: '', plain: '' };
  }
  return walk(payload);
}

/** Collect attachment metadata from a message part tree */
function extractAttachments(payload: {
  mimeType?: string | null;
  filename?: string | null;
  body?: { attachmentId?: string | null; size?: number | null } | null;
  parts?: unknown[] | null;
}): { name: string; size: number; mimeType: string; attachmentId: string }[] {
  const result: { name: string; size: number; mimeType: string; attachmentId: string }[] = [];
  function walk(part: typeof payload) {
    if (part.filename && part.body?.attachmentId) {
      result.push({
        name: part.filename,
        size: part.body.size ?? 0,
        mimeType: part.mimeType ?? 'application/octet-stream',
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) for (const p of part.parts as typeof payload[]) walk(p);
  }
  walk(payload);
  return result;
}

/** Return a 403 needsAuth response when Gmail scope is missing */
function noAuth(res: Response) {
  res.status(403).json({ error: 'Gmail not connected', needsAuth: true });
}

// ── Watch management ──────────────────────────────────────────────────────────

gmailRouter.post('/watch', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) {
    res.status(500).json({ error: 'GOOGLE_CLOUD_PROJECT_ID not configured' });
    return;
  }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const watchRes = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: `projects/${projectId}/topics/nexus-gmail`,
        labelIds: ['INBOX'],
      },
    });

    await supabase.from('gmail_watches').upsert({
      user_id: userId,
      history_id: watchRes.data.historyId ?? '0',
      expiration: Number(watchRes.data.expiration ?? Date.now() + 7 * 24 * 3600 * 1000),
    }, { onConflict: 'user_id' });

    res.json({ ok: true, expiration: watchRes.data.expiration });
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Watch registration failed' });
  }
});

gmailRouter.post('/stop-watch', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.stop({ userId: 'me' });
    await supabase.from('gmail_watches').delete().eq('user_id', userId);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // best-effort
  }
});

// ── Unread count ──────────────────────────────────────────────────────────────

gmailRouter.get('/unread-count', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const cacheKey = `gmail:${userId}:unread`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) { res.json(hit); return; }

  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    // Get unread count from INBOX label
    const labelRes = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    const unreadCount = labelRes.data.messagesUnread ?? 0;
    const result = { unreadCount };
    cacheSet(cacheKey, result, 30_000);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Failed to get unread count' });
  }
});

// ── Thread list ───────────────────────────────────────────────────────────────

gmailRouter.get('/threads', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { labelIds = 'INBOX', pageToken = '', maxResults = '20' } = req.query as Record<string, string>;
  const cacheKey = `gmail:${userId}:threads:${labelIds}:${pageToken}:${maxResults}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) { res.json(hit); return; }

  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const listRes = await gmail.users.threads.list({
      userId: 'me',
      labelIds: labelIds.split(','),
      maxResults: Math.min(Number(maxResults), 50),
      ...(pageToken ? { pageToken } : {}),
    });

    const threadIds = listRes.data.threads ?? [];

    // Fetch each thread's metadata in parallel (limited batch)
    const threads = await Promise.all(
      threadIds.map(async ({ id }) => {
        if (!id) return null;
        try {
          const t = await gmail.users.threads.get({
            userId: 'me', id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });
          const msg = t.data.messages?.[0];
          const lastMsg = t.data.messages?.[t.data.messages.length - 1];
          if (!msg || !lastMsg) return null;
          const headers = lastMsg.labelIds ? lastMsg.payload?.headers ?? [] : msg.payload?.headers ?? [];
          const allHeaders = lastMsg.payload?.headers ?? [];
          const from = getHeader(allHeaders, 'From');
          const subject = getHeader(allHeaders, 'Subject') || '(no subject)';
          const date = getHeader(allHeaders, 'Date');
          const labelIds = lastMsg.labelIds ?? msg.labelIds ?? [];

          // Parse sender
          const fromMatch = from.match(/^(.*?)\s*<(.+?)>$/) ?? [null, from, from];
          const senderName = (fromMatch[1] ?? from).replace(/"/g, '').trim();
          const senderEmail = fromMatch[2] ?? from;

          // Check for attachments
          const hasAttachment = (t.data.messages ?? []).some(m =>
            m.payload?.parts?.some(p => !!p.filename && !!p.body?.attachmentId)
          );

          return {
            threadId: id,
            snippet: t.data.snippet ?? '',
            subject,
            senderName,
            senderEmail,
            date,
            unread: labelIds.includes('UNREAD'),
            starred: labelIds.includes('STARRED'),
            hasAttachment,
            labelIds,
            messageCount: t.data.messages?.length ?? 1,
          };
        } catch { return null; }
      })
    );

    const result = {
      threads: threads.filter(Boolean),
      nextPageToken: listRes.data.nextPageToken ?? null,
    };
    cacheSet(cacheKey, result, 30_000);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Failed to list threads' });
  }
});

// ── Single thread (full messages) ─────────────────────────────────────────────

gmailRouter.get('/threads/:threadId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { threadId } = req.params;
  const cacheKey = `gmail:${userId}:thread:${threadId}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) { res.json(hit); return; }

  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const t = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    const messages = (t.data.messages ?? []).map(msg => {
      const headers = msg.payload?.headers ?? [];
      const from = getHeader(headers, 'From');
      const fromMatch = from.match(/^(.*?)\s*<(.+?)>$/) ?? [null, from, from];
      const body = extractBody(msg.payload as Parameters<typeof extractBody>[0]);
      const attachments = extractAttachments(msg.payload as Parameters<typeof extractAttachments>[0]);
      return {
        messageId: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds ?? [],
        senderName: (fromMatch[1] ?? from).replace(/"/g, '').trim(),
        senderEmail: fromMatch[2] ?? from,
        to: getHeader(headers, 'To'),
        cc: getHeader(headers, 'Cc'),
        bcc: getHeader(headers, 'Bcc'),
        date: getHeader(headers, 'Date'),
        subject: getHeader(headers, 'Subject') || '(no subject)',
        bodyHtml: body.html,
        bodyPlain: body.plain,
        attachments,
        unread: (msg.labelIds ?? []).includes('UNREAD'),
        starred: (msg.labelIds ?? []).includes('STARRED'),
      };
    });

    const result = { threadId, messages };
    cacheSet(cacheKey, result, 120_000);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Failed to get thread' });
  }
});

// ── Message actions ───────────────────────────────────────────────────────────

async function modifyThread(
  userId: string,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
  res: Response
) {
  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }
  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.threads.modify({
      userId: 'me', id: threadId,
      requestBody: { addLabelIds, removeLabelIds },
    });
    // Invalidate caches for this thread and thread list
    cache.delete(`gmail:${userId}:thread:${threadId}`);
    for (const key of cache.keys()) {
      if (key.startsWith(`gmail:${userId}:threads:`)) cache.delete(key);
      if (key.startsWith(`gmail:${userId}:unread`)) cache.delete(key);
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Modify failed' });
  }
}

gmailRouter.post('/threads/:threadId/read',   requireAuth, (req: AuthRequest, res) =>
  modifyThread(req.user!.id, req.params.threadId, [], ['UNREAD'], res));
gmailRouter.post('/threads/:threadId/unread', requireAuth, (req: AuthRequest, res) =>
  modifyThread(req.user!.id, req.params.threadId, ['UNREAD'], [], res));
gmailRouter.post('/threads/:threadId/star',   requireAuth, (req: AuthRequest, res) =>
  modifyThread(req.user!.id, req.params.threadId, ['STARRED'], [], res));
gmailRouter.post('/threads/:threadId/unstar', requireAuth, (req: AuthRequest, res) =>
  modifyThread(req.user!.id, req.params.threadId, [], ['STARRED'], res));
gmailRouter.post('/threads/:threadId/archive', requireAuth, (req: AuthRequest, res) =>
  modifyThread(req.user!.id, req.params.threadId, [], ['INBOX'], res));

gmailRouter.post('/threads/:threadId/label', requireAuth, async (req: AuthRequest, res: Response) => {
  const { addLabelIds = [], removeLabelIds = [] } = req.body as { addLabelIds?: string[]; removeLabelIds?: string[] };
  await modifyThread(req.user!.id, req.params.threadId, addLabelIds, removeLabelIds, res);
});

gmailRouter.delete('/threads/:threadId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }
  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.threads.trash({ userId: 'me', id: req.params.threadId });
    cache.delete(`gmail:${userId}:thread:${req.params.threadId}`);
    for (const key of cache.keys()) {
      if (key.startsWith(`gmail:${userId}:threads:`)) cache.delete(key);
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Trash failed' });
  }
});

// ── Send / Reply ──────────────────────────────────────────────────────────────

gmailRouter.post('/send', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  const { to, subject, body, cc, bcc, replyToMessageId, threadId } = req.body as {
    to: string; subject: string; body: string;
    cc?: string; bcc?: string; replyToMessageId?: string; threadId?: string;
  };

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    // Get sender email
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const fromEmail = profile.data.emailAddress ?? '';

    // Build RFC 2822 message
    const lines = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      ...(bcc ? [`Bcc: ${bcc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      body,
    ];
    if (replyToMessageId) lines.splice(3, 0, `In-Reply-To: ${replyToMessageId}`, `References: ${replyToMessageId}`);

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    const sentMsg = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    });

    // Invalidate sent/thread caches
    for (const key of cache.keys()) {
      if (key.startsWith(`gmail:${userId}:threads:`)) cache.delete(key);
    }

    res.json({ messageId: sentMsg.data.id });
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Send failed' });
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

gmailRouter.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { q = '', maxResults = '20', pageToken = '' } = req.query as Record<string, string>;
  if (!q.trim()) { res.json({ threads: [], nextPageToken: null }); return; }

  const cacheKey = `gmail:${userId}:search:${q}:${pageToken}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) { res.json(hit); return; }

  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const listRes = await gmail.users.threads.list({
      userId: 'me', q,
      maxResults: Math.min(Number(maxResults), 50),
      ...(pageToken ? { pageToken } : {}),
    });

    const threadIds = listRes.data.threads ?? [];
    const threads = await Promise.all(
      threadIds.map(async ({ id }) => {
        if (!id) return null;
        try {
          const t = await gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
          const lastMsg = t.data.messages?.[t.data.messages.length - 1];
          if (!lastMsg) return null;
          const headers = lastMsg.payload?.headers ?? [];
          const from = getHeader(headers, 'From');
          const fromMatch = from.match(/^(.*?)\s*<(.+?)>$/) ?? [null, from, from];
          const labelIds = lastMsg.labelIds ?? [];
          return {
            threadId: id,
            snippet: t.data.snippet ?? '',
            subject: getHeader(headers, 'Subject') || '(no subject)',
            senderName: (fromMatch[1] ?? from).replace(/"/g, '').trim(),
            senderEmail: fromMatch[2] ?? from,
            date: getHeader(headers, 'Date'),
            unread: labelIds.includes('UNREAD'),
            starred: labelIds.includes('STARRED'),
            hasAttachment: (t.data.messages ?? []).some(m => m.payload?.parts?.some(p => !!p.filename)),
            labelIds,
            messageCount: t.data.messages?.length ?? 1,
          };
        } catch { return null; }
      })
    );

    const result = { threads: threads.filter(Boolean), nextPageToken: listRes.data.nextPageToken ?? null };
    cacheSet(cacheKey, result, 60_000);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Search failed' });
  }
});

// ── Labels ────────────────────────────────────────────────────────────────────

gmailRouter.get('/labels', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const cacheKey = `gmail:${userId}:labels`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) { res.json(hit); return; }

  const tokens = await getTokensForService(userId, 'google-gmail');
  if (!tokens) { noAuth(res); return; }

  try {
    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const labels = await Promise.all(
      (labelsRes.data.labels ?? []).map(async l => {
        if (!l.id) return null;
        try {
          const detail = await gmail.users.labels.get({ userId: 'me', id: l.id });
          return {
            id: l.id,
            name: l.name ?? l.id,
            type: l.type ?? 'user',
            unreadCount: detail.data.messagesUnread ?? 0,
            totalCount: detail.data.messagesTotal ?? 0,
          };
        } catch { return { id: l.id, name: l.name ?? l.id, type: l.type ?? 'user', unreadCount: 0, totalCount: 0 }; }
      })
    );
    const result = { labels: labels.filter(Boolean) };
    cacheSet(cacheKey, result, 5 * 60_000);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (err?.code === 403) { noAuth(res); return; }
    res.status(500).json({ error: err?.message ?? 'Failed to get labels' });
  }
});

// ── Pub/Sub push webhook ──────────────────────────────────────────────────────

gmailRouter.post('/push', async (req, res) => {
  // Acknowledge immediately — Pub/Sub requires fast response
  res.sendStatus(200);

  try {
    const message = req.body?.message;
    if (!message?.data) return;

    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8')) as {
      emailAddress?: string;
      historyId?: string;
    };
    const email = decoded.emailAddress;
    if (!email) return;

    // Look up the NEXUS user by email
    const { data: userRecord } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();
    if (!userRecord?.id) return;

    const userId = userRecord.id as string;

    // Invalidate Gmail caches for this user
    cacheInvalidateUser(userId);

    // Fetch latest unread count
    const tokens = await getTokensForService(userId, 'google-gmail');
    if (!tokens) return;

    const auth = getGoogleAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const labelRes = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    const unreadCount = labelRes.data.messagesUnread ?? 0;

    // Push real-time event to connected client
    broadcastToUser(userId, { type: 'gmail:update', unreadCount });
  } catch {
    // Silently ignore — we already acknowledged
  }
});
