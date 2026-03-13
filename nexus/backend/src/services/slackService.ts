/**
 * Slack Integration
 * ─────────────────
 * All functions accept an optional `token` parameter.
 * When provided (user token from Supabase), calls are made on behalf of that user.
 * When omitted, falls back to the shared SLACK_BOT_TOKEN env var.
 */

export interface SlackMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: string;
  channel: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
}

function getBotToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || token === 'xoxb-') throw new Error('SLACK_BOT_TOKEN not configured');
  return token;
}

function resolveToken(token?: string): string {
  return token ?? getBotToken();
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function slackGet<T extends SlackApiResponse>(
  endpoint: string,
  params: Record<string, string | number> = {},
  token?: string,
): Promise<T> {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${resolveToken(token)}` },
  });
  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`Slack API error on ${endpoint}: ${data.error ?? 'unknown'}`);
  return data;
}

async function slackPost<T extends SlackApiResponse>(
  endpoint: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolveToken(token)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`Slack API error on ${endpoint}: ${data.error ?? 'unknown'}`);
  return data;
}

const usernameCache = new Map<string, string>();

async function resolveUsername(userId: string, token?: string): Promise<string> {
  if (!userId || userId === 'unknown') return 'unknown';
  if (usernameCache.has(userId)) return usernameCache.get(userId)!;
  try {
    const data = await slackGet<
      SlackApiResponse & {
        user: { profile: { display_name: string }; real_name: string; name: string };
      }
    >('users.info', { user: userId }, token);
    const name =
      data.user?.profile?.display_name || data.user?.real_name || data.user?.name || userId;
    usernameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

const channelIdCache = new Map<string, string>();

async function resolveChannelId(channelNameOrId: string, token?: string): Promise<string> {
  if (channelNameOrId.match(/^[CGDU][A-Z0-9]+$/)) return channelNameOrId;

  const normalised = channelNameOrId.replace(/^#/, '').toLowerCase();
  if (channelIdCache.has(normalised)) return channelIdCache.get(normalised)!;

  const data = await slackGet<
    SlackApiResponse & { channels: Array<{ id: string; name: string }> }
  >('conversations.list', { types: 'public_channel,private_channel', limit: 200 }, token);

  for (const ch of data.channels ?? []) {
    channelIdCache.set(ch.name.toLowerCase(), ch.id);
  }

  const resolved = channelIdCache.get(normalised);
  if (!resolved) throw new Error(`Slack channel not found: ${channelNameOrId}`);
  return resolved;
}

export async function getChannelMessages(
  channel: string,
  limit = 10,
  token?: string,
): Promise<SlackMessage[]> {
  const channelId = await resolveChannelId(channel, token);

  const data = await slackGet<
    SlackApiResponse & { messages: Array<{ ts: string; user: string; text: string }> }
  >('conversations.history', { channel: channelId, limit }, token);

  const messages = data.messages ?? [];
  return Promise.all(
    messages.map(async (msg) => ({
      id: msg.ts || '',
      userId: msg.user || 'unknown',
      username: await resolveUsername(msg.user || '', token),
      text: msg.text || '',
      timestamp: msg.ts || '',
      channel,
    })),
  );
}

export async function sendMessage(channel: string, text: string, token?: string): Promise<void> {
  const channelId = await resolveChannelId(channel, token);
  await slackPost('chat.postMessage', { channel: channelId, text }, token);
}

export async function sendDM(userId: string, text: string, token?: string): Promise<void> {
  const openData = await slackPost<SlackApiResponse & { channel: { id: string } }>(
    'conversations.open',
    { users: userId },
    token,
  );
  const dmChannelId = openData.channel?.id;
  if (!dmChannelId) throw new Error(`Could not open DM with user ${userId}`);
  await slackPost('chat.postMessage', { channel: dmChannelId, text }, token);
}

export async function listChannels(token?: string): Promise<SlackChannel[]> {
  const data = await slackGet<
    SlackApiResponse & { channels: Array<{ id: string; name: string }> }
  >('conversations.list', { types: 'public_channel,private_channel', limit: 200 }, token);
  return (data.channels ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export async function listUsers(token?: string): Promise<SlackUser[]> {
  const data = await slackGet<
    SlackApiResponse & {
      members: Array<{
        id: string;
        name: string;
        real_name: string;
        is_bot: boolean;
        deleted: boolean;
      }>;
    }
  >('users.list', {}, token);
  return (data.members ?? [])
    .filter((u) => !u.is_bot && !u.deleted)
    .map((u) => ({ id: u.id, name: u.name, realName: u.real_name }));
}

export async function findUserByName(name: string, token?: string): Promise<SlackUser | null> {
  const users = await listUsers(token);
  const lower = name.toLowerCase();
  return (
    users.find(
      (u) => u.name.toLowerCase() === lower || u.realName.toLowerCase().includes(lower),
    ) ?? null
  );
}

export async function checkConnection(token?: string): Promise<boolean> {
  try {
    resolveToken(token); // throws if no token available
    await slackGet('auth.test', {}, token);
    return true;
  } catch {
    return false;
  }
}
