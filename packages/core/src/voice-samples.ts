import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';
import { speech } from './pipeline';
import type { Settings } from './types';

export const sampleText = 'Hallo, so klingt meine Stimme. Mit redread kannst du deine Artikel unterwegs anhören, ganz in deinem eigenen Tempo.';
const pending = new Map<string, Promise<string>>();

function sampleId(s: Settings, voice: string) {
  return createHash('sha256').update(JSON.stringify([s.ttsProvider, s.ttsUrl, s.ttsModel, voice, sampleText])).digest('hex');
}
export function voiceSampleFile(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid voice sample ID.');
  return join(dataDir, 'voice-samples', `${id}.mp3`);
}
export function listVoiceSamples(s: Settings) {
  const voices = new Map<string, string>([[s.voice, 'Default voice']]);
  for (const [language, voice] of Object.entries(s.languageVoices)) voices.set(voice, `${language.toUpperCase()} voice`);
  for (const {name, voice} of s.customVoices) voices.set(voice, name);
  return Array.from(voices, ([voice, name]) => {
    const id = sampleId(s, voice);
    return {voice, name, id, available: existsSync(voiceSampleFile(id))};
  });
}
export async function createVoiceSample(s: Settings, voice: string): Promise<string> {
  if (!s.ttsModel) throw new Error('Configure a TTS model before creating a voice sample.');
  if (!listVoiceSamples(s).some(sample => sample.voice === voice)) throw new Error('Save this voice in Settings first.');
  const id = sampleId(s, voice);
  const file = voiceSampleFile(id);
  if (existsSync(file)) return id;
  const existing = pending.get(id);
  if (existing) return existing;
  const job = (async () => {
    const response = await speech({...s, voice}, sampleText);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('The TTS model returned no audio.');
    mkdirSync(join(dataDir, 'voice-samples'), {recursive: true, mode: 0o700});
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, {mode: 0o600});
      renameSync(temporary, file);
    } finally { rmSync(temporary, {force: true}); }
    return id;
  })();
  pending.set(id, job);
  try { return await job; }
  finally { pending.delete(id); }
}
