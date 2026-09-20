import {ext,hostPermission,normalizeServerUrl,message} from './shared';
const form=document.querySelector<HTMLFormElement>('form')!;
const input=document.querySelector<HTMLInputElement>('#server')!;
const button=document.querySelector<HTMLButtonElement>('button[type=submit]')!;
const status=document.querySelector<HTMLElement>('#status')!;
form.addEventListener('submit',async event=>{
  event.preventDefault();button.disabled=true;status.className='status';
  try{
    const base=normalizeServerUrl(input.value);
    // Must be called directly from this click/submit gesture, before other awaits.
    const granted=await ext.permissions.request({origins:[hostPermission(base)]});
    if(!granted)throw new Error('Ohne Serverberechtigung kann kein Artikel übertragen werden.');
    await ext.storage.local.set({serverUrl:base});input.value=base;
    status.textContent='Adresse gespeichert. Verbindung wird geprüft …';
    const result=await message<{ready:boolean}>({type:'check'});
    status.textContent=result.ready?'Verbunden. Öffne einen Artikel und klicke auf das redread-Symbol.':'Verbunden. Auf dem Server fehlen noch LLM-/TTS-Modelle; Artikel werden zunächst als Entwürfe gespeichert.';
    status.className='status saved';
  }catch(error){status.textContent=(error as Error).message;status.className='status error';}
  finally{button.disabled=false;}
});
void ext.storage.local.get('serverUrl').then(value=>{input.value=typeof value.serverUrl==='string'?value.serverUrl:'';});
