// background.js — NEXUS thin loader service worker
//
// Responsibilities:
//   1. Keep the NEXUS website warm in the browser's HTTP cache so new tab
//      navigations load from cache (~10ms) instead of the network (~200ms).
//   2. Handle chrome.search.query on behalf of nexus.lj-buchmiller.com via
//      the externally_connectable mechanism.
//   3. Persist pre-redirect type-ahead keystrokes from the extension new-tab
//      page and hand them to the website after redirect.

const NEXUS_ORIGIN = 'https://nexus.lj-buchmiller.com';

// ── Type-buffer persistence ──────────────────────────────────────────────────
const TYPE_BUFFER_PREFIX = 'nexus_typebuf:';
const TYPE_BUFFER_TTL_MS = 3 * 60 * 1000;
const TYPE_BUFFER_MAX_OPS = 2048;
const TYPE_BUFFER_MAX_INSERT_CHARS = 8;

function nowMs() {
  return Date.now();
}

function isValidToken(token) {
  return typeof token === 'string' && token.length >= 16 && token.length <= 128;
}

function typeBufferKey(token) {
  return `${TYPE_BUFFER_PREFIX}${token}`;
}

function sanitizeOps(ops) {
  if (!Array.isArray(ops)) return [];
  const out = [];
  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') continue;
    const op = raw;
    if (op.t === 'ins' && typeof op.v === 'string' && op.v.length > 0 && op.v.length <= TYPE_BUFFER_MAX_INSERT_CHARS) {
      out.push({ t: 'ins', v: op.v });
    } else if (op.t === 'back') {
      out.push({ t: 'back' });
    } else if (op.t === 'del') {
      out.push({ t: 'del' });
    }
    if (out.length >= TYPE_BUFFER_MAX_OPS) break;
  }
  return out;
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(items || {});
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function stageTypeBuffer(token, ops) {
  if (!isValidToken(token)) return { success: false };
  const cleanOps = sanitizeOps(ops);
  const key = typeBufferKey(token);
  await storageSet({
    [key]: {
      createdAt: nowMs(),
      ops: cleanOps,
    },
  });
  return { success: true, count: cleanOps.length };
}

async function consumeTypeBuffer(token) {
  if (!isValidToken(token)) return { success: false, ops: [] };
  const key = typeBufferKey(token);
  const items = await storageGet(key);
  const payload = items[key];
  await storageRemove(key);
  if (!payload || typeof payload !== 'object') return { success: true, ops: [] };

  const createdAt = typeof payload.createdAt === 'number' ? payload.createdAt : 0;
  if (!createdAt || nowMs() - createdAt > TYPE_BUFFER_TTL_MS) {
    return { success: true, ops: [] };
  }

  return {
    success: true,
    ops: sanitizeOps(payload.ops),
  };
}

async function purgeExpiredTypeBuffers() {
  const items = await storageGet(null);
  const cutoff = nowMs() - TYPE_BUFFER_TTL_MS;
  const staleKeys = [];
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(TYPE_BUFFER_PREFIX)) continue;
    const createdAt = value && typeof value === 'object' && typeof value.createdAt === 'number'
      ? value.createdAt
      : 0;
    if (!createdAt || createdAt < cutoff) staleKeys.push(key);
  }
  if (staleKeys.length > 0) await storageRemove(staleKeys);
}

// ── Cache warming ─────────────────────────────────────────────────────────────
async function warmCache() {
  try {
    await fetch('https://nexus.lj-buchmiller.com', { mode: 'no-cors' });
  } catch {
    // Network offline — safe to ignore
  }
}

chrome.runtime.onInstalled.addListener(warmCache);
chrome.runtime.onStartup.addListener(warmCache);
chrome.runtime.onInstalled.addListener(() => { purgeExpiredTypeBuffers().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { purgeExpiredTypeBuffers().catch(() => {}); });

chrome.alarms.create('cache-warm', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cache-warm') {
    warmCache();
    purgeExpiredTypeBuffers().catch(() => {});
  }
});

// ── Internal messages (extension pages → worker) ─────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;
  if (message.type !== 'NEXUS_TYPE_BUFFER_STAGE') return undefined;

  stageTypeBuffer(message.token, message.ops)
    .then(sendResponse)
    .catch(() => sendResponse({ success: false }));

  return true; // async sendResponse
});

// ── Search relay (externally_connectable) ─────────────────────────────────────
// The NEXUS website runs at https://nexus.lj-buchmiller.com and cannot call
// chrome.search.query directly (wrong origin). Instead it calls
// chrome.runtime.sendMessage(extensionId, ...) and this worker calls
// chrome.search.query, which routes through the user's default Chrome engine.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ success: false });
    return undefined;
  }

  const senderUrl = sender?.url || sender?.origin || '';
  if (senderUrl && !senderUrl.startsWith(NEXUS_ORIGIN)) {
    sendResponse({ success: false });
    return undefined;
  }

  if (message.type === 'NEXUS_SEARCH') {
    chrome.search.query({
      text: message.query,
      disposition: message.disposition || 'CURRENT_TAB',
    });
    sendResponse({ success: true });
    return undefined;
  }

  if (message.type === 'NEXUS_TYPE_BUFFER_CONSUME') {
    consumeTypeBuffer(message.token)
      .then(sendResponse)
      .catch(() => sendResponse({ success: false, ops: [] }));
    return true; // async sendResponse
  }

  return undefined;
});
