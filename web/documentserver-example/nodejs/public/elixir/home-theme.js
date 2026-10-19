/*
 * (c) Copyright ElixirOffice contributors 2026
 * Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0)
 */
(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    window.EOHomeTheme = api;
    api.bind(document.documentElement);
  }
})(function () {
  'use strict';
  var dark = new Set(['theme-dark', 'theme-night', 'theme-contrast-dark']);
  var light = new Set(['theme-white', 'theme-gray', 'theme-classic-light', 'theme-light']);
  var documents = new WeakMap();
  var valid = function (type) { return type === 'dark' || type === 'light'; };

  // The editor's UI preference is separate from its document content theme.
  function resolve(options) {
    options = options || {};
    var live = typeof options.liveId === 'string' && options.liveId;
    var id = live || (typeof options.id === 'string' ? options.id : '');
    var system = options.systemDark ? 'dark' : 'light';
    if (!id || id === 'theme-system') return system;
    if (dark.has(id)) return 'dark';
    if (light.has(id)) return 'light';
    if (live && valid(options.liveType)) return options.liveType;
    var cache = options.cache;
    if (cache && typeof cache === 'object' && !Array.isArray(cache) &&
        cache.id === id && valid(cache.type)) return cache.type;
    return system;
  }

  function bind(element) {
    var doc = element && element.ownerDocument;
    var win = doc && doc.defaultView;
    if (!win) return function () {};
    var state = documents.get(doc);
    if (!state) {
      var targets = new Set();
      var media;
      try { media = win.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { media = null; }
      var update = function () {
        var id, cache, live;
        try {
          id = win.localStorage.getItem('ui-theme-id');
          var raw = win.localStorage.getItem('ui-theme');
          if (raw) cache = JSON.parse(raw);
        } catch (e) { /* Denied storage or invalid cache keeps the OS fallback. */ }
        try { live = win.uitheme; } catch (e) { /* The owner frame may be going away. */ }
        var type = resolve({id: id, cache: cache, systemDark: !!(media && media.matches),
          liveId: live && live.id, liveType: live && live.type});
        targets.forEach(function (target) {
          target.setAttribute('data-eo-theme', type);
          target.style.setProperty('color-scheme', type);
        });
      };
      if (media) {
        if (media.addEventListener) media.addEventListener('change', update);
        else if (media.addListener) media.addListener(update);
      }
      win.addEventListener('storage', function (event) {
        if (event.key === null || event.key === 'ui-theme-id' || event.key === 'ui-theme') update();
      });
      win.addEventListener('focus', update);
      // Embedded Home follows the existing editor's live UI state as well as storage.
      if (win.MutationObserver) {
        var observer = new win.MutationObserver(update);
        var observe = function () {
          if (doc.documentElement) observer.observe(doc.documentElement, {attributes: true, attributeFilter: ['class']});
          if (doc.body) observer.observe(doc.body, {attributes: true, attributeFilter: ['class']});
          update();
        };
        observe();
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', observe, {once: true});
      }
      state = {targets: targets, update: update};
      documents.set(doc, state);
    }
    state.targets.add(element);
    state.update();
    return function () { state.targets.delete(element); };
  }
  return Object.freeze({resolve: resolve, bind: bind});
});
