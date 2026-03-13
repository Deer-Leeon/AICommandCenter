# NEXUS New Tab — Chrome Extension

Opens NEXUS (`https://nexus.lj-buchmiller.com`) in every new tab at maximum speed.

## How the Speed Works

The extension uses three layers to make NEXUS load as fast as possible:

**1. Background pre-warming (biggest impact)**
A background service worker fetches NEXUS every 10 minutes and on every browser startup. This keeps NEXUS's HTML and assets continuously warm in Chrome's HTTP cache. Instead of a cold network round-trip (~200 ms), new tab navigations hit cache (~10 ms).

**2. DNS + TLS pre-connection**
`newtab.html` fires `<link rel="preconnect">` which tells Chrome to resolve DNS and complete the TCP/TLS handshake *before* the redirect even fires. The handshake (~100 ms on a cold connection) happens in parallel with the tiny amount of work the extension page does, so it's already done by the time navigation starts.

**3. Speculative prerender**
A `<script type="speculationrules">` block (allowed by MV3's default CSP via `'inline-speculation-rules'`) tells Chrome to fully render NEXUS in a background context the moment the new tab page appears. When the redirect navigates to the same URL, Chrome *activates* the already-rendering page instead of starting fresh — near-instant in the best case.

## Install (Developer Mode)

1. Open Chrome → `chrome://extensions`
2. Turn **Developer mode** ON (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder
5. Done — open a new tab and NEXUS loads immediately

> After any file change: go to `chrome://extensions` and click the ↺ reload button next to NEXUS.

## Permissions Explained

- **`alarms`** — lets the background service worker run its 10-minute cache-warming timer reliably (MV3 service workers sleep between events; `chrome.alarms` is the approved way to schedule periodic tasks)
- **`host_permissions: nexus.lj-buchmiller.com`** — lets the background service worker fetch NEXUS to warm the cache; without this the background fetch would be blocked

## File Structure

```
chrome-extension/
  manifest.json   — MV3 manifest with background + permissions
  background.js   — Service worker: pre-warms cache on install, startup, every 10 min
  newtab.html     — New tab page: preconnect + speculation rules + instant redirect
  redirect.js     — window.location.replace() — single-line, runs synchronously
  README.md       — This file
```

## Change the URL

If you host NEXUS elsewhere, update `newtab.html` (the `<link rel="preconnect">`, speculation rules URLs, and `redirect.js`) and `background.js` (the `NEXUS` constant).
