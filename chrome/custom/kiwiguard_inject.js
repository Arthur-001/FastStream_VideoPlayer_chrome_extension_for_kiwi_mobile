(function() {
  const originalOpen = window.open;
  const originalExitFullscreen = document.exitFullscreen;
  const locProto = Location.prototype;
  const originalHrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
  const originalAssign = locProto.assign;
  const originalReplace = locProto.replace;

  function isDifferentOrigin(targetUrl) {
    if (!targetUrl) return false;
    try {
      const target = new URL(targetUrl, window.location.href);
      return target.origin !== window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function getOptions() {
    try {
      const attr = document.documentElement.getAttribute('data-kiwi-guard');
      return attr ? JSON.parse(attr) : { enabled: false, blockRedirects: false };
    } catch (e) {
      return { enabled: false, blockRedirects: false };
    }
  }

  window.open = function(...args) {
    const opts = getOptions();
    if (opts.enabled && opts.blockRedirects) {
      const targetUrl = args[0];
      if (!targetUrl || targetUrl === 'about:blank' || isDifferentOrigin(targetUrl)) {
        console.log('[KiwiGuard] Blocked cross-origin/blank window.open:', targetUrl);
        return null;
      }
    }
    return originalOpen.apply(window, args);
  };

  if (originalHrefDesc && originalHrefDesc.set) {
    Object.defineProperty(locProto, 'href', {
      get: function() {
        return originalHrefDesc.get.call(this);
      },
      set: function(val) {
        const opts = getOptions();
        if (opts.enabled && opts.blockRedirects && isDifferentOrigin(val)) {
          console.log('[KiwiGuard] Blocked cross-origin Location.prototype.href setter:', val);
          return;
        }
        originalHrefDesc.set.call(this, val);
      },
      configurable: true,
    });
  }

  locProto.assign = function(val) {
    const opts = getOptions();
    if (opts.enabled && opts.blockRedirects && isDifferentOrigin(val)) {
      console.log('[KiwiGuard] Blocked cross-origin Location.prototype.assign():', val);
      return;
    }
    return originalAssign.call(this, val);
  };

  locProto.replace = function(val) {
    const opts = getOptions();
    if (opts.enabled && opts.blockRedirects && isDifferentOrigin(val)) {
      console.log('[KiwiGuard] Blocked cross-origin Location.prototype.replace():', val);
      return;
    }
    return originalReplace.call(this, val);
  };

  document.exitFullscreen = function(...args) {
    const opts = getOptions();
    if (opts.enabled && opts.playerActive) {
      console.log('[KiwiGuard] Blocked exitFullscreen while player is active');
      return Promise.resolve();
    }
    return originalExitFullscreen ? originalExitFullscreen.apply(document, args) : Promise.resolve();
  };

  setInterval(() => {
    const opts = getOptions();
    if (opts.enabled && opts.blockRedirects) {
      if (window.onbeforeunload) {
        window.onbeforeunload = null;
      }
    }
  }, 1000);
})();
