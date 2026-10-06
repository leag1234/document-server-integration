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

// Office-style start page ("home") in front of the example integration.
// It only adds views on top of the example's own plumbing: files are created,
// uploaded, converted, downloaded and deleted through the existing routes
// (/editor, /upload, /convert, /download, DELETE /file). The test harness
// (upstream index page) stays reachable with ?dev=1.
//
// Storage: the user's Nextcloud (elixirNextcloud.js). The example's local
// test storage (per IP address) is only shown in developer mode.

const express = require('express');
const path = require('path');
const fileSystem = require('fs');
const config = require('config');
const DocManager = require('./docManager');
const fileUtility = require('./fileUtility');
const users = require('./users');
const identityLib = require('./elixirIdentity');
const session = require('./elixirSession');

// set by elixirNextcloud (no require cycle): default server, http allowed
const nextcloudDefaults = { defaultServer: 'https://murena.io', allowHttp: false };

const configServer = config.get('server');
const publicDir = path.join(__dirname, '..', 'public');
const elixirDir = path.join(publicDir, 'elixir');
const i18nDir = path.join(elixirDir, 'i18n');
// brand assets (logo, favicon, templates) are not part of this module: they are
// copied into public/elixir/brand/ by the distribution (see docs/home.md there)
const brandDir = path.join(elixirDir, 'brand');
const templatesDir = path.join(brandDir, 'templates');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fileSystem.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};

const readText = (file) => {
  try {
    return fileSystem.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
};

// translations: one flat JSON file per language, English is the reference
const catalogs = {};
const loadCatalogs = () => {
  let files = [];
  try {
    files = fileSystem.readdirSync(i18nDir).filter((f) => f.endsWith('.json'));
  } catch (e) {
    files = [];
  }
  files.forEach((f) => {
    catalogs[f.replace(/\.json$/, '')] = readJson(path.join(i18nDir, f), {});
  });
  if (!catalogs.en) catalogs.en = {};
};
loadCatalogs();

const iconSprite = readText(path.join(elixirDir, 'icons.svg'));

const editorLanguages = Object.keys(configServer.get('languages'));

// match a requested language tag against a list of supported tags
const matchLanguage = (tag, supported) => {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  const exact = supported.find((s) => s.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0];
  return supported.find((s) => s.toLowerCase() === base) || null;
};

// explicit ?lang= wins, then the browser preferences, then English
const resolveLanguage = (req) => {
  const candidates = [];
  if (req.query.lang) candidates.push(String(req.query.lang));
  const accept = req.headers['accept-language'] || '';
  accept.split(',').forEach((part) => {
    const tag = part.split(';')[0].trim();
    if (tag && tag !== '*') candidates.push(tag);
  });
  const uiLanguages = Object.keys(catalogs);
  let ui = null;
  let editor = null;
  candidates.some((c) => {
    ui = ui || matchLanguage(c, uiLanguages);
    editor = editor || matchLanguage(c, editorLanguages);
    return ui && editor;
  });
  return { ui: ui || 'en', editor: editor || 'en' };
};

const translator = (lang) => {
  const catalog = catalogs[lang] || {};
  return (key, vars) => {
    let text = catalog[key] || catalogs.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        text = text.split(`{${k}}`).join(vars[k]);
      });
    }
    return text;
  };
};

// templates manifest (brand asset); entries whose file is missing are skipped
const loadTemplates = () => {
  const manifest = readJson(path.join(templatesDir, 'templates.json'), { templates: [] });
  return (manifest.templates || []).filter((tpl) => tpl.id && tpl.file
    && fileSystem.existsSync(path.join(templatesDir, tpl.file))
    && fileUtility.getFileType(tpl.file));
};

const localized = (value, lang) => {
  if (!value || typeof value === 'string') return value || '';
  return value[lang] || value.en || Object.values(value)[0] || '';
};

const listFiles = (docManager) => docManager.getStoredFiles().map((file) => {
  let size = 0;
  try {
    size = fileSystem.statSync(docManager.storagePath(file.name)).size;
  } catch (e) {
    size = 0;
  }
  return {
    name: file.name,
    time: file.time,
    size,
    documentType: file.documentType,
    canEdit: file.canEdit,
    version: file.version,
  };
}).sort((a, b) => b.time - a.time);

