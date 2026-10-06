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

// Server-side browser sessions of the ElixirOffice start page: the user's
// profile (display name), developer mode, the Nextcloud connection (app
// password) and pending notices.
//
// - The browser only holds a random session id (cookie elx_sid, HttpOnly,
//   SameSite=Lax). The server stores data under sha256(id), so the data files
//   alone do not let anyone impersonate the browser.
// - Each session file is encrypted with AES-256-GCM. The key is a random
//   32-byte file created on first use (mode 0600) next to the sessions; the
//   directory is 0700 and every file 0600.
// - Nothing here is ever sent to a third party.

const crypto = require('crypto');
const path = require('path');
const fileSystem = require('fs');
const config = require('config');

const COOKIE = 'elx_sid';
const MAX_AGE = 365 * 24 * 3600; // seconds

const elixirConfig = config.has('elixir') ? config.get('elixir') : {};
const storageFolder = config.get('server.storageFolder');
// data folder: elixir.dataFolder, else a sibling of the example's file storage
const dataDir = path.resolve(elixirConfig.dataFolder || path.join(path.resolve(storageFolder), '..', 'elixir'));
const sessionsDir = path.join(dataDir, 'sessions');
const avatarsDir = path.join(dataDir, 'avatars');

const ensureDir = (dir) => {
  if (!fileSystem.existsSync(dir)) fileSystem.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fileSystem.chmodSync(dir, 0o700); } catch (e) { /* not ours */ }
};

let secretKey = null;
const key = () => {
  if (secretKey) return secretKey;
  ensureDir(dataDir);
  const file = path.join(dataDir, 'secret.key');
  try {
    secretKey = Buffer.from(fileSystem.readFileSync(file, 'utf8').trim(), 'base64');
  } catch (e) {
    secretKey = null;
  }
  if (!secretKey || secretKey.length !== 32) {
    secretKey = crypto.randomBytes(32);
    fileSystem.writeFileSync(file, secretKey.toString('base64'), { mode: 0o600 });
  }
  return secretKey;
};

// derived keys, so the session key is never used for two purposes
const subKey = (purpose) => crypto.createHmac('sha256', key()).update(`elixir:${purpose}`).digest();

const encrypt = (obj) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subKey('sessions'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('EX1'), iv, cipher.getAuthTag(), body]);
};

const decrypt = (buf) => {
  if (buf.slice(0, 3).toString() !== 'EX1') throw new Error('bad session file');
  const iv = buf.slice(3, 15);
  const tag = buf.slice(15, 31);
  const decipher = crypto.createDecipheriv('aes-256-gcm', subKey('sessions'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(buf.slice(31)), decipher.final()]).toString('utf8'));
};

const validHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const sessionFile = (hash) => path.join(sessionsDir, `${hash}.bin`);

const load = (hash) => {
  if (!validHash(hash)) return {};
  try {
    return decrypt(fileSystem.readFileSync(sessionFile(hash)));
  } catch (e) {
    return {};
  }
};

const save = (hash, data) => {
  if (!validHash(hash)) return;
  ensureDir(sessionsDir);
  const file = sessionFile(hash);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fileSystem.writeFileSync(tmp, encrypt(data), { mode: 0o600 });
  fileSystem.renameSync(tmp, file);
};

const remove = (hash) => {
  if (!validHash(hash)) return;
  try { fileSystem.unlinkSync(sessionFile(hash)); } catch (e) { /* already gone */ }
};

// read-modify-write, serialized per session inside this process
const locks = {};
const update = (hash, fn) => {
  const prev = locks[hash] || Promise.resolve();
  const next = prev.then(() => {
    const data = load(hash);
    const res = fn(data);
    return Promise.resolve(res).then((out) => {
      save(hash, data);
      return out;
    });
  });
  locks[hash] = next.catch(() => {});
  return next;
};

const parseCookies = (header) => {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
};

const isHttps = (req) => (req.headers['x-forwarded-proto'] || req.protocol) === 'https';

// Express middleware: req.elixir = { hash, data(), update(fn) }
const middleware = () => (req, res, next) => {
  let sid = parseCookies(req.headers.cookie)[COOKIE];
  if (!sid || !/^[A-Za-z0-9_-]{43}$/.test(sid)) {
    sid = crypto.randomBytes(32).toString('base64url');
    res.append('Set-Cookie', `${COOKIE}=${sid}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
  }
  const hash = crypto.createHash('sha256').update(sid).digest('hex');
  let cache = null;
  req.elixir = {
    hash,
    data: () => {
      if (!cache) cache = load(hash);
      return cache;
    },
    update: (fn) => update(hash, fn).then((out) => { cache = null; return out; }),
    // per-session token for state-changing links (GET /elixir/nc/new, uploads from the editor)
    csrf: () => {
      const data = req.elixir.data();
      if (!data.csrf) {
        data.csrf = crypto.randomBytes(18).toString('base64url');
        const value = data.csrf;
        update(hash, (d) => { if (!d.csrf) d.csrf = value; }).catch(() => {});
      }
      return data.csrf;
    },
  };
  next();
};

// ---- signed tokens (download / callback URLs handed to the document server) ----
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const signToken = (payload, ttlSeconds) => {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const mac = b64(crypto.createHmac('sha256', subKey('tokens')).update(body).digest());
  return `${body}.${mac}`;
};
const readToken = (token) => {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const expected = b64(crypto.createHmac('sha256', subKey('tokens')).update(body).digest());
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (e) {
    return null;
  }
};

// ---- small shared state files (document keys of open Nextcloud files) ----
const stateFile = (name) => path.join(dataDir, `${name}.bin`);
const loadState = (name) => {
  try {
    return decrypt(fileSystem.readFileSync(stateFile(name)));
  } catch (e) {
    return {};
  }
};
const saveState = (name, data) => {
  ensureDir(dataDir);
  const file = stateFile(name);
  const tmp = `${file}.${process.pid}.tmp`;
  fileSystem.writeFileSync(tmp, encrypt(data), { mode: 0o600 });
  fileSystem.renameSync(tmp, file);
};

// ---- avatars (copied from Nextcloud at connection time, served by random id) ----
const avatarPath = (id) => (/^[0-9a-f]{32}$/.test(id || '') ? path.join(avatarsDir, `${id}.img`) : null);
const saveAvatar = (id, buf, type) => {
  ensureDir(avatarsDir);
  fileSystem.writeFileSync(avatarPath(id), Buffer.concat([Buffer.from(`${type}\n`), buf]), { mode: 0o600 });
};
const readAvatar = (id) => {
  const p = avatarPath(id);
  if (!p) return null;
  try {
    const buf = fileSystem.readFileSync(p);
    const nl = buf.indexOf(10);
    return { type: buf.slice(0, nl).toString(), data: buf.slice(nl + 1) };
  } catch (e) {
    return null;
  }
};
const removeAvatar = (id) => {
  const p = avatarPath(id);
  if (p) try { fileSystem.unlinkSync(p); } catch (e) { /* gone */ }
};

module.exports = {
  middleware,
  load,
  save,
  remove,
  update,
  signToken,
  readToken,
  loadState,
  saveState,
  saveAvatar,
  readAvatar,
  removeAvatar,
  dataDir,
  elixirConfig,
};
