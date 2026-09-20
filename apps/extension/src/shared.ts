export const ext: typeof chrome = (globalThis as typeof globalThis & {browser?: typeof chrome}).browser ?? chrome;
export type Capture = {title: string; url: string; text: string};
export type Submission = {url:string; state:'sending'|'saved'|'error'; title:string; message:string; serverUrl:string; articleId?:string; updatedAt:number};
export type Reply<T> = {ok:true; data:T} | {ok:false; error:string};
export function normalizeServerUrl(value:string) {
  let url:URL;
  try {url=new URL(value.trim());} catch {throw new Error('Bitte eine vollständige Serveradresse mit http:// oder https:// eingeben.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/') throw new Error('Verwende die Serveradresse ohne Pfad, Zugangsdaten, Query oder Fragment.');
  return url.origin;
}
export function hostPermission(serverUrl:string) {
  const url=new URL(serverUrl);
  // WebExtension match patterns cannot restrict a host permission to one port.
  return `${url.protocol}//${url.hostname}/*`;
}
export async function serverUrl() {
  const data=await ext.storage.local.get('serverUrl');
  if(typeof data.serverUrl!=='string'||!data.serverUrl) throw new Error('Bitte zuerst deinen redread-Server verbinden.');
  return normalizeServerUrl(data.serverUrl);
}
export async function message<T>(payload:object):Promise<T> {
  const reply:Reply<T>=await ext.runtime.sendMessage(payload);
  if(!reply?.ok)throw new Error(reply?.error || 'Die Erweiterung antwortet nicht. Bitte erneut öffnen.');
  return reply.data;
}
export const submissionKey=(tabId:number)=>`submission:${tabId}`;
