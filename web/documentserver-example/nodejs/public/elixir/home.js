/**
 *
 * (c) Copyright ElixirOffice contributors 2026
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// Start page behaviour. No framework: the page is server-rendered and this
// script switches views, renders the file lists and drives uploads.
// Storage: this server's own storage (/upload, /convert, /download, DELETE /file)
// always works, with or without a cloud; when connected to Nextcloud / Murena
// (/elixir/nc/*) the user chooses between the two (default: the cloud).
(function home() {
  'use strict';

  var data = JSON.parse(document.getElementById('home-data').textContent);
  var strings = data.strings;
  var TYPES = ['word', 'cell', 'slide', 'pdf'];
  var VIEWS = ['home', 'new', 'open', 'cloud', 'local'].concat(TYPES);
  var connected = !!(data.nc && data.nc.connected);
  var devMode = !!data.devMode;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };

  var $ = function (id) { return document.getElementById(id); };
  var t = function (key, vars) {
    var text = strings[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { text = text.split('{' + k + '}').join(vars[k]); });
    }
    return text;
  };

  var langParam = '&lang=' + encodeURIComponent(data.lang.editor);
  var editorUrl = function (name) { return 'editor?fileName=' + encodeURIComponent(name) + langParam; };
  var ncOpenUrl = function (p) { return 'elixir/nc/open?path=' + encodeURIComponent(p) + langParam; };

  var state = {
    view: 'home',
    filter: '',
    query: '',
    local: (data.files || []).map(function (f) { return localItem(f); }),
    recent: [],
    recentLoaded: false,
    folder: { path: (data.nc && data.nc.lastFolder) || '/', items: [], loaded: false, canCreate: true },
    rows: [],
    menuItem: null,
    target: connected && store.get('elx-target') === 'local' ? 'local' : (connected ? 'nc' : 'local'),
  };
  // where a new or uploaded document goes: the browsed place, else the chosen one
  var targetFor = function () {
    if (!connected) return 'local';
    if (state.view === 'cloud') return 'nc';
    if (state.view === 'local') return 'local';
    return state.target;
  };

  var extOf = function (name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };
  var serverHost = (data.account && data.account.serverHost) || '';
  var serverName = (data.account && data.account.serverName) || serverHost;

  function localItem(f) {
    return { kind: 'file', source: 'local', name: f.name, documentType: f.documentType, time: f.time, size: f.size, url: editorUrl(f.name) };
  }
  function ncItem(f) {
    return {
      kind: f.type === 'dir' ? 'dir' : 'file', source: 'nc', name: f.name, path: f.path, fileid: f.fileid,
      documentType: f.documentType, time: f.time, size: f.size, supported: f.supported,
      url: f.type === 'dir' ? '#cloud' : ncOpenUrl(f.path),
    };
  }

  // JSON API helper: state changes carry X-Elixir (forces a CORS preflight)
  var api = function (url, body) {
    var opts = { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-Elixir'] = '1';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (res) {
        if (!r.ok) {
          var err = new Error(res.error || ('HTTP ' + r.status));
          err.code = res.error;
          err.status = r.status;
          throw err;
        }
        return res;
      });
    });
  };
  var ncError = function (err) {
    if (err instanceof TypeError) return t('error.network');
    var key = 'nc.error.' + (err.code || 'generic');
    return strings[key] ? t(key, { server: serverHost }) : t('error.generic', { message: err.message });
  };

  // ---------- formatting ----------
  var locale = document.documentElement.lang || 'en';
  var timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  var dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  var fullFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' });
  var numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  var formatTime = function (ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var now = new Date();
    if (now - d < 60 * 1000 && now >= d) return t('time.justNow');
    var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= startOfDay) return t('time.today', { time: timeFmt.format(d) });
    if (ms >= startOfDay - 86400000) return t('time.yesterday', { time: timeFmt.format(d) });
    return dateFmt.format(d);
  };
  var formatSize = function (bytes) {
    if (bytes < 1024) return numFmt.format(bytes) + ' B';
    if (bytes < 1024 * 1024) return numFmt.format(bytes / 1024) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return numFmt.format(bytes / 1024 / 1024) + ' MB';
    return numFmt.format(bytes / 1024 / 1024 / 1024) + ' GB';
  };

  var svgUse = function (id, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + id);
    svg.appendChild(use);
    return svg;
  };

  // ---------- which list is shown ----------
  var isType = function (view) { return TYPES.indexOf(view) !== -1; };
  var currentList = function () {
    if (state.view === 'cloud') return state.folder.items;
    if (state.view === 'local' || !connected) return state.local;
    return state.recent.concat(state.local).sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
  };
  var listSource = function () {
    if (state.view === 'local' || !connected) return 'local';
    if (state.view === 'cloud') return 'nc';
    return 'both';
  };

  // ---------- file list ----------
  var renderFiles = function () {
    var body = $('files-body');
    var type = isType(state.view) ? state.view : state.filter;
    var q = state.query.trim().toLowerCase();
    var all = currentList();
    var list = all.filter(function (f) {
      return (!type || f.kind === 'dir' || f.documentType === type) && (!q || f.name.toLowerCase().indexOf(q) !== -1);
    });
    state.rows = list;
    var frag = document.createDocumentFragment();
    list.forEach(function (f, idx) {
      var tr = document.createElement('tr');
      tr.dataset.idx = String(idx);
      if (f.kind === 'file' && f.source === 'nc' && !f.supported) tr.className = 'unsupported';

      var tdIcon = document.createElement('td');
      tdIcon.className = 'c-icon';
      var ft = f.kind === 'dir' ? 'folder' : (TYPES.indexOf(f.documentType) !== -1 ? f.documentType : 'file');
      tdIcon.appendChild(svgUse(ft === 'file' || ft === 'folder' ? ft : ft + '-f', 'ft t-' + ft));
      tr.appendChild(tdIcon);

      var tdName = document.createElement('td');
      tdName.className = 'c-name';
      var a = document.createElement('a');
      a.href = f.url;
      if (f.kind === 'file') a.target = '_blank';
      a.className = 'file-link';
      var dot = f.kind === 'file' ? f.name.lastIndexOf('.') : -1;
      var base = document.createElement('span');
      base.className = 'file-base';
      base.textContent = dot > 0 ? f.name.slice(0, dot) : f.name;
      var ext = document.createElement('span');
      ext.className = 'file-ext';
      ext.textContent = dot > 0 ? f.name.slice(dot) : '';
      a.appendChild(base);
      a.appendChild(ext);
      tdName.appendChild(a);
      if (f.source === 'nc' && state.view !== 'cloud' && f.path) {
        var where = document.createElement('span');
        where.className = 'file-where';
        var parent = f.path.slice(0, f.path.lastIndexOf('/')) || '/';
        where.textContent = parent === '/' ? serverHost : serverHost + parent;
        tdName.appendChild(where);
      } else if (f.source === 'local' && connected && state.view === 'home') {
        var here = document.createElement('span');
        here.className = 'file-where';
        here.textContent = t('loc.where');
        tdName.appendChild(here);
      }
      tr.appendChild(tdName);

      var tdMod = document.createElement('td');
      tdMod.className = 'c-mod';
      tdMod.textContent = formatTime(f.time);
      if (f.time) tdMod.title = fullFmt.format(new Date(f.time));
      tr.appendChild(tdMod);

      var tdSize = document.createElement('td');
      tdSize.className = 'c-size';
      tdSize.textContent = f.kind === 'dir' ? '' : formatSize(f.size);
      tr.appendChild(tdSize);

      var tdAct = document.createElement('td');
      tdAct.className = 'c-act';
      if (f.kind === 'file') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn row-menu';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-label', t('action.more', { name: f.name }));
        btn.appendChild(svgUse('more', 'ic-sm'));
        tdAct.appendChild(btn);
      }
      tr.appendChild(tdAct);

      frag.appendChild(tr);
    });
    body.replaceChildren(frag);

    var src = listSource();
    var loading = (src === 'nc' && !state.folder.loaded) || (src === 'both' && !state.recentLoaded);
    var none = all.length === 0;
    $('files').hidden = none || list.length === 0;
    $('empty').hidden = !none;
    $('no-match').hidden = none || list.length > 0;
    if (none) {
      var title = t('empty.title');
      var bodyText = t('empty.body');
      if (loading) { title = t('nc.loading'); bodyText = ''; }
      else if (state.view === 'cloud') { title = t('nc.empty.folder'); bodyText = t('nc.empty.folderBody'); }
      else if (src === 'both') { title = t('nc.empty.recent'); bodyText = t('nc.empty.recentBody', { server: serverHost }); }
      $('empty').querySelector('.empty-title').textContent = title;
      $('empty').querySelector('.empty-body').textContent = bodyText;
    }
    if (!none && list.length === 0) {
      $('no-match').textContent = q ? t('noMatch', { q: state.query.trim() }) : t('empty.title');
    }
  };

  var refreshLocal = function () {
    return fetch('elixir/api/files', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.files) {
          state.local = res.files.map(localItem);
          renderFiles();
        }
      })
      .catch(function () { /* keep the current list */ });
  };

  var onNcFailure = function (err) {
    if (err.status === 401) { location.reload(); return; } // the app password was revoked: page shows "connect"
    toast(ncError(err), { error: true });
  };

  var refreshRecent = function () {
    if (!connected) return Promise.resolve();
    return api('elixir/nc/recent').then(function (res) {
      state.recent = (res.files || []).map(ncItem);
      state.recentLoaded = true;
      renderFiles();
    }).catch(function (err) {
      state.recentLoaded = true;
      renderFiles();
      onNcFailure(err);
    });
  };

  var loadFolder = function (p) {
    if (!connected) return Promise.resolve();
    state.folder.loaded = false;
    state.folder.path = p;
    state.folder.items = [];
    renderCrumbs();
    renderFiles();
    return api('elixir/nc/list?path=' + encodeURIComponent(p)).then(function (res) {
      if (state.folder.path !== p) return;
      state.folder.items = (res.items || []).map(ncItem);
      state.folder.canCreate = res.canCreate !== false;
      state.folder.loaded = true;
      renderCrumbs();
      renderFiles();
    }).catch(function (err) {
      state.folder.loaded = true;
      renderFiles();
      if (err.status === 404 && p !== '/') { loadFolder('/'); return; }
      onNcFailure(err);
    });
  };

  var refreshFiles = function () {
    if (state.view === 'cloud') return loadFolder(state.folder.path);
    if (state.view === 'local') return refreshLocal();
    return Promise.all([refreshRecent(), refreshLocal()]);
  };

  // ---------- breadcrumbs (Nextcloud folder) ----------
  var renderCrumbs = function () {
    var nav = $('crumbs');
    var frag = document.createDocumentFragment();
    var parts = state.folder.path.split('/').filter(Boolean);
    var add = function (label, p, last) {
      var b = document.createElement(last ? 'span' : 'button');
      b.className = 'crumb';
      b.textContent = label;
      if (last) b.setAttribute('aria-current', 'location');
      else { b.type = 'button'; b.dataset.path = p; }
      frag.appendChild(b);
      if (!last) frag.appendChild(svgUse('chevron', 'crumb-sep'));
    };
    add(serverName || t('nav.cloud'), '/', parts.length === 0);
    parts.forEach(function (part, i) { add(part, '/' + parts.slice(0, i + 1).join('/'), i === parts.length - 1); });
    nav.replaceChildren(frag);
  };
  $('crumbs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-path]');
    if (b) loadFolder(b.dataset.path);
  });

  // ---------- creation targets ----------
  var newUrl = function (ext, template) {
    var folder = state.view === 'cloud' ? state.folder.path : ((data.nc && data.nc.lastFolder) || '/');
    if (state.view === 'cloud') data.nc.lastFolder = folder;
    return 'elixir/nc/new?' + (template ? 'template=' + encodeURIComponent(template) : 'type=' + ext)
      + '&folder=' + encodeURIComponent(folder) + '&csrf=' + encodeURIComponent(data.csrf) + langParam;
  };
  var BLANK = { word: 'docx', cell: 'xlsx', slide: 'pptx', pdf: 'pdf' };
  document.querySelectorAll('#tiles .tile').forEach(function (tile) {
    tile.dataset.localHref = tile.getAttribute('href');
    var m = /template=([^&]+)/.exec(tile.dataset.localHref);
    tile.dataset.template = m ? decodeURIComponent(m[1]) : '';
  });
  // creating never needs a cloud: the tile's own href creates the document on this
  // server; when connected and the cloud is the chosen place, point it at Nextcloud
  var aimTile = function (tile) {
    tile.href = targetFor() === 'nc' ? newUrl(BLANK[tile.dataset.type], tile.dataset.template) : tile.dataset.localHref;
  };
  $('tiles').addEventListener('click', function (e) {
    var tile = e.target.closest('.tile');
    if (tile) aimTile(tile);
  });
  $('tiles').addEventListener('auxclick', function (e) {
    var tile = e.target.closest('.tile');
    if (tile) aimTile(tile);
  });

  // ---------- views ----------
  var setView = function (view) {
    if (VIEWS.indexOf(view) === -1) view = 'home';
    if (view === 'local' && !connected) view = 'home';
    state.view = view;
    var typeView = isType(view);
    var browsing = view === 'cloud' || view === 'local';

    document.querySelectorAll('.rail-item[data-view]').forEach(function (a) {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    $('connect-card').hidden = connected || connectDismissed || browsing || view === 'new' || view === 'open';
    $('loc-pick').hidden = !connected || browsing || view === 'cloud';
    $('start').hidden = view === 'open' || browsing;
    $('start-title').textContent = data.startTitles[view] || data.startTitles.home;
    document.querySelectorAll('#tiles .tile').forEach(function (tile) {
      var type = tile.dataset.type;
      var show;
      if (typeView) show = type === view;
      else if (view === 'home') show = !(tile.dataset.blank && type === 'pdf');
      else show = true;
      tile.hidden = !show;
    });

    $('open-panel').hidden = view !== 'open';
    $('recent').hidden = view === 'new' || (view === 'cloud' && !connected);
    $('chips').hidden = typeView || view === 'cloud';
    $('crumbs').hidden = view !== 'cloud';
    $('recent-title').hidden = view === 'cloud';
    $('new-button').hidden = view !== 'cloud';
    $('upload-button').hidden = view === 'open';
    if (view === 'local') $('recent-title').textContent = t('local.title');
    else $('recent-title').textContent = typeView ? t('recent.recentOf.' + view) : t('recent.title');
    if (view === 'cloud') {
      if (!connected) openConnect();
      else if (!state.folder.loaded) loadFolder(state.folder.path);
      else renderCrumbs();
    }
    renderFiles();
  };

  // ---------- creation place (connected only) ----------
  var connectDismissed = store.get('elx-connect-dismissed') === '1';
  $('connect-dismiss').addEventListener('click', function () {
    connectDismissed = true;
    store.set('elx-connect-dismissed', '1');
    $('connect-card').hidden = true;
  });
  var syncTarget = function () {
    document.querySelectorAll('#loc-pick .loc-opt').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.loc === state.target));
    });
  };
  $('loc-pick').addEventListener('click', function (e) {
    var b = e.target.closest('.loc-opt');
    if (!b) return;
    state.target = b.dataset.loc;
    store.set('elx-target', state.target);
    syncTarget();
  });
  syncTarget();

  var onHash = function () { setView((location.hash || '#home').slice(1)); };
  window.addEventListener('hashchange', onHash);

  $('chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    document.querySelectorAll('#chips .chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(c === chip));
    });
    renderFiles();
  });

  var search = $('search');
  search.addEventListener('input', function () {
    state.query = search.value;
    if (state.view === 'new') location.hash = '#home';
    else renderFiles();
  });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { search.value = ''; state.query = ''; renderFiles(); }
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      search.focus();
    }
  });

  // ---------- toast ----------
  var toastTimer = null;
  var toast = function (text, opts) {
    opts = opts || {};
    clearTimeout(toastTimer);
    var el = $('toast');
    el.classList.toggle('busy', !!opts.busy);
    el.classList.toggle('error', !!opts.error);
    $('toast-text').textContent = text;
    var link = $('toast-link');
    link.hidden = !opts.link;
    if (opts.link) {
      link.href = opts.link.href;
      link.textContent = opts.link.text;
    }
    el.hidden = false;
    if (!opts.busy && !opts.sticky) toastTimer = setTimeout(function () { el.hidden = true; }, opts.error ? 8000 : 4000);
  };
  $('toast-close').addEventListener('click', function () { $('toast').hidden = true; });

  // ---------- row actions ----------
  var menu = $('menu');
  var closeMenu = function () {
    if (menu.hidden) return;
    menu.hidden = true;
    if (state.menuButton) state.menuButton.setAttribute('aria-expanded', 'false');
    state.menuItem = null;
  };
  var placeMenu = function (m, anchor) {
    m.hidden = false;
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth;
    var mh = m.offsetHeight;
    var top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
    m.style.top = Math.max(8, top) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    var first = m.querySelector('button:not([hidden])');
    if (first) first.focus();
  };
  var openMenu = function (button, item) {
    state.menuItem = item;
    state.menuButton = button;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('[data-nc]').forEach(function (el) { el.hidden = item.source !== 'nc'; });
    menu.querySelectorAll('[data-local]').forEach(function (el) { el.hidden = item.source !== 'local'; });
    placeMenu(menu, button);
  };

  var openItem = function (item) {
    if (item.kind === 'dir') {
      if (state.view !== 'cloud') location.hash = '#cloud';
      loadFolder(item.path);
      return;
    }
    window.open(item.url, '_blank');
  };

  $('files-body').addEventListener('click', function (e) {
    var btn = e.target.closest('.row-menu');
    var tr = e.target.closest('tr');
    if (!tr) return;
    var item = state.rows[Number(tr.dataset.idx)];
    if (!item) return;
    if (btn) {
      e.stopPropagation();
      if (!menu.hidden && state.menuItem === item) closeMenu();
      else openMenu(btn, item);
      return;
    }
    var link = e.target.closest('a');
    if (item.kind === 'dir') { e.preventDefault(); openItem(item); return; }
    if (!link) openItem(item);
  });

  var deleteFile = function (name) {
    $('confirm-body').textContent = t('delete.body', { name: name });
    var dlg = $('confirm');
    dlg.returnValue = '';
    dlg.onclose = function () {
      if (dlg.returnValue !== 'ok') return;
      fetch('file?filename=' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.success) throw new Error('delete failed');
          toast(t('delete.done', { name: name }));
          return refreshLocal();
        })
        .catch(function (err) { toast(t('error.generic', { message: err.message }), { error: true }); });
    };
    dlg.showModal();
  };

  menu.addEventListener('click', function (e) {
    var el = e.target.closest('button[data-action]');
    if (!el) return;
    var item = state.menuItem;
    var button = state.menuButton;
    closeMenu();
    if (!item) return;
    var action = el.dataset.action;
    if (action === 'open') openItem(item);
    else if (action === 'download') {
      location.href = item.source === 'nc' ? 'elixir/nc/file?path=' + encodeURIComponent(item.path) : 'download?fileName=' + encodeURIComponent(item.name);
    } else if (action === 'location') {
      location.hash = '#cloud';
      loadFolder(item.path.slice(0, item.path.lastIndexOf('/')) || '/');
    } else if (action === 'web') {
      window.open(data.account.server + '/index.php/f/' + encodeURIComponent(item.fileid), '_blank', 'noopener');
    } else if (action === 'delete') deleteFile(item.name);
    if (action !== 'delete' && action !== 'location' && button) button.focus();
  });
  var menuKeys = function (m, close) {
    m.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(m.querySelectorAll('button:not([hidden])'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape' || e.key === 'Tab') close(e.key === 'Escape');
    });
  };
  menuKeys(menu, function (focus) {
    var b = state.menuButton;
    closeMenu();
    if (focus && b) b.focus();
  });

  // "New" in a Nextcloud folder
  var newMenu = $('new-menu');
  var closeNewMenu = function () { newMenu.hidden = true; $('new-button').setAttribute('aria-expanded', 'false'); };
  $('new-button').addEventListener('click', function (e) {
    e.stopPropagation();
    if (!newMenu.hidden) { closeNewMenu(); return; }
    $('new-button').setAttribute('aria-expanded', 'true');
    placeMenu(newMenu, $('new-button'));
  });
  newMenu.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-new]');
    if (!b) return;
    closeNewMenu();
    window.open(newUrl(b.dataset.new), '_blank');
    setTimeout(function () { loadFolder(state.folder.path); }, 2500);
  });
  menuKeys(newMenu, function (focus) { closeNewMenu(); if (focus) $('new-button').focus(); });

  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) closeMenu();
    if (!newMenu.contains(e.target)) closeNewMenu();
  });
  window.addEventListener('resize', function () { closeMenu(); closeNewMenu(); });
  window.addEventListener('scroll', function () { closeMenu(); closeNewMenu(); }, true);

  // ---------- upload ----------
  var busy = false;
  var postForm = function (url, fields) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }).then(function (r) { return r.json(); });
  };

  var convert = function (name) {
    return postForm('convert', { filename: name, lang: data.lang.editor }).then(function (res) {
      if (res.error) {
        var err = new Error(res.error);
        err.password = String(res.error).indexOf('Incorrect password') !== -1;
        throw err;
      }
      if (res.step !== undefined && res.step < 100) {
        return new Promise(function (resolve) { setTimeout(resolve, 1000); })
          .then(function () { return convert(name); });
      }
      return res.filename || name;
    });
  };

  var openAfterUpload = function (name, url) {
    var win = window.open(url, '_blank');
    if (win) toast(t('upload.done', { name: name }));
    else toast(t('upload.done', { name: name }), { sticky: true, link: { href: url, text: t('action.open') } });
  };

  var uploadLocal = function (file, ext) {
    var form = new FormData();
    form.append('uploadedFile', file, file.name);
    return fetch('upload', { method: 'POST', body: form })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) throw new Error(res.error);
        var name = res.filename;
        if (data.convertExts.indexOf(ext) === -1) return name;
        toast(t('upload.converting', { name: name }), { busy: true });
        return convert(name);
      })
      .then(function (name) {
        refreshLocal();
        openAfterUpload(name, editorUrl(name));
      });
  };

  var uploadNc = function (file) {
    var folder = state.view === 'cloud' ? state.folder.path : ((data.nc && data.nc.lastFolder) || '/');
    var form = new FormData();
    form.append('folder', folder);
    form.append('uploadedFile', file, file.name);
    return fetch('elixir/nc/upload', { method: 'POST', body: form, headers: { 'X-Elixir': '1' }, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (res) {
          if (!r.ok) { var err = new Error(res.error || r.status); err.code = res.error; err.status = r.status; throw err; }
          return res;
        });
      })
      .then(function (res) {
        refreshFiles();
        openAfterUpload(res.name, ncOpenUrl(res.path));
      });
  };

  var upload = function (file) {
    if (busy || !file) return;
    var target = targetFor();
    var ext = extOf(file.name);
    if (data.uploadExts.indexOf(ext) === -1) {
      toast(t('error.unsupported', { name: file.name }), { error: true });
      return;
    }
    if (file.size <= 0 || file.size > data.maxFileSize) {
      toast(t('error.tooLarge', { name: file.name }), { error: true });
      return;
    }
    busy = true;
    toast(target === 'nc' ? t('nc.uploading', { name: file.name, server: serverHost }) : t('upload.uploading', { name: file.name }), { busy: true });
    (target === 'nc' ? uploadNc(file) : uploadLocal(file, ext))
      .then(function () { busy = false; })
      .catch(function (err) {
        busy = false;
        refreshFiles();
        if (err.password) toast(t('error.password', { name: file.name }), { error: true });
        else if (target === 'nc') toast(ncError(err), { error: true });
        else if (err instanceof TypeError) toast(t('error.network'), { error: true });
        else toast(t('error.generic', { message: err.message }), { error: true });
      });
  };

  var input = $('file-input');
  input.addEventListener('change', function () {
    upload(input.files[0]);
    input.value = '';
  });

  // drag and drop anywhere on the page
  var overlay = $('drop-overlay');
  var dragDepth = 0;
  var hasFiles = function (e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
  };
  document.addEventListener('dragenter', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    overlay.hidden = false;
  });
  document.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', function (e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
  });

  // ---------- notices (saves that ended in a conflict copy, failed saves) ----------
  var showNotices = function () {
    if (!connected) return;
    api('elixir/api/notices').then(function (res) {
      var n = (res.notices || [])[0];
      if (!n) return;
      if (n.type === 'conflict') {
        toast(t('nc.notice.conflict', { name: n.name, copy: n.copy }), { sticky: true, error: true, link: { href: ncOpenUrl(n.path), text: t('action.open') } });
      } else if (n.type === 'saveFailed') {
        toast(t('nc.notice.saveFailed', { name: n.name, server: serverHost }), { sticky: true, error: true });
      }
    }).catch(function () {});
  };

  // refresh when coming back from an editor tab
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { refreshFiles(); showNotices(); }
  });

  // ---------- account panel ----------
  var panel = $('account-panel');
  var accBtn = $('account-btn');
  var closePanel = function (focus) {
    if (panel.hidden) return;
    panel.hidden = true;
    accBtn.setAttribute('aria-expanded', 'false');
    if (focus) accBtn.focus();
  };
  accBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!panel.hidden) { closePanel(); return; }
    panel.hidden = false;
    accBtn.setAttribute('aria-expanded', 'true');
    var first = panel.querySelector('.acct-item');
    if (first) first.focus();
  });
  document.addEventListener('click', function (e) { if (!panel.contains(e.target) && e.target !== accBtn) closePanel(); });
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(true); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var items = Array.prototype.slice.call(panel.querySelectorAll('.acct-item'));
      var i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  var on = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); };
  on('acct-rename', function () { closePanel(); openProfile(); });
  on('acct-disconnect', function () {
    closePanel();
    toast(t('nc.disconnecting', { server: serverHost }), { busy: true });
    api('elixir/nc/disconnect', {}).then(function (res) {
      try { sessionStorage.setItem('elx-notice', res.revoked ? 'disconnected' : 'disconnectedLocal'); } catch (e) { /* ignore */ }
      location.reload();
    }).catch(function (err) { toast(ncError(err), { error: true }); });
  });
  on('acct-dev', function () {
    api('elixir/api/dev', { on: !devMode }).then(function () { location.reload(); })
      .catch(function (err) { toast(t('error.generic', { message: err.message }), { error: true }); });
  });
  panel.querySelectorAll('[data-test-user]').forEach(function (b) {
    b.addEventListener('click', function () {
      api('elixir/api/dev', { on: true, user: b.dataset.testUser || null }).then(function () { location.reload(); });
    });
  });
  document.querySelectorAll('[data-connect]').forEach(function (b) {
    b.addEventListener('click', function () { closePanel(); openConnect(); });
  });

  // ---------- profile (local identity) ----------
  var profileDlg = $('profile-dialog');
  var openProfile = function () {
    profileDlg.returnValue = '';
    profileDlg.showModal();
    $('profile-name').select();
  };
  profileDlg.addEventListener('close', function () {
    var v = profileDlg.returnValue;
    if (v !== 'ok' && v !== 'skip') return;
    var name = v === 'ok' ? $('profile-name').value.trim() : '';
    if (v === 'skip' && data.account.named) return;
    api('elixir/api/profile', { name: name }).then(function () { location.reload(); })
      .catch(function (err) { toast(t('error.generic', { message: err.message }), { error: true }); });
  });

  // ---------- connect (Nextcloud Login Flow v2) ----------
  var connectDlg = $('connect-dialog');
  var pollTimer = null;
  var loginWin = null;
  var stopPolling = function () { clearTimeout(pollTimer); pollTimer = null; };
  var showStep = function (step) {
    $('connect-step-server').hidden = step !== 'server';
    $('connect-step-wait').hidden = step !== 'wait';
  };
  var openConnect = function () {
    if (connected) return;
    stopPolling();
    showStep('server');
    $('connect-error').hidden = true;
    if (!connectDlg.open) connectDlg.showModal();
    $('connect-server').focus();
    $('connect-server').select();
  };
  connectDlg.addEventListener('close', function () {
    stopPolling();
    if (loginWin && !loginWin.closed) loginWin.close();
  });
  connectDlg.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { connectDlg.close(); });
  });
  var poll = function () {
    api('elixir/nc/connect/poll', {}).then(function (res) {
      if (res.status === 'connected') {
        stopPolling();
        if (loginWin && !loginWin.closed) loginWin.close();
        try { sessionStorage.setItem('elx-notice', 'connected'); } catch (e) { /* ignore */ }
        location.hash = '#home';
        location.reload();
      } else if (res.status === 'expired') {
        stopPolling();
        showStep('server');
        $('connect-error').textContent = t('nc.error.expired');
        $('connect-error').hidden = false;
      } else {
        pollTimer = setTimeout(poll, 2000);
      }
    }).catch(function (err) {
      if (err instanceof TypeError || err.status >= 500 || err.code === 'network' || err.code === 'timeout') { pollTimer = setTimeout(poll, 4000); return; }
      stopPolling();
      showStep('server');
      $('connect-error').textContent = ncError(err);
      $('connect-error').hidden = false;
    });
  };
  $('connect-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var server = $('connect-server').value.trim();
    if (!server) { $('connect-server').focus(); return; }
    // the sign-in window is opened now, in the click, so popup blockers let it through
    loginWin = window.open('', 'elx-nc-login', 'width=640,height=760');
    if (loginWin) { try { loginWin.document.title = t('nc.dialog.title'); } catch (x) { /* cross-origin later */ } }
    $('connect-submit').disabled = true;
    $('connect-error').hidden = true;
    api('elixir/nc/connect', { server: server }).then(function (res) {
      $('connect-submit').disabled = false;
      var host = res.server;
      try { host = new URL(res.server).host; } catch (x) { /* keep */ }
      $('connect-wait-text').textContent = t('nc.dialog.wait', { server: host });
      $('connect-reopen').href = res.login;
      if (loginWin && !loginWin.closed) loginWin.location.href = res.login;
      else loginWin = window.open(res.login, 'elx-nc-login', 'width=640,height=760');
      showStep('wait');
      pollTimer = setTimeout(poll, 2000);
    }).catch(function (err) {
      $('connect-submit').disabled = false;
      if (loginWin && !loginWin.closed) loginWin.close();
      $('connect-error').textContent = ncError(err);
      $('connect-error').hidden = false;
    });
  });
  $('connect-reopen').addEventListener('click', function (e) {
    e.preventDefault();
    loginWin = window.open($('connect-reopen').href, 'elx-nc-login', 'width=640,height=760');
  });

  // messages carried over a reload
  try {
    var carried = sessionStorage.getItem('elx-notice');
    if (carried) {
      sessionStorage.removeItem('elx-notice');
      if (carried === 'connected') toast(t('nc.connected', { name: data.account.name, server: serverHost }));
      else if (carried === 'disconnected') toast(t('nc.disconnected'));
      else if (carried === 'disconnectedLocal') toast(t('nc.disconnectedLocal'), { error: true, sticky: true });
    }
  } catch (e) { /* storage blocked */ }

  // ---------- editor warm-up ----------
  // Files open in a new tab whose editor downloads ~6 MB of compressed code and fonts before
  // the document shows. Fetch them into the HTTP cache while the user is on this page (when
  // idle, or at once when a Word file or tile is pointed at): the editor then starts warm.
  // Static files are served under a versioned path (/<version>-<hash>/...) with immutable
  // caching; api.js, which is never cached, carries that path.
  var WARM = {
    word: [
      'web-apps/vendor/requirejs/require.js',
      'web-apps/apps/documenteditor/main/app.js',
      'web-apps/apps/documenteditor/main/app.css',
      'web-apps/vendor/jquery/jquery.min.js',
      'web-apps/vendor/xregexp/xregexp-all-min.js',
      'web-apps/vendor/socketio/socket.io.min.js',
      'sdkjs/common/AllFonts.js',
      'sdkjs/word/sdk-all-min.js',
      'sdkjs/word/sdk-all.js',
      'sdkjs/common/libfont/engine/fonts.js',
      'sdkjs/common/libfont/engine/fonts.wasm',
      'sdkjs/common/Charts/ChartStyles.js',
      'sdkjs/common/Images/cursors/svg.json',
      'sdkjs/common/Images/fonts_thumbnail.png.bin',
      'web-apps/apps/documenteditor/main/locale/' + (data.lang.editor || 'en') + '.json',
      'web-apps/apps/documenteditor/main/code.js',
    ],
  };
  // fonts the Word editor always loads (its defaults and their metric-compatible substitutes)
  var WARM_FONTS = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'OpenSymbol', 'Open Sans', 'Carlito', 'Caladea'];
  var warmed = {};
  var warmRoot = null; // Promise of "<site root>/<version>-<hash>/"

  var prefetch = function (url) {
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  };
  var versionRoot = function () {
    if (!warmRoot) {
      warmRoot = fetch(data.apiUrl, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (src) {
          var ver = /const ver = '(\/[^'{]+)'/.exec(src);
          if (!ver) throw new Error('no version in api.js');
          return data.apiUrl.replace(/web-apps\/apps\/api\/documents\/api\.js.*$/, '').replace(/\/$/, '') + ver[1] + '/';
        });
      warmRoot.catch(function () { warmRoot = null; });
    }
    return warmRoot;
  };
  var warmFonts = function (root) {
    return fetch(root + 'sdkjs/common/AllFonts.js').then(function (r) { return r.text(); }).then(function (src) {
      var files = /__fonts_files"\]\s*=\s*(\[[^\]]*\])/.exec(src);
      var infos = /__fonts_infos"\]\s*=\s*(\[[\s\S]*?\]\s*\]);/.exec(src);
      if (!files || !infos) return;
      files = JSON.parse(files[1]);
      JSON.parse(infos[1]).forEach(function (info) {
        if (WARM_FONTS.indexOf(info[0]) < 0) return;
        [info[1], info[3], info[5], info[7]].forEach(function (i) { if (i >= 0 && files[i]) prefetch(root + 'fonts/' + files[i]); });
      });
    });
  };
  var warmUp = function (type) {
    if (warmed[type] || !WARM[type] || !data.apiUrl || !window.fetch) return;
    var c = navigator.connection;
    if (c && (c.saveData || /2g|3g/.test(c.effectiveType || ''))) return;
    warmed[type] = true;
    versionRoot().then(function (root) {
      WARM[type].forEach(function (p) { prefetch(root + p); });
      return warmFonts(root);
    }).catch(function () { warmed[type] = false; });
  };
  var typeOfTarget = function (el) {
    if (!el || !el.closest) return null;
    var tr = el.closest('#files-body tr');
    if (tr && tr.dataset.idx) {
      var item = state.rows[Number(tr.dataset.idx)];
      return item && item.kind === 'file' ? item.documentType : null;
    }
    var tile = el.closest('.tile');
    return tile ? tile.dataset.type : null;
  };
  ['pointerover', 'focusin', 'pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var type = typeOfTarget(e.target);
      if (type) warmUp(type);
    }, { passive: true });
  });
  window.addEventListener('load', function () {
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
    setTimeout(function () { idle(function () { warmUp('word'); }, { timeout: 4000 }); }, 1000);
  });

  // account actions asked from an editor tab (title bar account menu)
  var action = (location.hash || '').slice(1);
  if (action === 'connect' || action === 'profile' || action === 'account') {
    history.replaceState(null, '', location.pathname + location.search + '#home');
    setTimeout(function () {
      if (action === 'connect') openConnect();
      else if (action === 'profile') openProfile();
      else accBtn.click();
    }, 0);
    data.askName = false;
  }
  onHash();
  if (connected) { refreshRecent(); showNotices(); }
  if (data.askName && !location.hash.match(/cloud/)) openProfile();
  // Install as an app: the installed window has no tabs, so Office keys such as Ctrl+Tab, Ctrl+PageDown and Ctrl+T reach the editor
  (function () {
    var btn = document.getElementById('install-app'), deferred = null;
    if (!btn) return;
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; btn.hidden = false; });
    window.addEventListener('appinstalled', function () { deferred = null; btn.hidden = true; });
    btn.addEventListener('click', function () { if (deferred) { var p = deferred; deferred = null; btn.hidden = true; p.prompt(); } });
  }());
}());
