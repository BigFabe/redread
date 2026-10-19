'use client';

import type { PlaybackMutation, PlaybackProgress } from '@redread/core/types';

type Snapshot = Pick<PlaybackProgress,'positionMs'|'completed'>;
export type PlaybackEntry = {
  key:string; serverId:string; articleId:string; audioId:string;
  snapshot:Snapshot; revision:number; generation:number; dirty:boolean; changedAt:number;
  pending?:PlaybackMutation & {generation:number}; conflict?:PlaybackProgress;
  blocked?:string; retryAt:number; failures:number;
};
export type SyncView = {entry?:PlaybackEntry; recoveries?:PlaybackEntry[]; message:string};
const listeners = new Map<string,Set<(view:SyncView)=>void>>();
const running = new Map<string,Promise<void>>();
let database:Promise<IDBDatabase> | undefined;
let started = false;

function uuid() {
  // crypto.randomUUID is unavailable on HTTP Tailnet origins.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]&15)|64; bytes[8] = (bytes[8]&63)|128;
  const hex = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function db() {
  return database ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request = indexedDB.open('redread-playback',1);
    request.onupgradeneeded = ()=>request.result.createObjectStore('positions',{keyPath:'key'});
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}
async function allEntries() {
  const database = await db();
  return new Promise<PlaybackEntry[]>((resolve,reject)=>{
    const request = database.transaction('positions').objectStore('positions').getAll();
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}
// Every read/modify/write, including receipt acknowledgement, is one transaction.
async function change(key:string, update:(entry:PlaybackEntry|undefined)=>PlaybackEntry|undefined) {
  const database = await db();
  return new Promise<PlaybackEntry|undefined>((resolve,reject)=>{
    const tx = database.transaction('positions','readwrite');
    const store = tx.objectStore('positions');
    let result:PlaybackEntry|undefined;
    const request = store.get(key);
    request.onsuccess = ()=>{
      try { result = update(request.result); if(result)store.put(result); }
      catch { tx.abort(); }
    };
    tx.oncomplete = ()=>resolve(result);
    tx.onabort = tx.onerror = ()=>reject(tx.error || new Error('Playback could not be saved locally.'));
  });
}
const messages = new Map<string,string>();
function sameAudio(a:PlaybackEntry,b:PlaybackEntry) {
  return a.serverId===b.serverId&&a.articleId===b.articleId&&a.audioId===b.audioId;
}
function publish(key:string,_entry?:PlaybackEntry,message='') {
  messages.set(key,message);
  // Refresh related listeners too: an abandoned outbox may hit a conflict even
  // when its original player/tab no longer exists.
  void allEntries().then(entries=>{
    for(const [listenerKey,subscribers] of listeners) {
      const entry = entries.find(value=>value.key===listenerKey);
      if(!entry)continue;
      const status = entry.blocked || (entry.conflict?'Position auf anderem Gerät geändert':messages.get(listenerKey)) || (entry.dirty?'Nur lokal gespeichert · Sync ausstehend':entry.revision<0?'Hörposition noch nicht abgeglichen':'Synchronisiert');
      const recoveries = entries.filter(value=>value.key!==entry.key&&sameAudio(value,entry)&&value.dirty&&(
        value.snapshot.positionMs!==entry.snapshot.positionMs||value.snapshot.completed!==entry.snapshot.completed||value.revision!==entry.revision
      ));
      subscribers.forEach(listener=>listener({entry,message:status,recoveries}));
    }
  }).catch(()=>{});
}
class SyncError extends Error {
  constructor(readonly status:number, message:string, readonly current?:PlaybackProgress) { super(message); }
}
async function request<T>(path:string,init?:RequestInit):Promise<T> {
  const response = await fetch(path,{...init,cache:'no-store',signal:AbortSignal.timeout(3500)});
  const data = await response.json();
  if(!response.ok)throw new SyncError(response.status,data.error || 'Sync fehlgeschlagen.',data.current);
  return data;
}
function endpoint(entry:PlaybackEntry) {
  return `/api/articles/${entry.articleId}/playback?version=${encodeURIComponent(entry.audioId)}`;
}
function validateProgress(entry:PlaybackEntry,value:PlaybackProgress) {
  if(value.articleId!==entry.articleId||value.audioId!==entry.audioId||!Number.isSafeInteger(value.positionMs)||value.positionMs<0||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.completed!=='boolean'||typeof value.mutationId!=='string') {
    throw new SyncError(400,'Ungültige Sync-Antwort · lokale Position bleibt gespeichert');
  }
}
async function reconcile(entry:PlaybackEntry) {
  const remote = await request<PlaybackProgress>(endpoint(entry));
  validateProgress(entry,remote);
  return change(entry.key,current=>{
    if(!current || current.pending || current.conflict || current.blocked)return current;
    if(current.dirty) {
      if((current.revision < 0 && remote.revision > 0) || (current.revision >= 0 && current.revision !== remote.revision))return {...current,conflict:remote};
      return {...current,revision:remote.revision};
    }
    return {...current,snapshot:{positionMs:remote.positionMs,completed:remote.completed},revision:remote.revision,generation:current.generation+1,changedAt:Date.now()};
  });
}
async function performSync(key:string,read:boolean,force:boolean) {
  let entry = await change(key,e=>e);
  if(!entry || entry.blocked || entry.conflict || (!read&&!force&&entry.retryAt>Date.now()))return;
  try {
    if(entry.dirty && entry.revision<0 && !entry.pending)entry = await reconcile(entry);
    // Two rounds let an urgent pause flush the snapshot collected during an
    // older uncertain request, without starting parallel writes.
    for(let round=0;round<(force?2:1);round++) {
      entry = await change(key,current=>{
        if(!current || current.blocked || current.conflict || !current.dirty || current.revision<0)return current;
        return current.pending?current:{...current,pending:{...current.snapshot,baseRevision:current.revision,mutationId:uuid(),generation:current.generation}};
      });
      if(!entry?.pending || entry.conflict || entry.blocked)break;
      const pending = entry.pending;
      const {generation,...body} = pending;
      const ack = await request<PlaybackProgress>(endpoint(entry),{
        method:'PUT',headers:{'Content-Type':'application/json','X-Redread-Server':entry.serverId},body:JSON.stringify(body),keepalive:true,
      });
      validateProgress(entry,ack);
      if(ack.mutationId!==pending.mutationId||ack.revision!==pending.baseRevision+1||ack.completed!==pending.completed||Math.abs(ack.positionMs-pending.positionMs)>2000)throw new SyncError(400,'Ungültige Sync-Bestätigung · lokale Position bleibt gespeichert');
      entry = await change(key,current=>{
        if(!current || current.pending?.mutationId!==pending.mutationId)return current;
        const dirty = current.generation!==generation;
        return {...current,revision:ack.revision,pending:undefined,dirty,
          snapshot:dirty?current.snapshot:{positionMs:ack.positionMs,completed:ack.completed},failures:0,retryAt:dirty?Date.now()+10000:0};
      });
    }
    if(read && entry && !entry.pending && !entry.conflict && !entry.blocked)entry = await reconcile(entry);
    publish(key,entry);
  } catch(error) {
    entry = await change(key,current=>{
      if(!current)return current;
      if(error instanceof SyncError && error.status===409 && error.current)return {...current,conflict:error.current,pending:undefined};
      if(error instanceof SyncError && error.status>=400 && error.status<500 && ![408,429].includes(error.status))return {...current,blocked:error.status===404?'Audiofassung nicht mehr verfügbar':error.message};
      const failures = current.failures+1;
      return {...current,failures,retryAt:Date.now()+Math.min(60000,2000*2**Math.min(failures-1,5))};
    });
    publish(key,entry,entry?.conflict||entry?.blocked?'':'Verbindung unterbrochen · Position lokal gespeichert');
  }
}
async function sync(key:string,read=false,force=false):Promise<void> {
  const active = running.get(key);
  if(active) { await active; if(read||force)return sync(key,read,force); return; }
  const job = performSync(key,read,force);
  running.set(key,job);
  try { await job; } finally { if(running.get(key)===job)running.delete(key); }
}
async function flushPending() {
  try {
    for(const entry of await allEntries()) {
      if(entry.dirty&&!entry.conflict&&!entry.blocked&&entry.retryAt<=Date.now())void sync(entry.key).catch(()=>{});
    }
  } catch { /* The player exposes unavailable local storage; do not upload without it. */ }
}
export function startPlaybackSync() {
  if(started)return;
  started = true;
  void flushPending();
  window.setInterval(()=>void flushPending(),2000);
  window.addEventListener('online',()=>void flushPending());
}
export class PlaybackSync {
  private constructor(readonly key:string) {}
  static async open(articleId:string,audioId:string) {
    startPlaybackSync();
    let serverId = localStorage.getItem('redread-playback-server') || '';
    try {
      const health = await request<{serverId:string}>('/api/health');
      if(!health.serverId)throw new SyncError(400,'Server für Fortschrittssync aktualisieren.');
      serverId = health.serverId;
      localStorage.setItem('redread-playback-server',serverId);
    } catch(error) { if(!serverId || error instanceof SyncError)throw error; }
    // Every player instance owns its baseline. Never reuse sessionStorage IDs:
    // duplicated tabs inherit them and would silently share acknowledgements.
    const key = `${serverId}:${articleId}:${audioId}:${uuid()}`;
    await change(key,entry=>entry || {
      key,serverId,articleId,audioId,snapshot:{positionMs:0,completed:false},
      revision:-1,generation:0,dirty:false,changedAt:0,retryAt:0,failures:0,
    });
    return new PlaybackSync(key);
  }
  subscribe(listener:(view:SyncView)=>void) {
    let set = listeners.get(this.key);
    if(!set)listeners.set(this.key,set=new Set());
    set.add(listener);
    publish(this.key);
    return ()=>{set.delete(listener);if(!set.size)listeners.delete(this.key);};
  }
  async prepare() {
    let current = await change(this.key,e=>e);
    if(!current)return;
    const previous = (await allEntries()).filter(entry=>entry.key!==this.key&&sameAudio(entry,current!));
    // Recover uncertain writes from a closed player before fetching the resume
    // position. Separate keys preserve each writer's own CAS baseline.
    await Promise.all(previous.filter(entry=>entry.dirty&&!entry.conflict&&!entry.blocked).map(entry=>sync(entry.key,false,true)));
    await sync(this.key,true,true);
    current = await change(this.key,e=>e);
    if(current && current.revision<0 && !current.dirty && current.failures>0) {
      const cached = previous.filter(entry=>!entry.blocked&&(entry.dirty||entry.revision>=0)).sort((a,b)=>(b.changedAt||0)-(a.changedAt||0))[0];
      if(cached)current = await change(this.key,entry=>entry&&!entry.dirty&&entry.revision<0?{
        ...entry,snapshot:cached.snapshot,revision:cached.revision,generation:cached.generation,
        changedAt:cached.changedAt,dirty:cached.dirty,pending:cached.pending,conflict:cached.conflict,
      }:entry);
    }
    publish(this.key,current);
    return current?.snapshot;
  }
  async checkpoint(positionMs:number,completed:boolean,force=false) {
    if(!Number.isFinite(positionMs))return;
    const snapshot = {positionMs:Math.max(0,Math.round(positionMs)),completed};
    const entry = await change(this.key,current=>{
      if(!current)return current;
      if(current.snapshot.positionMs===snapshot.positionMs&&current.snapshot.completed===snapshot.completed)return current;
      return {...current,snapshot,dirty:true,generation:current.generation+1,changedAt:Date.now(),retryAt:force?0:current.dirty?current.retryAt:Date.now()+10000};
    });
    publish(this.key,entry);
    if(force)await sync(this.key,false,true);
  }
  async resolve(useServer:boolean,recoveryKey?:string) {
    await running.get(this.key);
    if(recoveryKey)await running.get(recoveryKey);
    const entry = await change(this.key,e=>e);
    if(!entry)return;
    const recovery = recoveryKey?await change(recoveryKey,e=>e):undefined;
    if(recoveryKey&&(!recovery||!sameAudio(entry,recovery)))return;
    // A choice applies to a freshly read revision, never to a stale dialog.
    const remote = await request<PlaybackProgress>(endpoint(entry));
    validateProgress(entry,remote);
    let applied = false;
    const next = await change(this.key,current=>{
      if(!current||current.generation!==entry.generation||current.revision!==entry.revision||current.pending?.mutationId!==entry.pending?.mutationId)return current;
      applied = true;
      return {
        ...current,snapshot:useServer?{positionMs:remote.positionMs,completed:remote.completed}:recovery?.snapshot||current.snapshot,
        revision:remote.revision,dirty:!useServer,pending:undefined,conflict:undefined,blocked:undefined,
        generation:current.generation+1,changedAt:Date.now(),failures:0,retryAt:0,
      };
    });
    if(!applied)throw new Error('Die lokale Position hat sich geändert. Bitte erneut wählen.');
    if(recovery) {
      await change(recovery.key,current=>current&&current.generation===recovery.generation&&current.pending?.mutationId===recovery.pending?.mutationId?{
        ...current,dirty:false,pending:undefined,conflict:undefined,blocked:'Position in anderem Player übernommen',
      }:current);
    }
    publish(this.key,next);
    if(!useServer)await sync(this.key,false,true);
    return next?.snapshot;
  }
}
