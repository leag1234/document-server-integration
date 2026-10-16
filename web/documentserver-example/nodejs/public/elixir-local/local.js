/*
 * SPDX-FileCopyrightText: 2026 ElixirOffice contributors
 * SPDX-License-Identifier: Apache-2.0
 */
(function(){
 'use strict';
 var input=document.getElementById('file'),save=document.getElementById('save'),cancel=document.getElementById('cancel'),message=document.getElementById('message');
 var editor,controller,abort,file,workingName,pdfCopyWarning,opening=false,operationScope;
 var canonical={doc:'docx',rtf:'docx',txt:'docx',docm:'docx',dotx:'docx',xls:'xlsx',csv:'xlsx',xlsm:'xlsx',xltx:'xlsx',ppt:'pptx',ppsx:'pptx',potx:'pptx'};
 var kinds={pdf:'pdf',docx:'word',odt:'word',xlsx:'cell',ods:'cell',pptx:'slide',odp:'slide'};
 var exports={pdf:[513],word:[65,67,68,69,513],cell:[257,259,260,513],slide:[129,131,513]};
 function outputName(format){if(workingName)return workingName.replace(/\.[^.]+$/,'.'+format);var original=file.name,from=original.split('.').pop().toLowerCase();return original.replace(/\.[^.]+$/,'')+(canonical[from]?' (converted)':'')+'.'+format;}

 function status(text){message.textContent=text;}
 function script(win,url){return new Promise(function(resolve,reject){var s=win.document.createElement('script');s.src=url;s.onload=resolve;s.onerror=function(){reject(new Error('Cannot load local editor assets'));};win.document.head.appendChild(s);});}
 function unsaved(){return controller&&(controller.hasPendingImages()||controller.isModified());}
 function download(bytes,name){var url=URL.createObjectURL(new Blob([bytes],{type:/\.pdf$/i.test(name||'')?'application/pdf':'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name||file.name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);status('Saved locally. No document was uploaded.');}
 function operationEvent(event){window.dispatchEvent(new CustomEvent('eo:local-operation',{detail:event}));}
 function downloadPdfCopy(bytes,name){
  if(!window.confirm(pdfCopyWarning)){status('PDF export cancelled.');return false;}download(bytes,name);return true;
 }
 async function open(selected){
  if(!selected||opening)return;input.value='';
  if(!/\.(docx|odt|rtf|txt|doc|dotx|docm|xlsx|ods|csv|xls|xltx|xlsm|pptx|odp|ppt|potx|ppsx|pdf)$/i.test(selected.name))throw new Error('Unsupported local document format');
  if(unsaved()&&!window.confirm('This local document has unsaved changes. Open another file and discard them?')){input.value='';return;}
  opening=true;operationScope=crypto.randomUUID();window.EOLocalFailure=null;window.EOLocalSession=null;file=selected;workingName=null;input.disabled=true;save.disabled=true;cancel.disabled=false;abort=new AbortController();
  if(controller)controller.dispose();controller=null;if(editor)editor.destroyEditor();
  var sourceFormat=file.name.split('.').pop().toLowerCase(),format=canonical[sourceFormat]||sourceFormat,kind=kinds[format];
  if(!kind){opening=false;input.disabled=false;cancel.disabled=true;throw new Error('Unsupported local document format');}
  status('Opening locally…');
  var bytes=await file.arrayBuffer();
  await new Promise(function(resolve,reject){
   editor=new DocsAPI.DocEditor('editor',{documentType:kind,type:'desktop',width:'100%',height:'100%',

    editorConfig:{mode:'edit',lang:new URLSearchParams(location.search).get('lang')||'en',user:{id:'local',name:'Local user'},customization:{elixirLocal:true,autosave:false,forcesave:false,plugins:false,macros:false},coEditing:{mode:'strict',change:false}},
    events:{onAppReady:async function(){
     if(controller)return;
     try{
      var frame=document.querySelector('#editor iframe')||document.querySelector('iframe'),win=frame.contentWindow;
      await script(win,'/example/local-assets/sdkjs/common/clientpdf/wasm-fonts.js');await script(win,'/example/local-assets/sdkjs/common/wasm-convert/api.js');await script(win,'/example/local-assets/sdkjs/common/wasm-convert/pdf.js');
      if(!win.Common||!win.Common.ElixirLocal)await new Promise(function(resolve,reject){win.require(['common/main/lib/elixir-local/Controller'],resolve,reject);});

      var main=(kind==='word'?win.DE:kind==='cell'?win.SSE:kind==='pdf'?win.PDFE:win.PE).getController('Main');
      win.Common.ElixirLocal.prepare(main.api,main,{downloadFormats:exports[kind],saveAs:{
       sourceFormat:sourceFormat,language:new URLSearchParams(location.search).get('lang')||'en',
       getName:function(){return outputName(format).replace(/\.[^.]+$/,'');},
       validateName:function(value,target){return !!win.Common.ElixirLocal.fileName(value,target);},
       commitName:function(value,target){
        var name=win.Common.ElixirLocal.fileName(value,target);
        if(!name)return;
        workingName=name.slice(0,-target.length-1)+'.'+format;
        main.api.documentTitle=workingName;main.api.DocInfo&&main.api.DocInfo.put_Title(workingName);
        var doc=main.document||main.appOptions.spreadsheet;if(doc)doc.title=workingName;
        main.onDocumentName(workingName);
        window.EOLocalSession.name=workingName;
       },
       getSignal:function(){return abort.signal;},onError:function(error){status(error.message);}
      }});
      main.loadDocument({doc:{fileType:format,title:outputName(format),url:'_offline_',key:'local-'+crypto.randomUUID(),permissions:{edit:kind!=='pdf',comment:true,fillForms:true,download:true,print:true,chat:false}}});
      controller=win.Common.ElixirLocal.install(main.api,{format:format,lang:new URLSearchParams(location.search).get('lang')||'en',operationScope:operationScope,onOperation:operationEvent,getSignal:function(){return abort.signal;},onSave:function(bytes){download(bytes,outputName(format));return {kind:'download-started',name:outputName(format),bytes:bytes.length};},
       buildPdf:win.EOLocalPdf,onExport:function(bytes,target,options,stats){
        if(options.isPdfPrint){
         var url=win.URL.createObjectURL(new win.Blob([bytes],{type:'application/pdf'}));
         main.api.sendEvent('asc_onPrintUrl',url);
         setTimeout(function(){win.URL.revokeObjectURL(url);},60*1000);
         status('Printing locally. No document was uploaded.');
        }else if(kind==='pdf'){if(!downloadPdfCopy(bytes,outputName(target)))return {kind:'cancelled'};}
        else download(bytes,outputName(target));
        window.EOLocalLastExport={format:target,printed:!!options.isPdfPrint,bytes:bytes.length,stats:stats};
        return {kind:options.isPdfPrint?'print-started':'download-started',name:outputName(target),bytes:bytes.length};
       },onBeforeSave:function(){abort=new AbortController();save.disabled=true;input.disabled=true;cancel.disabled=false;},onAfterSave:function(){save.disabled=!!controller.canSave&&!controller.canSave();input.disabled=false;cancel.disabled=true;},onError:function(e){status(e.message);},onProgress:function(p){status('Local conversion: '+p.stage);}});
      if(sourceFormat!==format){
       status('Opening a converted copy as .'+format+'…');
       bytes=await win.EOWasmConvert.convert(new win.Uint8Array(bytes),sourceFormat,format,{signal:abort.signal,onProgress:function(p){status('Local conversion: '+p.stage);}});
      }
      var stats=await controller.open(bytes);
      if(kind==='pdf'){
       // The PDF launcher reuses the selector without changing its hosted menu.
       var fm=win.PDFE.getController('LeftMenu').leftMenu.menuFile;
       var bs=Object.create(win.Common.Views.ElixirBackstage.prototype);
       bs.controller=main;bs.fm=fm;bs.mode=fm.mode||main.appOptions;bs.defaultFileType='pdf';
       bs.formats=function(){return [{type:win.Asc.c_oAscFileType.PDF,ext:'.pdf',name:'txtFmtPdf',desc:'txtFmtPdfDesc',group:'pdf'}];};
       var language=(new URLSearchParams(location.search).get('lang')||'en').toLowerCase();
       if(!/^[a-z]{2}(?:-[a-z]{2,4})?$/.test(language))language='en';
       var localeUrl='/example/local-assets/web-apps/apps/documenteditor/main/locale/';
       var response=await win.fetch(localeUrl+language+'.json');
       if(!response.ok)response=await win.fetch(localeUrl+'en.json');
       var labels=await response.json();
       ['txtSaveAs','txtSaveFormat','txtSaveName','txtSaveNameInvalid','txtFmtPdf','txtFmtPdfDesc','txtPdfCopyWarning'].forEach(function(key){
        bs[key]=labels['DE.Views.ElixirBackstage.'+key];
       });
       bs.afterApplyMode=function(){bs.mode=fm.mode||main.appOptions;bs.enhanceSaveAs();};
       bs.patchFileMenu();
       var render=fm.render;fm.render=function(){var result=render.apply(this,arguments);bs.afterApplyMode();return result;};
       bs.afterApplyMode();pdfCopyWarning=bs.txtPdfCopyWarning;
      }
      window.EOLocalSession={controller:controller,format:format,sourceFormat:sourceFormat,converted:sourceFormat!==format,stats:stats};
      save.disabled=kind==='pdf'&&!controller.canSave();status(kind==='pdf'&&!controller.canSave()?controller.readOnlyMessage():sourceFormat!==format?'Editing a converted copy. Download saves .'+format+'; the original stays unchanged.':'Editing locally. Documents stay on this computer.');resolve();
     }catch(e){reject(e);}
    },onError:function(e){reject(new Error(e.data&&e.data.errorDescription||'Editor could not open locally'));}}
   });
  }).catch(function(e){if(controller)controller.dispose();controller=null;if(editor)editor.destroyEditor();editor=null;throw e;});
  opening=false;input.disabled=false;cancel.disabled=true;
 }
 input.addEventListener('change',function(){open(input.files[0]).catch(function(e){opening=false;input.disabled=false;cancel.disabled=true;window.EOLocalFailure=e.message;status(e.message);});});
 save.addEventListener('click',function(){save.disabled=true;input.disabled=true;cancel.disabled=false;abort=new AbortController();controller.save().catch(function(e){status(e.message);}).finally(function(){save.disabled=!!controller.canSave&&!controller.canSave();input.disabled=false;cancel.disabled=true;});});
 cancel.addEventListener('click',function(){abort.abort();status('Conversion cancelled.');});
 window.EOLocalOpen=open;
 var request=indexedDB.open('eo-local-launch',1);
 request.onupgradeneeded=function(){request.result.createObjectStore('pending');};
 request.onsuccess=function(){
  var db=request.result,t=db.transaction('pending','readwrite'),store=t.objectStore('pending'),get=store.get('file');
  get.onsuccess=function(){var pending=get.result;store.delete('file');t.oncomplete=function(){db.close();if(pending)open(pending instanceof File?pending:new File([pending.bytes],pending.name,{type:pending.type,lastModified:pending.lastModified})).catch(function(e){opening=false;input.disabled=false;cancel.disabled=true;window.EOLocalFailure=e.message;status(e.message);});};};
 };

})();
