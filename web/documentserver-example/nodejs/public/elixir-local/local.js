/*
 * SPDX-FileCopyrightText: 2026 ElixirOffice contributors
 * SPDX-License-Identifier: Apache-2.0
 */
(function(){
 'use strict';
 var input=document.getElementById('file'),save=document.getElementById('save'),cancel=document.getElementById('cancel'),message=document.getElementById('message');
 var editor,controller,abort,file,opening=false;
 function status(text){message.textContent=text;}
 function script(win,url){return new Promise(function(resolve,reject){var s=win.document.createElement('script');s.src=url;s.onload=resolve;s.onerror=function(){reject(new Error('Cannot load local editor assets'));};win.document.head.appendChild(s);});}
 function download(bytes,name){var url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name||file.name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);status('Saved locally. No document was uploaded.');}
 async function open(selected){
  if(!selected||opening)return;opening=true;window.EOLocalFailure=null;file=selected;input.disabled=true;save.disabled=true;cancel.disabled=false;abort=new AbortController();
  if(controller)controller.dispose();controller=null;if(editor)editor.destroyEditor();
  var format=file.name.split('.').pop().toLowerCase(),kind={docx:'word',odt:'word',xlsx:'cell',ods:'cell',pptx:'slide',odp:'slide'}[format];
  if(!kind){opening=false;input.disabled=false;cancel.disabled=true;throw new Error('Unsupported local document format');}
  status('Opening locally…');
  var bytes=await file.arrayBuffer();
  await new Promise(function(resolve,reject){
   editor=new DocsAPI.DocEditor('editor',{documentType:kind,type:'desktop',width:'100%',height:'100%',

    editorConfig:{mode:'edit',lang:new URLSearchParams(location.search).get('lang')||'en',user:{id:'local',name:'Local user'},customization:{autosave:false,forcesave:false,plugins:false,macros:false},coEditing:{mode:'strict',change:false}},
    events:{onAppReady:async function(){
     if(controller)return;
     try{
      var frame=document.querySelector('#editor iframe')||document.querySelector('iframe'),win=frame.contentWindow;
      await script(win,'/example/local-assets/sdkjs/common/clientpdf/wasm-fonts.js');await script(win,'/example/local-assets/sdkjs/common/wasm-convert/api.js');
      if(!win.Common||!win.Common.ElixirLocal)await new Promise(function(resolve,reject){win.require(['common/main/lib/elixir-local/Controller'],resolve,reject);});

      var main=(kind==='word'?win.DE:kind==='cell'?win.SSE:win.PE).getController('Main');
      win.Common.ElixirLocal.prepare(main.api,main);
      main.loadDocument({doc:{fileType:format,title:file.name,url:'_offline_',key:'local-'+crypto.randomUUID(),permissions:{edit:true,download:true,print:false,chat:false}}});
      controller=win.Common.ElixirLocal.install(main.api,{format:format,getSignal:function(){return abort.signal;},onSave:function(bytes){download(bytes,selected.name);},onBeforeSave:function(){abort=new AbortController();save.disabled=true;input.disabled=true;cancel.disabled=false;},onAfterSave:function(){save.disabled=false;input.disabled=false;cancel.disabled=true;},onError:function(e){status(e.message);},onProgress:function(p){status('Local conversion: '+p.stage);}});
      var stats=await controller.open(bytes);
      window.EOLocalSession={controller:controller,format:format,stats:stats};
      save.disabled=false;status('Editing locally. Documents stay on this computer.');resolve();
     }catch(e){reject(e);}
    },onError:function(e){reject(new Error(e.data&&e.data.errorDescription||'Editor could not open locally'));}}
   });
  });
  opening=false;input.disabled=false;cancel.disabled=true;
 }
 input.addEventListener('change',function(){open(input.files[0]).catch(function(e){opening=false;input.disabled=false;cancel.disabled=true;window.EOLocalFailure=e.message;status(e.message);});});
 save.addEventListener('click',function(){save.disabled=true;input.disabled=true;cancel.disabled=false;abort=new AbortController();controller.save().catch(function(e){status(e.message);}).finally(function(){save.disabled=false;input.disabled=false;cancel.disabled=true;});});
 cancel.addEventListener('click',function(){abort.abort();status('Conversion cancelled.');});
 window.EOLocalOpen=open;
 var request=indexedDB.open('eo-local-launch',1);
 request.onupgradeneeded=function(){request.result.createObjectStore('pending');};
 request.onsuccess=function(){
  var db=request.result,t=db.transaction('pending','readwrite'),store=t.objectStore('pending'),get=store.get('file');
  get.onsuccess=function(){var pending=get.result;store.delete('file');t.oncomplete=function(){db.close();if(pending)open(pending).catch(function(e){opening=false;input.disabled=false;cancel.disabled=true;window.EOLocalFailure=e.message;status(e.message);});};};
 };

})();
