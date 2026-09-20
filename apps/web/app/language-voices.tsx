'use client';
import { Plus, X } from 'lucide-react';
import { languageCode, languageVoices } from '@redread/core/language';

export type VoiceRow={language:string;voice:string};
export function voiceRowsToSettings(rows:VoiceRow[]) {
  const values:Record<string,string>={};
  for(const row of rows) {
    if(!row.language.trim()&&!row.voice.trim())continue;
    const code=languageCode(row.language);
    if(Object.hasOwn(values,code))throw new Error(`Sprache ${code} ist doppelt eingetragen.`);
    values[code]=row.voice;
  }
  return languageVoices(values);
}
export default function LanguageVoices({rows,onChange,fish,disabled}:{rows:VoiceRow[];onChange:(rows:VoiceRow[])=>void;fish:boolean;disabled:boolean}) {
  return <section className="settings-section language-voices"><h2>Stimmen nach Sprache</h2>
    <p className="muted">Das LLM erkennt die Artikelsprache vor der Verarbeitung. Ohne passende Zuordnung wird die Standardstimme verwendet.</p>
    {rows.map((row,index)=><div className="language-voice-row" key={index}>
      <label>Sprache<input aria-label={`Sprache ${index+1}`} disabled={disabled} value={row.language} placeholder="de, en, fr …" maxLength={35} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,language:e.target.value}:r))}/></label>
      <label>{fish?'Stimme (Reference-ID)':'Stimme'}<input aria-label={`Stimme ${index+1}`} disabled={disabled} value={row.voice} placeholder={fish?'Reference-ID':'Stimmen-ID'} maxLength={200} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,voice:e.target.value}:r))}/></label>
      <button type="button" className="icon-button" disabled={disabled} title="Zuordnung entfernen" aria-label={`Sprachstimme ${index+1} entfernen`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}><X size={18}/></button>
    </div>)}
    <button type="button" className="text-link" disabled={disabled||rows.length>=50} onClick={()=>onChange([...rows,{language:'',voice:''}])}><Plus size={16}/>Sprache hinzufügen</button>
  </section>;
}
