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

const express = require('express');
const path = require('path');
const fileSystem = require('fs');
const config = require('config');
const DocManager = require('./docManager');
const fileUtility = require('./fileUtility');
const users = require('./users');

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

module.exports = function elixirHome() {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    // the upstream test harness (user switcher, languages, WOPI…) stays available
    if (req.query.dev === '1' || req.query.dev === 'true') {
      next();
      return;
    }
    try {
      const docManager = new DocManager(req, res);
      const lang = resolveLanguage(req);
      const t = translator(lang.ui);
      const user = users.getUser(req.query.userid);
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
        user: { id: user.id, name: user.name || '' },
        templates,
        files: listFiles(docManager),
        uploadExts: fileUtility.getSuppotredExtensions().filter((ext) => fileUtility.getFormatActions(ext).length),
        convertExts: fileUtility.getConvertExtensions(),
        maxFileSize: configServer.get('maxFileSize'),
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

  return router;
};
