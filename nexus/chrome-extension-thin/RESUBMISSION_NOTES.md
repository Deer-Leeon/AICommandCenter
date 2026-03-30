# Chrome Web Store Submission Notes — v2.0.0

## What this extension does
NEXUS replaces the Chrome new tab page with a personal productivity dashboard.
This version uses a thin loader approach — the extension intercepts the new
tab page and immediately redirects to nexus.lj-buchmiller.com. All app code
lives on the website; deploying the website instantly updates what all
extension users see with no Chrome Web Store resubmission needed.

## Single purpose
This extension has exactly one purpose: replace the new tab page by
redirecting to the NEXUS dashboard at nexus.lj-buchmiller.com.

## Search functionality
The NEXUS dashboard includes a search bar that uses the Chrome Search API
(chrome.search.query) to respect the user's default search engine set in
Chrome settings.

Because the website runs as a top-level page at nexus.lj-buchmiller.com
(an https:// origin, not a chrome-extension:// origin), it cannot call
chrome.search.query directly. The implementation uses the standard
externally_connectable mechanism:
  1. newtab.js embeds the extension ID in the redirect URL (?extid=<id>)
  2. The website calls chrome.runtime.sendMessage(extensionId, { type: 'NEXUS_SEARCH' })
  3. The background service worker receives the message via onMessageExternal
  4. The service worker calls chrome.search.query({ text, disposition })
This is the documented approach for allowing a trusted web page to invoke
extension capabilities.

## Keystroke handoff for new-tab typing
To prevent dropped keystrokes when network latency is high:
  1. `redirect.js` captures early keystrokes on the extension new-tab page
     before redirect completes.
  2. It stores a sanitized op queue (`insert`/`backspace`/`delete`) in the
     extension background worker using a one-time token.
  3. The website receives the token in the redirect URL and consumes the queue
     via `chrome.runtime.sendMessage(extensionId, ...)`.
  4. The website replays the queue into the NEXUS search bar and then removes
     the one-time token from the URL.

No keystroke content is embedded directly in the URL.

## Permissions used
- search:  required for chrome.search.query in the background service worker
- alarms:  used for periodic cache warming fetch to improve load speed
- storage: stores one-time pre-redirect keystroke buffers keyed by token for
  reliable handoff from extension page to website

## externally_connectable
Declared for https://nexus.lj-buchmiller.com/* to allow the website to send
messages to this extension's background service worker for the search relay.

## Privacy policy
https://nexus.lj-buchmiller.com/privacy
