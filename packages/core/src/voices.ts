export type CustomVoice = {name:string;voice:string};
export function customVoices(value:unknown):CustomVoice[] {
  if(!Array.isArray(value)||value.length>100)throw new Error('Please create no more than 100 custom voices.');
  const names=new Set<string>();
  return value.map(row=>{
    if(!row||typeof row.name!=='string'||typeof row.voice!=='string')throw new Error('Every voice requires a name and a voice ID.');
    const name=row.name.trim(),voice=row.voice.trim();
    if(!name||name.length>100||!voice||voice.length>200)throw new Error('Name (max. 100 characters) and voice ID (max. 200 characters) must not be empty.');
    if(names.has(name.toLowerCase()))throw new Error('Voice names must be unique.');
    names.add(name.toLowerCase());return {name,voice};
  });
}
