/**
 * Platform detection — deliberately does NOT import @capacitor/core.
 *
 * Importing @capacitor/core (and every @capacitor/* plugin) statically caused
 * those packages to register DOM event listeners and run plugin initialization
 * code at module-load time, even in browser builds. That triggered React's
 * "Maximum update depth exceeded" error (#185) and crashed the app on every
 * page load when not running on a native device.
 *
 * Instead we read window.Capacitor directly. The Capacitor runtime injects
 * this object on native platforms before any JS runs; on the web it is absent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cap = (): any =>
  typeof window !== 'undefined' ? (window as any).Capacitor : undefined;

export const isCapacitor   = (): boolean => !!cap()?.isNativePlatform?.();
export const isIOS         = (): boolean => cap()?.getPlatform?.() === 'ios';
export const isAndroid     = (): boolean => cap()?.getPlatform?.() === 'android';
export const isNativeMobile = (): boolean => isIOS() || isAndroid();
