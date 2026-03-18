# NEXUS Extension — Privacy Practices

This document describes exactly what data the NEXUS Chrome extension collects,
stores, and transmits. Use this to accurately complete the Chrome Web Store
privacy questionnaire and to keep the privacy policy current.

---

## What the Extension Does

NEXUS replaces the Chrome new tab page with a personal productivity dashboard.
All features (widgets, search, settings) serve this single purpose.

---

## Data Collected and Why

### 1. Google Account Information
- **What**: Email address, display name, profile photo URL
- **Why**: To identify the user and personalise the dashboard
- **How**: Google OAuth 2.0 via Supabase Auth
- **Stored**: Supabase database (cloud), localStorage (session token)
- **Shared**: Not sold or shared with third parties

### 2. Widget Layout and Preferences
- **What**: Which widgets are placed on the dashboard, their sizes and positions
- **Why**: To persist the user's dashboard configuration across sessions and devices
- **How**: Saved on every change via the NEXUS backend API
- **Stored**: Supabase database (cloud), localStorage (cache for instant load)
- **Shared**: Not shared

### 3. Third-Party Service Tokens (OAuth)
- **What**: OAuth access tokens for optionally connected services:
  Google Calendar, Google Tasks, Google Drive, Google Docs, Gmail, Spotify, Slack
- **Why**: To display live data from those services in the corresponding widgets
- **How**: Stored encrypted in the Supabase database
- **Shared**: Sent only to the respective service's own API (Google, Spotify, Slack)

### 4. Search Queries
- **What**: Text typed into the NEXUS search bar
- **Why**: To perform a web search using `chrome.search.query` (which delegates
  to Chrome's default search engine) or to navigate to a URL/shortcut
- **How**: Processed entirely in the browser; the query text is passed to
  `chrome.search.query()` or used for a direct URL navigation
- **Stored**: Recent searches and custom shortcuts stored in localStorage only;
  nothing is sent to NEXUS servers
- **Shared**: Passed to Chrome's search engine (whatever the user configured);
  not sent to NEXUS servers

### 5. Browsing History (Custom Shortcuts Only)
- **What**: URLs the user has explicitly saved as shortcuts in the omnibar
- **Why**: To enable quick-launch navigation to the user's most-visited sites
- **How**: User-entered; stored in localStorage only
- **Stored**: localStorage in the browser; not synced to the cloud
- **Shared**: Not shared

---

## Data NOT Collected

- The extension does **not** read, store, or transmit the user's general
  browsing history
- The extension does **not** read content from web pages the user visits
- The extension does **not** inject content scripts into external websites
- The extension does **not** use `eval()`, `new Function()`, or any dynamic
  code execution
- The extension does **not** transmit data to any advertising network
- The extension does **not** sell user data to any third party

---

## Data Storage Locations

| Data | Location | Encrypted |
|------|----------|-----------|
| Session token | localStorage | No (scoped to extension origin) |
| Widget layout cache | localStorage | No (scoped to extension origin) |
| Recent searches / shortcuts | localStorage | No (scoped to extension origin) |
| User profile + layout | Supabase (cloud DB) | Yes (at rest + in transit) |
| OAuth tokens for 3rd-party services | Supabase (cloud DB) | Yes (at rest + in transit) |

---

## Data Transmission

All data transmitted to NEXUS servers uses HTTPS (TLS 1.2+).
The NEXUS backend is hosted at `https://nexus-api.lj-buchmiller.com`.

Third-party API calls made by the extension:
| Service | Endpoint | Data sent |
|---------|----------|-----------|
| Google APIs | googleapis.com | OAuth token + API-specific params |
| Spotify | api.spotify.com | OAuth token + playback/search params |
| Slack | slack.com | OAuth token + channel/message params |
| Supabase | *.supabase.co | Session token + user data |
| Google Fonts | fonts.googleapis.com | Font family names (no user data) |

---

## Permissions Justification

| Permission | Why it is needed |
|------------|-----------------|
| `storage` | Persist user preferences and session token locally |
| `search` | Route search bar queries through `chrome.search.query` so Chrome's default search engine is respected |
| `alarms` *(simple extension only)* | Schedule periodic cache-warming fetches; MV3 service workers sleep between events and require `chrome.alarms` for reliable periodic tasks |

---

## Privacy Policy

Full privacy policy: **https://nexus.lj-buchmiller.com/privacy**

The privacy policy covers both the web app and this Chrome extension.
