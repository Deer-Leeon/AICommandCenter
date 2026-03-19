/**
 * Unified platform detection for NEXUS.
 *
 * Usage:
 *   import { isExtension, getExtensionId, getPlatform } from './platform'
 *
 * The existing isElectron.ts and isCapacitor.ts are intentionally kept
 * unchanged — this file is purely additive.
 */

export type Platform = 'web' | 'extension' | 'electron' | 'capacitor'

// ── Extension detection ───────────────────────────────────────────────────────
// The thin loader redirects newtab.html → nexus.lj-buchmiller.com and embeds
// two values in the URL:
//   ?source=extension   — identifies the extension context
//   &extid=<id>         — the chrome.runtime.id of the extension, so the website
//                         can call chrome.runtime.sendMessage(extId, ...) back to
//                         the background service worker (externally_connectable)

let _extensionContext = false;
let _extensionId: string | null = null;

if (typeof window !== 'undefined') {
  if (window.location.search.includes('source=extension')) {
    _extensionContext = true;
    // Extract the extension ID passed by newtab.js so AIInputBar can use
    // chrome.runtime.sendMessage(extensionId, ...) for the search relay.
    const params = new URLSearchParams(window.location.search);
    _extensionId = params.get('extid');
  }

  // Belt-and-suspenders: listen for the postMessage from newtab.js
  // (used by the iframe approach; harmless in the redirect approach)
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'NEXUS_EXTENSION_CONTEXT') {
      _extensionContext = true;
    }
  });
}

/** True when NEXUS is running inside the Chrome extension context. */
export const isExtension = (): boolean => _extensionContext;

/**
 * The Chrome extension ID passed via ?extid= in the redirect URL.
 * Used with chrome.runtime.sendMessage(extId, ...) for the search relay.
 * Returns null when not in extension context or ID was not embedded.
 */
export const getExtensionId = (): string | null => _extensionId;

// ── Electron detection ────────────────────────────────────────────────────────
export const isElectron = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as any).electronAPI !== 'undefined' &&
  (window as any).electronAPI.isElectron === true;

// ── Capacitor detection ───────────────────────────────────────────────────────
// Deliberately does NOT import @capacitor/core (see isCapacitor.ts for why).
export const isCapacitor = (): boolean => {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return !!cap?.isNativePlatform?.();
};

// ── Unified helpers ───────────────────────────────────────────────────────────
export const isWeb = (): boolean =>
  !isExtension() && !isElectron() && !isCapacitor();

export function getPlatform(): Platform {
  if (isElectron()) return 'electron';
  if (isCapacitor()) return 'capacitor';
  if (isExtension()) return 'extension';
  return 'web';
}
