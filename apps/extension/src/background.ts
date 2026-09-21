import {ext,hostPermission,serverUrl,normalizeServerUrl,submissionKey,type Capture,type Submission} from './shared';
const pending=new Map<number,Promise<Submission>>();

async function request(base:string,path:string,body?:object) {
  if(!await ext.permissions.contains({origins:[hostPermission(base)]}))throw new Error('Server permission is missing. Please save the server address again in Settings.');
  let response:Response;
  try {
    response=await fetch(`${base}${path}`,{method:body?'POST':'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(25000),headers:body?{'Content-Type':'application/json','X-Redread-Extension':'1'}:{},body:body?JSON.stringify(body):undefined});
  }catch{throw new Error('The server is unreachable or timed out. Check Tailscale and the server address. Before sending again, check your library.');}
  let data;
  try{data=await response.json();}catch{throw new Error(`No redread response (HTTP ${response.status}). Check the server address.`);}
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`Server error: HTTP ${response.status}`);
  return data;
}
export async function checkConnection(address?:string) {
  const base=address===undefined?await serverUrl():normalizeServerUrl(address);
  const data=await request(base,'/api/health');
  if(data.app!=='redread')throw new Error('No redread server is responding at this address.');
  return {ready:!!data.ready};
}
export function submitTab(tabId:number,voice=''):Promise<Submission> {
  const existing=pending.get(tabId);if(existing)return existing;
  const job=saveTab(tabId,voice).finally(()=>pending.delete(tabId));pending.set(tabId,job);return job;
}
async function saveTab(tabId:number,voice:string):Promise<Submission> {
  const base=await serverUrl();
  const tab=await ext.tabs.get(tabId);
  if(!tab.url||!/^https?:\/\//.test(tab.url))throw new Error('Please open a regular article page. Browser pages, PDFs, and add-on stores cannot be read.');
  const key=submissionKey(tabId);
  const previous=(await ext.storage.local.get(key))[key] as Submission|undefined;
  if(previous?.state==='saved'&&previous.url===tab.url&&previous.serverUrl===base)return previous;
  const submission:Submission={url:tab.url,title:tab.title||'Article',state:'sending',message:'Reading and sending article…',serverUrl:base,updatedAt:Date.now()};
  const save=async()=>{
    // Do not restore a submission after the user disconnected in the popup.
    if((await ext.storage.local.get('serverUrl')).serverUrl!==base)return;
    submission.updatedAt=Date.now();await ext.storage.local.set({[key]:submission});
  };
  await save();
  try{
    let results:chrome.scripting.InjectionResult<Capture | {error:string}>[];
    try{results=await ext.scripting.executeScript({target:{tabId},files:['capture.js']});}
    catch{throw new Error('This page cannot be read. Open the article as a regular web page and click the redread icon again. Alternatively, paste the text into the web app.');}
    const article=results[0]?.result;
    if(article && 'error' in article)throw new Error(article.error);
    if(!article?.text)throw new Error('No readable article was found. Please paste the text directly into the web app.');
    // Do not accidentally submit a different page if the user navigated during extraction.
    const current=await ext.tabs.get(tabId);
    if(current.url!==tab.url)throw new Error('The page has changed. Please open the extension again.');
    const saved=await request(base,'/api/articles',{...article,process:true,voice});
    if(typeof saved.id!=='string'||!/^[a-f0-9-]{36}$/.test(saved.id))throw new Error('Invalid server response. Check your library before sending again.');
    submission.state='saved';submission.title=article.title;submission.articleId=saved.id;
    submission.message=saved.status==='draft'?'Saved as a draft. Connect an LLM and a TTS model in the web app to create audio.':'Article saved. Audio processing will continue on your server.';
    await save();return submission;
  }catch(error){
    submission.state='error';submission.message=error instanceof Error?error.message:'The article could not be sent.';
    await save();return submission;
  }
}
ext.runtime.onMessage.addListener((payload,sender,sendResponse)=>{
  // No messages from arbitrary websites or injected content scripts.
  if(sender.id!==ext.runtime.id||!sender.url?.startsWith(ext.runtime.getURL('')))return false;
  let task:Promise<unknown>;
  if(payload?.type==='check')task=checkConnection(typeof payload.serverUrl==='string'?payload.serverUrl:undefined);
  else if(payload?.type==='voices')task=serverUrl().then(base=>request(base,'/api/voices'));
  else if(payload?.type==='submit'&&Number.isInteger(payload.tabId))task=submitTab(payload.tabId,typeof payload.voice==='string'?payload.voice:'');
  else return false;
  void task.then(data=>sendResponse({ok:true,data}),error=>sendResponse({ok:false,error:error instanceof Error?error.message:'Request failed.'}));
  return true;
});
ext.tabs.onRemoved.addListener(tabId=>{void ext.storage.local.remove(submissionKey(tabId));});
