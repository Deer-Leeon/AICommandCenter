# NEXUS — AI Command Center

A production-ready, full-stack AI-powered personal command center. Drag-and-drop widget dashboard with a central AI input bar powered by a locally running Ollama model. The AI understands natural language and autonomously routes actions to connected services.

## Architecture

```
nexus/
├── frontend/      React 18 + Vite + TypeScript + Tailwind + @dnd-kit + Zustand
└── backend/       Node.js + Express + TypeScript + MCP Server
```

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **Ollama** installed and running (`brew install ollama` on macOS)
- Optional: Obsidian with Local REST API plugin
- Optional: Google Cloud project (for Calendar + Docs)
- Optional: Slack app with bot token

## Quick Start

### 1. Install dependencies

```bash
cd nexus
npm run install:all
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Pull Ollama model

```bash
ollama pull llama3
# or: ollama pull mistral
```

### 4. Start development

```bash
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:3001
- **Health check:** http://localhost:3001/api/health

---

## Service Setup

### Google Calendar + Docs (OAuth 2.0)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable **Google Calendar API** and **Google Docs API**
3. Credentials → Create OAuth 2.0 Client ID (Web application)
4. Add authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
5. Copy Client ID and Client Secret to `.env`
6. Start the backend, then visit: `http://localhost:3001/api/auth/google`
7. Complete the OAuth flow — your refresh token is saved automatically to `tokens.json`

Required `.env` variables:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
```

### Slack

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. App name: **NEXUS** — pick your workspace
3. OAuth & Permissions → Bot Token Scopes:
   - `channels:read`, `channels:history`, `chat:write`
   - `im:read`, `im:write`, `im:history`, `users:read`
4. Install to Workspace → copy **Bot User OAuth Token** to `SLACK_BOT_TOKEN`
5. Basic Information → copy **Signing Secret** to `SLACK_SIGNING_SECRET`

Required `.env` variables:
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_DEFAULT_CHANNEL=general
```

### Obsidian (Local REST API)

1. In Obsidian: Settings → Community Plugins → Browse
2. Search **"Local REST API"** → Install → Enable
3. Plugin Settings: set an API key, note the port (default `27123`)
4. Copy the API key to `.env`

Required `.env` variables:
```
OBSIDIAN_API_URL=http://localhost:27123
OBSIDIAN_API_KEY=...
OBSIDIAN_VAULT_NAME=MyVault
OBSIDIAN_GROCERY_FILE=Shopping/Groceries.md
```

### Weather (Optional)

1. Get a free API key at [openweathermap.org](https://openweathermap.org)
2. Add to `.env`:
```
OPENWEATHER_API_KEY=...
OPENWEATHER_DEFAULT_CITY=New York,US
```

---

## Usage

### AI Commands (Natural Language Examples)

| What you say | What happens |
|---|---|
| "I have a meeting tomorrow at 3pm" | Creates Google Calendar event |
| "Don't forget to buy milk" | Appends to Obsidian grocery list |
| "Send a message to #general saying good morning" | Sends Slack message |
| "Remind me to call John next Monday at 2pm" | Creates calendar event |
| "Add buy bread to my grocery list" | Appends to Obsidian |
| "Send Alex a DM saying I'll be 10 minutes late" | Sends Slack DM |

### Drag & Drop Widgets

Drag any widget from the left sidebar into any of the 12 grid cells (6×2). Widgets automatically connect to their services when credentials are configured.

Available widgets:
- **Calendar** — Today's events + upcoming 7 days
- **Slack** — Recent channel messages (live, 30s refresh)
- **Obsidian** — Grocery/notes file content
- **Google Docs** — Recent documents
- **To-Do** — Local task list with priorities
- **Weather** — Current conditions (requires OpenWeather key)

---

## Chrome Extension

The NEXUS Chrome extension uses a thin loader approach.

### Location
`nexus/chrome-extension-thin/`

### How it works
The extension intercepts the new tab page and immediately redirects to
`nexus.lj-buchmiller.com?source=extension`. All app code lives on the
website — deploying the website instantly updates what all extension users
see with no Chrome Web Store resubmission needed.

### Build the extension ZIP for Chrome Web Store submission
```bash
npm run build:extension-thin
```
Output: `chrome-extension-thin/nexus-extension-v2.0.0.zip`

### When to resubmit to Chrome Web Store
Only when `manifest.json`, `newtab.html`, `newtab.js`, or `background.js`
change. Feature updates to the app never require resubmission.

---

## MCP Server (for Claude Desktop)

The NEXUS MCP server exposes all integrations as tools for any MCP-compatible client.

```bash
npm run mcp
```

To use with Claude Desktop, add to your Claude config:

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["./nexus/backend/dist/mcp/mcpServer.js"]
    }
  }
}
```

Available MCP tools:
- `nexus_calendar_list_events` — List upcoming events
- `nexus_calendar_create_event` — Create calendar event
- `nexus_calendar_delete_event` — Delete calendar event
- `nexus_slack_send_message` — Send channel message
- `nexus_slack_send_dm` — Send direct message
- `nexus_slack_get_messages` — Get channel messages
- `nexus_obsidian_append` — Append to note
- `nexus_obsidian_read` — Read note
- `nexus_obsidian_create` — Create note
- `nexus_docs_list` — List Google Docs
- `nexus_docs_append` — Append to document

---

## API Reference

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/ai` | Send message to AI, get intent + action result |
| `GET` | `/api/health` | Service connection status |
| `GET` | `/api/auth/google` | Initiate Google OAuth |
| `GET` | `/api/auth/google/callback` | OAuth callback |
| `GET` | `/api/calendar/events` | List events (`?days=7`) |
| `POST` | `/api/calendar/events` | Create event |
| `PUT` | `/api/calendar/events/:id` | Update event |
| `DELETE` | `/api/calendar/events/:id` | Delete event |
| `GET` | `/api/slack/messages` | Get messages (`?channel=general&limit=10`) |
| `POST` | `/api/slack/messages` | Send message |
| `GET` | `/api/slack/channels` | List channels |
| `GET` | `/api/slack/users` | List users |
| `GET` | `/api/obsidian/file` | Get file (`?path=...`) |
| `POST` | `/api/obsidian/append` | Append to file |
| `POST` | `/api/obsidian/create` | Create note |
| `GET` | `/api/docs/list` | List recent docs |
| `GET` | `/api/docs/:id` | Get doc content |
| `POST` | `/api/docs/:id/append` | Append to doc |
| `GET` | `/api/weather` | Current weather |

---

## Changing the Ollama Model

Edit `.env`:
```
OLLAMA_MODEL=mistral
# Options: llama3, mistral, mixtral, llama3:70b, phi3, etc.
```

Then restart the backend. Make sure to pull the model first: `ollama pull mistral`

---

## Troubleshooting

**Ollama not connecting:**
- Make sure Ollama is running: `ollama serve`
- Check it's accessible: `curl http://localhost:11434/api/tags`

**Google Auth failing:**
- Verify your redirect URI matches exactly in Google Console
- Make sure Calendar and Docs APIs are enabled for your project

**Widgets showing "Not connected":**
- Check the status bar at the bottom for service connection status
- Visit `/api/health` for detailed status
- Ensure `.env` is properly configured

**No drag-and-drop:**
- The sidebar must be open to see draggable widgets
- Drag from the sidebar chip into any numbered grid cell
