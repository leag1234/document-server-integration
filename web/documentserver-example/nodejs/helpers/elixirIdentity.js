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

// Who is using this browser: the Nextcloud user when the session is connected
// to a Nextcloud server (display name, e-mail, avatar), otherwise a local
// profile (a display name the user picks, "Me" by default, and an initials
// avatar). In developer mode the example's test users can still be chosen.
// The identity is what the editor gets as editorConfig.user, so co-editing
// presence, comments and tracked changes carry the real name.

const crypto = require('crypto');
const config = require('config');
const users = require('./users');

// Friendly names of Nextcloud servers, shown in the start page rail and as the
// root of the folder view ("Murena Workspace" rather than "murena.io"). A host
// matches itself and its subdomains. Other servers are called "Nextcloud".
// elixir.nextcloud.serverNames ({ "<host>": "<name>" }) adds or overrides entries.
const KNOWN_SERVERS = { 'murena.io': 'Murena Workspace' };
const configuredNames = () => {
  try {
    return (config.has('elixir.nextcloud.serverNames') && config.get('elixir.nextcloud.serverNames')) || {};
  } catch (e) { return {}; }
};
const serverName = (host) => {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const names = {};
  Object.entries({ ...KNOWN_SERVERS, ...configuredNames() }).forEach(([k, v]) => { names[k.toLowerCase()] = v; });
  const key = Object.keys(names).filter((k) => h === k || h.endsWith(`.${k}`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? names[key] : 'Nextcloud';
};

// accessible avatar colours (white text, contrast >= 4.5:1)
const COLORS = ['#a4262c', '#ca5010', '#8e562e', '#407855', '#038387', '#0078d4',
  '#4f6bed', '#5c2e91', '#8764b8', '#881798', '#c239b3', '#498205'];

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const colorOf = (id) => COLORS[parseInt(hash(id).slice(0, 8), 16) % COLORS.length];
const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const chars = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]])
    .map((p) => Array.from(p)[0].toUpperCase());
  return chars.join('');
};

const ncUserId = (nc) => `nc-${hash(`${nc.server}\n${nc.userId}`).slice(0, 24)}`;

// the session's identity; creates the local profile id on first use
const identity = (req, t, serverUrl) => {
  const session = req.elixir ? req.elixir.data() : {};
  const nc = session.nc;
  if (nc && nc.appPassword) {
    const id = ncUserId(nc);
    let host = nc.server;
    try { host = new URL(nc.server).host; } catch (e) { /* keep */ }
    return {
      source: 'nextcloud',
      id,
      name: nc.displayName || nc.userId,
      email: nc.email || '',
      login: nc.userId,
      server: nc.server,
      serverHost: host,
      serverName: serverName(host),
      image: nc.avatarId && serverUrl ? `${serverUrl}/elixir/avatar/${nc.avatarId}` : null,
      initials: initialsOf(nc.displayName || nc.userId),
      color: colorOf(id),
      named: true,
    };
  }
  let profile = session.profile;
  if ((!profile || !profile.id) && req.elixir) {
    profile = { id: `local-${crypto.randomBytes(9).toString('base64url')}`, name: '' };
    const created = profile;
    req.elixir.update((data) => {
      if (!data.profile || !data.profile.id) data.profile = created;
    }).catch(() => {});
  }
  profile = profile || { id: 'local', name: '' };
  const name = profile.name || (t ? t('profile.defaultName') : 'Me');
  return {
    source: 'local',
    id: profile.id,
    name,
    email: '',
    image: null,
    initials: initialsOf(name),
    color: colorOf(profile.id),
    named: !!profile.name,
  };
};

const devMode = (req) => !!(req.elixir && req.elixir.data().dev);

// editor user: the identity, with the permissions of the example's default
// user (uid-1: full rights). The example's test users stay available in
// developer mode (account menu) and with an explicit ?userid= (test harness).
const editorUser = (req, t, serverUrl) => {
  const session = req.elixir ? req.elixir.data() : {};
  const testId = req.query.userid || (session.dev && session.devUser) || null;
  if (testId) {
    const u = users.getUser(testId);
    if (u && u.id === testId) return { user: u, test: true };
  }
  const id = identity(req, t, serverUrl);
  const base = users.getUser('uid-1');
  const u = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
    id: id.id,
    name: id.name,
    email: id.email,
    avatar: false,
    image: id.image,
    favorite: null,
    goback: base.goback ? { ...base.goback } : base.goback,
    deniedPermissions: [],
  });
  return { user: u, test: false, identity: id };
};

module.exports = {
  identity,
  editorUser,
  devMode,
  initialsOf,
  colorOf,
  ncUserId,
  serverName,
};
