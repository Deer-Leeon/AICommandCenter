/**
 * Ambient declarations for Capacitor globals.
 * The concrete types come from @capacitor/core — this file fills gaps that
 * TypeScript doesn't infer automatically.
 */

// Extend the Window interface so window.Capacitor is recognised
// (Capacitor injects this at runtime in native contexts).
interface Window {
  Capacitor?: {
    isNativePlatform: () => boolean;
    getPlatform: () => 'ios' | 'android' | 'web';
    isPluginAvailable: (name: string) => boolean;
  };
}
