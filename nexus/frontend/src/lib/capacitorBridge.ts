/**
 * Unified Capacitor bridge — mirrors the window.electronAPI pattern so the
 * rest of the app calls platform-agnostic helpers without knowing whether it is
 * running in Electron, Capacitor, or the browser.
 *
 * IMPORTANT — no static @capacitor/* imports here.
 * Importing Capacitor plugin packages statically caused their web-platform
 * implementations to register DOM event listeners and run initialisation code
 * at module-load time, even in plain browser builds. This triggered React's
 * "Maximum update depth exceeded" crash (#185) on every page load.
 *
 * Instead, every function below guards with native() and lazily imports the
 * required plugin only when running on a real native device. The import()
 * calls produce code-split chunks that are never fetched in the browser build.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const native = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as any).Capacitor?.isNativePlatform?.();

// ── Haptics ───────────────────────────────────────────────────────────────────

export const hapticImpact = async (style: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!native()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  await Haptics.impact({
    style:
      style === 'light'  ? ImpactStyle.Light
      : style === 'medium' ? ImpactStyle.Medium
      : ImpactStyle.Heavy,
  });
};

export const hapticSelection = async () => {
  if (!native()) return;
  const { Haptics } = await import('@capacitor/haptics');
  await Haptics.selectionChanged();
};

// ── In-app browser (Safari View Controller on iOS) ────────────────────────────

export const openInAppBrowser = async (url: string) => {
  if (native()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#0a0a0f' });
  } else {
    window.location.href = url;
  }
};

export const closeInAppBrowser = async () => {
  if (!native()) return;
  const { Browser } = await import('@capacitor/browser');
  await Browser.close();
};

export const onBrowserFinished = (callback: () => void) => {
  if (!native()) return;
  import('@capacitor/browser').then(({ Browser }) =>
    Browser.addListener('browserFinished', callback),
  );
};

export const onBrowserPageLoaded = (callback: (url: string) => void) => {
  if (!native()) return;
  import('@capacitor/browser').then(({ Browser }) =>
    Browser.addListener('browserPageLoaded', () => callback('')),
  );
};

// ── Push notifications ────────────────────────────────────────────────────────

export const registerPushNotifications = async (): Promise<string | null> => {
  if (!native()) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return null;
  await PushNotifications.register();
  return new Promise((resolve) => {
    PushNotifications.addListener('registration',      (token) => resolve(token.value));
    PushNotifications.addListener('registrationError', ()      => resolve(null));
  });
};

// ── Network ───────────────────────────────────────────────────────────────────

export const getNetworkStatus = async () => {
  if (!native()) return { connected: navigator.onLine };
  const { Network } = await import('@capacitor/network');
  return Network.getStatus();
};

// ── Device info ───────────────────────────────────────────────────────────────

export const getDeviceInfo = async () => {
  if (!native()) return null;
  const { Device } = await import('@capacitor/device');
  return Device.getInfo();
};

// ── Splash screen ─────────────────────────────────────────────────────────────

export const hideSplashScreen = async () => {
  if (!native()) return;
  const { SplashScreen } = await import('@capacitor/splash-screen');
  await SplashScreen.hide();
};

// ── Status bar ────────────────────────────────────────────────────────────────

export const setStatusBarDark = async () => {
  if (!native()) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark });
};

// ── App lifecycle ─────────────────────────────────────────────────────────────

export const onAppStateChange = (callback: (isActive: boolean) => void) => {
  if (!native()) return;
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => callback(isActive)),
  );
};

export const onAppUrlOpen = (callback: (url: string) => void) => {
  if (!native()) return;
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appUrlOpen', ({ url }) => callback(url)),
  );
};

// ── Keyboard ─────────────────────────────────────────────────────────────────

export const onKeyboardShow = (callback: (height: number) => void) => {
  if (!native()) return;
  import('@capacitor/keyboard').then(({ Keyboard }) =>
    Keyboard.addListener('keyboardWillShow', (info) => callback(info.keyboardHeight)),
  );
};

export const onKeyboardHide = (callback: () => void) => {
  if (!native()) return;
  import('@capacitor/keyboard').then(({ Keyboard }) =>
    Keyboard.addListener('keyboardWillHide', callback),
  );
};
