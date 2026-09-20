import {ext,message,submissionKey,normalizeServerUrl,hostPermission,type Submission} from './shared';
const title=document.querySelector<HTMLHeadingElement>('#title')!;
const source=document.querySelector<HTMLElement>('#source')!;
const status=document.querySelector<HTMLElement>('#status')!;
const submit=document.querySelector<HTMLButtonElement>('#submit')!;
const voice=document.querySelector<HTMLSelectElement>('#voice')!;
const voiceField=document.querySelector<HTMLElement>('#voice-field')!;
const open=document.querySelector<HTMLAnchorElement>('#open')!;
const connection=document.querySelector<HTMLElement>('#connection')!;
const articleView=document.querySelector<HTMLElement>('#article-view')!;
const settings=document.querySelector<HTMLButtonElement>('#settings')!;
const input=document.querySelector<HTMLInputElement>('#server')!;
const connect=document.querySelector<HTMLButtonElement>('#connect')!;
const connectionStatus=document.querySelector<HTMLElement>('#connection-status')!;
const connectedActions=document.querySelector<HTMLElement>('#connected-actions')!;
const logout=document.querySelector<HTMLButtonElement>('#logout')!;
let tabId:number|undefined;
let url='';
let base='';
function showConnection(visible:boolean) {
  connection.hidden=!visible;articleView.hidden=visible;
  settings.hidden=!base;settings.setAttribute('aria-expanded',String(visible));
  connectedActions.hidden=!base;
  if(visible){input.value=base;input.focus();}
}
function show(submission:Submission) {
  status.textContent=submission.message;status.className=`status ${submission.state}`;
  submit.disabled=submission.state!=='error';voice.disabled=submission.state!=='error';
  submit.textContent=submission.state==='sending'?'Wird übertragen …':submission.state==='saved'?'✓ In deiner Bibliothek':'Erneut versuchen';
  if(submission.state==='saved'&&submission.articleId){open.href=`${submission.serverUrl}/?article=${encodeURIComponent(submission.articleId)}`;open.hidden=false;}
}
async function refresh() {
  const config=await ext.storage.local.get('serverUrl');base=typeof config.serverUrl==='string'?config.serverUrl:'';
  open.hidden=true;open.removeAttribute('href');submit.disabled=true;
  voice.replaceChildren(new Option('Automatisch / Standardstimme',''));voice.disabled=false;voiceField.hidden=true;
  submit.textContent='Artikel hörbar machen ↗';status.className='status';
  showConnection(!base);
  if(!base){tabId=undefined;url='';return;}
  const [tab]=await ext.tabs.query({active:true,currentWindow:true});tabId=tab?.id;url=tab?.url||'';
  title.textContent=tab?.title||'Aktuelle Seite';
  if(!tabId||!/^https?:\/\//.test(url)){source.textContent='Keine Artikelseite';status.textContent='';return;}
  source.textContent=new URL(url).hostname;
  status.textContent='Der Artikeltext wird erst beim Senden ausgelesen.';
  try{
    const voices=await message<{name:string;voice:string}[]>({type:'voices'});
    for(const item of voices)voice.add(new Option(item.name,item.voice));
    voiceField.hidden=!voices.length;
  }catch{status.textContent='Stimmen konnten nicht geladen werden. Erneut öffnen oder mit Standardstimme senden.';}
  submit.disabled=false;
  const previous=(await ext.storage.local.get(submissionKey(tabId)))[submissionKey(tabId)] as Submission|undefined;
  if(previous?.url===url&&previous.serverUrl===base){
    if(previous.state==='sending'&&Date.now()-previous.updatedAt>60000)show({...previous,state:'error',message:'Übertragung nicht bestätigt. Bitte zuerst in der Bibliothek prüfen, bevor du erneut sendest.'});
    else show(previous);
  }
}
settings.addEventListener('click',()=>showConnection(connection.hidden));
document.querySelector('#back')!.addEventListener('click',()=>showConnection(false));
document.querySelector('#connect-form')!.addEventListener('submit',async event=>{
  event.preventDefault();connect.disabled=true;logout.disabled=true;connectionStatus.className='status';
  try{
    const nextBase=normalizeServerUrl(input.value);
    // Request permissions within the submit gesture, before any other awaits.
    const granted=await ext.permissions.request({origins:[hostPermission(nextBase)]});
    if(!granted)throw new Error('Ohne Serverberechtigung kann kein Artikel übertragen werden.');
    connectionStatus.textContent='Verbindung wird geprüft …';
    const result=await message<{ready:boolean}>({type:'check',serverUrl:nextBase});
    await ext.storage.local.set({serverUrl:nextBase});
    connectionStatus.textContent=result.ready?'Verbunden.':'Verbunden. Auf dem Server fehlen noch LLM-/TTS-Modelle; Artikel werden zunächst als Entwürfe gespeichert.';
    connectionStatus.className='status saved';
    await refresh();
  }catch(error){connectionStatus.textContent=(error as Error).message;connectionStatus.className='status error';}
  finally{connect.disabled=false;logout.disabled=false;}
});
logout.addEventListener('click',async()=>{
  logout.disabled=true;connect.disabled=true;
  try{
    const permissions=await ext.permissions.getAll();
    if(permissions.origins?.length)await ext.permissions.remove({origins:permissions.origins});
    const stored=await ext.storage.local.get(null);
    await ext.storage.local.remove(Object.keys(stored).filter(key=>key==='serverUrl'||key.startsWith('submission:')));
    connectionStatus.textContent='';connectionStatus.className='status';
    await refresh();
  }catch(error){connectionStatus.textContent=(error as Error).message;connectionStatus.className='status error';}
  finally{logout.disabled=false;connect.disabled=false;}
});
submit.addEventListener('click',async()=>{
  if(!base){showConnection(true);return;}
  if(tabId===undefined)return;
  submit.disabled=true;voice.disabled=true;submit.textContent='Wird übertragen …';status.textContent='Artikel auslesen und übertragen …';status.className='status sending';
  try{show(await message<Submission>({type:'submit',tabId,voice:voice.value}));}
  catch(error){status.textContent=(error as Error).message;status.className='status error';submit.disabled=false;voice.disabled=false;submit.textContent='Erneut versuchen';}
});
ext.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&tabId!==undefined){const value=changes[submissionKey(tabId)]?.newValue as Submission|undefined;if(value?.url===url&&value.serverUrl===base)show(value);}
});
void refresh().catch(error=>{status.textContent=(error as Error).message;status.className='status error';});
