'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AudioLines, Download, LoaderCircle, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import type { Article } from '@redread/core/types';

const timestamp = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

function SkipIcon({forward=false}:{forward?:boolean}) {
  return <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
    <g transform={forward?'translate(24 0) scale(-1 1)':undefined} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 6.5A8 8 0 1 1 4 13M3 3v5h5"/>
    </g>
    <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize="8" fontWeight="600" fontFamily="var(--body)">15</text>
  </svg>;
}

export default function AudioPlayer({ article, onClose, onOpen, audioRef, onPausedChange }: {
  article: Article; onClose: () => void; onOpen: () => void;
  audioRef: RefObject<HTMLAudioElement|null>; onPausedChange: (paused: boolean) => void;
}) {
  const audio = audioRef;
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(article.duration || 0);
  const [rate, setRate] = useState(1);
  const [rateOpen, setRateOpen] = useState(false);
  const rateControl = useRef<HTMLDivElement>(null);
  const rateButton = useRef<HTMLButtonElement>(null);
  const rateId = useId();
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');

  async function play() {
    try { await audio.current?.play(); }
    catch { setPaused(true); setWaiting(false); }
  }
  useEffect(() => { void play(); }, []);
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
    audio.current.currentTime = Math.max(0, Math.min(value, audio.current.duration));
    setPosition(audio.current.currentTime);
  }
  function updateDuration() {
    if (audio.current && Number.isFinite(audio.current.duration)) setDuration(audio.current.duration);
  }

  return <section className="player-bar" aria-label="Audioplayer">
    <audio ref={audio} src={`/api/articles/${article.id}/audio?v=${encodeURIComponent(article.publishedAt)}`} preload="metadata"
      onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
      onPlay={() => { setPaused(false); setError(''); }}
      onPause={() => { setPaused(true); setWaiting(false); }}
      onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
      onCanPlay={() => setWaiting(false)} onEnded={() => { setPaused(true); setWaiting(false); }}
      onError={() => { setError('Audio konnte nicht geladen werden.'); setWaiting(false); setPaused(true); }} />
    <div className="player-main">
      <button className="player-article" onClick={onOpen} title={article.title} aria-label={`Artikel öffnen: ${article.title}`}>
        <AudioLines size={24}/><span><strong>{article.title}</strong><small>{article.source}</small></span>
      </button>
      <div className="player-transport">
        <button className="icon-button player-skip" aria-label="15 Sekunden zurück" onClick={() => seek((audio.current?.currentTime || 0) - 15)}><SkipIcon/></button>
        <button className="player-toggle" aria-label={paused?'Abspielen':'Pausieren'} onClick={() => { if (paused) void play(); else audio.current?.pause(); }} disabled={!!error}>
          {waiting&&!paused?<LoaderCircle size={21} className="spin"/>:paused?<Play size={21} fill="currentColor"/>:<Pause size={21} fill="currentColor"/>}
        </button>
        <button className="icon-button player-skip" aria-label="15 Sekunden vor" onClick={() => seek((audio.current?.currentTime || 0) + 15)}><SkipIcon forward/></button>
      </div>
      <div className="player-options">
        <div className="player-rate-control" ref={rateControl}>
          <button ref={rateButton} className="player-rate" aria-label={`Wiedergabetempo: ${rate.toLocaleString('de-DE')}×`} aria-expanded={rateOpen} aria-controls={rateId} onClick={() => setRateOpen(!rateOpen)}>{rate.toLocaleString('de-DE')}×</button>
          {rateOpen&&<div id={rateId} className="player-rate-menu" role="group" aria-label="Wiedergabetempo wählen">
            {[0.75,1,1.25,1.5,1.75,2].map(value => <button key={value} aria-pressed={rate===value} onClick={() => { setRate(value); if(audio.current) audio.current.playbackRate=value; setRateOpen(false); rateButton.current?.focus(); }}>{value.toLocaleString('de-DE')}×</button>)}
          </div>}
        </div>
        <button className="icon-button player-mute" aria-label={muted?'Ton einschalten':'Stummschalten'} onClick={() => { if(audio.current) audio.current.muted=!muted; setMuted(!muted); }}>{muted?<VolumeX size={19}/>:<Volume2 size={19}/>}</button>
        <a className="icon-button" href={`/api/articles/${article.id}/audio?v=${encodeURIComponent(article.publishedAt)}`} download aria-label="Audio herunterladen"><Download size={19}/></a>
        <button className="icon-button" aria-label="Player schließen" onClick={onClose}><X size={19}/></button>
      </div>
    </div>
    <div className="player-timeline"><time>{timestamp(position)}</time><input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position,duration || 1)} disabled={!duration||!!error} aria-label="Wiedergabeposition" aria-valuetext={`${timestamp(position)} von ${timestamp(duration)}`} style={{'--progress':`${duration?position/duration*100:0}%`} as CSSProperties} onChange={e => seek(Number(e.target.value))}/><time>{timestamp(duration)}</time></div>
    {error&&<p className="player-error" role="alert">{error}</p>}
  </section>;
}
