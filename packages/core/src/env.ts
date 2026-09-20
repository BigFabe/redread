import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import type { Settings } from './types';
import { languageVoices } from './language';
import { customVoices } from './voices';

// Web/worker workspace commands and direct commands from the repository root.
const paths = process.env.REDREAD_ENV_FILE !== undefined
  ? [process.env.REDREAD_ENV_FILE]
  : [resolve(/* turbopackIgnore: true */ '.env'), resolve(/* turbopackIgnore: true */ '../../.env')];
const file = paths.find(path => path && existsSync(path));
if (file) loadEnvFile(file);

function integerSetting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} muss eine Ganzzahl zwischen ${min} und ${max} sein.`);
  return value;
}
const numericNames = {
  articleConcurrency: ['ARTICLE_CONCURRENCY', 2, 1, 8],
  llmConcurrency: ['LLM_CONCURRENCY', 3, 1, 32],
  ttsConcurrency: ['TTS_CONCURRENCY', 2, 1, 32],
  llmChunkChars: ['LLM_CHUNK_CHARS', 3000, 1000, 12000],
} as const;

const names = {
  llmUrl: 'LLM_BASE_URL', llmModel: 'LLM_MODEL', llmKey: 'LLM_API_KEY',
  ttsProvider: 'TTS_PROVIDER', ttsUrl: 'TTS_URL', ttsModel: 'TTS_MODEL',
  ttsKey: 'TTS_API_KEY', voice: 'TTS_VOICE',
  prompt: 'LLM_PROMPT', publicUrl: 'PUBLIC_URL', feedTitle: 'FEED_TITLE',
} as const;
export function environmentSettings(): Partial<Settings> {
  const result: Record<string,unknown> = {};
  if(process.env.TTS_CUSTOM_VOICES!==undefined){
    try{result.customVoices=customVoices(JSON.parse(process.env.TTS_CUSTOM_VOICES));}
    catch(error){throw new Error(`TTS_CUSTOM_VOICES: ${(error as Error).message}`);}
  }
  if (process.env.TTS_LANGUAGE_VOICES !== undefined) {
    try { result.languageVoices=languageVoices(JSON.parse(process.env.TTS_LANGUAGE_VOICES)); }
    catch { throw new Error('TTS_LANGUAGE_VOICES muss eine gültige JSON-Zuordnung sein, z. B. {"de":"stimme-de","en":"stimme-en"}.'); }
  }
  for (const [field, variable] of Object.entries(names)) {
    if (process.env[variable] !== undefined) result[field] = process.env[variable]!;
  }
  for (const [field, [name, fallback, min, max]] of Object.entries(numericNames)) {
    if (process.env[name] !== undefined) result[field] = integerSetting(name, fallback, min, max);
  }
  if (result.ttsProvider && !['openai','fish'].includes(String(result.ttsProvider))) throw new Error('TTS_PROVIDER muss openai oder fish sein.');
  return result as Partial<Settings>;
}
