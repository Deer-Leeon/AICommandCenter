# NEXUS Chrome Extension — Thin Loader

This is the production Chrome extension submitted to the Chrome Web Store.

## How it works

When a new tab is opened, `newtab.html` shows a dark background instantly
(zero white flash). `redirect.js` starts a tiny pre-redirect capture window:

1. If no typing happens, it redirects to the website almost immediately.
2. If the user starts typing before redirect, it buffers keystrokes in the
   extension context and then redirects with a one-time boot token.
3. The website consumes that token via the extension background worker and
   replays the full keystroke sequence into the NEXUS search bar.

The NEXUS website loads as the full new tab page. All app features — auth,
search, widgets, settings — work identically to the web version. Updating
the website instantly updates what all extension users see with no Chrome
Web Store resubmission needed.

## Why redirect instead of iframe?

Embedding the website in an `<iframe>` causes Google to return 403 on any
navigation to a Google URL (OAuth sign-in, search results, Google Calendar)
because Google sets `X-Frame-Options: SAMEORIGIN`. A top-level redirect
avoids this entirely and is simpler and more reliable.

## URL parameters

The redirect URL includes `?source=extension` so the NEXUS website can
detect it is running inside the Chrome extension (checked in `platform.ts`
via `isExtension()`). This allows the website to adjust its behavior when
needed (e.g., different auth flows, extension-specific UI).

The URL also includes:

- `extid=<extensionId>` so the website can call the extension worker through
  `chrome.runtime.sendMessage(extensionId, ...)`
- `boot=<token>` only when pre-redirect typing was captured; this token is
  consumed once and removed from the URL via `history.replaceState`.

## To build and package

From the `nexus/` root:

```bash
npm run build:extension-thin
```

Output: `chrome-extension-thin/nexus-extension-v2.0.0.zip`

## To install unpacked (for testing)

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `nexus/chrome-extension-thin/` folder (NOT the dist subfolder)

## To submit to Chrome Web Store

1. Build the ZIP: `npm run build:extension-thin`
2. Go to chrome.google.com/webstore/devconsole
3. Upload `nexus-extension-v2.0.0.zip`
4. Paste `RESUBMISSION_NOTES.md` into the reviewer notes field
5. Submit

## To update the app

Just deploy the website — no extension update needed.
The only time the extension needs to be updated and resubmitted is when
`manifest.json` changes (new permissions, new capabilities).
