// align-native-bridge.js — Capacitor native feature bridges
// Loaded by iOS app wrapper. Exposes window.AlignNative for feature detection.
// Gracefully degrades in Safari (web) — all functions fail silently.

(function() {
  'use strict';

  window.AlignNative = {};

  // Check if running inside Capacitor (native) vs Safari (web)
  window.AlignNative.isNative = function() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  };

  // Camera — opens native camera / photo picker
  window.AlignNative.takePhoto = async function() {
    try {
      const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins.Camera;
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt
      });
      return image.dataUrl;
    } catch (e) {
      if (e.message && e.message.includes('cancelled')) return null;
      console.warn('AlignNative: camera failed', e.message);
      return null;
    }
  };

  // Haptic feedback — subtle tap vibration
  window.AlignNative.lightTap = async function() {
    try {
      const { Haptics, ImpactStyle } = window.Capacitor.Plugins.Haptics;
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) { /* silently fail on web */ }
  };

  // Status bar — match app theme
  window.AlignNative.setStatusBar = async function(dark) {
    try {
      const { StatusBar, Style } = window.Capacitor.Plugins.StatusBar;
      if (dark) {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#0a0a12' });
      } else {
        await StatusBar.setStyle({ style: Style.Light });
        await StatusBar.setBackgroundColor({ color: '#ffffff' });
      }
    } catch (e) { /* silently fail on web */ }
  };

  // Splash screen — hide after app loads
  window.AlignNative.hideSplash = async function() {
    try {
      const { SplashScreen } = window.Capacitor.Plugins.SplashScreen;
      await SplashScreen.hide();
    } catch (e) { /* silently fail */ }
  };

  console.log('AlignNative: bridge loaded, isNative=' + window.AlignNative.isNative());
})();
