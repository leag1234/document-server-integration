/*
 * SPDX-FileCopyrightText: 2026 ElixirOffice contributors
 * SPDX-License-Identifier: Apache-2.0
 */
(function(){
 'use strict';
 var key='eo-local-conversion',input=document.getElementById('file-input')||document.getElementById('fileupload');
 if(!input)return;
 var label=document.createElement('label'),setting=document.createElement('input');setting.type='checkbox';
 try{setting.checked=localStorage.getItem(key)==='true';}catch(e){}
 label.append(setting,document.createTextNode(' Convert files locally (no upload)'));
 var link=document.createElement('a');link.href='local.html';link.textContent='Open a local document';link.style.marginLeft='12px';
 var panel=document.createElement('div');panel.style.padding='12px';panel.append(label,link);
 var header=document.querySelector('header');if(header)header.insertAdjacentElement('afterend',panel);else input.parentNode.insertBefore(panel,input);
 setting.addEventListener('change',function(){try{localStorage.setItem(key,String(setting.checked));}catch(e){}});
 function db(){return new Promise(function(resolve,reject){var request=indexedDB.open('eo-local-launch',1);request.onupgradeneeded=function(){request.result.createObjectStore('pending');};request.onsuccess=function(){resolve(request.result);};request.onerror=function(){reject(request.error);};});}
 async function local(file){
  var store=await db();await new Promise(function(resolve,reject){var t=store.transaction('pending','readwrite');t.objectStore('pending').put(file,'file');t.oncomplete=resolve;t.onerror=function(){reject(t.error);};});store.close();location.href='local.html'+location.search;
 }
 async function reachable(){
  var abort=new AbortController(),timer=setTimeout(function(){abort.abort();},1500);
  try{var r=await fetch('/healthcheck',{signal:abort.signal,cache:'no-store'});return r.ok&&(await r.text()).trim()==='true';}catch(e){return false;}finally{clearTimeout(timer);}
 }
 window.addEventListener('change',function(event){
  if(event.target!==input||event.eoServerAllowed||!input.files.length)return;
  event.stopImmediatePropagation();
  var file=input.files[0];
  (async function(){
   var server= !setting.checked && await reachable();
   if(setting.checked||!server)return local(file);
   var replay=new Event('change',{bubbles:true});replay.eoServerAllowed=true;input.dispatchEvent(replay);
  })().catch(function(e){panel.textContent='Cannot open locally: '+e.message;});
 },true);
 window.addEventListener('drop',function(event){
  if(event.eoServerAllowed||!event.dataTransfer||!event.dataTransfer.files.length)return;
  event.preventDefault();event.stopImmediatePropagation();
  var transfer=new DataTransfer();
  Array.from(event.dataTransfer.files).forEach(function(file){transfer.items.add(file);});
  var file=transfer.files[0];
  (async function(){
   var server=!setting.checked&&await reachable();
   if(setting.checked||!server)return local(file);
   var replay=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer});replay.eoServerAllowed=true;event.target.dispatchEvent(replay);
  })().catch(function(e){panel.textContent='Cannot open locally: '+e.message;});
 },true);
})();
