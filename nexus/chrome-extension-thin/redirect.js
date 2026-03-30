// redirect.js — runs in <head> during HTML parsing.
//
// Instead of a blind immediate redirect, we briefly keep the extension page
// alive to capture early key presses (before the website can load) and hand
// them to the website via a tokenized background-store handoff.
//
// Offline behavior is unchanged: this script exits and newtab.js shows offline UI.
(function () {
  if (!navigator.onLine) return;

  const NEXUS_ORIGIN = 'https://nexus.lj-buchmiller.com';
  const EXT_ID = chrome.runtime.id;

  // Fast path for users who just open a tab (no typing).
  const FAST_REDIRECT_MS = 90;
  // Once typing starts, wait for a short idle gap before redirecting.
  const IDLE_REDIRECT_MS = 650;
  // Absolute cap so we never hold the tab indefinitely.
  const MAX_CAPTURE_MS = 12000;

  let done = false;
  let sawTyping = false;
  const ops = [];

  let fastTimer = null;
  let idleTimer = null;
  let maxTimer = null;

  function buildUrl(token) {
    const params = new URLSearchParams({
      source: 'extension',
      extid: EXT_ID,
    });
    if (token) params.set('boot', token);
    return `${NEXUS_ORIGIN}?${params.toString()}`;
  }

  function makeToken() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function scheduleIdleRedirect() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void commitRedirect('idle'); }, IDLE_REDIRECT_MS);
  }

  function stopTimers() {
    if (fastTimer) clearTimeout(fastTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (maxTimer) clearTimeout(maxTimer);
    fastTimer = null;
    idleTimer = null;
    maxTimer = null;
  }

  function stopCapture() {
    document.removeEventListener('keydown', onKeyDown, true);
    stopTimers();
  }

  async function commitRedirect(_reason) {
    if (done) return;
    done = true;
    stopCapture();

    const token = sawTyping ? makeToken() : null;

    if (token) {
      try {
        await chrome.runtime.sendMessage({
          type: 'NEXUS_TYPE_BUFFER_STAGE',
          token,
          ops,
        });
      } catch {
        // Non-fatal: still continue to website.
      }
    }

    window.location.replace(buildUrl(token));
  }

  function pushOp(op) {
    sawTyping = true;
    ops.push(op);
    scheduleIdleRedirect();
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    const el = target;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.isContentEditable;
  }

  function onKeyDown(e) {
    if (done) return;
    if (e.isComposing) return;

    const target = e.target || document.activeElement;
    if (isEditableTarget(target)) return;

    // Redirect immediately when Enter is pressed after any typing.
    if (e.key === 'Enter' && sawTyping) {
      void commitRedirect('enter');
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key.length === 1) {
      pushOp({ t: 'ins', v: e.key });
    } else if (e.key === 'Backspace') {
      pushOp({ t: 'back' });
    } else if (e.key === 'Delete') {
      pushOp({ t: 'del' });
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

  fastTimer = setTimeout(() => {
    if (!sawTyping) void commitRedirect('fast');
  }, FAST_REDIRECT_MS);

  maxTimer = setTimeout(() => {
    void commitRedirect('max');
  }, MAX_CAPTURE_MS);
})();
