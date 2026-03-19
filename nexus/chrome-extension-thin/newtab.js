// newtab.js — offline UI only.
//
// redirect.js (in <head>) already handled the online case and redirected
// before this script ran. This script only runs when the user is offline.

const NEXUS_URL =
  'https://nexus.lj-buchmiller.com?source=extension&extid=' + chrome.runtime.id;

const offline  = document.getElementById('offline');
const retryBtn = document.getElementById('retry-btn');

// Show the offline UI (redirect.js left us here because navigator.onLine was false)
if (!navigator.onLine) {
  offline.classList.add('visible');
}

// Wire the Retry button via addEventListener — inline onclick="" is blocked by
// the MV3 CSP (script-src 'self' forbids inline event handlers).
retryBtn.addEventListener('click', () => {
  if (navigator.onLine) window.location.replace(NEXUS_URL);
});

window.addEventListener('online', () => {
  offline.classList.remove('visible');
  window.location.replace(NEXUS_URL);
});
