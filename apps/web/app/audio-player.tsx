'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AudioLines, ChevronDown, Download, List, LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { PlayableArticle } from '@redread/core/types';
import { timestamp } from '@redread/core/duration';
import { usePlaybackProgress } from './use-playback-progress';

function SkipIcon({forward=false}:{forward?:boolean}) {
  return <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
    <g transform={forward?'translate(24 0) scale(-1 1)':undefined} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 6.5A8 8 0 1 1 4 13M3 3v5h5"/>
    </g>
    <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize="8" fontWeight="600" fontFamily="var(--body)">15</text>
  </svg>;
}

export default function AudioPlayer({ article, onClose, onOpen, audioRef, playRef, onPausedChange, rate, onRateChange }: {
  article: PlayableArticle; onClose: () => void; onOpen: () => void;
  audioRef: RefObject<HTMLAudioElement|null>; playRef: RefObject<(()=>void)|null>; onPausedChange: (paused: boolean) => void;
  rate: number; onRateChange: (rate: number) => void;
}) {
  const audio = audioRef;
  const audioId = article.audioId || article.versionId || '';
  const audioUrl = `/api/articles/${article.id}/audio?version=${encodeURIComponent(audioId)}`;
  const progress = usePlaybackProgress(article.id,audioId,audio);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(article.duration || 0);
  const [rateOpen, setRateOpen] = useState(false);
  const rateControl = useRef<HTMLDivElement>(null);
  const rateButton = useRef<HTMLButtonElement>(null);
  const rateId = useId();
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const chapters = article.chapters || [];
  const chapterIndex = Math.max(0, chapters.findLastIndex(chapter => chapter.startTime <= position + 0.05));
  const currentChapter = chapters[chapterIndex];
  const chapterMenuId = useId();
  const chapterMenu = useRef<HTMLDivElement>(null);
  const chapterButton = useRef<HTMLButtonElement>(null);
  const chapterDisabled = !duration || !!error || progress.starting;
  const restartChapter = currentChapter && position > currentChapter.startTime + 3;

  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [audio, rate]);
  useEffect(() => { playRef.current=progress.play; return ()=>{playRef.current=null;}; },[playRef,progress.play]);
  useEffect(() => { onPausedChange(paused); }, [paused,onPausedChange]);
  useEffect(() => {
    if (!rateOpen) return;
    function outside(event: PointerEvent) {
      if (!rateControl.current?.contains(event.target as Node)) setRateOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key==='Escape') { setRateOpen(false); rateButton.current?.focus(); }
    }
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape); };
  },[rateOpen]);

  function seek(value: number) {
    if (!audio.current || !Number.isFinite(audio.current.duration)) return;
    progress.seek(value);
  }
  function updateDuration() {
    if (audio.current) {
      audio.current.playbackRate = rate;
      if (Number.isFinite(audio.current.duration)) setDuration(audio.current.duration);
    }
  }

  return <section className="player-bar" aria-label="Audioplayer">
    <audio ref={audio} src={audioUrl} preload="metadata"
      onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
      onPlay={() => { setPaused(false); setError(''); }}
      onPause={() => { setPaused(true); setWaiting(false); }}
      onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
      onCanPlay={() => setWaiting(false)} onEnded={() => { setPaused(true); setWaiting(false); }}
      onError={() => { setError('Audio konnte nicht geladen werden.'); setWaiting(false); setPaused(true); }} />
    <div className="player-main">
      <button className="player-article" onClick={onOpen} title={article.title} aria-label={`Open article: ${article.title}`}>
        <AudioLines size={24}/><span><strong>{article.title}</strong><small>{article.source}{article.versionId&&` · Previous version · ${new Date(article.publishedAt).toLocaleString()}`}</small></span>
      </button>
      <div className="player-transport">
        <button className="icon-button player-skip" aria-label="Back 15 seconds" disabled={progress.starting} onClick={() => seek((audio.current?.currentTime || 0) - 15)}><SkipIcon/></button>
        <button className="player-toggle" aria-label={progress.resolving?'Hörposition wird abgeglichen':progress.starting?'Start abbrechen':paused?'Abspielen':'Pausieren'} onClick={() => { if (progress.starting||!paused) progress.pause(); else progress.play(); }} disabled={!!error||progress.resolving}>
          {progress.starting||waiting&&!paused?<LoaderCircle size={21} className="spin"/>:paused?<Play size={21} fill="currentColor"/>:<Pause size={21} fill="currentColor"/>}
        </button>
        <button className="icon-button player-skip" aria-label="15 Sekunden vor" disabled={progress.starting} onClick={() => seek((audio.current?.currentTime || 0) + 15)}><SkipIcon forward/></button>
      </div>
      <div className="player-options">
        <div className="player-rate-control" ref={rateControl}>
          <button ref={rateButton} className="player-rate" aria-label={`Wiedergabetempo: ${rate.toLocaleString('de-DE')}×`} aria-expanded={rateOpen} aria-controls={rateId} onClick={() => setRateOpen(!rateOpen)}>{rate.toLocaleString('de-DE')}×</button>
          {rateOpen&&<div id={rateId} className="player-rate-menu" role="group" aria-label="Choose playback speed">
            <label htmlFor={`${rateId}-slider`}>Wiedergabetempo <output>{rate.toLocaleString('de-DE')}×</output></label>
            <input id={`${rateId}-slider`} type="range" min={0.5} max={3} step={0.05} value={rate} aria-label="Wiedergabetempo" aria-valuetext={`${rate.toLocaleString('de-DE')}×`} onChange={e => onRateChange(Number(e.target.value))}/>
            <div className="player-rate-limits"><span>0,5×</span><span>3×</span></div>
          </div>}
        </div>
        <button className="icon-button player-mute" aria-label={muted?'Ton einschalten':'Stummschalten'} onClick={() => { if(audio.current) audio.current.muted=!muted; setMuted(!muted); }}>{muted?<VolumeX size={19}/>:<Volume2 size={19}/>}</button>
        <a className="icon-button" href={audioUrl} download aria-label="Audio herunterladen"><Download size={19}/></a>
        <button className="icon-button" aria-label="Close player" onClick={onClose}><X size={19}/></button>
      </div>
    </div>
    <div className="player-timeline"><time>{timestamp(position/rate)}</time><div className="player-track"><input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position,duration || 1)} disabled={!duration||!!error||progress.starting} aria-label="Wiedergabeposition" aria-valuetext={`${timestamp(position/rate)} von ${timestamp(duration/rate)}`} style={{'--progress':`${duration?position/duration*100:0}%`} as CSSProperties} onChange={e => seek(Number(e.target.value))}/>{duration>0&&<span className="player-chapter-marks" aria-hidden="true">{chapters.slice(1).map((chapter,index)=><i key={index} style={{left:`${Math.min(100,chapter.startTime/duration*100)}%`}}/>)}</span>}</div><time title={`Hördauer bei ${rate.toLocaleString('de-DE')}×`}>{timestamp(duration/rate)}</time></div>
    {currentChapter&&<nav className="player-chapters" aria-label="Kapitelnavigation">
      <button type="button" className="icon-button" aria-label={restartChapter?'Zum Kapitelanfang':'Vorheriges Kapitel'} title={restartChapter?'Zum Kapitelanfang':'Vorheriges Kapitel'} disabled={chapterDisabled||chapterIndex===0&&!restartChapter} onClick={()=>seek(chapters[restartChapter?chapterIndex:Math.max(0,chapterIndex-1)].startTime)}><SkipBack size={17}/></button>
      <button ref={chapterButton} type="button" className="player-chapter-current" popoverTarget={chapterMenuId} aria-controls={chapterMenuId} aria-haspopup="dialog" title="Kapitel auswählen"><List size={16}/><small>{chapterIndex+1}/{chapters.length}</small><span>{currentChapter.title}</span><ChevronDown size={15}/></button>
      <button type="button" className="icon-button" aria-label="Nächstes Kapitel" title="Nächstes Kapitel" disabled={chapterDisabled||chapterIndex>=chapters.length-1} onClick={()=>seek(chapters[chapterIndex+1].startTime)}><SkipForward size={17}/></button>
      <div ref={chapterMenu} id={chapterMenuId} popover="auto" role="dialog" aria-label="Kapitel auswählen" className="player-chapter-menu">
        <header><strong>Kapitel</strong><button type="button" className="icon-button" aria-label="Kapitelliste schließen" popoverTarget={chapterMenuId} popoverTargetAction="hide"><X size={17}/></button></header>
        <ol>{chapters.map((chapter,index)=><li key={index}><button type="button" aria-current={index===chapterIndex?'true':undefined} disabled={chapterDisabled} onClick={()=>{seek(chapter.startTime);chapterMenu.current?.hidePopover();chapterButton.current?.focus();}}><small>{index+1}</small><span>{chapter.title}</span><time>{timestamp(chapter.startTime/rate)}</time></button></li>)}</ol>
      </div>
    </nav>}
    <div className="player-sync" role="status"><span>{progress.message}</span>{progress.entry?.conflict&&<div className="player-sync-actions"><button type="button" disabled={progress.starting} onClick={()=>progress.resolve(true)}>Serverstand übernehmen</button><button type="button" disabled={progress.starting} onClick={()=>progress.resolve(false)}>Hier fortsetzen</button></div>}{progress.recoveries?.slice(0,1).map(entry=><div className="player-sync-recovery" key={entry.key}><span>Weitere lokale Position: {timestamp(entry.snapshot.positionMs/1000)}{entry.snapshot.completed?' · abgeschlossen':''}{progress.recoveries!.length>1?` · ${progress.recoveries!.length} gespeichert`:''}</span><div className="player-sync-actions"><button type="button" disabled={progress.starting} onClick={()=>progress.resolve(false,entry.key)}>Diese Position übernehmen</button><button type="button" disabled={progress.starting} onClick={()=>progress.resolve(true,entry.key)}>Serverstand behalten</button></div></div>)}</div>
    {error&&<p className="player-error" role="alert">{error}</p>}
  </section>;
}
