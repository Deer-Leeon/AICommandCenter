// background.js — NEXUS thin loader service worker
//
// Responsibilities:
//   1. Keep the NEXUS website warm in the browser's HTTP cache so new tab
//      navigations load from cache (~10ms) instead of the network (~200ms).
//   2. Handle chrome.search.query on behalf of nexus.lj-buchmiller.com via
//      the externally_connectable mechanism.

const NEXUS_URL =
  'https://nexus.lj-buchmiller.com?source=extension&extid=' + chrome.runtime.id;

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

chrome.alarms.create('cache-warm', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cache-warm') warmCache();
});

// ── Search relay (externally_connectable) ─────────────────────────────────────
// The NEXUS website runs at https://nexus.lj-buchmiller.com and cannot call
// chrome.search.query directly (wrong origin). Instead it calls
// chrome.runtime.sendMessage(extensionId, ...) and this worker calls
// chrome.search.query, which routes through the user's default Chrome engine.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === 'NEXUS_SEARCH') {
    chrome.search.query({
      text: message.query,
      disposition: message.disposition || 'CURRENT_TAB',
    });
    sendResponse({ success: true });
  }
});
