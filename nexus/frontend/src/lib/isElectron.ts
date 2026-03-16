/**
 * Returns true when running inside the Electron desktop wrapper.
 * Safe to call server-side (returns false on SSR / during tests).
 */
export function isElectron(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI !== 'undefined' &&
    window.electronAPI.isElectron === true
  );
}

/**
 * The platform string when running in Electron, null otherwise.
 * Useful for mac-specific UI (e.g. hiding custom window controls on macOS).
 */
export function electronPlatform(): NodeJS.Platform | null {
  if (!isElectron()) return null;
  return window.electronAPI!.platform;
}

/** True when running in Electron on macOS. */
export function isElectronMac(): boolean {
  return electronPlatform() === 'darwin';
}
