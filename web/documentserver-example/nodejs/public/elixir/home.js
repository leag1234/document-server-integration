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
// script only switches views, renders the recent list and drives uploads
// through the example's /upload and /convert endpoints.
(function home() {
  'use strict';

  var data = JSON.parse(document.getElementById('home-data').textContent);
  var strings = data.strings;
  var TYPES = ['word', 'cell', 'slide', 'pdf'];
  var VIEWS = ['home', 'new', 'open'].concat(TYPES);

  var $ = function (id) { return document.getElementById(id); };
  var t = function (key, vars) {
    var text = strings[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { text = text.split('{' + k + '}').join(vars[k]); });
    }
    return text;
  };

  var state = {
    view: 'home',
    filter: '',
    query: '',
    files: data.files || [],
    menuFile: null,
  };

  var langParam = '&lang=' + encodeURIComponent(data.lang.editor);
  var editorUrl = function (name) { return 'editor?fileName=' + encodeURIComponent(name) + langParam; };
  var extOf = function (name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };

  // ---------- formatting ----------
  var locale = document.documentElement.lang || 'en';
  var timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  var dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  var fullFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' });
  var numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  var formatTime = function (ms) {
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
    return numFmt.format(bytes / 1024 / 1024) + ' MB';
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

  // ---------- recent list ----------
  var renderFiles = function () {
    var body = $('files-body');
    var type = TYPES.indexOf(state.view) !== -1 ? state.view : state.filter;
    var q = state.query.trim().toLowerCase();
    var list = state.files.filter(function (f) {
      return (!type || f.documentType === type) && (!q || f.name.toLowerCase().indexOf(q) !== -1);
    });
    var frag = document.createDocumentFragment();
    list.forEach(function (f) {
      var tr = document.createElement('tr');
      tr.dataset.name = f.name;

      var tdIcon = document.createElement('td');
      tdIcon.className = 'c-icon';
      var ft = TYPES.indexOf(f.documentType) !== -1 ? f.documentType : 'file';
      tdIcon.appendChild(svgUse(ft === 'file' ? 'file' : ft + '-f', 'ft t-' + ft));
      tr.appendChild(tdIcon);

      var tdName = document.createElement('td');
      tdName.className = 'c-name';
      var a = document.createElement('a');
      a.href = editorUrl(f.name);
      a.target = '_blank';
      a.className = 'file-link';
      var dot = f.name.lastIndexOf('.');
      var base = document.createElement('span');
      base.className = 'file-base';
      base.textContent = dot > 0 ? f.name.slice(0, dot) : f.name;
      var ext = document.createElement('span');
      ext.className = 'file-ext';
      ext.textContent = dot > 0 ? f.name.slice(dot) : '';
      a.appendChild(base);
      a.appendChild(ext);
      tdName.appendChild(a);
      tr.appendChild(tdName);

      var tdMod = document.createElement('td');
      tdMod.className = 'c-mod';
      tdMod.textContent = formatTime(f.time);
      tdMod.title = fullFmt.format(new Date(f.time));
      tr.appendChild(tdMod);

      var tdSize = document.createElement('td');
      tdSize.className = 'c-size';
      tdSize.textContent = formatSize(f.size);
      tr.appendChild(tdSize);

      var tdAct = document.createElement('td');
      tdAct.className = 'c-act';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn row-menu';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-label', t('action.more', { name: f.name }));
      btn.appendChild(svgUse('more', 'ic-sm'));
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);

      frag.appendChild(tr);
    });
    body.replaceChildren(frag);

    var none = state.files.length === 0;
    $('files').hidden = none || list.length === 0;
    $('empty').hidden = !none;
    $('no-match').hidden = none || list.length > 0;
    if (!none && list.length === 0) {
      $('no-match').textContent = q ? t('noMatch', { q: state.query.trim() }) : t('empty.title');
    }
  };

  var refreshFiles = function () {
    return fetch('elixir/api/files', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.files) {
          state.files = res.files;
          renderFiles();
        }
      })
      .catch(function () { /* keep the current list */ });
  };

  // ---------- views ----------
  var setView = function (view) {
    if (VIEWS.indexOf(view) === -1) view = 'home';
    state.view = view;
    var isType = TYPES.indexOf(view) !== -1;

    document.querySelectorAll('.rail-item[data-view]').forEach(function (a) {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    $('start').hidden = view === 'open';
    $('start-title').textContent = data.startTitles[view] || data.startTitles.home;
    document.querySelectorAll('#tiles .tile').forEach(function (tile) {
      var type = tile.dataset.type;
      var show;
      if (isType) show = type === view;
      else if (view === 'home') show = !(tile.dataset.blank && type === 'pdf');
      else show = true;
      tile.hidden = !show;
    });

    $('open-panel').hidden = view !== 'open';
    $('recent').hidden = view === 'new';
    $('chips').hidden = isType;
    $('upload-button').hidden = view === 'open';
    $('recent-title').textContent = isType ? t('recent.recentOf.' + view) : t('recent.title');
    renderFiles();
  };

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
    state.menuFile = null;
  };
  var openMenu = function (button, name) {
    state.menuFile = name;
    state.menuButton = button;
    button.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    var r = button.getBoundingClientRect();
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
    menu.style.top = Math.max(8, top) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    menu.querySelector('button').focus();
  };

  $('files-body').addEventListener('click', function (e) {
    var btn = e.target.closest('.row-menu');
    var tr = e.target.closest('tr');
    if (!tr) return;
    if (btn) {
      e.stopPropagation();
      if (!menu.hidden && state.menuFile === tr.dataset.name) closeMenu();
      else openMenu(btn, tr.dataset.name);
      return;
    }
    if (!e.target.closest('a')) window.open(editorUrl(tr.dataset.name), '_blank');
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
          return refreshFiles();
        })
        .catch(function (err) { toast(t('error.generic', { message: err.message }), { error: true }); });
    };
    dlg.showModal();
  };

  menu.addEventListener('click', function (e) {
    var item = e.target.closest('button[data-action]');
    if (!item) return;
    var name = state.menuFile;
    var button = state.menuButton;
    closeMenu();
    if (!name) return;
    if (item.dataset.action === 'open') window.open(editorUrl(name), '_blank');
    else if (item.dataset.action === 'download') location.href = 'download?fileName=' + encodeURIComponent(name);
    else if (item.dataset.action === 'delete') deleteFile(name);
    if (item.dataset.action !== 'delete' && button) button.focus();
  });
  menu.addEventListener('keydown', function (e) {
    var items = Array.prototype.slice.call(menu.querySelectorAll('button'));
    var i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') {
      var b = state.menuButton;
      closeMenu();
      if (e.key === 'Escape' && b) b.focus();
    }
  });
  document.addEventListener('click', function (e) { if (!menu.contains(e.target)) closeMenu(); });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

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

  var openAfterUpload = function (name) {
    var url = editorUrl(name);
    var win = window.open(url, '_blank');
    if (win) toast(t('upload.done', { name: name }));
    else toast(t('upload.done', { name: name }), { sticky: true, link: { href: url, text: t('action.open') } });
  };

  var upload = function (file) {
    if (busy || !file) return;
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
    toast(t('upload.uploading', { name: file.name }), { busy: true });
    var form = new FormData();
    form.append('uploadedFile', file, file.name);
    fetch('upload', { method: 'POST', body: form })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) throw new Error(res.error);
        var name = res.filename;
        if (data.convertExts.indexOf(ext) === -1) return name;
        toast(t('upload.converting', { name: name }), { busy: true });
        return convert(name);
      })
      .then(function (name) {
        busy = false;
        refreshFiles();
        openAfterUpload(name);
      })
      .catch(function (err) {
        busy = false;
        refreshFiles();
        if (err.password) toast(t('error.password', { name: file.name }), { error: true });
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

  // refresh when coming back from an editor tab
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshFiles();
  });

  onHash();
}());
