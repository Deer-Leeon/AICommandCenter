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

## Permissions used
- search:  required for chrome.search.query in the background service worker
- alarms:  used for periodic cache warming fetch to improve load speed

## externally_connectable
Declared for https://nexus.lj-buchmiller.com/* to allow the website to send
messages to this extension's background service worker for the search relay.

## Privacy policy
https://nexus.lj-buchmiller.com/privacy
