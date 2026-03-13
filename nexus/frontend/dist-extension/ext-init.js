/**
 * NEXUS Extension Init Script
 *
 * Replaces the two inline <script> blocks from index.html for the Chrome
 * Extension build.  Manifest V3 forbids inline scripts, so we extract them
 * here and reference this file with a plain <script src="ext-init.js">.
 *
 * Runs synchronously during HTML parse — before any module bundle loads —
 * giving us the same early-execution guarantees as the original inline scripts.
 */

// ── 1. Predictive prefetch ────────────────────────────────────────────────────
// Fires API requests BEFORE React mounts so widget data is in-flight or done
// by the time each widget's hook runs.
(function () {
  try {
    var API = 'https://nexus-api.lj-buchmiller.com';
    var session = JSON.parse(localStorage.getItem('nexus-auth') || 'null');
    if (!session || !session.access_token) return;
    var token = session.access_token;
    var layout = JSON.parse(localStorage.getItem('nexus_layout_v2') || 'null');
    if (!layout || !layout.widgets) return;
    var widgets = Object.values(layout.widgets);

    var MAP = {
      calendar: '/api/calendar/events?days=7',
      weather: '/api/weather',
      slack: '/api/slack/messages?limit=10',
      todo: '/api/todos',
      tasks: '/api/tasks',
      docs: '/api/docs/list',
      stocks: '/api/stocks/overview',
      plaid: '/api/plaid/accounts',
      pomodoro: '/api/pomodoro/stats',
    };

    var hdrs = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    };

    window.__nexusPrefetch = {};
    var seen = {};

    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      var ep = MAP[w];
      if (ep && !seen[ep]) {
        seen[ep] = 1;
        window.__nexusPrefetch[ep] = fetch(API + ep, { headers: hdrs }).catch(
          function () {
            return null;
          },
        );
      }
    }

    // Chess widgets use per-connection endpoints — prefetch each individually.
    var conns = layout.connections || {};
    for (var slot in layout.widgets) {
      if (layout.widgets[slot] === 'shared_chess' && conns[slot]) {
        var chessEp = '/api/chess/' + conns[slot];
        if (!seen[chessEp]) {
          seen[chessEp] = 1;
          window.__nexusPrefetch[chessEp] = fetch(API + chessEp, {
            headers: hdrs,
          }).catch(function () {
            return null;
          });
        }
      }
    }
  } catch (e) {}
})();

// ── 2. Type-ahead keystroke buffer ────────────────────────────────────────────
// Captures printable keystrokes from the very first byte of HTML — before
// React, before fonts, before any JS bundle loads.  AIInputBar drains
// window.__nexusTypeBuffer on its first focus and replays every character.
(function () {
  window.__nexusTypeBuffer = '';
  window.__nexusTypeBufferActive = true;
  document.addEventListener(
    'keydown',
    function (e) {
      if (!window.__nexusTypeBufferActive) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        window.__nexusTypeBuffer += e.key;
      } else if (e.key === 'Backspace' && window.__nexusTypeBuffer.length > 0) {
        window.__nexusTypeBuffer = window.__nexusTypeBuffer.slice(0, -1);
      }
    },
    true,
  );
})();