// account menu data (start page and editor title bar)
const accountInfo = (req, t, server) => {
  const id = identityLib.identity(req, t, server);
  const dev = identityLib.devMode(req);
  const devUser = dev ? (req.elixir.data().devUser || null) : null;
  return {
    source: id.source,
    name: id.name,
    named: id.named,
    asked: !!((req.elixir.data().profile || {}).asked),
    login: id.login || '',
    email: id.email || '',
    server: id.server || '',
    serverHost: id.serverHost || '',
    serverName: id.serverName || '',
    image: id.image || '',
    initials: id.initials,
    color: id.color,
    homeUrl: `${server}/`,
    devMode: dev,
    devUser,
    testUsers: dev ? users.getAllUsers().map((u) => ({ id: u.id, name: u.name || t('account.anonymous') })) : [],
  };
};

// Editor configuration for the ElixirOffice backstage (File menu): the start
// page templates of the same document type, the recent files and the host URLs
// used by the Open, Share and title bar pages (editorConfig.elixir).
const editorExtras = (docManager, req, fileName) => {
  const lang = resolveLanguage(req);
  const t = translator(lang.ui);
  const server = docManager.getServerUrl();
  const documentType = fileUtility.getFileType(fileName);
  const userParam = req.query.userid ? `&userid=${encodeURIComponent(req.query.userid)}` : '';
  const editorUrl = (name) => `${server}/editor?fileName=${encodeURIComponent(name)}${userParam}`;
  const templates = loadTemplates().filter((tpl) => fileUtility.getFileType(tpl.file) === documentType)
    .map((tpl) => ({
      title: localized(tpl.title, lang.ui),
      image: tpl.thumb && fileSystem.existsSync(path.join(templatesDir, tpl.thumb))
        ? `${server}/elixir/brand/templates/${encodeURIComponent(tpl.thumb)}` : '',
      url: `${server}/elixir/new?template=${encodeURIComponent(tpl.id)}&lang=${encodeURIComponent(lang.ui)}${userParam}`,
    }));
  const folder = t('storage.name');
  const recent = listFiles(docManager).filter((file) => file.name !== fileName).slice(0, 30)
    .map((file) => ({
      title: file.name,
      url: editorUrl(file.name),
      folder: folder !== 'storage.name' ? folder : configServer.get('appName'),
      modified: new Date(file.time).toISOString(),
      size: file.size,
    }));
  return {
    templates: templates.length ? templates : null,
    recent,
    elixir: {
      account: { ...accountInfo(req, t, server), reloadUrl: `${server}${req.originalUrl}` },
      homeUrl: `${server}/`,
      openUrl: `${server}/#open`,
      uploadUrl: `${server}/upload`,
      editorUrl: editorUrl('{name}').replace(encodeURIComponent('{name}'), '{name}'),
      shareUrl: editorUrl(fileName),
      folder: folder !== 'storage.name' ? folder : configServer.get('appName'),
      uploadExts: fileUtility.getSuppotredExtensions().filter((ext) => fileUtility.getFormatActions(ext).length
        && fileUtility.getConvertExtensions().indexOf(ext) === -1),
    },
  };
};

