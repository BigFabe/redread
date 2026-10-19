'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PlaybackSync, type SyncView } from './playback-sync';

export function usePlaybackProgress(articleId:string,audioId:string,audio:RefObject<HTMLAudioElement|null>) {
  const [view,setView] = useState<SyncView>({message:'Hörposition wird geladen…'});
  const [starting,setStarting] = useState(false);
  const [resolving,setResolving] = useState(false);
  const controls = useRef({play:()=>{},pause:()=>{},seek:(_value:number)=>{},resolve:(_useServer:boolean,_recoveryKey?:string)=>{}});
  useEffect(()=>{
    const element = audio.current;
    if(!element)return;
    let disposed = false, restoring = false, active = false, completed = false;
    let token = 0, pendingPlay = false, resolutionLocked = false;
    let pendingSeek:number|undefined;
    let sync:PlaybackSync|undefined;
    let unsubscribe = ()=>{};
    const waiters = new Set<()=>void>();
    let opening:Promise<void>|undefined;
    function initialize() {
      if(sync)return Promise.resolve();
      return opening ??= PlaybackSync.open(articleId,audioId).then(value=>{
        if(disposed)return;
        sync = value;
        unsubscribe = value.subscribe(next=>{if(!disposed)setView(next);});
      }).finally(()=>{opening=undefined;});
    }
    function waitFor(event:string,timeout:number) {
      return new Promise<void>((resolve,reject)=>{
        const finish = (error?:Error)=>{
          clearTimeout(timer); element!.removeEventListener(event,done); element!.removeEventListener('error',failed);
          waiters.delete(cancel);
          if(error)reject(error); else resolve();
        };
        const done = ()=>finish();
        const failed = ()=>finish(new Error('Audio konnte nicht geladen werden.'));
        const cancel = ()=>finish(new Error('Player geschlossen.'));
        const timer = setTimeout(()=>finish(new Error('Audio lädt zu lange. Erneut auf Play drücken.')),timeout);
        element!.addEventListener(event,done,{once:true}); element!.addEventListener('error',failed,{once:true});
        waiters.add(cancel);
      });
    }
    async function restore(positionMs:number) {
      const duration = element!.duration;
      const target = Math.max(0,Math.min(positionMs/1000,Number.isFinite(duration)?duration:positionMs/1000));
      if(Math.abs(element!.currentTime-target)<0.05)return;
      restoring = true;
      const seeked = waitFor('seeked',10000);
      try { element!.currentTime = target; await seeked; }
      finally { restoring = false; }
    }
    async function save(force=false) {
      if(!sync || !active || restoring || resolutionLocked || (element!.seeking&&pendingSeek===undefined) || element!.readyState<1)return;
      try { await sync.checkpoint(pendingSeek===undefined?element!.currentTime*1000:pendingSeek*1000,completed,force); }
      catch { if(!disposed)setView({message:'Position konnte nicht lokal gespeichert werden · Browserspeicher prüfen'}); }
    }
    async function play() {
      if(pendingPlay || resolutionLocked || !element!.paused)return;
      const attempt = ++token;
      pendingPlay = true; setStarting(true);
      try {
        // Failed initialization remains retryable on the next Play. Do not
        // start unmanaged playback without a durable local outbox.
        await initialize();
        if(disposed||attempt!==token)return;
        if(element!.readyState<1)await waitFor('loadedmetadata',15000);
        if(disposed||attempt!==token)return;
        const snapshot = await sync?.prepare();
        if(disposed||attempt!==token)return;
        if(snapshot) {
          completed = snapshot.completed;
          await restore(snapshot.completed?0:snapshot.positionMs);
        }
        if(disposed||attempt!==token)return;
        completed = false;
        await element!.play();
      } catch(error) {
        if(!disposed && attempt===token && !(error instanceof DOMException && error.name==='NotAllowedError')) {
          setView(previous=>({...previous,message:error instanceof Error?error.message:'Wiedergabe konnte nicht gestartet werden.'}));
        }
      } finally {
        if(attempt===token) { pendingPlay=false; if(!disposed)setStarting(false); }
      }
    }
    function pause() {
      // A resolution can already have committed a fresh server revision. Do
      // not cancel its matching audio restore or allow stale checkpoints.
      if(resolutionLocked)return;
      ++token; pendingPlay=false; setStarting(false); element!.pause();
    }
    function seek(value:number) {
      if(!sync || pendingPlay || resolutionLocked || !Number.isFinite(element!.duration))return;
      ++token; active = true; completed = false;
      const target = Math.max(0,Math.min(value,element!.duration));
      pendingSeek = target;
      // Persist explicit intent even if the player closes before seeked fires.
      void sync.checkpoint(target*1000,false).catch(()=>{if(!disposed)setView(previous=>({...previous,message:'Position konnte nicht lokal gespeichert werden'}));});
      element!.currentTime = target;
    }
    async function resolve(useServer:boolean,recoveryKey?:string) {
      if(pendingPlay||resolutionLocked)return;
      pause();
      const checkpoint = save();
      // The old media position must never be checkpointed against a revision
      // committed by this choice, even if a later storage/seek operation fails.
      active=false;
      const attempt = ++token;
      resolutionLocked=true; pendingPlay=true; setResolving(true); setStarting(true);
      try {
        await checkpoint;
        const snapshot = await sync?.resolve(useServer,recoveryKey);
        if(disposed||attempt!==token)return;
        if(snapshot&&(useServer||recoveryKey)) {
          // Disable checkpoints before the asynchronous seek, including if
          // seeking fails or the player closes after the database commit.
          active=false; completed = snapshot.completed; pendingSeek=undefined;
          // Adopting a completed episode must not turn it into a replay.
          await restore(snapshot.positionMs);
        }
      } catch(error) {
        if(!disposed&&attempt===token)setView(previous=>({...previous,message:error instanceof Error?error.message:'Server nicht erreichbar · Auswahl erneut versuchen'}));
      } finally {
        resolutionLocked=false;
        if(!disposed)setResolving(false);
        if(attempt===token){pendingPlay=false;if(!disposed)setStarting(false);}
      }
    }
    function playing() { if(resolutionLocked){element!.pause();return;} active=true; completed=false; void save(true); }
    function paused() { if(!pendingPlay&&!element!.ended)void save(true); }
    function seeked() { if(!restoring&&active) {pendingSeek=undefined;completed=false;void save(true);} }
    function ended() { active=true;completed=true;void save(true); }
    function hidden() { if(document.visibilityState==='hidden')void save(true); }
    function leaving() { void save(true); }
    const timer = setInterval(()=>{if(!element.paused&&!element.ended)void save();},5000);
    element.addEventListener('playing',playing); element.addEventListener('pause',paused);
    element.addEventListener('seeked',seeked); element.addEventListener('ended',ended);
    document.addEventListener('visibilitychange',hidden); window.addEventListener('pagehide',leaving);
    controls.current = {play:()=>void play(),pause,seek,resolve:(value,recoveryKey)=>void resolve(value,recoveryKey)};
    void play();
    return ()=>{
      disposed=true; ++token;
      void save(true);
      waiters.forEach(cancel=>cancel());
      clearInterval(timer); unsubscribe();
      element.removeEventListener('playing',playing); element.removeEventListener('pause',paused);
      element.removeEventListener('seeked',seeked); element.removeEventListener('ended',ended);
      document.removeEventListener('visibilitychange',hidden); window.removeEventListener('pagehide',leaving);
      controls.current = {play:()=>{},pause:()=>{},seek:()=>{},resolve:()=>{}};
    };
  },[articleId,audioId,audio]);
  return {
    ...view,starting,resolving,
    play:useCallback(()=>controls.current.play(),[]),
    pause:useCallback(()=>controls.current.pause(),[]),
    seek:useCallback((value:number)=>controls.current.seek(value),[]),
    resolve:useCallback((useServer:boolean,recoveryKey?:string)=>controls.current.resolve(useServer,recoveryKey),[]),
  };
}
