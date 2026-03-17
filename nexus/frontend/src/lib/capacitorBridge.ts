/**
 * Unified Capacitor bridge — mirrors the window.electronAPI pattern so the
 * rest of the app calls platform-agnostic helpers without knowing whether it is
 * running in Electron, Capacitor, or the browser.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { PushNotifications } from '@capacitor/push-notifications';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';

const native = (): boolean => Capacitor.isNativePlatform();

// ── Haptics ───────────────────────────────────────────────────────────────────

export const hapticImpact = async (style: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!native()) return;
  await Haptics.impact({
    style:
      style === 'light' ? ImpactStyle.Light
      : style === 'medium' ? ImpactStyle.Medium
      : ImpactStyle.Heavy,
  });
};

export const hapticSelection = async () => {
  if (!native()) return;
  await Haptics.selectionChanged();
};

// ── In-app browser (Safari View Controller on iOS) ────────────────────────────
// Used for all OAuth flows — Google, Spotify — so that 2FA / biometrics work
// and the user is not dropped into an external browser tab.

export const openInAppBrowser = async (url: string) => {
  if (native()) {
    await Browser.open({
      url,
      presentationStyle: 'popover',
      toolbarColor: '#0a0a0f',
    });
  } else {
    window.location.href = url;
  }
};

export const closeInAppBrowser = async () => {
  if (native()) await Browser.close();
};

export const onBrowserFinished = (callback: () => void) => {
  if (!native()) return;
  Browser.addListener('browserFinished', callback);
};

export const onBrowserPageLoaded = (callback: (url: string) => void) => {
  if (!native()) return;
  // browserPageLoaded does not expose the URL directly; use appUrlOpen instead
  Browser.addListener('browserPageLoaded', () => callback(''));
};

// ── Push notifications ────────────────────────────────────────────────────────

export const registerPushNotifications = async (): Promise<string | null> => {
  if (!native()) return null;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return null;

  await PushNotifications.register();

  return new Promise((resolve) => {
    PushNotifications.addListener('registration', (token) => resolve(token.value));
    PushNotifications.addListener('registrationError', () => resolve(null));
  });
};

// ── Network ───────────────────────────────────────────────────────────────────

export const getNetworkStatus = async () => {
  if (!native()) return { connected: navigator.onLine };
  return Network.getStatus();
};

// ── Device info ───────────────────────────────────────────────────────────────

export const getDeviceInfo = async () => {
  if (!native()) return null;
  return Device.getInfo();
};

// ── Splash screen ─────────────────────────────────────────────────────────────

export const hideSplashScreen = async () => {
  if (!native()) return;
  await SplashScreen.hide();
};

// ── Status bar ────────────────────────────────────────────────────────────────

export const setStatusBarDark = async () => {
  if (!native()) return;
  await StatusBar.setStyle({ style: Style.Dark });
};

// ── App lifecycle ─────────────────────────────────────────────────────────────

export const onAppStateChange = (callback: (isActive: boolean) => void) => {
  if (!native()) return;
  App.addListener('appStateChange', ({ isActive }) => callback(isActive));
};

export const onAppUrlOpen = (callback: (url: string) => void) => {
  if (!native()) return;
  App.addListener('appUrlOpen', ({ url }) => callback(url));
};

// ── Keyboard ─────────────────────────────────────────────────────────────────

export const onKeyboardShow = (callback: (height: number) => void) => {
  if (!native()) return;
  Keyboard.addListener('keyboardWillShow', (info) => callback(info.keyboardHeight));
};

export const onKeyboardHide = (callback: () => void) => {
  if (!native()) return;
  Keyboard.addListener('keyboardWillHide', callback);
};
