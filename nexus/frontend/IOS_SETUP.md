# NEXUS iOS Setup Guide

Complete manual steps required after running `npm run ios:dev` for the first time.

---

## Quick Start (first time)

```bash
# 1. In nexus/frontend/ — initialise Capacitor (run once)
npm run cap:init
npm run cap:add:ios

# 2. Build the web app and open Xcode
npm run ios:dev
```

After this, follow the Xcode steps below.

---

## 1. Open the project in Xcode

`npm run open:ios` opens `ios/App/App.xcworkspace` in Xcode.

**Always open the `.xcworkspace` file, not `.xcodeproj`** — CocoaPods dependencies are only linked in the workspace.

---

## 2. Signing & Capabilities

1. Select the **App** target in the project navigator (left sidebar)
2. Go to **Signing & Capabilities** tab
3. Set **Team** to your Apple Developer account
4. Set **Bundle Identifier** to `com.nexus.app`
5. Enable **Automatically manage signing**

---

## 3. Capabilities to enable

Still in Signing & Capabilities, click **+ Capability** and add:

| Capability | Notes |
|---|---|
| **Push Notifications** | Required for Gmail unread, Pomodoro, connection invites |
| **Background Modes** | Check: Background fetch, Remote notifications |
| **Associated Domains** | Optional — add later if using Universal Links |

---

## 4. Info.plist additions

Xcode → App target → Info tab → add these keys (or edit `ios/App/App/Info.plist` directly):

```xml
<!-- Camera — Shared Photo Frame widget -->
<key>NSCameraUsageDescription</key>
<string>NEXUS uses your camera to take photos for the Shared Photo Frame widget</string>

<!-- Photo library read -->
<key>NSPhotoLibraryUsageDescription</key>
<string>NEXUS accesses your photo library to share photos in the Shared Photo Frame widget</string>

<!-- Photo library save -->
<key>NSPhotoLibraryAddUsageDescription</key>
<string>NEXUS saves photos to your library from the Shared Photo Frame widget</string>

<!-- Microphone — future video features -->
<key>NSMicrophoneUsageDescription</key>
<string>NEXUS may access the microphone for future video features</string>

<!-- Face ID — biometric sign-in -->
<key>NSFaceIDUsageDescription</key>
<string>NEXUS uses Face ID for quick and secure sign-in</string>

<!-- Custom URL scheme — OAuth deep links -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>nexus</string>
    </array>
  </dict>
</array>
```

Capacitor adds `CFBundleURLSchemes` automatically if you configure it — verify it's present.

---

## 5. Minimum iOS version

Xcode → App target → General → Deployment Info → set **iOS 16.0** minimum.

---

## 6. Build and run on your iPhone

1. Plug in your iPhone via USB
2. Select your iPhone as the build target (top bar in Xcode)
3. **Cmd+R** to build and run
4. First run: on your iPhone go to **Settings → General → VPN & Device Management → Developer App → Trust**

---

## 7. Daily development workflow

```bash
# After any frontend code change:
npm run build:ios     # vite build + cap sync
# Then Cmd+R in Xcode to push to device

# For quick iteration with live reload (same WiFi network):
# 1. Uncomment the server.url line in capacitor.config.ts
#    and replace YOUR_LOCAL_IP with your Mac's IP (System Preferences → Network)
# 2. npm run dev  (start Vite dev server)
# 3. Cmd+R in Xcode — the app will load from your dev server with hot reload
```

---

## 8. Supabase redirect URL

Add `nexus://auth/callback` to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.

This enables the Google OAuth PKCE flow to return to the app after sign-in.

---

## 9. Spotify OAuth (when applicable)

Add `nexus://spotify/callback` to your Spotify Developer Dashboard redirect URIs.

On the frontend, calls to Spotify OAuth will detect `isCapacitor()` and open the URL in Safari View Controller, then return via the `nexus://` scheme.

---

## 10. Push Notifications (APNs) setup

