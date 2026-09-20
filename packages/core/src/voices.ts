export type CustomVoice = {name:string;voice:string};
export function customVoices(value:unknown):CustomVoice[] {
  if(!Array.isArray(value)||value.length>100)throw new Error('Bitte maximal 100 eigene Stimmen anlegen.');
  const names=new Set<string>();
  return value.map(row=>{
    if(!row||typeof row.name!=='string'||typeof row.voice!=='string')throw new Error('Jede Stimme benötigt einen Namen und eine Voice-ID.');
    const name=row.name.trim(),voice=row.voice.trim();
    if(!name||name.length>100||!voice||voice.length>200)throw new Error('Name (max. 100 Zeichen) und Voice-ID (max. 200 Zeichen) dürfen nicht leer sein.');
    if(names.has(name.toLowerCase()))throw new Error('Stimmennamen müssen eindeutig sein.');
    names.add(name.toLowerCase());return {name,voice};
  });
}
