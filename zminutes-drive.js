/* Portable local backups and optional per-user Google Drive sync. Raw audio is excluded from Drive. */
(() => {
  const $=id=>document.getElementById(id), CLIENT='zminutes-drive-client-id', META='zminutes-drive-meta';
  let token='',folder='',syncing=false,changeVersion=0;
  const read=(key,f)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??f}catch{return f}};
  const status=s=>{if($('syncState'))$('syncState').textContent=s;if($('driveStatus'))$('driveStatus').textContent=s};
  const clientField=$('driveClientId');
  if(clientField){clientField.value=localStorage.getItem(CLIENT)||'';if(clientField.value)status(navigator.onLine?'Drive configured · tap Sync now':'Offline · saved locally')}
  $('saveDriveClientBtn').onclick=()=>{
    const value=clientField.value.trim();
    if(!value){status('Enter your Google OAuth Web Client ID first');clientField.focus();return}
    if(!value.endsWith('.apps.googleusercontent.com')){status('Use a Google OAuth Web Client ID, not an API key');clientField.focus();return}
    localStorage.setItem(CLIENT,value);$('syncSettingsBtn').disabled=false;status('Client ID saved · preparing Google sign-in…');
    loadGIS().then(()=>status('Ready · tap Sync now to connect Google Drive')).catch(err=>status('Google sign-in could not load · check your connection'));
  };
  function snapshot(includeAudio){
    return{app:'zMinutes',version:1,updatedAt:new Date().toISOString(),projects:projectData,meetings:meetings.map(m=>includeAudio?m:{...m,audio:null}),tasks:taskData,fieldNotes:fieldData};
  }
  function download(data,name){
    const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);
  }
  $('backupBtn').onclick=()=>download(snapshot(true),'zMinutes-backup-'+new Date().toISOString().slice(0,10)+'.json');
  $('restoreBtn').onclick=()=>$('restoreInput').click();
  async function restore(data){
    if(!data||data.app!=='zMinutes'||!Array.isArray(data.meetings)||!Array.isArray(data.projects))throw new Error('This is not a zMinutes backup.');
    meetings=data.meetings;projectData=data.projects;taskData=Array.isArray(data.tasks)?data.tasks:[];fieldData=Array.isArray(data.fieldNotes)?data.fieldNotes:[];
    meetings.forEach(m=>{m.agenda||=[];m.photos||=[];m.stakeholders||=[];m.transcript||=''});
    await Promise.all([['meetings',meetings],['projects',projectData],['tasks',taskData],['fieldNotes',fieldData]].map(([k,v])=>ZMinutesStore.put(k,v,true)));
    try{localStorage.setItem('meeting-note-data',JSON.stringify(meetings.map(m=>({...m,audio:null}))));localStorage.setItem('zminutes-projects-v1',JSON.stringify(projectData));localStorage.setItem('zminutes-tasks-v1',JSON.stringify(taskData));localStorage.setItem('zminutes-field-notes-v1',JSON.stringify(fieldData.map(f=>({...f,photos:[]}))))}catch{}
    PROJECTS.splice(0,PROJECTS.length,...projectData);navState.project=PROJECTS.some(p=>p.id===navState.project)?navState.project:'inbox';renderSidebar();refreshSection();
  }
  $('restoreInput').onchange=e=>{
    const file=e.target.files[0];if(!file)return;const r=new FileReader();
    r.onload=async()=>{try{const data=JSON.parse(r.result);if(!confirm('Replace this device data with the selected backup? A backup of current data will download first.'))return;download(snapshot(true),'zMinutes-before-restore-'+Date.now()+'.json');await restore(data);alert('Backup restored.')}catch(err){alert('Restore failed: '+err.message)}finally{e.target.value=''}};
    r.readAsText(file);
  };
  window.addEventListener('zminutes:datachange',e=>{
    if(!['meetings','projects','tasks','fieldNotes'].includes(e.detail?.key))return;
    changeVersion++;window.zmDriveDirty=true;status(token?'Local changes · syncing shortly':'Local changes · tap Sync now to upload');if(token){clearTimeout(window.zmDriveTimer);window.zmDriveTimer=setTimeout(()=>sync(false),2500)}
  });
  window.addEventListener('online',()=>{if(token)sync(false)});

  let gisPromise;
  function loadGIS(){
    if(window.google?.accounts?.oauth2)return Promise.resolve();if(gisPromise)return gisPromise;
    gisPromise=new Promise((resolve,reject)=>{
      let s=document.querySelector('script[data-gis]');const failed=message=>{s?.remove();reject(new Error(message))},loaded=()=>window.google?.accounts?.oauth2?resolve():failed('Google sign-in did not initialize');
      if(!s){s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.dataset.gis='1';s.addEventListener('load',loaded,{once:true});s.addEventListener('error',()=>failed('Could not load Google sign-in. Check the connection.'),{once:true});document.head.append(s);return}
      s.addEventListener('load',loaded,{once:true});s.addEventListener('error',()=>failed('Could not load Google sign-in. Check the connection.'),{once:true});
    }).finally(()=>{if(!window.google?.accounts?.oauth2)gisPromise=null});
    return gisPromise;
  }
  async function authorize(){
    const client=localStorage.getItem(CLIENT);
    if(!client){showSection('settings');status('Setup required · enter a Google OAuth Web Client ID');clientField?.focus();throw new Error('Open Settings → Google Drive sync and save a Google OAuth Web Client ID first.')}
    if(!window.google?.accounts?.oauth2){await loadGIS();throw new Error('Google sign-in has loaded. Tap Sync now again to continue.')}
    await new Promise((resolve,reject)=>{
      let timeout;const c=google.accounts.oauth2.initTokenClient({client_id:client,scope:'https://www.googleapis.com/auth/drive.file',callback:r=>{clearTimeout(timeout);r.error?reject(new Error(r.error_description||r.error)):(token=r.access_token,resolve())}});
      timeout=setTimeout(()=>reject(new Error('Google sign-in did not finish. Return to zMinutes and tap Sync now again.')),90000);c.requestAccessToken();
    });
  }
  async function api(url,options={}){
    const r=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+token}});
    if(!r.ok){const detail=(await r.text()).slice(0,160);if(r.status===401){token='';throw new Error('Google Drive authorization expired. Tap Sync now and grant access again.')}throw new Error('Drive returned '+r.status+': '+detail)}return r;
  }
  async function getFolder(){
    if(folder)return folder;
    const q=encodeURIComponent("name='zMinutes' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const list=await(await api('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)')).json();
    if(list.files?.length)return folder=list.files[0].id;
    const created=await(await api('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'zMinutes',mimeType:'application/vnd.google-apps.folder'})})).json();
    return folder=created.id;
  }
  async function findFile(fid){
    const q=encodeURIComponent("name='zminutes-sync.json' and '"+fid+"' in parents and trashed=false");
    const x=await(await api('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime)')).json();return x.files?.[0]||null;
  }
  async function writeFile(fid,file,data,name='zminutes-sync.json'){
    const boundary='zminutes_'+crypto.randomUUID().replaceAll('-',''),metadata=file?{name}:{name,mimeType:'application/json',parents:[fid]};
    const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n',JSON.stringify(data),'\r\n--'+boundary+'--']);
    const url=file?'https://www.googleapis.com/upload/drive/v3/files/'+file.id+'?uploadType=multipart&fields=id,name,modifiedTime':'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';
    return(await api(url,{method:file?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();
  }
  async function readFile(id){return(await api('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media')).json()}
  async function sync(showErrors=true){
    if(syncing){status('Sync is already running…');return}
    if(!navigator.onLine){status('Offline · local data is safe; sync when online');return}
    syncing=true;
    try{
      status('Connecting to Drive…');if(!token)await authorize();
      const fid=await getFolder(),remote=await findFile(fid),saved=read(META,null),dirty=!!window.zmDriveDirty;
      if(remote){
        const hasLocalContent=meetings.length>0||taskData.length>0||fieldData.length>0||projectData.some(p=>p.id!=='inbox');
        if(!saved&&!dirty&&!hasLocalContent){const data=await readFile(remote.id);await restore(data);localStorage.setItem(META,JSON.stringify({fileId:remote.id,modifiedTime:remote.modifiedTime}));window.zmDriveDirty=false;status('Drive data downloaded to this device');return}
        const changed=saved?.fileId===remote.id&&saved.modifiedTime&&saved.modifiedTime!==remote.modifiedTime;
        if((changed&&dirty)||(!saved&&dirty)){
          const takeRemote=confirm('Drive and this device both changed. OK = download Drive after saving a local backup. Cancel = keep local and save a separate conflict copy.');
          const data=await readFile(remote.id);
          if(takeRemote){download(snapshot(true),'zMinutes-conflict-local-'+Date.now()+'.json');await restore(data);window.zmDriveDirty=false}
          else{await writeFile(fid,null,snapshot(false),'zminutes-conflict-local-'+Date.now()+'.json');window.zmDriveDirty=false;status('Conflict copy saved · main Drive file unchanged');return}
        }else if(!dirty&&(!saved||changed)){
          const takeRemote=confirm('Google Drive has newer or unlinked data. OK = save a local backup, then restore Drive. Cancel = keep this device data and save it as a separate conflict copy; the main Drive backup will not be replaced.');
          if(takeRemote){const data=await readFile(remote.id);download(snapshot(true),'zMinutes-before-drive-'+Date.now()+'.json');await restore(data);window.zmDriveDirty=false}
          else{await writeFile(fid,null,snapshot(false),'zminutes-conflict-local-'+Date.now()+'.json');localStorage.setItem(META,JSON.stringify({fileId:remote.id,modifiedTime:remote.modifiedTime}));window.zmDriveDirty=false;status('Local copy saved separately · main Drive file unchanged');return}
        }
      }
      const uploadVersion=changeVersion,uploaded=await writeFile(fid,remote,snapshot(false));
      localStorage.setItem(META,JSON.stringify({fileId:uploaded.id,modifiedTime:uploaded.modifiedTime}));window.zmDriveDirty=changeVersion!==uploadVersion;
      status(window.zmDriveDirty?'Drive synced · newer changes are waiting':'Drive synced · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
    }catch(err){console.error(err);status('Sync needs attention · '+err.message);if(showErrors)alert('Google Drive sync could not finish: '+err.message+'\nYour local data is unchanged.')}
    finally{syncing=false;if(window.zmDriveDirty&&token&&navigator.onLine){clearTimeout(window.zmDriveTimer);window.zmDriveTimer=setTimeout(()=>sync(false),2500)}}
  }
  $('syncBtn').onclick=()=>sync(true);
  $('syncSettingsBtn').onclick=()=>sync(true);
  if(localStorage.getItem(CLIENT)){status(navigator.onLine?'Drive configured · tap Sync now':'Offline · saved locally');if(navigator.onLine)loadGIS().catch(()=>{})}
  else{$('syncSettingsBtn').disabled=true;status('Not connected · add a Client ID to enable cross-device sync')}
})();