### Apple Developer Portal
1. Go to [developer.apple.com](https://developer.apple.com) → Certificates, IDs & Profiles
2. Keys → Create a key with **Apple Push Notifications service (APNs)**
3. Download the `.p8` file — you can only download it once, keep it safe
4. Note the **Key ID** (10 chars) and your **Team ID** (top-right corner of developer portal)

### Xcode
1. App target → Signing & Capabilities → **+ Capability** → Push Notifications (already done in step 3)

### Backend `.env`
```
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_KEY_PATH=./AuthKey_XXXXXXXXXX.p8
APNS_BUNDLE_ID=com.nexus.app
```

### Backend dependency
```bash
cd nexus/backend && npm install node-apn
```

---

## 11. App Icon & Splash Screen

### Prepare assets
Place these two files in `nexus/frontend/resources/`:
- `icon.png` — 1024×1024 px, no transparency (App Store requirement)
- `splash.png` — 2732×2732 px centered on dark background (`#0a0a0f`)

### Generate all sizes
```bash
cd nexus/frontend
npx capacitor-assets generate --ios
npx cap sync ios
```

This generates all required icon and splash screen sizes and copies them into the Xcode project automatically.

---

## 12. TestFlight (internal testing before App Store)

1. In Xcode: **Product → Archive**
2. Xcode Organizer opens → **Distribute App → TestFlight & App Store**
3. Upload to App Store Connect
4. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Your app → TestFlight
5. Add internal testers (up to 100 with just your Apple ID)
6. Testers install TestFlight app, accept invite, install NEXUS

---

## 13. App Store submission checklist

### Required accounts & registrations
- [ ] Apple Developer account ($99/year) at [developer.apple.com](https://developer.apple.com)
- [ ] App created in App Store Connect: `com.nexus.app`
- [ ] Privacy Policy URL live (e.g. `https://nexus.lj-buchmiller.com/privacy`)

### Screenshots required
| Device | Size |
|---|---|
| iPhone 6.7" (14 Pro Max) | Required |
| iPhone 6.5" (11 Pro Max) | Required |
| iPad Pro 12.9" | Required if supporting iPad |

### App Store Connect fields
- [ ] App name: NEXUS
- [ ] Subtitle: AI Command Center
- [ ] Category: Productivity
- [ ] Description (see marketing copy)
- [ ] Keywords (productivity, dashboard, widgets, AI, calendar, gmail)
- [ ] Privacy Policy URL
- [ ] Age Rating: 4+
- [ ] Pricing: Free

---

## Pre-submission iOS Testing Checklist

### Core functionality
- [ ] App launches without white flash on real device
- [ ] Splash screen shows correctly then hides
- [ ] Google OAuth completes via in-app browser (Safari View Controller)
- [ ] Supabase session persists after app restart
- [ ] The Stack card interface loads with saved widgets
- [ ] Layout changes sync with web browser in real time

### The Stack interaction
- [ ] Card tap haptic fires (light impact) on card swap
- [ ] Side card tap haptic fires (selection changed) on touch
- [ ] Card animations smooth at 60fps on iPhone 12+
- [ ] Tapping peeking card jumps to active position correctly
- [ ] Layout editor works for reordering cards
- [ ] No gesture conflicts — vertical scroll inside cards doesn't accidentally swap cards

### Native features
- [ ] Push notification permission prompt appears on first launch after login
- [ ] Test push notification received while app is backgrounded
- [ ] Camera permission prompt appears in Shared Photo widget
- [ ] Camera capture works and photo uploads correctly
- [ ] Safe areas respected — no content behind notch or home indicator
- [ ] Keyboard pushes card content up correctly in search/notes/compose

### Widgets (test each at card size)
- [ ] Calendar — loads events
- [ ] Spotify — controls playback
- [ ] Gmail — loads inbox, scrolling works
- [ ] Pomodoro — timer runs correctly
- [ ] Chess — board renders and moves work
- [ ] Wordle — game plays correctly
- [ ] Weather — loads current conditions
- [ ] Notes — typing and saving works

### Performance
- [ ] App launch to interactive under 3 seconds on iPhone 12+
- [ ] Card swap animation maintains 60fps
- [ ] No memory warnings during normal use
- [ ] App resumes correctly from background
- [ ] No black-screen flash when returning from background

### App Store
- [ ] All required screenshots captured (6.7", 6.5", iPad if applicable)
- [ ] Privacy policy page live
- [ ] All Info.plist permission descriptions added
- [ ] Tested on iOS 16, 17, and 18
- [ ] Tested on both small (iPhone SE) and large (iPhone Pro Max) screens

---

## Common issues

**"Unable to launch" on first run**
→ Trust the developer certificate: Settings → General → VPN & Device Management → Developer App → Trust

**White flash on app launch**
→ Ensure `backgroundColor: '#0a0a0f'` is set in both `capacitor.config.ts` and the `SplashScreen` plugin config

**Google OAuth opens then loops back to sign-in**
→ Verify `nexus://auth/callback` is in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs

**"Not allowed by CORS" API errors**
→ The Capacitor app's `origin` is `capacitor://localhost` — ensure this is in the backend's `allowedOrigins` array in `backend/src/index.ts`

**Push notifications not arriving**
→ Check Xcode Console for APNs registration errors; verify `.p8` key file path and Key ID in `.env`
