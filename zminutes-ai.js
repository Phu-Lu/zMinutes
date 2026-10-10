/* Multiple summary providers and opt-in post-recording cloud transcription. */
(() => {
  const $z=id=>document.getElementById(id), tick=String.fromCharCode(96), CONFIG_KEY='zminutes-ai-settings-v1';
  let savedConfig={};
  try{savedConfig=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')||{}}catch{savedConfig={}}
  let selectedProvider=savedConfig.provider||$z('aiProvider').value;
  if(savedConfig.provider)$z('aiProvider').value=savedConfig.provider;
  if(savedConfig.model)$z('aiModel').value=savedConfig.model;
  $z('aiApiKey').value=savedConfig.keys?.[savedConfig.provider||$z('aiProvider').value]||savedConfig.key||'';
  if(savedConfig.url)$z('ollamaUrl').value=savedConfig.url;
  if(savedConfig.transcriptionProvider)$z('transcriptionProvider').value=savedConfig.transcriptionProvider;
  if(savedConfig.transcriptionKey)$z('transcriptionApiKey').value=savedConfig.transcriptionKey;
  if(typeof savedConfig.cloudAudio==='boolean')$z('cloudAudioEnabled').checked=savedConfig.cloudAudio;
  function saveAiSettings(showStatus=true){
    const provider=$z('aiProvider').value,keys={...(savedConfig.keys||{})};keys[provider]=$z('aiApiKey').value.trim();
    const value={provider,model:$z('aiModel').value.trim(),keys,url:$z('ollamaUrl').value.trim(),transcriptionProvider:$z('transcriptionProvider').value,transcriptionKey:$z('transcriptionApiKey').value.trim(),cloudAudio:$z('cloudAudioEnabled').checked};
    try{savedConfig=value;localStorage.setItem(CONFIG_KEY,JSON.stringify(value));localStorage.setItem('meeting-note-ai',JSON.stringify({provider:value.provider,model:value.model,url:value.url}));$z('aiSaveStatus').textContent=showStatus?'Saved on this device.':'Changes not saved yet.';return true}catch(e){$z('aiSaveStatus').textContent='Could not save settings in this browser.';console.warn('Could not save AI preferences',e);return false}
  }
  function refreshAiSettings(){const p=$z('aiProvider').value,local=p==='ollama',quick=p==='quick';$z('apiKeyField').classList.toggle('hidden',local||quick);$z('ollamaUrlField').classList.toggle('hidden',!local);$z('apiKeyLabel').textContent=p==='gemini'?'Gemini API key':p==='openai'?'OpenAI API key':'API key';$z('aiHelp').textContent=quick?'No API request is made. zMinutes creates a structured draft from your notes.':local?'Uses a model installed in Ollama on this computer.':p==='gemini'?'Get a Gemini API key from Google AI Studio. It is saved only in this browser on this device.':'Use an OpenAI API key. ChatGPT subscriptions and API billing are separate.';}
  refreshAiSettings();
  $z('aiProvider').addEventListener('change',()=>{const defaults={gemini:'gemini-2.5-flash',openai:'gpt-4.1-mini',ollama:'qwen2.5:3b',quick:''},provider=$z('aiProvider').value;savedConfig.keys={...(savedConfig.keys||{}),[selectedProvider]:$z('aiApiKey').value.trim()};selectedProvider=provider;$z('aiModel').value=defaults[provider];$z('aiModel').dataset.provider=provider;$z('aiApiKey').value=savedConfig.keys[provider]||'';refreshAiSettings();saveAiSettings(false)});
  $z('saveAiSettingsBtn').addEventListener('click',()=>{if(saveAiSettings(true))$z('aiSaveStatus').textContent='AI settings saved on this device.'});
  $z('clearAiKeysBtn').addEventListener('click',()=>{if(!confirm('Clear the saved AI and transcription API keys from this browser?'))return;$z('aiApiKey').value='';$z('transcriptionApiKey').value='';savedConfig.keys={};saveAiSettings(true);$z('aiSaveStatus').textContent='Saved API keys cleared from this device.'});
  ['aiModel','aiApiKey','ollamaUrl','transcriptionProvider','transcriptionApiKey','cloudAudioEnabled'].forEach(id=>$z(id).addEventListener('input',()=>{$z('aiSaveStatus').textContent='Unsaved changes — select Save AI settings.'}));
  function quickDraft(){
    const lines=[current.transcript||'',current.note||'',...(current.agenda||[]).flatMap(a=>[a.text,a.note||''])].join('\n').split(/\n+/).map(x=>x.trim()).filter(Boolean);
    const list=a=>a.length?'<ul>'+a.map(x=>'<li>'+esc(x.replace(/^[✓◇!-]\s*/,''))+'</li>').join('')+'</ul>':'<p>None captured.</p>';
    return '<h3>Overview</h3><p>'+esc(lines.slice(0,4).join(' ')||'No notes or transcript captured yet.')+'</p><h3>Decisions</h3>'+list(lines.filter(x=>/decision|decided|agree|approved|◇/i.test(x)))+'<h3>Action items</h3>'+list(lines.filter(x=>/action|todo|task|deadline|✓|follow.?up/i.test(x)))+'<h3>Open questions</h3>'+list(current.agenda.filter(a=>!a.done).map(a=>a.text))+'<h3>Field notes</h3><p>'+current.photos.length+' photo(s) attached.</p>';
  }
  function promptText(){
    return 'Write concise, accurate English meeting notes as HTML using only h3, p, ul, li, strong. Sections: Overview, Decisions, Action items, Open questions, Field notes. Do not invent facts.\nMeeting: '+current.title+'\nDate: '+formatDate(current.date)+'\nStakeholders: '+(current.stakeholders||[]).map(p=>p.name+(p.role?' — '+p.role:'')).join(', ')+'\nAgenda: '+current.agenda.map(a=>'- '+a.text+(a.note?' ('+a.note+')':'')).join('\n')+'\nTranscript:\n'+(current.transcript||'None')+'\nNotes:\n'+(current.note||'None');
  }
  function sanitize(raw){
    const t=document.createElement('template');t.innerHTML=String(raw||'').split(tick.repeat(3)+'html').join('').split(tick.repeat(3)).join('');
    const allowed=new Set(['H3','P','UL','OL','LI','STRONG','B','EM','BR']);
    const walk=n=>[...n.childNodes].forEach(c=>{if(c.nodeType===Node.ELEMENT_NODE){if(!allowed.has(c.tagName))c.replaceWith(document.createTextNode(c.textContent||''));else{[...c.attributes].forEach(a=>c.removeAttribute(a.name));walk(c)}}});
    walk(t.content);return t.innerHTML||'<p>No recap returned.</p>';
  }
  async function callText(prompt){
    const p=$z('aiProvider').value,model=$z('aiModel').value.trim(),key=$z('aiApiKey').value.trim(),url=($z('ollamaUrl').value||'http://localhost:11434').replace(/\/$/,'');
    if(p==='quick')return quickDraft();
    if(p==='ollama'){
      const r=await fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],stream:false,options:{temperature:.2}})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Ollama request failed');return d.message?.content||'';
    }
    if(!key)throw new Error('Enter the selected AI provider API key.');
    if(p==='gemini'){
      const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.2}})});
      const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'Gemini request failed');return d.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
    }
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,input:prompt,temperature:.2})});
    const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'OpenAI request failed');return d.output_text||d.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('')||'';
  }
  generateSummary=async function(){
    if(!current)return;saveAiSettings(false);saveCurrent();const b=$z('generateSummaryBtn'),s=$z('aiStatus');b.disabled=true;b.textContent='Generating…';s.textContent='Preparing recap…';
    try{current.summary=sanitize(await callText(promptText()));s.textContent=$z('aiProvider').value==='quick'?'Offline quick draft · not an LLM':'Recap generated'}
    catch(e){console.warn(e);current.summary=quickDraft();s.textContent='Provider unavailable · offline draft used';if(!current.note&&!current.transcript)alert(e.message+'\nAn offline draft was created from available content.')}
    finally{saveCurrent();renderSummary();b.disabled=false;b.textContent='✦ Generate recap'}
  };
  function asDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}
  async function toWavParts(blob,seconds=90){
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return[blob];
    const ctx=new C();
    try{
      const audio=await ctx.decodeAudioData(await blob.arrayBuffer()),rate=16000,hop=Math.max(1,Math.floor(audio.sampleRate/rate)),total=Math.ceil(audio.length/hop),per=seconds*rate,chs=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)),out=[];
      for(let start=0;start<total;start+=per){
        const n=Math.min(per,total-start),buf=new ArrayBuffer(44+n*2),v=new DataView(buf),w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
        w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
        for(let i=0;i<n;i++){let x=0;for(const c of chs)x+=c[Math.min((start+i)*hop,c.length-1)]||0;x=Math.max(-1,Math.min(1,x/chs.length));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}
        out.push(new Blob([buf],{type:'audio/wav'}))
      }return out
    }finally{await ctx.close()}
  }
  async function transcribePart(blob,p,key){
    if(p==='openai'){
      const f=new FormData();f.append('file',blob,'meeting-segment.wav');f.append('model','gpt-4o-mini-transcribe');
      const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:f}),d=await r.json();if(!r.ok)throw new Error(d.error?.message||'OpenAI transcription failed');return d.text||''
    }
    const b64=(await asDataUrl(blob)).split(',')[1];
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:'Transcribe all speech verbatim in its original language. Return only the transcript.'},{inlineData:{mimeType:'audio/wav',data:b64}}]}]})});
    const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'Gemini transcription failed');return d.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||''
  }
  async function transcribe(blob){
    if(!current.cloudAudioAllowed)return;
    const p=$z('transcriptionProvider').value,key=$z('transcriptionApiKey').value.trim()||(p===$z('aiProvider').value?$z('aiApiKey').value.trim():'');
    if(!key){$z('transcriptStatus').textContent='Audio saved locally · enter a transcription key to transcribe';return}
    try{
      const parts=await toWavParts(blob),text=[];
      for(let i=0;i<parts.length;i++){
        $z('transcriptStatus').textContent='Transcribing segment '+(i+1)+' of '+parts.length+'…';
        text.push(await transcribePart(parts[i],p,key));current.transcript=text.filter(Boolean).join('\n');$z('transcriptInput').value=current.transcript;$z('transcriptText').textContent='Draft transcript · review names and details';saveCurrent();
        if((i+1)%2===0){try{current.summary=sanitize(await callText(promptText()));saveCurrent();renderSummary()}catch{}}
      }
      $z('transcriptStatus').textContent='Transcript complete · review before sharing';await generateSummary()
    }catch(e){console.error(e);$z('transcriptStatus').textContent='Transcription failed · audio remains local';alert('Transcription failed: '+e.message+'\nThe recording remains saved on this device.')}
  }
  let recorder,stream,timer;
  function recordMessage(error){
    switch(error?.name){
      case 'NotAllowedError':case 'PermissionDeniedError':case 'SecurityError':return 'Microphone access was blocked. Check the site permission and your phone’s microphone privacy setting.';
      case 'NotFoundError':case 'DevicesNotFoundError':return 'No microphone was found. Connect one or check your device settings.';
      case 'NotReadableError':case 'TrackStartError':return 'The microphone is busy or unavailable to this browser. Close other recording apps and try again.';
      case 'OverconstrainedError':return 'This microphone does not support the requested recording settings.';
      case 'NotSupportedError':return 'This browser cannot record audio in a supported format.';
      default:return 'Recording could not start'+(error?.message?': '+error.message:'. Try again in Chrome or Edge.');
    }
  }
  function recordStatus(message,error=false){const s=$z('recordStatus');s.textContent=message;s.classList.toggle('error',error)}
  function resetRecordUi(label){
    clearInterval(timer);$z('recordDot').classList.remove('live');$z('recordLabel').textContent=label;
    $z('recordBtn').classList.remove('live');$z('recordBtn span').textContent='Record';$z('recordBtn').disabled=false;
  }
  toggleRecord=async function(){
    if(recorder?.state==='recording'){recorder.stop();$z('recordBtn').disabled=true;recordStatus('Saving audio on this device…');return}
    if(recorder||!current)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){recordStatus('Recording needs HTTPS or localhost and a browser with microphone support.',true);return}
    if(!window.MediaRecorder){recordStatus('This browser does not support audio recording. Try Chrome or Edge.',true);return}
    const meeting=current,button=$z('recordBtn');let acquiredStream;
    button.disabled=true;recordStatus('Connecting to microphone…');
    try{
      saveCurrent();
      acquiredStream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported?.(type));
      const activeRecorder=new MediaRecorder(acquiredStream,mime?{mimeType:mime}:undefined),recordedParts=[];
      recorder=activeRecorder;stream=acquiredStream;
      activeRecorder.ondataavailable=e=>{if(e.data?.size)recordedParts.push(e.data)};
      activeRecorder.onerror=e=>{console.error('Recording failed:',e.error||e);recordStatus(recordMessage(e.error),true)};
      activeRecorder.onstop=async()=>{
        const finishedStream=stream;finishedStream?.getTracks().forEach(track=>track.stop());stream=null;
        resetRecordUi('Not recording');$z('recordBtn').disabled=true;
        try{
          const blob=new Blob(recordedParts,{type:activeRecorder.mimeType||recordedParts[0]?.type||'audio/webm'});
          if(!blob.size)throw new Error('The microphone produced no audio. Check the device input and try again.');
          meeting.audio=await asDataUrl(blob);persist();
          if(current?.id===meeting.id){
            $z('recordLabel').textContent='Audio saved locally';recordStatus('Audio saved on this device.');
            $z('transcriptStatus').textContent='Audio saved locally · '+Math.round(blob.size/1024)+' KB';
            $z('transcriptText').textContent=meeting.cloudAudioAllowed?'Cloud transcription enabled for this meeting.':'Cloud transcription off · audio remains on this device.';
            if(meeting.cloudAudioAllowed)await transcribe(blob);
            else if(meeting.note||meeting.transcript){meeting.summary=quickDraft();saveCurrent();renderSummary()}
          }
        }catch(e){console.error('Could not save recording:',e);recordStatus('Could not save recording: '+e.message,true)}
        finally{recorder=null;$z('recordBtn').disabled=false}
      };
      activeRecorder.start(30000);button.disabled=false;
      $z('recordDot').classList.add('live');$z('recordLabel').textContent='Recording';button.classList.add('live');$z('recordBtn span').textContent='Stop';recordStatus('Microphone is recording. Tap Stop to save.');elapsed=0;
      timer=setInterval(()=>{$z('recordTimer').textContent=formatTime(++elapsed);if(current?.id===meeting.id&&elapsed%60===0&&(meeting.note||meeting.transcript)){meeting.summary=quickDraft();saveCurrent();renderSummary()}},1000);
    }catch(e){console.error('Microphone could not start:',e);acquiredStream?.getTracks().forEach(track=>track.stop());stream=null;recorder=null;resetRecordUi('Not recording');recordStatus(recordMessage(e),true)}
  };
  $z('generateSummaryBtn').onclick=()=>generateSummary();$z('recordBtn').onclick=()=>toggleRecord();
  $z('cloudAudioEnabled').addEventListener('change',()=>saveAiSettings(false));
  document.addEventListener('input',e=>{
    if(e.target.id==='transcriptInput'&&current){current.transcript=e.target.value;saveCurrent()}
    if(e.target.id==='noteInput'&&current&&recorder?.state==='recording'){clearTimeout(window.zmLiveDraft);window.zmLiveDraft=setTimeout(()=>{current.summary=quickDraft();saveCurrent();renderSummary()},1400)}
  });
})();
