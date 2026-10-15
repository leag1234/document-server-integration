/* SPDX-License-Identifier: AGPL-3.0-only */
(function () {
 'use strict';
 window.EOFileOperations = function (storage, base, strings) {
  const t=(key,vars)=>{let text=strings['fileops.'+key];for(const [name,value] of Object.entries(vars||{}))text=text.split('{'+name+'}').join(value);return text;};
  const errors={"Choose a valid file name without a folder path": "badName", "Choose a shorter file name": "shortName", "A file with this name already exists": "conflict", "Folder already exists": "folderExists", "Choose a writable folder": "notWritable", "The file changed in storage. Reopen it before renaming.": "changed", "Choose a supported document format": "badFormat"};
  let busy = false;
  async function request(route, body) {
   const response = await fetch(base+route,{method:body?'POST':'GET',credentials:'same-origin',
    headers:body?{'Content-Type':'application/json','X-Elixir':'1'}:{},body:body?JSON.stringify(body):undefined});
   const data=await response.json();
   if(!response.ok)throw Error(errors[data.message]?t(errors[data.message]):data.message||t('failure'));
   return data;
  }
  function picker(title, url) {
   const box=document.createElement('dialog');box.dataset.storageFolderPicker=storage.kind;
   box.style.cssText='max-width:600px;width:80%;padding:24px;border:1px solid #bbb;border-radius:8px;font:14px Arial,sans-serif';
   const heading=document.createElement('h2');heading.textContent=t('saveCopy');
   const path=document.createElement('p'),list=document.createElement('div'),name=document.createElement('input'),notice=document.createElement('p'),save=document.createElement('button'),cancel=document.createElement('button');
   name.value=title;name.maxLength=200;name.setAttribute('aria-label',t('fileName'));name.style.cssText='width:100%;margin:16px 0';
   save.textContent=t('save');cancel.textContent=t('cancel');notice.setAttribute('role','status');
   let folder=storage.folder||'/',loading=false,writable=true;
   async function browse(next) {
    loading=true;save.disabled=true;notice.textContent='';
    try {
     const cloud=storage.kind==='nc',data=await request(cloud?'/elixir/nc/list?path='+encodeURIComponent(next):'/elixir/storage/folders?folder='+encodeURIComponent(next));
     folder=data.folder||data.path;writable=cloud?data.canUpload===true:true;path.textContent=(storage.label||(cloud?'Nextcloud':t('thisServer')))+' '+folder;list.replaceChildren();
     const choices=[];
     if(folder!=='/')choices.push({name:'↑ ..',path:folder.slice(0,folder.lastIndexOf('/'))||'/'});
     for(const item of data.items)if(!cloud||item.type==='dir')choices.push(item);
     for(const item of choices){const button=document.createElement('button');button.type='button';button.textContent=item.name;button.dataset.folder=item.path;button.style.cssText='display:block;margin:6px 0';button.onclick=()=>browse(item.path);list.append(button)}
    } catch(e){notice.textContent=e.message;writable=false}
    finally{loading=false;save.disabled=!writable}
   }
   box.append(heading,path,list);
   if(storage.kind==='local'){
    const create=document.createElement('button');create.type='button';create.textContent=t('newFolder');create.dataset.newFolder='';
    create.onclick=async()=>{
     const value=window.prompt(t('folderName'));if(value===null)return;create.disabled=true;
     try{const result=await request('/elixir/storage/folder',{folder,name:value});await browse(result.folder)}
     catch(e){notice.textContent=e.message}finally{create.disabled=false}
    };box.append(create);
   }
   box.append(name,notice,save,cancel);document.body.append(box);box.showModal();
   cancel.onclick=()=>box.close();box.addEventListener('close',()=>box.remove(),{once:true});
   save.onclick=async()=>{
    if(loading)return;loading=true;save.disabled=true;cancel.disabled=true;notice.textContent='';
    try {
     const result=await request(storage.kind==='nc'?'/elixir/nc/copy':'/elixir/storage/copy',{key:storage.key,folder,name:name.value,url});
     notice.textContent=t('copySaved',{name:result.name});name.disabled=true;save.remove();cancel.textContent=t('close');
     const open=document.createElement('a');open.textContent=result.editable===false?t('downloadCopy'):t('openCopy');open.href=result.url;open.target='_blank';open.rel='noopener';box.insertBefore(open,cancel);
     window.EOLastStorageCopy=result;
    }catch(e){notice.textContent=e.message;save.disabled=false}
    finally{loading=false;cancel.disabled=false}
   };
   browse(folder);return box;
  }
  return {
   rename:async value=>{
    if(busy)return;busy=true;
    try {
     const result=await request(storage.kind==='nc'?'/elixir/nc/rename':'/rename',
      storage.kind==='nc'?{key:storage.key,name:value}:{dockey:storage.key,newfilename:value});
     storage.name=result.name;window.EOLastStorageRename=result;return result;
    }finally{busy=false}
   },
   saveAs:event=>picker(event.title,event.url)
  };
 };
})();
