'use client';
import {Plus,Trash2} from 'lucide-react';
import type {CustomVoice} from '@redread/core/voices';

export function VoiceSelect({voices,value,onChange,disabled=false}:{voices:CustomVoice[];value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  if(!voices.length&&!value)return null;
  return <label>Voice<select aria-label="Voice" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">Automatic / default voice</option>{value&&!voices.some(v=>v.voice===value)&&<option value={value}>{value}</option>}{voices.map((v,i)=><option key={i} value={v.voice}>{v.name}</option>)}</select></label>;
}
export default function CustomVoices({rows,onChange,disabled}:{rows:CustomVoice[];onChange:(rows:CustomVoice[])=>void;disabled:boolean}) {
  return <section className="settings-section"><h2>Custom voices</h2><div className="custom-voices-table"><table><thead><tr><th scope="col">Name</th><th scope="col">Voice ID</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map((row,index)=><tr key={index}><td><input aria-label={`Voice name ${index+1}`} required maxLength={100} disabled={disabled} value={row.name} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/></td><td><input aria-label={`Voice ID ${index+1}`} required maxLength={200} disabled={disabled} value={row.voice} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,voice:e.target.value}:r))}/></td><td><button type="button" className="icon-button danger" aria-label={`Remove voice ${index+1}`} disabled={disabled} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}><Trash2 size={17}/></button></td></tr>)}</tbody></table></div><button type="button" className="button secondary" disabled={disabled||rows.length>=100} onClick={()=>onChange([...rows,{name:'',voice:''}])}><Plus size={16}/>Add voice</button></section>;
}
