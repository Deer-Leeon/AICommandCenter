# Chrome Web Store — Pre-Submission Checklist

Run through every item below before uploading the ZIP.
All items must be ✅ before submitting.

---

## Manifest 1 — Simple Redirect Extension (`chrome-extension/`)

This is the lightweight version: replaces the new tab page with an instant
redirect to `https://nexus.lj-buchmiller.com` and pre-warms the browser
HTTP cache in the background.

### Final permissions

| Permission | Justified by |
|---|---|
| `alarms` | `chrome.alarms.create('nexus-prewarm', { periodInMinutes: 10 })` and `chrome.alarms.onAlarm.addListener(...)` in `background.js` — required to schedule the periodic cache-warming fetch |

### Permissions removed vs. previous version

| Removed | Reason |
|---|---|
| `search` | This extension is a pure redirect; it has no `AIInputBar` and never calls `chrome.search.query` |
| `host_permissions: nexus.lj-buchmiller.com` | `background.js` uses `mode: 'no-cors'` fetch; no host_permissions keeps the manifest minimal. Cache warming may silently fail (caught by try/catch) but the redirect itself works correctly |

### Before / after comparison

**Before:**
```json
"permissions": ["alarms", "search"],
"host_permissions": ["https://nexus.lj-buchmiller.com/*"]
```

**After:**
```json
"permissions": ["alarms"]
```
*(host_permissions removed entirely)*

### Checklist
- [x] `manifest_version: 3`
- [x] Only `alarms` permission — verified against background.js line by line
- [x] No `host_permissions`
- [x] No `content_scripts`
- [x] No `web_accessible_resources`
- [x] No `omnibox`
- [x] `newtab.html` exists ✓
- [x] `background.js` exists ✓
- [x] `redirect.js` exists ✓
- [x] `icons/icon16.png` exists ✓
- [x] `icons/icon32.png` exists ✓
- [x] `icons/icon48.png` exists ✓
- [x] `icons/icon128.png` exists ✓
- [x] No `.map` files
- [x] No `.DS_Store` files
- [x] No `.env` files
- [x] No `node_modules`

---

## Manifest 2 — Full Bundled Extension (`frontend/dist-extension/`)

This is the full NEXUS app bundled locally into the extension package.
The NEXUS dashboard runs inside the extension page — no redirect to an
external server.

### Final permissions

| Permission | Justified by |
|---|---|
| `storage` | Used throughout the React app — Supabase session token, layout cache, user preferences all stored via localStorage / chrome.storage |
| `search` | `AIInputBar.tsx` calls `chrome.search.query({ text, disposition })` to route searches through Chrome's default search engine instead of hardcoding Google |

### Host permissions

| Domain | Justified by |
|---|---|
| `nexus-api.lj-buchmiller.com` | Backend API for widget data, layout persistence, and auth |
| `*.supabase.co` | Supabase authentication and PostgreSQL database |
| `fonts.googleapis.com` | Google Fonts CSS stylesheet loaded in extension page |
| `fonts.gstatic.com` | Google Fonts binary files; also intercepted by the service worker for caching |

### CSP

```
script-src 'self'                         — all JS bundled locally, no external scripts
object-src 'none'                         — no plugins/embeds used anywhere
connect-src nexus-api + supabase + fonts  — exact domains, no wildcards
font-src 'self' + fonts.gstatic.com       — fonts only
img-src 'self' data: https:               — needed for widget images (weather icons etc.)
style-src 'self' 'unsafe-inline' + fonts  — unsafe-inline required for React/Tailwind inline styles
```

No `unsafe-eval` anywhere. ✅

### Checklist
- [x] `manifest_version: 3`
- [x] Version `1.1.1`
- [x] No `unsafe-eval` in CSP or codebase
- [x] No external script sources in CSP
- [x] `object-src 'none'`
- [x] No `content_scripts`
- [x] No `web_accessible_resources` beyond what Vite generates
- [x] No `omnibox`
- [x] `index.extension.html` exists ✓
- [x] `ext-init.js` exists ✓
- [x] `icons/icon16.png` exists ✓
- [x] `icons/icon32.png` exists ✓
- [x] `icons/icon48.png` exists ✓
- [x] `icons/icon128.png` exists ✓
- [x] No `sw.js` (removed — extensions cannot register service workers on their own pages)
- [x] No `.map` source map files
- [x] No `.DS_Store` files
- [x] No `.env` files
- [x] No `node_modules`

