// NEXUS background service worker — keeps NEXUS warm in the browser's HTTP cache
// so every new tab navigation hits cache instead of the network cold.

const NEXUS = 'https://nexus.lj-buchmiller.com';

async function prewarm() {
  try {
    // no-cors: we don't need a readable response, just warming the HTTP cache
    // cache: 'default' respects Cache-Control headers so we stay in sync with
    // the server's versioning and never serve stale assets
    await fetch(NEXUS, { mode: 'no-cors', cache: 'default' });
  } catch {
    // Silent — never let a network error crash the service worker
  }
}

// Warm immediately when the extension is first installed or updated
chrome.runtime.onInstalled.addListener(prewarm);

// Warm when the browser starts so the first new tab of the day is fast
chrome.runtime.onStartup.addListener(prewarm);

// MV3 service workers go to sleep between events; chrome.alarms is the only
// reliable way to run periodic tasks. 10-minute interval keeps the HTTP cache
// continuously warm without creating noticeable network overhead.
chrome.alarms.create('nexus-prewarm', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexus-prewarm') prewarm();
});
