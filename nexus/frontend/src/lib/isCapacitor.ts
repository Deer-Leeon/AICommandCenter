import { Capacitor } from '@capacitor/core';

export const isCapacitor = (): boolean => Capacitor.isNativePlatform();
export const isIOS = (): boolean => Capacitor.getPlatform() === 'ios';
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';
export const isNativeMobile = (): boolean => isIOS() || isAndroid();