---

## Complete File List — `dist-extension/` ZIP Contents

These are the exact files included in the submission ZIP (1.26 MB total):

```
manifest.json
index.extension.html
ext-init.js
icons/
  icon16.png
  icon32.png
  icon48.png
  icon128.png
assets/
  index.extension-[hash].js       ← main React app entry
  vendor-[hash].js                ← React, router, zustand, dnd-kit
  vendor-supabase-[hash].js       ← Supabase client (separate chunk, loaded at auth time)
  vendor-charts-[hash].js         ← recharts + d3 (lazy-loaded only for chart widgets)
  CalendarWidget-[hash].js        ← lazy-loaded widget chunk
  GoogleDocsWidget-[hash].js
  LofiWidget-[hash].js
  NewsWidget-[hash].js
  NotesWidget-[hash].js
  ObsidianWidget-[hash].js
  PlaidWidget-[hash].js
  PomodoroWidget-[hash].js
  QuickLinksWidget-[hash].js
  SharedTodoWidget-[hash].js
  SlackWidget-[hash].js
  SpotifyWidget-[hash].js
  StocksWidget-[hash].js
  TasksWidget-[hash].js
  TodoWidget-[hash].js
  TypingWidget-[hash].js
  WeatherWidget-[hash].js
  index-[hash].css                ← all styles
```

No sensitive files present. ✅  
Package size: **1.26 MB** (well under the 10 MB Chrome Web Store soft limit). ✅

---

## Privacy Policy

- [x] `/privacy` route exists in the React app (`main.tsx` line 219)
- [x] `PrivacyPage.tsx` exists at `src/pages/PrivacyPage.tsx`
- [x] Page is accessible without login (route is outside the auth gate)
- [x] URL: `https://nexus.lj-buchmiller.com/privacy`
- [x] Page covers: What We Collect, How We Use It, What We Share, Data Storage, Third-Party Services, Your Rights, Contact
- [x] Privacy Policy link added to Settings modal left sidebar
- [x] Contact email listed: `lj.buchmiller@gmail.com`
- [ ] **ACTION REQUIRED**: Verify the page loads at `https://nexus.lj-buchmiller.com/privacy` after the next Railway deploy

---

## Red Argon Violation — Fixed

The original rejection stated the extension modified both the new tab page AND
the user's search experience. Both issues are now resolved:

1. **New tab override**: The extension's single purpose is replacing the new tab
   page with the NEXUS dashboard. ✅ This is the declared purpose.

2. **Search experience**: The search bar now calls `chrome.search.query()` which
   delegates to whatever search engine the user has set as their Chrome default.
   The extension no longer overrides or redirects to a hardcoded search URL. ✅

---

## Resubmission Notes Status

`RESUBMISSION_NOTES.md` is accurate and up to date. Paste its contents into the
"Notes to reviewer" field in the Chrome Web Store Developer Dashboard when
submitting.

**One update to make manually** in `RESUBMISSION_NOTES.md` before resubmitting:
add item #5: "Missing icon sizes (16×16, 32×32, 48×48) have been added — all
four required icon sizes are now present in the package."

---

## Pre-Submission Build Steps

Run these commands in order before creating the ZIP:

```bash
# In nexus/frontend/
npm run build:extension
# This runs: tsc --noEmit && vite build --config vite.extension.config.ts && node scripts/clean-extension-build.js
# Expected output: "✅  Extension build is clean and ready for submission."
# Expected size: < 10 MB

# Then ZIP dist-extension/ (not the whole frontend/ — just the dist-extension/ folder)
cd dist-extension
zip -r ../nexus-extension-v1.1.1.zip .
```

Upload `nexus-extension-v1.1.1.zip` to the Chrome Web Store Developer Dashboard.

---

## Final Gate

All of the following must be true before submitting:

- [ ] `npm run build:extension` completes without errors
- [ ] Clean script reports ✅ and package size < 10 MB
- [ ] `https://nexus.lj-buchmiller.com/privacy` loads correctly in a private browser window (not logged in)
- [ ] Extension loads in Chrome developer mode from the ZIP without errors
- [ ] New tab opens NEXUS dashboard correctly after installing the extension
- [ ] Search bar routes through Chrome default engine (test with DuckDuckGo set as default)
- [ ] Reviewer notes (RESUBMISSION_NOTES.md) pasted into submission form
