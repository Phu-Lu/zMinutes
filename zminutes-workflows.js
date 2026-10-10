/* Unified local workflows for Tasks, Calendar, stakeholders and recovery migration. */
(() => {
  const $z=id=>document.getElementById(id), DAY=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  let selectedDay=DAY();
  const safeRead=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  function normalize(){
    meetings=Array.isArray(meetings)?meetings.filter(m=>m&&typeof m==='object'):[];
    meetings.forEach(m=>{m.title=String(m.title||'');m.location=String(m.location||'');m.note=String(m.note||'');m.projectId||='inbox';m.agenda=Array.isArray(m.agenda)?m.agenda:[];m.photos=Array.isArray(m.photos)?m.photos:[];m.stakeholders=Array.isArray(m.stakeholders)?m.stakeholders:[];m.transcript=typeof m.transcript==='string'?m.transcript:'';m.cloudAudioAllowed=!!m.cloudAudioAllowed});
    projectData=Array.isArray(projectData)?projectData.filter(p=>p&&typeof p==='object'&&typeof p.id==='string'&&p.id.trim()&&typeof p.name==='string'&&p.name.trim()):[];
    if(!projectData.length)projectData=[{id:'inbox',name:'Inbox',color:'#0078d4',createdAt:Date.now()}];
    taskData=Array.isArray(taskData)?taskData:[];fieldData=Array.isArray(fieldData)?fieldData:[];
  }
  async function hydrate(){
    const legacy=[safeRead('meeting-note-data',[]),safeRead('zminutes-projects-v1',[]),safeRead('zminutes-tasks-v1',[]),safeRead('zminutes-field-notes-v1',[])];
    try{
      const db=await Promise.all(['meetings','projects','tasks','fieldNotes'].map(k=>ZMinutesStore.get(k)));
      meetings=Array.isArray(db[0])&& (db[0].length||!legacy[0]?.length)?db[0]:(Array.isArray(legacy[0])?legacy[0]:[]);
      projectData=Array.isArray(db[1])&&db[1].length?db[1]:(Array.isArray(legacy[1])&&legacy[1].length?legacy[1]:projectData);
      taskData=Array.isArray(db[2])&&(db[2].length||!legacy[2]?.length)?db[2]:(Array.isArray(legacy[2])?legacy[2]:[]);
      fieldData=Array.isArray(db[3])&&(db[3].length||!legacy[3]?.length)?db[3]:(Array.isArray(legacy[3])?legacy[3]:[]);
    }catch(e){console.warn('Using browser storage fallback:',e);meetings=Array.isArray(legacy[0])?legacy[0]:meetings;projectData=Array.isArray(legacy[1])&&legacy[1].length?legacy[1]:projectData;taskData=Array.isArray(legacy[2])?legacy[2]:taskData;fieldData=Array.isArray(legacy[3])?legacy[3]:fieldData}
    normalize();
    if(!projectData.some(p=>p.id==='inbox'))projectData.unshift({id:'inbox',name:'Inbox',color:'#0078d4',createdAt:Date.now()});
    meetings.forEach(m=>{if(!projectData.some(p=>p.id===m.projectId))m.projectId='inbox'});
    PROJECTS.splice(0,PROJECTS.length,...projectData);if(!PROJECTS.some(p=>p.id===navState.project))navState.project='inbox';
    renderSidebar();renderSection(navState.section);renderOverview();if(current){current=meetings.find(m=>m.id===current.id)||null;if(current)renderEditor()}
    if($z('syncState'))$z('syncState').textContent=navigator.onLine?'Local · ready':'Offline · saved locally';
    try{await Promise.all([['meetings',meetings],['projects',projectData],['tasks',taskData],['fieldNotes',fieldData]].map(([k,v])=>ZMinutesStore.put(k,v,true)))}catch(e){console.warn('Local database write failed; app remains usable with browser-storage fallback.',e)}
  }
  window.addEventListener('online',()=>{if($z('syncState'))$z('syncState').textContent='Online · local data saved'});
  window.addEventListener('offline',()=>{if($z('syncState'))$z('syncState').textContent='Offline · queued locally'});
  $z('newMeetingDialog').querySelector('.dialog-close').onclick=()=>$z('newMeetingDialog').close();

  const late=t=>t.status!=='done'&&t.due&&t.due<DAY();
  const taskState=t=>t.status==='done'?'Completed':late(t)?'Overdue':'In progress';
  function renderTasks(){
    const items=taskData.filter(t=>t.projectId===navState.project).sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999')));
    $z('placeholderView').innerHTML=secHead('Tasks','Add a task on its own or link it to a meeting. Status is saved on this device.')+
    '<section class="task-create ov-card"><h2>Add a task</h2><form id="taskForm" class="task-form"><input id="taskTitle" required maxlength="240" placeholder="What needs to be done?"><input id="taskDue" type="date" value="'+selectedDay+'"><select id="taskMeeting"><option value="">No linked meeting</option>'+activeMeetings().map(m=>'<option value="'+esc(m.id)+'">'+esc(m.title||'Untitled meeting')+'</option>').join('')+'</select><button class="primary" type="submit">+ Add task</button></form></section>'+
    '<section class="ov-card"><div class="ov-card-head"><h2>Project tasks</h2><span class="task-count">'+items.length+' total</span></div>'+
    (items.length?items.map(t=>'<article class="task-card"><span class="signal '+(t.status==='done'?'green':late(t)?'red':'amber')+'" title="'+taskState(t)+'"></span><div><strong>'+esc(t.title)+'</strong><small>'+(t.due?'Due '+new Date(t.due+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'No due date')+' · '+taskState(t)+(t.meetingId?' · '+esc(meetings.find(m=>m.id===t.meetingId)?.title||'Meeting'):'')+'</small><details class="task-edit"><summary>Edit</summary><form data-task-edit="'+esc(t.id)+'"><input name="title" required value="'+esc(t.title)+'" aria-label="Task title"><input name="due" type="date" value="'+esc(t.due||'')+'" aria-label="Due date"><button class="secondary">Save changes</button></form></details></div><select data-task-status="'+esc(t.id)+'" aria-label="Status"><option value="in-progress" '+(t.status!=='done'?'selected':'')+'>In progress</option><option value="done" '+(t.status==='done'?'selected':'')+'>Completed</option></select><button class="mini-delete" data-delete-task="'+esc(t.id)+'" aria-label="Delete task">×</button></article>').join(''):'<div class="empty-note">No tasks yet. Add one above.</div>')+'</section>';
  }
  function dayItems(day){
    return [...activeMeetings().filter(m=>String(m.date||'').slice(0,10)===day).map(m=>({kind:'Meeting',title:m.title||'Untitled meeting',id:m.id,date:m.date,sub:m.location||'Open meeting'})),
      ...taskData.filter(t=>t.projectId===navState.project&&t.due===day).map(t=>({kind:'Task',title:t.title,id:t.meetingId,sub:taskState(t)}))];
  }
  function renderCalendar(){
    const [y,m]=selectedDay.split('-').map(Number),first=new Date(y,m-1,1),start=new Date(y,m-1,1-first.getDay());
    const cells=Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i)).map(d=>{
      const key=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10),n=dayItems(key).length;
      return '<button class="cal-day'+(d.getMonth()!==m-1?' outside':'')+(key===selectedDay?' selected':'')+'" data-day="'+key+'"><span>'+d.getDate()+'</span>'+(n?'<i aria-label="'+n+' items"></i>':'')+'</button>';
    }).join('');
    const items=dayItems(selectedDay),title=first.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    $z('placeholderView').innerHTML=secHead('Calendar','Choose a date to see meetings and deadlines, or create an item for that day.')+
    '<section class="ov-card calendar-card"><div class="calendar-toolbar"><button class="secondary" data-month="-1" aria-label="Previous month">‹</button><h2>'+title+'</h2><div><button class="secondary" data-today>Today</button> <button class="secondary" data-month="1" aria-label="Next month">›</button></div></div><div class="calendar-grid calendar-weekdays">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="calendar-grid">'+cells+'</div><div class="calendar-selected"><h3>'+new Date(selectedDay+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})+'</h3><div class="calendar-create"><button class="primary" data-create-meeting>+ Meeting</button><button class="secondary" data-create-task>+ Task</button></div>'+
    (items.length?items.map(x=>'<button class="calendar-entry" '+(x.kind==='Meeting'&&x.id?'data-open="'+esc(x.id)+'"':'')+'><span class="calendar-type">'+x.kind+'</span><strong>'+esc(x.title)+'</strong><small>'+esc(x.sub)+(x.date?' · '+new Date(x.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'')+'</small></button>').join(''):'<p class="empty-note">Nothing scheduled for this date.</p>')+'</div><div class="calendar-toolbar"><span>Export project meetings</span><button id="icsBtn" class="link-btn">↓ Export .ics</button></div></section>';
  }
  function renderSection(sec){
    if(sec==='tasks')return renderTasks();if(sec==='calendar')return renderCalendar();if(sec==='field')return renderFieldNotes();
    if(sec==='files')$z('placeholderView').innerHTML=secHead('Files','Open a meeting to export PDF, Word, or a meeting package.')+'<div class="ov-card">Use Backup in the top bar to export local data.</div>';
  }
  window.renderSection=renderSection;window.renderTasks=renderTasks;window.renderCalendar=renderCalendar;

  const templates={project:['Progress since last meeting','Current blockers','Decisions needed','Next actions'],site:['Site conditions','Safety and access','Issues observed','Required follow-up'],oneonone:['Check-in','Wins and challenges','Topics to discuss','Next steps']};
  const baseNew=newMeeting,baseOpen=openMeeting;
  newMeeting=function(title='',date=nowLocal()){baseNew(title,date);if(current){current.stakeholders||=[];current.transcript||='';try{const cfg=JSON.parse(localStorage.getItem('zminutes-ai-settings-v1')||'{}');if(typeof current.cloudAudioAllowed!=='boolean')current.cloudAudioAllowed=!!cfg.cloudAudio}catch{}persist()}};
  openMeeting=function(id){baseOpen(id);if(current){current.stakeholders||=[];current.transcript||='';try{const cfg=JSON.parse(localStorage.getItem('zminutes-ai-settings-v1')||'{}');if(typeof current.cloudAudioAllowed!=='boolean')current.cloudAudioAllowed=!!cfg.cloudAudio}catch{}renderEditor()}};
  renderEditor=function(){
    if(!current)return;$z('agendaBadge').textContent=current.agenda.length;$z('photoBadge').textContent=current.photos.length;
    if($z('stakeholderBadge'))$z('stakeholderBadge').textContent=current.stakeholders.length;
    renderAgenda();renderPhotos();renderSummary();renderPeople();$z('transcriptInput').value=current.transcript||'';$z('meetingCloudAudioEnabled').checked=!!current.cloudAudioAllowed;
    document.querySelectorAll('.tabs [data-tab]').forEach(b=>{const selected=b.dataset.tab===activeTab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected))});
    ['note','agenda','field','summary','stakeholders'].forEach(x=>$z(x+'Panel')?.classList.toggle('hidden',x!==activeTab));
  };
  function renderPeople(){
    const box=$z('stakeholderList');if(!box||!current)return;
    box.innerHTML=current.stakeholders.map((p,i)=>'<article class="stakeholder-row"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.role||'No role specified')+'</small></div><select data-person-status="'+i+'"><option value="invited" '+((p.status||'invited')==='invited'?'selected':'')+'>Invited</option><option value="attended" '+(p.status==='attended'?'selected':'')+'>Attended</option><option value="not-attended" '+(p.status==='not-attended'?'selected':'')+'>Did not attend</option></select><button class="mini-delete" data-delete-person="'+i+'" aria-label="Remove person">×</button></article>').join('')||'<p class="empty-note">No stakeholders added yet.</p>';
  }

  document.addEventListener('submit',e=>{
    const f=e.target;
    if(f.id==='taskForm'){e.preventDefault();e.stopImmediatePropagation();taskData.push({id:uid(),projectId:navState.project,meetingId:$z('taskMeeting').value||null,title:$z('taskTitle').value.trim(),due:$z('taskDue').value,status:'in-progress',created:Date.now(),updated:Date.now()});saveTasks();renderTasks();return}
    if(f.matches('[data-task-edit]')){e.preventDefault();e.stopImmediatePropagation();const t=taskData.find(a=>a.id===f.dataset.taskEdit);if(t){t.title=f.elements.title.value.trim();t.due=f.elements.due.value;t.updated=Date.now();saveTasks();renderTasks()}return}
    if(f.id==='fieldForm'){e.preventDefault();e.stopImmediatePropagation();const photos=[...$z('fieldPreview').querySelectorAll('img')].map(x=>x.src);fieldData.push({id:uid(),projectId:navState.project,title:$z('fieldTitle').value.trim(),location:$z('fieldLocation').value.trim(),text:$z('fieldText').value.trim(),photos,updated:Date.now()});saveFields();renderFieldNotes();return}
    if(f.id==='stakeholderForm'){e.preventDefault();e.stopImmediatePropagation();current.stakeholders.push({id:uid(),name:$z('stakeholderName').value.trim(),role:$z('stakeholderRole').value.trim(),status:'invited'});f.reset();persist();renderEditor();return}
    if(f.id==='newMeetingForm'){e.preventDefault();e.stopImmediatePropagation();const dialog=$z('newMeetingDialog'),title=$z('newTitle').value.trim(),date=$z('newDate').value||nowLocal(),qs=templates[$z('meetingTemplateSelect').value]||[];try{newMeeting(title,date);if(current&&qs.length){current.agenda.push(...qs.map(text=>({id:uid(),text,note:'',done:false})));persist();renderEditor()}f.reset()}catch(err){console.error('Could not create meeting:',err);alert('The meeting could not be created. Your entered title is still available; please try again.');return}finally{if(dialog.open)dialog.close()}}
  },true);
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('[data-task-status]')){e.stopImmediatePropagation();const x=taskData.find(a=>a.id===t.dataset.taskStatus);if(x){x.status=t.value;x.updated=Date.now();saveTasks();renderTasks()}return}
    if(t.matches('[data-person-status]')&&current){current.stakeholders[Number(t.dataset.personStatus)].status=t.value;persist();renderPeople();return}
    if(t.id==='meetingCloudAudioEnabled'&&current){current.cloudAudioAllowed=t.checked;persist()}
  },true);
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.closest('.tabs')&&b.dataset.tab){e.preventDefault();e.stopImmediatePropagation();activeTab=b.dataset.tab;renderEditor();return}
    if(b.dataset.day){selectedDay=b.dataset.day;renderCalendar();return}
    if(b.dataset.month){const[y,m]=selectedDay.split('-').map(Number),d=new Date(y,m-1+Number(b.dataset.month),1);selectedDay=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);renderCalendar();return}
    if(b.hasAttribute('data-today')){selectedDay=DAY();renderCalendar();return}
    if(b.hasAttribute('data-create-meeting')){newMeeting('',selectedDay+'T09:00');return}
    if(b.hasAttribute('data-create-task')){showSection('tasks');$z('taskDue').value=selectedDay;$z('taskTitle').focus();return}
    if(b.dataset.deleteTask){e.stopImmediatePropagation();taskData=taskData.filter(t=>t.id!==b.dataset.deleteTask);saveTasks();renderTasks();return}
    if(b.dataset.deletePerson&&current){e.stopImmediatePropagation();current.stakeholders.splice(Number(b.dataset.deletePerson),1);persist();renderEditor();return}
    if(b.dataset.open){e.stopImmediatePropagation();activeTab=b.dataset.tab||'note';openMeeting(b.dataset.open);return}
    if(b.id==='icsBtn'){e.stopImmediatePropagation();const l=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//zMinutes//EN'];activeMeetings().filter(m=>m.date).forEach(m=>{const s=new Date(m.date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');l.push('BEGIN:VEVENT','UID:'+m.id+'@zminutes','DTSTART:'+s,'SUMMARY:'+String(m.title||'Meeting').replace(/[,;]/g,' '),'END:VEVENT')});l.push('END:VCALENDAR');download(new Blob([l.join('\r\n')],{type:'text/calendar'}),'zMinutes-'+navState.project+'.ics')}
  },true);
  const baseHome=renderHome;
  renderHome=function(q=''){
    const list=$z('meetingList');if(!list)return baseHome(q);
    const term=q.toLowerCase(),items=activeMeetings().filter(m=>[m.title,m.location,m.note,m.transcript,...(m.stakeholders||[]).map(p=>p.name+' '+(p.role||''))].join(' ').toLowerCase().includes(term)).sort((a,b)=>(b.updated||0)-(a.updated||0));
    $z('meetingCount').textContent=items.length?items.length+' meeting(s) in this project':'No matching meetings';list.innerHTML='';
    if(!items.length){list.innerHTML='<div class="empty-note">No meetings found. Try another search or create a meeting.</div>';return}
    items.forEach(m=>{const t=$z('meetingTemplate').content.cloneNode(true),a=t.querySelector('.card-main');t.querySelector('.meeting-date').textContent=new Date(m.date||Date.now()).toLocaleDateString('en-US',{day:'2-digit',month:'short'});t.querySelector('strong').textContent=m.title||'Untitled meeting';t.querySelector('small').textContent=formatDate(m.date);a.onclick=()=>openMeeting(m.id);t.querySelector('.delete-btn').onclick=e=>{e.stopPropagation();if(confirm('Delete this meeting?')){meetings=meetings.filter(x=>x.id!==m.id);persist();refreshSection()}};list.append(t)})
  };
  hydrate();
})();
