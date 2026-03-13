# NEXUS Chrome Extension Setup

Turn NEXUS into your instant new-tab page — loads in under 100 ms, no server round-trip needed for the shell.

---

## 1. Build the extension

```bash
cd nexus/frontend
npm run build:ext
```

The output lands in `nexus/frontend/dist-extension/`.

---

## 2. Load the unpacked extension in Chrome

1. Open **chrome://extensions**
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `nexus/frontend/dist-extension/` folder
5. Chrome loads the extension. Note the **Extension ID** shown (looks like `abcdefghijklmnopqrstuvwxyzabcdef`)

---

## 3. Whitelist your Extension ID for Google OAuth

Chrome extensions get a unique ID. Supabase OAuth must know this ID to allow the redirect.

### 3a — Google Cloud Console

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, add:
   ```
   chrome-extension://YOUR_EXTENSION_ID/index.extension.html
   ```
4. Save

### 3b — Supabase Dashboard

1. Open your Supabase project → **Authentication → URL Configuration**
2. Under **Redirect URLs**, add:
   ```
   chrome-extension://YOUR_EXTENSION_ID/index.extension.html
   ```
3. Save

---

## 4. Open a new tab

Open a new Chrome tab — NEXUS appears instantly! Sign in with Google once and you're done.

---

## Keeping the same Extension ID across rebuilds

As long as you always load from the **same folder** (`dist-extension/`), the ID is stable. If you ever delete the extension and re-add it, Chrome assigns a new ID and you'll need to update the redirect URIs.

### (Optional) Fix the ID permanently

Add a `key` field to `manifest.json` to pin the ID across installs (useful if you ever publish to the Chrome Web Store):

1. In Chrome, go to **chrome://extensions** → your extension → click the extension ID link
2. Copy the public key from the extension details page
3. Add it to `public/manifest.json` (alongside the existing fields):
   ```json
   "key": "MIIBIjANBgkqhkiG9w0B..."
   ```
4. Rebuild: `npm run build:ext`

---

## Updating the extension

Whenever you make changes:

```bash
npm run build:ext
```

Then in **chrome://extensions**, click the **↺ refresh** button on the NEXUS card.  
Open a new tab — your updates are live.

---

## Both web + extension at the same time

The website (`https://nexus.lj-buchmiller.com`) and the extension are completely independent. Each has its own Supabase session stored in its own `localStorage`. You can be logged into both simultaneously — they both talk to the same backend API.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Sign in" redirects to a broken page | Double-check the redirect URI in Google Console and Supabase matches `chrome-extension://YOUR_ID/index.extension.html` exactly |
| New tab shows blank white page | Open DevTools on the extension page (right-click → Inspect) and check the Console for CSP errors |
| Extension ID changed | You removed and re-added the extension. Update the redirect URIs with the new ID |
| Build fails with TS errors | Run `npm run build` (web build) first — it shows all errors clearly |
