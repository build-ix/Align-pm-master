// Force clear any stale service workers (one-time cleanup)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    registrations.forEach(function(reg) { reg.unregister(); });
  }).then(function() {
    // Re-register fresh after clearing
    if ('serviceWorker' in navigator) {
      var newWorker = null;
      navigator.serviceWorker.register('/align-sw.js?v=10').then(function(reg) {
        reg.addEventListener('updatefound', function() {
          newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              document.getElementById('sw-update-bar').style.display = 'block';
            }
          });
        });
      });
      document.getElementById('sw-update-btn').addEventListener('click', function() {
        if (newWorker) { newWorker.postMessage({ action: 'skipWaiting' }); }
        window.location.reload();
      });
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        window.location.reload();
      });
    }
  });
}
