# NEXUS Chrome Extension Setup

The extension uses a **thin loader** approach — the only job of the extension
is to redirect the new tab page to `nexus.lj-buchmiller.com`. All app code
lives on the website and updates instantly on deploy, with no Chrome Web Store
resubmission needed for feature changes.

---

## Extension location

```
nexus/chrome-extension-thin/
├── manifest.json     — MV3 manifest (v2.0.0)
├── newtab.html       — Dark background shown instantly on new tab
├── newtab.js         — Redirects to nexus.lj-buchmiller.com?source=extension
├── background.js     — Service worker: cache warming via chrome.alarms
├── icons/            — Extension icons (16, 32, 48, 128 px)
├── README.md         — Architecture notes
└── RESUBMISSION_NOTES.md  — Paste into Chrome Web Store reviewer notes
```

---

## Load the extension locally (for testing)

1. Open **chrome://extensions**
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `nexus/chrome-extension-thin/` ← the source folder, not `dist/`
5. Open a new tab — it shows the dark NEXUS background, then redirects to the
   NEXUS website. If you type immediately, the extension buffers those
   keystrokes and replays them into the website search bar after redirect.

---

## Build the ZIP for Chrome Web Store submission

From the `nexus/` root:

```bash
npm run build:extension-thin
```

Output: `chrome-extension-thin/nexus-extension-v2.0.0.zip`

Then:

1. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Upload the ZIP
3. Paste `RESUBMISSION_NOTES.md` into the reviewer notes field
4. Submit

---

## When to resubmit to Chrome Web Store

Only when these files change:

- `manifest.json` — permissions, version bump
- `newtab.html` — the shell page
- `newtab.js` — redirect logic
- `background.js` — cache warming

**Feature updates to the NEXUS app never require resubmission.**
Just deploy the website — all extension users get the update automatically.
