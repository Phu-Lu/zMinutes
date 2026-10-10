/* Portable local backups and optional per-user Google Drive sync. Raw audio is excluded from Drive. */
(() => {
  const $=id=>document.getElementById(id), CLIENT='zminutes-drive-client-id', META='zminutes-drive-meta';
  let token='',folder='';
  const read=(key,f)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??f}catch{return f}};
  const status=s=>{if($('syncState'))$('syncState').textContent=s};
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
    window.zmDriveDirty=true;if(token){clearTimeout(window.zmDriveTimer);window.zmDriveTimer=setTimeout(()=>sync(false),2500)}
  });
  window.addEventListener('online',()=>{if(token)sync(false)});

  function loadGIS(){
    return new Promise((resolve,reject)=>{
      if(window.google?.accounts?.oauth2)return resolve();let s=document.querySelector('script[data-gis]');
      if(!s){s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.dataset.gis='1';document.head.append(s)}
      s.onload=()=>window.google?.accounts?.oauth2?resolve():reject(new Error('Google sign-in did not initialize'));
      s.onerror=()=>reject(new Error('Could not load Google sign-in. Check the connection.'));
    });
  }
  async function authorize(){
    await loadGIS();let client=localStorage.getItem(CLIENT);
    if(!client){client=prompt('Enter Google OAuth Web Client ID. Register this exact zMinutes origin in Google Cloud Console.');if(!client)throw new Error('Google Client ID is required');localStorage.setItem(CLIENT,client.trim())}
    await new Promise((resolve,reject)=>{
      const c=google.accounts.oauth2.initTokenClient({client_id:client,scope:'https://www.googleapis.com/auth/drive.file',callback:r=>r.error?reject(new Error(r.error_description||r.error)):(token=r.access_token,resolve())});
      c.requestAccessToken({prompt:token?'':'consent'});
    });
  }
  async function api(url,options={}){
    const r=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+token}});
    if(!r.ok)throw new Error('Drive returned '+r.status+': '+(await r.text()).slice(0,160));return r;
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
    if(!navigator.onLine){status('Offline · Drive sync queued');return}
    try{
      status('Connecting to Drive…');if(!token)await authorize();
      const fid=await getFolder(),remote=await findFile(fid),saved=read(META,null),dirty=!!window.zmDriveDirty;
      if(remote){
        const changed=saved?.fileId===remote.id&&saved.modifiedTime&&saved.modifiedTime!==remote.modifiedTime;
        if((changed&&dirty)||(!saved&&dirty)){
          const takeRemote=confirm('Drive and this device both changed. OK = download Drive after saving a local backup. Cancel = keep local and save a separate conflict copy.');
          const data=await readFile(remote.id);
          if(takeRemote){download(snapshot(true),'zMinutes-conflict-local-'+Date.now()+'.json');await restore(data);window.zmDriveDirty=false}
          else{await writeFile(fid,null,snapshot(false),'zminutes-conflict-local-'+Date.now()+'.json');status('Conflict copy saved · main Drive file unchanged');return}
        }else if(!dirty&&(!saved||changed)){
          const takeRemote=confirm('A different zMinutes backup exists in Google Drive. OK = save a local backup, then restore Drive. Cancel = keep this device data and upload it.');
          if(takeRemote){const data=await readFile(remote.id);download(snapshot(true),'zMinutes-before-drive-'+Date.now()+'.json');await restore(data);window.zmDriveDirty=false}
        }
      }
      const uploaded=await writeFile(fid,remote,snapshot(false));
      localStorage.setItem(META,JSON.stringify({fileId:uploaded.id,modifiedTime:uploaded.modifiedTime}));window.zmDriveDirty=false;
      status('Drive synced · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
    }catch(err){console.error(err);status('Drive sync paused');if(showErrors)alert('Google Drive sync could not finish: '+err.message+'\nYour local data is unchanged.')}
  }
  $('syncBtn').onclick=()=>sync(true);
  if(localStorage.getItem(CLIENT))status(navigator.onLine?'Local · Drive configured':'Offline · saved locally');
})();
