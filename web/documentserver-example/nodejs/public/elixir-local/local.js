/*
 * SPDX-FileCopyrightText: 2026 ElixirOffice contributors
 * SPDX-License-Identifier: Apache-2.0
 */
(function(){
 'use strict';
 var input=document.getElementById('file'),save=document.getElementById('save'),cancel=document.getElementById('cancel'),message=document.getElementById('message');
 var editor,controller,abort,file,workingName,opening=false;
 var canonical={doc:'docx',rtf:'docx',txt:'docx',docm:'docx',dotx:'docx',xls:'xlsx',csv:'xlsx',xlsm:'xlsx',xltx:'xlsx',ppt:'pptx',ppsx:'pptx',potx:'pptx'};
 var kinds={pdf:'pdf',docx:'word',odt:'word',xlsx:'cell',ods:'cell',pptx:'slide',odp:'slide'};
 var exports={pdf:[513],word:[65,67,68,69,513],cell:[257,259,260,513],slide:[129,131,513]};
 function outputName(format){if(workingName)return workingName.replace(/\.[^.]+$/,'.'+format);var original=file.name,from=original.split('.').pop().toLowerCase();return original.replace(/\.[^.]+$/,'')+(canonical[from]?' (converted)':'')+'.'+format;}

 function status(text){message.textContent=text;}
 function script(win,url){return new Promise(function(resolve,reject){var s=win.document.createElement('script');s.src=url;s.onload=resolve;s.onerror=function(){reject(new Error('Cannot load local editor assets'));};win.document.head.appendChild(s);});}
 function unsaved(){return controller&&(controller.hasPendingImages()||controller.isModified());}
 function download(bytes,name){var url=URL.createObjectURL(new Blob([bytes],{type:/\.pdf$/i.test(name||'')?'application/pdf':'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name||file.name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);status('Saved locally. No document was uploaded.');}
 function downloadPdfCopy(bytes,name){
  if(window.confirm('Export a PDF copy? This preview does not preserve bookmarks or document properties, and invalidates digital signatures. Your original stays unchanged.'))download(bytes,name);
  else status('PDF export cancelled.');
 }
 async function open(selected){
  if(!selected||opening)return;input.value='';
  if(!/\.(docx|odt|rtf|txt|doc|dotx|docm|xlsx|ods|csv|xls|xltx|xlsm|pptx|odp|ppt|potx|ppsx|pdf)$/i.test(selected.name))throw new Error('Unsupported local document format');
  if(unsaved()&&!window.confirm('This local document has unsaved changes. Open another file and discard them?')){input.value='';return;}
  opening=true;window.EOLocalFailure=null;window.EOLocalSession=null;file=selected;workingName=null;input.disabled=true;save.disabled=true;cancel.disabled=false;abort=new AbortController();
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
      win.Common.ElixirLocal.prepare(main.api,main,{downloadFormats:exports[kind]});
      main.loadDocument({doc:{fileType:format,title:outputName(format),url:'_offline_',key:'local-'+crypto.randomUUID(),permissions:{edit:kind!=='pdf',comment:true,fillForms:true,download:true,print:true,chat:false}}});
      controller=win.Common.ElixirLocal.install(main.api,{format:format,lang:new URLSearchParams(location.search).get('lang')||'en',getSignal:function(){return abort.signal;},onSave:function(bytes){download(bytes,outputName(format));},
       buildPdf:win.EOLocalPdf,onExport:function(bytes,target,options,stats){
        if(options.isPdfPrint){
         var url=win.URL.createObjectURL(new win.Blob([bytes],{type:'application/pdf'}));
         main.api.sendEvent('asc_onPrintUrl',url);
         setTimeout(function(){win.URL.revokeObjectURL(url);},60*1000);
         status('Printing locally. No document was uploaded.');
        }else if(kind==='pdf')downloadPdfCopy(bytes,outputName(target));
        else download(bytes,outputName(target));
        window.EOLocalLastExport={format:target,printed:!!options.isPdfPrint,bytes:bytes.length,stats:stats};
       },onBeforeSave:function(){abort=new AbortController();save.disabled=true;input.disabled=true;cancel.disabled=false;},onAfterSave:function(){save.disabled=!!controller.canSave&&!controller.canSave();input.disabled=false;cancel.disabled=true;},onError:function(e){status(e.message);},onProgress:function(p){status('Local conversion: '+p.stage);}});
      if(sourceFormat!==format){
       status('Opening a converted copy as .'+format+'…');
       bytes=await win.EOWasmConvert.convert(new win.Uint8Array(bytes),sourceFormat,format,{signal:abort.signal,onProgress:function(p){status('Local conversion: '+p.stage);}});
      }
      var stats=await controller.open(bytes);
      window.EOLocalSession={controller:controller,format:format,sourceFormat:sourceFormat,converted:sourceFormat!==format,stats:stats};
      if(kind!=='pdf'){
      var bs=(win.DE||win.SSE||win.PE).getController('ElixirChrome').backstage,enhance=bs.enhanceSaveAs;
      bs.enhanceSaveAs=function(){
       enhance.call(this);var panel=bs.fm.panels&&bs.fm.panels.saveas;
       if(!panel||panel.$el.find('[data-local-rename]').length)return;
       var button=win.$('<button type="button" data-local-rename/>').text('Rename downloaded copy');
       button.on('click',function(){
        var value=window.prompt('Name for downloaded copies. The original file stays unchanged.',outputName(format).replace(/\.[^.]+$/,''));
        if(value===null)return;
        value=value.normalize('NFC');var leaf=value.trim(),candidate=leaf.toLowerCase().endsWith('.'+format)?leaf:leaf+'.'+format;
        if(!value.trim()||/[\x00-\x1f\x7f\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/.test(value)||/[. ]$/.test(value)||value.trim()==='.'||value.trim()==='..'||value.length>200||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(leaf.split('.')[0].replace(/ +$/,''))||new TextEncoder().encode(candidate).length>255){status('Choose a valid file name');return}
        workingName=value.trim();if(!workingName.toLowerCase().endsWith('.'+format))workingName+='.'+format;main.api.documentTitle=workingName;main.api.DocInfo&&main.api.DocInfo.put_Title(workingName);var doc=main.document||main.appOptions.spreadsheet;if(doc)doc.title=workingName;main.onDocumentName(workingName);bs.fm.loadDocument({doc:main.document||main.appOptions.spreadsheet});status('Downloaded copies use '+workingName+'. The original file stays unchanged.');
        window.EOLocalSession.name=workingName;
       });panel.$el.find('.elx-page-inner').prepend(button);
      };bs.enhanceSaveAs();
      }
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
