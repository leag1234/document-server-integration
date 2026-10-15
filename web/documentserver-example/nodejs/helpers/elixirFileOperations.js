/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const fs=require('fs'),path=require('path'),express=require('express'),config=require('config');
const DocManager=require('./docManager'),session=require('./elixirSession'),paths=require('./elixirStoragePaths'),service=require('./documentService');
const STATE='local-open',locks=new Map();
function run(key,fn){
 const previous=locks.get(key)||Promise.resolve(),next=previous.catch(()=>{}).then(fn);
 locks.set(key,next);return next.finally(()=>{if(locks.get(key)===next)locks.delete(key)});
}
function mutate(fn){
 // Synchronous read-modify-write cannot interleave in the single Node process.
 const st=session.loadState(STATE);
 for(const k of Object.keys(st))if(st[k].updated<Date.now()-14*86400000)delete st[k];
 const result=fn(st);session.saveState(STATE,st);return result;
}
function keyName(key){
 if(typeof key!=='string'||!/^[A-Za-z0-9_.=-]{1,128}$/.test(key)||['__proto__','constructor','prototype'].includes(key))throw paths.error(400,'Invalid editing session');
 return key;
}
function identity(req,address,folder,name){
 const f=paths.file(root(req,address),folder,name),s=f.stat;
 return [s.dev,s.ino,s.size,s.mtimeMs].join(':');
}
function activeKey(req,name,address){
 const owner=new DocManager(req,null).curUserHostAddress(address),folder=req.elixirStorageFolder?.path||'/',st=session.loadState(STATE);
 let current;try{current=identity(req,owner,folder,name)}catch(e){return null}
 return Object.keys(st).find(k=>!st[k].closed&&st[k].address===owner&&st[k].folder===folder&&st[k].name===name&&st[k].identity===current);
}
function close(key){mutate(st=>{if(Object.hasOwn(st,key)){st[key].closed=true;st[key].updated=Date.now()}})}
function csrf(req){if(req.get('X-Elixir')!=='1')throw paths.error(403,'Invalid file operation')}
const handle=fn=>async(req,res)=>{
 res.removeHeader('Access-Control-Allow-Origin');res.set('Cache-Control','no-store');
 try{await fn(req,res)}catch(e){res.status(e.status||422).json({error:e.status===409?'conflict':'fileOperation',message:e.status?e.message:'The file operation failed. Reopen the document and try again.'})}
};
function root(req,address){const dm=new DocManager(req,null);return dm.userStorageRootPath(address);}
function bind(req,folder='/',address){
 const dm=new DocManager(req,null),owner=dm.curUserHostAddress(address),base=root(req,owner);
 fs.mkdirSync(base,{recursive:true});const selected=paths.folder(base,folder);
 req.elixirStorageFolder={address:owner,...selected};return selected;
}
function register(req,key,name,permissions={canRename:true,canCopy:true}){
 keyName(key);return mutate(st=>{
  const address=new DocManager(req,null).curUserHostAddress(),folder=req.elixirStorageFolder?.path||'/';
  let e=Object.hasOwn(st,key)&&st[key];if(!e||e.closed)e={address,folder,name,sessions:{}};
  if(e.address!==address||e.folder!==folder||e.name!==name)throw paths.error(409,'Reopen this document');
  e.sessions[req.elixir.hash]={canRename:permissions.canRename===true,canCopy:permissions.canCopy===true};e.identity=identity(req,address,folder,name);e.updated=Date.now();e.closed=false;st[key]=e;
  return {kind:'local',key,name:e.name,folder:e.folder,...e.sessions[req.elixir.hash]};
 });
}
function entry(req,key,permission){
 keyName(key);const st=session.loadState(STATE),e=Object.hasOwn(st,key)&&st[key];
 if(!e||e.closed||!Object.hasOwn(e.sessions,req.elixir.hash)||e.address!==new DocManager(req,null).curUserHostAddress())throw paths.error(403,'Reopen this document before changing its file');
 if(permission&&e.sessions[req.elixir.hash]?.[permission]!==true)throw paths.error(403,'This file operation is unavailable for the current user');
 return e;
}
function track(req,key,name,address){
 const st=session.loadState(STATE),e=Object.hasOwn(st,key)&&st[key];if(!e){bind(req,req.query.folder||'/',address);return name;}
 if(e.closed)throw paths.error(409,'This editing session has ended');
 if(e.address!==new DocManager(req,null).curUserHostAddress(address))throw paths.error(403,'Invalid editing session');
 bind(req,e.folder,address);return e.name;
}
function suffix(req){const p=req.elixirStorageFolder?.path;return p&&p!=='/'?'&folder='+encodeURIComponent(p):'';}
function checkedDownload(req,url,key){
 keyName(key);
 const dm=new DocManager(req,null),u=new URL(url),site=config.get('server').get('siteUrl');
 const allowed=new URL(/^https?:\/\//.test(site)?site:dm.getServerHost());
 if(u.origin!==allowed.origin||(!u.pathname.startsWith('/cache/files/')||!u.pathname.includes(key)))throw paths.error(400,'Invalid converted-file URL');
 return /^https?:\/\//.test(site)?u.href:new URL(u.pathname+u.search,'http://localhost/').href;
}
async function convertedBytes(req,url,key){
 const response=await fetch(checkedDownload(req,url,key),{redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw paths.error(422,'Could not retrieve the converted copy');
 const limit=config.get('server').get('maxFileSize'),chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw paths.error(413,'Copy is too large');chunks.push(chunk)}
 if(!size)throw paths.error(422,'Copy is empty');return Buffer.concat(chunks);
}
function copyName(value){
 value=paths.name(value);
 if(!require('./fileUtility').getSuppotredExtensions().concat(['zip']).includes(path.extname(value).slice(1).toLowerCase()))throw paths.error(400,'Choose a supported document format');
 return value;
}
function strings(req){
 const home=require('./elixirHome'),t=home.translator(home.resolveLanguage(req).ui);
 return Object.fromEntries(['fileops.saveCopy','fileops.fileName','fileops.save','fileops.cancel','fileops.newFolder','fileops.folderName','fileops.copySaved','fileops.close','fileops.downloadCopy','fileops.openCopy','fileops.thisServer','fileops.failure','fileops.badName','fileops.shortName','fileops.conflict','fileops.folderExists','fileops.notWritable','fileops.changed','fileops.badFormat'].map(key=>[key,t(key)]));
}
function router(){
 const r=express.Router();
 r.get('/elixir/storage/folders',handle(async(req,res)=>{
  const selected=bind(req,req.query.folder||'/');
  const items=fs.readdirSync(selected.root,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()&&!x.name.endsWith('-history')).map(x=>({name:x.name,path:(selected.path==='/'?'':selected.path)+'/'+x.name}));
  res.json({folder:selected.path,items:items.sort((a,b)=>a.name.localeCompare(b.name))});
 }));
 r.post('/elixir/storage/folder',handle(async(req,res)=>{
  csrf(req);const selected=bind(req,req.body.folder||'/'),name=paths.name(req.body.name);
  try{fs.mkdirSync(path.join(selected.root,name),{mode:0o700})}catch(e){if(e.code==='EEXIST')throw paths.error(409,'Folder already exists');throw e;}
  res.json({folder:(selected.path==='/'?'':selected.path)+'/'+name});
 }));
 r.post('/elixir/storage/copy',handle(async(req,res)=>{
  csrf(req);entry(req,req.body.key,'canCopy');const name=copyName(req.body.name);
  const bytes=await convertedBytes(req,req.body.url,req.body.key),e=entry(req,req.body.key,'canCopy'),dm=new DocManager(req,null);
  const created=paths.create(root(req,e.address),req.body.folder||e.folder,name,bytes);
  bind(req,created.path,e.address);dm.saveFileData(created.name,'local','Local user',e.address);
  const editable=path.extname(created.name).toLowerCase()!=='.zip';
  res.json({name:created.name,folder:created.path,editable,url:dm.getServerUrl()+(editable?'/editor?fileName=':'/download?fileName=')+encodeURIComponent(created.name)+suffix(req)});
 }));
 return r;
}
module.exports={strings,router,bind,register,entry,track,close,activeKey,mutate,run,suffix,root,convertedBytes,copyName,csrf,handle,STATE};
