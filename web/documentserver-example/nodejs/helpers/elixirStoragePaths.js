/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function error(status, message) { return Object.assign(new Error(message), {status}); }
function name(value) {
  if (typeof value !== 'string') throw error(400, 'Choose a valid file name without a folder path');
  value = value.normalize('NFC');
  const stem = value.split('.')[0].replace(/ +$/, '');
  if (!value.trim() || value !== value.trim() || value.length > 200 || Buffer.byteLength(value,'utf8') > 255
      || /[\x00-\x1f\x7f\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/.test(value) || value === '.' || value === '..'
      || /[. ]$/.test(value) || value.endsWith('-history') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))
    throw error(400, 'Choose a valid file name without a folder path');
  return value;
}
// Existing files/folders remain addressable; new names use the stricter portable policy.
function existingName(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200
      || /[\x00-\x1f\x7f\\/:*?"<>|]/.test(value) || value === '.' || value === '..'
      || /[. ]$/.test(value) || value.endsWith('-history'))
    throw error(400,'Choose a valid file name without a folder path');
  return value;
}
function identity(a, b) { return a.ino === b.ino && a.dev === b.dev; }
function folder(root, value = '/') {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f\\]/.test(value)) throw error(400, 'Invalid folder');
  const parts = value.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  parts.forEach(existingName);
  let current = path.resolve(root); const chain = [];
  for (const part of [null, ...parts]) {
    if (part !== null) current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error(403, 'Folder is unavailable');
    chain.push({target:current, stat});
  }
  return {root:current, path:parts.length ? '/' + parts.join('/') : '/', chain};
}
function unchangedFolder(parent) {
  for (const item of parent.chain) {
    const stat = fs.lstatSync(item.target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !identity(stat,item.stat)) throw error(409,'Folder changed during operation');
  }
}
function file(root, folderName, filename) {
  existingName(filename);
  const parent = folder(root, folderName), target = path.join(parent.root, filename);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw error(404, 'File is unavailable');
  return {...parent, target, name:filename, stat};
}
async function hash(target) {
  const digest=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(target,{flags:fs.constants.O_RDONLY|(process.platform==='win32'?0:(fs.constants.O_NOFOLLOW||0))}))digest.update(chunk);
  return digest.digest('hex');
}
async function rename(root, folderName, oldName, newName) {
  const old = file(root, folderName, oldName); newName = name(newName);
  if(Buffer.byteLength(newName+'-history','utf8')>255)throw error(400,'Choose a shorter file name');
  if (oldName === newName) return old;
  const digest = await hash(old.target), target = path.join(old.root,newName);
  const oldHistory = path.join(old.root,oldName+'-history'), newHistory = path.join(old.root,newName+'-history');
  const hashed=fs.lstatSync(old.target);
  if(!hashed.isFile()||hashed.isSymbolicLink()||!identity(hashed,old.stat)||hashed.size!==old.stat.size||hashed.mtimeMs!==old.stat.mtimeMs)
    throw error(409,'File changed during rename');
  let linked = false, historyReserved = false, historyStat, reservation, moved = [];
  try {
    unchangedFolder(old);
    // Reserve the entire destination history even when there is no history yet.
    fs.mkdirSync(newHistory,{mode:0o700}); historyReserved = true; reservation = fs.lstatSync(newHistory);
    fs.linkSync(old.target,target); linked = true;
    try { historyStat = fs.lstatSync(oldHistory); } catch (e) { if(e.code !== 'ENOENT') throw e; }
    if (historyStat) {
      if (!historyStat.isDirectory() || historyStat.isSymbolicLink()) throw error(403,'File history is unavailable');
      for (const child of fs.readdirSync(oldHistory)) {
        const next = [oldName,oldName+'.txt'].includes(child) ? newName + child.slice(oldName.length) : child;
        const from = path.join(oldHistory,child), to = path.join(newHistory,next);
        fs.renameSync(from,to); moved.push({from,to});
      }
    }
    const currentDigest = await hash(old.target);
    unchangedFolder(old);
    const latest = fs.lstatSync(old.target), created = fs.lstatSync(target);
    if (!latest.isFile() || latest.isSymbolicLink() || !identity(latest,old.stat)
        || !identity(created,old.stat) || latest.size!==old.stat.size || latest.mtimeMs!==old.stat.mtimeMs || currentDigest !== digest)
      throw error(409,'File changed during rename');
    if (historyStat) {
      if (!identity(fs.lstatSync(oldHistory),historyStat)) throw error(409,'History changed during rename');
      fs.rmdirSync(oldHistory);
    } else { fs.rmdirSync(newHistory); historyReserved = false; }
    fs.unlinkSync(old.target); linked = false;
    return {...old, target, name:newName};
  } catch (e) {
    // Roll back only entries reserved by this operation, without overwriting another file.
    if (historyReserved && identity(fs.lstatSync(newHistory),reservation)) {
      if (moved.length && !fs.existsSync(oldHistory)) fs.mkdirSync(oldHistory,{mode:historyStat.mode & 0o777});
      for (const item of moved.reverse()) if (!fs.existsSync(item.from)) fs.renameSync(item.to,item.from);
      fs.rmdirSync(newHistory);
    }
    if (linked && identity(fs.lstatSync(target),old.stat)) fs.unlinkSync(target);
    if (e.code === 'EEXIST') throw error(409,'A file with this name already exists');
    throw e;
  }
}
function create(root, folderName, filename, bytes) {
  filename = name(filename);
  const parent = folder(root,folderName), target = path.join(parent.root,name(filename));
  let fd, stat;
  try {
    unchangedFolder(parent); fd = fs.openSync(target,'wx',0o600); stat = fs.fstatSync(fd);
    fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); unchangedFolder(parent);
  } catch (e) {
    if (stat && identity(fs.lstatSync(target),stat)) fs.unlinkSync(target);
    if (e.code === 'EEXIST') throw error(409,'A file with this name already exists');
    throw e;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return {...parent,target,name:filename};
}
module.exports = {name,folder,file,rename,create,error};
