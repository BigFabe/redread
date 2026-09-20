import {ext,message,submissionKey,type Submission} from './shared';
const title=document.querySelector<HTMLHeadingElement>('#title')!;
const source=document.querySelector<HTMLElement>('#source')!;
const status=document.querySelector<HTMLElement>('#status')!;
const submit=document.querySelector<HTMLButtonElement>('#submit')!;
const open=document.querySelector<HTMLAnchorElement>('#open')!;
let tabId:number|undefined;
let url='';
let base='';
function show(submission:Submission) {
  status.textContent=submission.message;status.className=`status ${submission.state}`;
  submit.disabled=submission.state!=='error';
  submit.textContent=submission.state==='sending'?'Wird übertragen …':submission.state==='saved'?'✓ In deiner Bibliothek':'Erneut versuchen';
  if(submission.state==='saved'&&submission.articleId){open.href=`${submission.serverUrl}/?article=${encodeURIComponent(submission.articleId)}`;open.hidden=false;}
}
async function refresh() {
  const config=await ext.storage.local.get('serverUrl');base=typeof config.serverUrl==='string'?config.serverUrl:'';
  if(!base){title.textContent='Verbinde deinen Server.';source.textContent='Einmal einrichten, dann Artikel sammeln.';status.textContent='In den Einstellungen die Adresse deiner redread-Webapp eintragen.';submit.disabled=false;submit.textContent='Server verbinden';return;}
  const [tab]=await ext.tabs.query({active:true,currentWindow:true});tabId=tab?.id;url=tab?.url||'';
  title.textContent=tab?.title||'Aktuelle Seite';
  if(!tabId||!/^https?:\/\//.test(url)){source.textContent='Keine Artikelseite';status.textContent='Öffne eine Webseite mit einem Artikel. Browserseiten und Add-on-Stores sind nicht zugänglich.';return;}
  source.textContent=new URL(url).hostname;
  status.textContent='Der Artikeltext wird erst beim Senden ausgelesen.';
  submit.disabled=false;
  const previous=(await ext.storage.local.get(submissionKey(tabId)))[submissionKey(tabId)] as Submission|undefined;
  if(previous?.url===url&&previous.serverUrl===base){
    if(previous.state==='sending'&&Date.now()-previous.updatedAt>60000)show({...previous,state:'error',message:'Übertragung nicht bestätigt. Bitte zuerst in der Bibliothek prüfen, bevor du erneut sendest.'});
    else show(previous);
  }
}
document.querySelector('#settings')!.addEventListener('click',()=>void ext.runtime.openOptionsPage());
submit.addEventListener('click',async()=>{
  if(!base){void ext.runtime.openOptionsPage();return;}
  if(tabId===undefined)return;
  submit.disabled=true;submit.textContent='Wird übertragen …';status.textContent='Artikel auslesen und übertragen …';status.className='status sending';
  try{show(await message<Submission>({type:'submit',tabId}));}
  catch(error){status.textContent=(error as Error).message;status.className='status error';submit.disabled=false;submit.textContent='Erneut versuchen';}
});
ext.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&tabId!==undefined){const value=changes[submissionKey(tabId)]?.newValue as Submission|undefined;if(value?.url===url&&value.serverUrl===base)show(value);}
});
void refresh().catch(error=>{status.textContent=(error as Error).message;status.className='status error';});
