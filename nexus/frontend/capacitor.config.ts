import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexus.app',
  appName: 'NEXUS',
  webDir: 'dist',
  server: {
    // Uncomment + set to your Mac's local IP for live-reload dev:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
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
