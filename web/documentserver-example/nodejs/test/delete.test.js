/* Regression tests for the file removal routes (DELETE /file and DELETE /files).
 * A request without a usable file name once emptied the whole storage: it must now be refused. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-delete-test-'));
const storage = path.join(tmp, 'files');
fs.mkdirSync(storage);
process.env.NODE_CONFIG = JSON.stringify({ server: { storageFolder: storage, appName: 'ElixirOffice' } });
process.chdir(path.join(__dirname, '..'));

const app = require('../app');

let server;
let port;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const userDir = (ip) => path.join(storage, ip);
function seed(ip, names) {
  fs.mkdirSync(userDir(ip), { recursive: true });
  names.forEach((n) => fs.writeFileSync(path.join(userDir(ip), n), 'x'));
}
function del(pathAndQuery, ip) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'DELETE', path: pathAndQuery, headers: { 'x-forwarded-for': ip },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
const list = (ip) => fs.readdirSync(userDir(ip)).sort();

test('deletes only the named file and its history (fileName and filename)', async () => {
  seed('10.0.0.1', ['a.docx', 'b.docx', 'c.docx']);
  fs.mkdirSync(path.join(userDir('10.0.0.1'), 'a.docx-history', '1'), { recursive: true });
  fs.writeFileSync(path.join(userDir('10.0.0.1'), 'a.docx-history', '1', 'prev.docx'), 'x');
  let r = await del('/file?fileName=a.docx', '10.0.0.1');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(list('10.0.0.1'), ['b.docx', 'c.docx']);
  r = await del('/file?filename=b.docx', '10.0.0.1');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(list('10.0.0.1'), ['c.docx']);
});

test('missing, empty or malformed fileName returns 400 and deletes nothing', async () => {
  seed('10.0.0.2', ['a.docx', 'b.docx']);
  const bad = ['/file', '/file?fileName=', '/file?fileName=%20%20', '/file?fileName=a&fileName=b',
    '/file?fileName[x]=1', '/file?FILENAME=a.docx', '/file?name=a.docx'];
  for (const q of bad) {
    // eslint-disable-next-line no-await-in-loop
    const r = await del(q, '10.0.0.2');
    assert.strictEqual(r.status, 400, q);
    assert.deepStrictEqual(list('10.0.0.2'), ['a.docx', 'b.docx'], q);
  }
});

test('names resolving outside the user folder are refused', async () => {
  seed('10.0.0.3', ['a.docx']);
  fs.writeFileSync(path.join(storage, 'outside.docx'), 'x');
  fs.writeFileSync(path.join(userDir('10.0.0.3'), '..', '10.0.0.4.docx'), 'x');
  const bad = ['../outside.docx', '..%2Foutside.docx', '..%5Coutside.docx', '/etc/passwd', '.', '..', '%2e%2e',
    'a.docx%00', '..%2F10.0.0.3', '10.0.0.3', 'x/../a.docx'];
  for (const n of bad) {
    // eslint-disable-next-line no-await-in-loop
    const r = await del(`/file?fileName=${n}`, '10.0.0.3');
    assert.ok([400, 404].includes(r.status), `${n} -> ${r.status}`);
    assert.ok(fs.existsSync(path.join(storage, 'outside.docx')), n);
    assert.deepStrictEqual(list('10.0.0.3'), ['a.docx'], n);
  }
});

test('unknown file returns 404 and folders cannot be deleted through /file', async () => {
  seed('10.0.0.5', ['a.docx']);
  fs.mkdirSync(path.join(userDir('10.0.0.5'), 'dir'));
  assert.strictEqual((await del('/file?fileName=missing.docx', '10.0.0.5')).status, 404);
  assert.strictEqual((await del('/file?fileName=dir', '10.0.0.5')).status, 404);
  assert.deepStrictEqual(list('10.0.0.5'), ['a.docx', 'dir']);
});

test('X-Forwarded-For "." or ".." never makes the storage root or its parent the user folder', async () => {
  seed('10.0.0.6', ['keep.docx']);
  for (const ip of ['.', '..', '...']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await del('/files?confirm=delete-all', ip);
    assert.strictEqual(r.status, 200, ip);
  }
  assert.deepStrictEqual(list('10.0.0.6'), ['keep.docx']);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app.js')));
});

test('delete all needs its own route and an explicit confirmation, and spares other users', async () => {
  seed('10.0.0.7', ['a.docx', 'b.docx']);
  seed('10.0.0.8', ['other.docx']);
  assert.strictEqual((await del('/files', '10.0.0.7')).status, 400);
  assert.strictEqual((await del('/files?confirm=yes', '10.0.0.7')).status, 400);
  assert.deepStrictEqual(list('10.0.0.7'), ['a.docx', 'b.docx']);
  assert.strictEqual((await del('/files?confirm=delete-all', '10.0.0.7')).status, 200);
  assert.deepStrictEqual(list('10.0.0.7'), []);
  assert.deepStrictEqual(list('10.0.0.8'), ['other.docx']);
});
