/*
 * SPDX-FileCopyrightText: 2026 ElixirOffice contributors
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');

// Serve every local editor document and worker with the same browser-enforced
// boundary. This route exposes static assets only, never document-server APIs.
module.exports = function localAssets() {
  const router = express.Router();
  const root = process.env.EO_ROOT;
  if (!root) {
    router.use((req, res) => res.status(503).send('Local editor assets are not configured'));
    return router;
  }
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.sendStatus(405);
    const host = req.get('X-Forwarded-Host') || req.get('host');
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host) || !/^(http|https)$/.test(protocol)) return res.sendStatus(400);
    const origin = protocol + '://' + host;
    const assets = origin + '/example/local-assets/';
    const policy = [
      "default-src 'none'",
      "script-src " + assets + " 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
      "style-src " + assets + " 'unsafe-inline'",
      "img-src " + assets + " blob: data:",
      "font-src " + assets + " blob: data:",
      "connect-src " + assets + " blob: data:",
      "worker-src " + assets + " blob:",
      "frame-src " + assets + " blob:",
      "media-src blob: data:",
      "object-src 'none'", "base-uri 'none'", "form-action 'none'"
    ].join('; ');
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use((req, res, next) => {
    // The packaged DocsAPI inserts its content-version prefix.
    req.url = req.url.replace(/^\/\d+\.\d+\.\d+-[a-f0-9]+(?=\/)/, '');
    next();
  });
  router.get(/^\/web-apps\/apps\/(documenteditor|spreadsheeteditor|presentationeditor)\/main\/index(?:_loader)?\.html$/, (req, res, next) => {
    fs.readFile(path.join(root, req.path), 'utf8', (error, html) => {
      if (error) return next(error);
      // Packaged pages have a deeper SDK path and a server cache worker.
      // Keep local static dependencies inside the CSP namespace and do not
      // register a document-server service worker for a local editor.
      html = html.replace(/(?:\.\.\/)+sdkjs\//g, '/example/local-assets/sdkjs/')
        .replace(/'serviceWorker' in navigator/g, 'false');
      res.type('html').send(html);
    });
  });
  router.get(/^\/sdkjs\/common\/wasm-convert\/runtime\/[a-f0-9-]+st\/x2t\.(js|wasm)$/, (req, res, next) => {
    const accepted = new Map((req.get('Accept-Encoding') || '').split(',').map(value => {
      const parts = value.trim().split(';');
      const quality = parts.slice(1).find(part => part.trim().startsWith('q='));
      return [parts[0], quality ? Number(quality.trim().slice(2)) : 1];
    }));
    res.vary('Accept-Encoding');
    const encoding = ['br', 'gzip'].filter(value => accepted.get(value) > 0 && accepted.get(value) <= 1)
      .sort((a, b) => accepted.get(b) - accepted.get(a))[0];
    if (!encoding) return next();
    const filename = path.join(root, req.path) + (encoding === 'br' ? '.br' : '.gz');
    fs.stat(filename, (error, stat) => {
      if (error || !stat.isFile()) return next();
      res.setHeader('Content-Encoding', encoding);
      res.type(req.path.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
      res.sendFile(filename);
    });
  });
  for (const directory of ['web-apps', 'sdkjs', 'fonts', 'dictionaries']) {
    router.use('/' + directory, express.static(path.join(root, directory), {dotfiles: 'deny'}));
  }
  router.use((req, res) => res.sendStatus(404));
  return router;
};
