# Resubmission Notes for Chrome Web Store Review

## Changes made to address Red Argon violation:

1. Search functionality updated to use Chrome Search API (`chrome.search.query`)
   which respects the user's default search engine set in Chrome settings.
   The extension no longer overrides or hardcodes the user's search preference.
   The `"search"` permission was added to `manifest.json` to support this API.

2. Full permissions audit completed — removed all unused permissions.
   The `"search"` permission is present only in the full dashboard extension
   (where `chrome.search.query` is called); it is absent from the simple
   redirect extension which does not contain any search functionality.

3. Content Security Policy reviewed and tightened:
   - `object-src` changed from `'self'` to `'none'` (no plugin embeds are used)
   - No `unsafe-eval` anywhere
   - No external scripts — all JavaScript is bundled locally

4. All four icon sizes (16×16, 32×32, 48×48, 128×128) are now present in the
   package. Previously only the 128×128 icon existed.

5. Confirmed single purpose: this extension replaces the Chrome new tab page
   with a personal productivity dashboard. All features (widgets, search bar,
   settings) serve this single purpose. There are no content scripts injected
   into external web pages, no omnibox keyword, and no context menus.

---

## The extension's single purpose:

Replace the Chrome new tab page with NEXUS — a personal productivity dashboard
featuring customisable widgets for calendar, weather, stocks, music controls,
tasks, news, and more. The search bar in the dashboard uses `chrome.search.query`
to route searches through the user's own default search engine.

---

## Data handling:

- User authentication via Google OAuth (the user's existing Google account)
- Widget data fetched from the respective third-party APIs (Spotify, weather, etc.)
- User preferences and layout stored in Supabase database
- Search queries passed directly to `chrome.search.query()` — not stored on
  NEXUS servers
- No general browsing history collected or transmitted
- No content scripts injected into external pages
- No data sold to third parties
- Full privacy policy: https://nexus.lj-buchmiller.com/privacy

---

## Permissions in this submission:

| Permission | Justification |
|------------|--------------|
| `storage`  | Persist user preferences, session token, and widget layout cache locally |
| `search`   | Required by `chrome.search.query` to route search bar queries through the user's Chrome default search engine |

Host permissions:
| Domain | Justification |
|--------|--------------|
| `nexus-api.lj-buchmiller.com` | NEXUS backend API (widget data, layout persistence, auth) |
| `*.supabase.co` | Supabase authentication and database |
| `fonts.googleapis.com` | Google Fonts stylesheet (Space Mono, DM Sans) |
| `fonts.gstatic.com` | Google Fonts binary files |
