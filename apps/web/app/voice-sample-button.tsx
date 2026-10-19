'use client';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Square, Volume2 } from 'lucide-react';

export default function VoiceSampleButton({voice, name, disabled, onError}: {
  voice: string; name: string; disabled: boolean; onError: (message: string) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController|null>(null);
  const sampleId = useRef('');
  const [pending, setPending] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = audio.current;
    return () => { request.current?.abort(); element?.pause(); };
  }, []);

  async function toggle() {
    const element = audio.current;
    if (!element || pending) return;
    if (!element.paused) { element.pause(); return; }
    setPending(true); onError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!sampleId.current) {
        const response = await fetch('/api/voice-samples', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({voice}), signal:controller.signal});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The voice sample could not be created.');
        sampleId.current = data.id;
        element.src = `/api/voice-samples/${data.id}`;
      }
      if (controller.signal.aborted) return;
      element.currentTime = 0;
      await element.play();
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Sample saved. Click the speaker again to listen.' : (error as Error).message);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const label = pending ? `Creating voice sample: ${name}` : playing ? `Stop voice sample: ${name}` : `Listen to voice sample: ${name}`;
  return <>
    <audio ref={audio} hidden preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); onError(`The voice sample for ${name} could not be loaded. Click the speaker to try again.`); }}/>
    <button type="button" className="icon-button" disabled={disabled || pending} aria-label={label} aria-pressed={playing} aria-busy={pending} title={playing ? label : `${label}. Creates and saves a sample once using your TTS provider.`} onClick={() => void toggle()}>
      {pending ? <LoaderCircle size={17} className="spin"/> : playing ? <Square size={15} fill="currentColor"/> : <Volume2 size={17}/>}
    </button>
  </>;
}
