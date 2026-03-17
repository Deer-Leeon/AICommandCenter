import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ljbuchmiller.nexus',
  appName: 'NEXUS',
  webDir: 'dist',
  server: {
    // Uncomment + set to your Mac's local IP for live-reload dev:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,

    // Restrict in-WebView navigation to NEXUS domains only.
    // All other URLs (OAuth, external links) are intercepted and routed
    // through the @capacitor/browser plugin (SFSafariViewController) instead.
    allowNavigation: [
      'nexus-api.lj-buchmiller.com',
      'nexus.lj-buchmiller.com',
      '*.supabase.co',
    ],
  },
  ios: {
    contentInset: 'always',
    scrollEnabled: false,        // web layer handles all scrolling
    backgroundColor: '#0a0a0f',  // no white flash on launch
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      iosSpinnerStyle: 'small',
      spinnerColor: '#7c6aff',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0a0a0f',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
