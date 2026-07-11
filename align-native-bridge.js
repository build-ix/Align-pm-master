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

  var API_ORIGIN = 'https://alignprojects.net';
  var NATIVE_TOKEN_KEY = 'align-native-token';

  function nativeToken() {
    try {
      return window.localStorage.getItem(NATIVE_TOKEN_KEY) ||
        window.localStorage.getItem('align-token') || '';
    } catch (e) {
      return '';
    }
  }

  // The bundled iOS shell runs at capacitor://localhost. Rewrite only API
  // requests to the public server; local JS, CSS, and images stay bundled.
  if (window.AlignNative.isNative() && typeof window.fetch === 'function') {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isRelativeApi = url.indexOf('/api/') === 0;
      var isPublicApi = url.indexOf(API_ORIGIN + '/api/') === 0;
      if (!isRelativeApi && !isPublicApi) return originalFetch(input, init);

      var options = Object.assign({}, init || {});
      var headers = new Headers(options.headers || {});
      var token = nativeToken();
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + token);
      }
      options.headers = headers;
      options.credentials = 'include';

      var target = isRelativeApi ? API_ORIGIN + url : input;
      var isLegacySignIn = target === API_ORIGIN + '/api/auth/signin';
      var isLegacySignOut = target === API_ORIGIN + '/api/auth/signout';
      if (isLegacySignIn) target = API_ORIGIN + '/api/auth/login';
      if (isLegacySignOut) target = API_ORIGIN + '/api/auth/logout';

      return originalFetch(target, options).then(function(response) {
        if (isLegacySignOut && response.ok) {
          try {
            window.localStorage.removeItem(NATIVE_TOKEN_KEY);
            window.localStorage.removeItem('align-token');
          } catch (e) {}
          return new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (!isLegacySignIn || !response.ok) return response;
        return response.json().then(function(data) {
          if (data && data.token) {
            try {
              window.localStorage.setItem(NATIVE_TOKEN_KEY, data.token);
              window.localStorage.setItem('align-token', data.token);
            } catch (e) {}
          }
          return new Response(JSON.stringify({ user: data.user }), {
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      });
    };
  }

  if (window.AlignNative.isNative() && window.XMLHttpRequest) {
    var xhrProto = window.XMLHttpRequest.prototype;
    var originalOpen = xhrProto.open;
    var originalSend = xhrProto.send;
    var originalSetRequestHeader = xhrProto.setRequestHeader;

    xhrProto.open = function(method, url) {
      var args = Array.prototype.slice.call(arguments);
      this.__alignApiRequest = typeof url === 'string' &&
        (url.indexOf('/api/') === 0 || url.indexOf(API_ORIGIN + '/api/') === 0);
      if (typeof url === 'string' && url.indexOf('/api/') === 0) {
        args[1] = API_ORIGIN + url;
      }
      return originalOpen.apply(this, args);
    };

    xhrProto.setRequestHeader = function(name, value) {
      if (String(name).toLowerCase() === 'authorization') this.__alignHasAuth = true;
      return originalSetRequestHeader.call(this, name, value);
    };

    xhrProto.send = function(body) {
      var token = nativeToken();
      if (this.__alignApiRequest && token && !this.__alignHasAuth) {
        originalSetRequestHeader.call(this, 'Authorization', 'Bearer ' + token);
      }
      return originalSend.call(this, body);
    };
  }

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
