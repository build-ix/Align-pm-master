/* align-errors.js — Global Error Monitor
 * ─────────────────────────────────────────────────────────────────────────────
 * Must load FIRST, before any application code.
 * Hooks window.onerror and unhandledrejection, reports to /api/errors/report.
 * Deduplicates identical errors within 30 seconds to avoid flooding.
 */
(function() {
  'use strict';
  var reported = {}; // deduplicate identical errors within 30s

  function report(err) {
    var msg = (err && err.message) || String(err);
    var key = msg + '@' + (err && err.filename || '');
    if (reported[key]) return;
    reported[key] = true;
    setTimeout(function() { delete reported[key]; }, 30000);

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/errors/report', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        message: msg,
        url: (err && err.filename) || location.href,
        line: err && err.lineno,
        col: err && err.colno,
        stack: (err && err.error && err.error.stack) || (err && err.stack) || '',
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      }));
      // Also push to ntfy for real-time alerts
      var payload = msg + '\n' + ((err && err.filename) || location.href) + ':' + (err && err.lineno || '');
      fetch('https://ntfy.sh/alfr-hermes-tasks', {
        method: 'POST',
        body: payload,
        headers: { 'Title': 'Align Error', 'Priority': 'high' }
      }).catch(function(){});
    } catch (ignore) {}
  }

  window.onerror = function(msg, url, line, col, error) {
    report({ message: String(msg), filename: url, lineno: line, colno: col, error: error });
    return false; // let default console error also fire
  };

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var msg = reason instanceof Error ? reason.message : String(reason);
    report({ message: 'Unhandled rejection: ' + msg, stack: reason && reason.stack });
  });
})();
