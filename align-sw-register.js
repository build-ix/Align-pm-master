// Skip service worker in Capacitor (assets bundled, no offline benefit)
// Service worker is only useful for web version
if ('serviceWorker' in navigator && !window.Capacitor) {
  navigator.serviceWorker.register('/align-sw.js?v=52').catch(function() {
    // Silent fail — app works without SW
  });
}