module.exports = function elixirHome() {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    // the upstream test harness (user switcher, languages, WOPI…) stays available,
    // and turns developer mode on for this browser
    if (req.query.dev === '1' || req.query.dev === 'true') {
      if (req.elixir && !req.elixir.data().dev) {
        req.elixir.update((data) => { data.dev = true; }).then(() => next(), () => next());
        return;
      }
      next();
      return;
    }
    try {
      const docManager = new DocManager(req, res);
      const lang = resolveLanguage(req);
      const t = translator(lang.ui);
      const server = docManager.getServerUrl();
      const account = accountInfo(req, t, server);
      const sessionData = req.elixir.data();
      const templates = loadTemplates().map((tpl) => ({
        id: tpl.id,
        title: localized(tpl.title, lang.ui),
        documentType: fileUtility.getFileType(tpl.file),
        thumb: tpl.thumb && fileSystem.existsSync(path.join(templatesDir, tpl.thumb))
          ? `elixir/brand/templates/${encodeURIComponent(tpl.thumb)}` : '',
      }));
      res.render('home', {
        appName: configServer.get('appName'),
        lang,
        t,
        strings: { ...catalogs.en, ...(catalogs[lang.ui] || {}) },
        iconSprite,
        hasLogo: fileSystem.existsSync(path.join(brandDir, 'logo.svg')),
        hasFavicon: fileSystem.existsSync(path.join(brandDir, 'favicon.svg')),
        account,
        csrf: req.elixir.csrf(),
        nc: {
          connected: account.source === 'nextcloud',
          defaultServer: nextcloudDefaults.defaultServer,
          allowHttp: nextcloudDefaults.allowHttp,
          lastFolder: sessionData.lastFolder || '/',
        },
        devMode: account.devMode,
        templates,
        files: account.devMode ? listFiles(docManager) : [],
        uploadExts: fileUtility.getSuppotredExtensions().filter((ext) => fileUtility.getFormatActions(ext).length),
        convertExts: fileUtility.getConvertExtensions(),
        maxFileSize: configServer.get('maxFileSize'),
        // the editor warm-up (home.js) reads the versioned static path from api.js
        apiUrl: configServer.get('siteUrl') + configServer.get('apiUrl'),
      });
    } catch (ex) {
      console.log(ex);
      res.status(500);
      res.render('error', { message: 'Server error' });
    }
  });

  // recent files, newest first
  router.get('/elixir/api/files', (req, res) => {
    try {
      res.json({ files: listFiles(new DocManager(req, res)) });
    } catch (ex) {
      console.log(ex);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // create a document from a template, then open it like /editor?fileExt= does
  router.get('/elixir/new', (req, res) => {
    try {
      const docManager = new DocManager(req, res);
      const tpl = loadTemplates().find((item) => item.id === req.query.template);
      if (!tpl) {
        res.status(404);
        res.render('error', { message: 'Template not found' });
        return;
      }
      const lang = resolveLanguage(req);
      const ext = fileUtility.getFileExtension(tpl.file);
      const title = localized(tpl.title, lang.ui) || fileUtility.getFileName(tpl.file, true);
      const fileName = docManager.getCorrectName(`${title}${ext}`);
      docManager.copyFile(path.join(templatesDir, tpl.file), docManager.storagePath(fileName));
      const user = users.getUser(req.query.userid);
      docManager.saveFileData(fileName, user.id, user.name);
      res.redirect(`${docManager.getServerUrl()}/editor?mode=edit&fileName=${encodeURIComponent(fileName)}`
        + `${docManager.getCustomParams()}`);
    } catch (ex) {
      console.log(ex);
      res.status(500);
      res.render('error', { message: 'Server error' });
    }
  });

  // ---- identity, developer mode, notices (JSON; state changes need X-Elixir: 1)
  const api = (fn) => (req, res) => {
    res.removeHeader('Access-Control-Allow-Origin');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.get('X-Elixir') !== '1') {
      res.status(403).json({ error: 'csrf' });
      return;
    }
    Promise.resolve(fn(req, res)).catch((ex) => {
      console.log(ex);
      res.status(500).json({ error: 'Server error' });
    });
  };

  router.get('/elixir/api/me', api((req, res) => {
    const t = translator(resolveLanguage(req).ui);
    res.json(accountInfo(req, t, new DocManager(req, res).getServerUrl()));
  }));

  router.post('/elixir/api/profile', api(async (req, res) => {
    const name = String((req.body && req.body.name) || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80);
    await req.elixir.update((data) => {
      data.profile = data.profile || {};
      data.profile.name = name;
      data.profile.asked = true;
    });
    const t = translator(resolveLanguage(req).ui);
    res.json(accountInfo(req, t, new DocManager(req, res).getServerUrl()));
  }));

  router.post('/elixir/api/dev', api(async (req, res) => {
    const on = !!(req.body && req.body.on);
    const userId = req.body && req.body.user;
    await req.elixir.update((data) => {
      data.dev = on;
      if (!on) data.devUser = null;
      else if (userId !== undefined) {
        data.devUser = userId && users.getAllUsers().some((u) => u.id === userId) ? userId : null;
      }
    });
    res.json({ ok: true, devMode: on });
  }));

  router.get('/elixir/api/notices', api(async (req, res) => {
    const notices = req.elixir.data().notices || [];
    if (notices.length) await req.elixir.update((data) => { data.notices = []; });
    res.json({ notices });
  }));

  router.get('/elixir/avatar/:id', (req, res) => {
    const avatar = session.readAvatar(req.params.id);
    if (!avatar) {
      res.sendStatus(404);
      return;
    }
    res.setHeader('Content-Type', avatar.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(avatar.data);
  });

  return router;
};

module.exports.editorExtras = editorExtras;
module.exports.nextcloudDefaults = nextcloudDefaults;
module.exports.accountInfo = accountInfo;
module.exports.resolveLanguage = resolveLanguage;
module.exports.translator = translator;
module.exports.loadTemplates = loadTemplates;
module.exports.templatesDir = templatesDir;
module.exports.localized = localized;
