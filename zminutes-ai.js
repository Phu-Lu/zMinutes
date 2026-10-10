/* Multiple summary providers and opt-in post-recording cloud transcription. */
(() => {
  const $z=id=>document.getElementById(id), tick=String.fromCharCode(96);
  const aiDetails=document.querySelector('.ai-settings'),aiDialog=document.createElement('dialog');
  aiDialog.className='ai-settings-dialog';aiDialog.setAttribute('aria-labelledby','aiDialogTitle');
  const aiTitle=document.createElement('h2');aiTitle.id='aiDialogTitle';aiTitle.textContent='AI provider & API keys';
  const aiHint=document.createElement('p');aiHint.className='ai-dialog-hint';aiHint.textContent='Choose Gemini, OpenAI (ChatGPT API), Ollama, or an offline draft. API keys stay in this browser session and are not saved.';
  const aiClose=document.createElement('button');aiClose.type='button';aiClose.className='dialog-close';aiClose.textContent='×';aiClose.setAttribute('aria-label','Close AI settings');aiClose.onclick=()=>aiDialog.close();
  aiDialog.append(aiClose,aiTitle,aiHint);if(aiDetails){aiDetails.open=true;aiDialog.append(aiDetails)}document.body.append(aiDialog);
  const openAiSettings=()=>{if(!aiDialog.open)aiDialog.showModal()};
  $z('aiSettingsBtn')?.addEventListener('click',openAiSettings);
  const aiIntro=document.querySelector('#summaryPanel .panel-intro>div');
  if(aiIntro){const setup=document.createElement('button');setup.type='button';setup.className='secondary ai-open-settings';setup.textContent='⚙ AI setup & API keys';setup.onclick=openAiSettings;aiIntro.append(setup)}
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
    if(!current)return;saveCurrent();const b=$z('generateSummaryBtn'),s=$z('aiStatus');b.disabled=true;b.textContent='Generating…';s.textContent='Preparing recap…';
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
    const key=$z('transcriptionApiKey').value.trim(),p=$z('transcriptionProvider').value;
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
  let recorder,stream,parts=[],timer;
  toggleRecord=async function(){
    if(recorder?.state==='recording'){recorder.stop();return}if(!current)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert('Recording needs browser microphone support over localhost or HTTPS.');return}
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});parts=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data?.size)parts.push(e.data)};
      recorder.onstop=async()=>{
        clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());$z('recordDot').classList.remove('live');$z('recordLabel').textContent='Audio saved locally';$z('recordBtn').classList.remove('live');$z('recordBtn span').textContent='Record';
        try{const blob=new Blob(parts,{type:recorder.mimeType||'audio/webm'});current.audio=await asDataUrl(blob);persist();$z('transcriptStatus').textContent='Audio saved locally · '+Math.round(blob.size/1024)+' KB';$z('transcriptText').textContent=current.cloudAudioAllowed?'Cloud transcription enabled for this meeting.':'Cloud transcription off · audio remains on this device.';if(current.cloudAudioAllowed)await transcribe(blob);else if(current.note||current.transcript){current.summary=quickDraft();saveCurrent();renderSummary()}}
        catch(e){console.error(e);$z('transcriptStatus').textContent='Could not save recording: '+e.message}
      };
      recorder.start(30000);$z('recordDot').classList.add('live');$z('recordLabel').textContent='Recording';$z('recordBtn').classList.add('live');$z('recordBtn span').textContent='Stop';elapsed=0;
      timer=setInterval(()=>{$z('recordTimer').textContent=formatTime(++elapsed);if(elapsed%60===0&&(current.note||current.transcript)){current.summary=quickDraft();saveCurrent();renderSummary()}},1000)
    }catch(e){alert('Microphone access is unavailable. Allow microphone access, then try again.')}
  };
  $z('generateSummaryBtn').onclick=()=>generateSummary();$z('recordBtn').onclick=()=>toggleRecord();
  $z('aiProvider').addEventListener('change',()=>{
    const p=$z('aiProvider').value;$z('apiKeyField').classList.toggle('hidden',p==='ollama'||p==='quick');$z('ollamaUrlField').classList.toggle('hidden',p!=='ollama');
    $z('aiHelp').textContent=p==='ollama'?'Uses a model installed in Ollama. Offline quick recap remains available if Ollama is unavailable.':p==='quick'?'Creates a structured offline draft; it is not an LLM.':'Cloud text recap runs only when requested.';
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='transcriptInput'&&current){current.transcript=e.target.value;saveCurrent()}
    if(e.target.id==='noteInput'&&current&&recorder?.state==='recording'){clearTimeout(window.zmLiveDraft);window.zmLiveDraft=setTimeout(()=>{current.summary=quickDraft();saveCurrent();renderSummary()},1400)}
  });
})();
