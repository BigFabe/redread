import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Article, Settings } from './types';
import { articleDir, patchArticle, settings } from './db';
import { createLimiter, mapConcurrent } from './concurrency';
const exec = promisify(execFile);
// Global within the single worker process, not multiplied by active articles.
const llmSlot = createLimiter(() => settings().llmConcurrency);
const ttsSlot = createLimiter(() => settings().ttsConcurrency);

export function splitText(text: string, limit = 3000): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const section = remaining.slice(0, limit);
    let cut = Math.max(section.lastIndexOf('\n\n'), section.lastIndexOf('. '), section.lastIndexOf('! '), section.lastIndexOf('? '));
    if (cut < limit / 2) cut = section.lastIndexOf(' ');
    if (cut < 1) cut = limit - 1;
    parts.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
async function provider(url: string, path: string, key: string, body: object, headers: Record<string,string> = {}) {
  const response = await fetch(path ? `${url.replace(/\/$/, '')}/${path}` : url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {}), ...headers},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Modell-Endpunkt ${path || 'TTS'}: HTTP ${response.status}. Prüfe Modell, API-Key und Basis-URL in den Einstellungen.`);
  }
  return response;
}
export async function prepareText(s: Settings, input: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider(s.llmUrl, 'chat/completions', s.llmKey, {model: s.llmModel, messages: [{role:'system',content:s.prompt},{role:'user',content:input}]});
    const json = await response.json();
    const choice = json.choices?.[0];
    const error = json.error || choice?.error;
    if (error || choice?.finish_reason === 'error') {
      const code = typeof error?.code === 'number' ? ` (Code ${error.code})` : '';
      throw new Error(`Der LLM-Anbieter meldet einen Fehler${code}, obwohl die HTTP-Anfrage erfolgreich war. Bitte erneut versuchen.`);
    }
    if (choice?.finish_reason === 'length') throw new Error('Das LLM hat das Ausgabelimit erreicht. Bei Reasoning-Modellen kann das Limit schon vor der eigentlichen Textausgabe verbraucht sein. Bitte ein höheres Ausgabelimit oder ein anderes Modell verwenden.');
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new Error('Das LLM hat die Verarbeitung des Artikels abgelehnt (Inhaltsfilter).');
    const text = choice?.message?.content;
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (attempt === 0) { await new Promise(resolve => setTimeout(resolve, 750)); continue; }
    const reasoning = Number(json.usage?.completion_tokens_details?.reasoning_tokens);
    const detail = Number.isFinite(reasoning) && reasoning > 0 ? ` Es wurden ${reasoning} Reasoning-Tokens, aber keine Hörfassung geliefert.` : '';
    throw new Error(`Das LLM hat auch beim zweiten Versuch keinen Text zurückgegeben.${detail} Bitte erneut versuchen oder das Modell wechseln.`);
  }
  throw new Error('Keine LLM-Ausgabe.');
}
export function speech(s: Settings, text: string) {
  if (s.ttsProvider === 'fish') {
    return provider(s.ttsUrl, '', s.ttsKey, {text, format: 'mp3', ...(s.voice ? {reference_id: s.voice} : {})}, {model: s.ttsModel});
  }
  return provider(s.ttsUrl, 'audio/speech', s.ttsKey, {model: s.ttsModel, voice: s.voice, input: text, response_format: 'mp3'});
}
export async function processArticle(article: Article) {
  const s = settings();
  const dir = articleDir(article.id);
  const recipe = {llmUrl: s.llmUrl, llmModel: s.llmModel, prompt: s.prompt, ttsProvider: s.ttsProvider, ttsUrl: s.ttsUrl, ttsModel: s.ttsModel, voice: s.voice};
  patchArticle(article.id, {recipe: JSON.stringify(recipe)});
  let script = article.script;
  if (!script) {
    const parts = splitText(article.original, s.llmChunkChars);
    const pending = new Map<string, Promise<string>>();
    let completed = 0;
    patchArticle(article.id, {progress: `Hörfassung · 0 von ${parts.length} Abschnitten fertig`});
    const result = await mapConcurrent(parts, 32, async part => {
      const hash = createHash('sha256').update(JSON.stringify([s.llmUrl,s.llmModel,s.prompt,part])).digest('hex');
      let job = pending.get(hash);
      if (!job) {
        job = (async () => {
          const file = join(dir, `text-${hash}.txt`);
          if (existsSync(file)) return readFileSync(file, 'utf8');
          const text = await llmSlot(() => prepareText(s, part));
          writeFileSync(file, text, {mode: 0o600});
          return text;
        })();
        pending.set(hash, job);
      }
      const text = await job;
      patchArticle(article.id, {progress: `Hörfassung · ${++completed} von ${parts.length} Abschnitten fertig`});
      return text;
    });
    script = result.join('\n\n');
    patchArticle(article.id, {script});
  }
  patchArticle(article.id, {status: 'speaking'});
  const parts = splitText(script);
  const pendingAudio = new Map<string, Promise<string>>();
  let completedAudio = 0;
  patchArticle(article.id, {progress: `Audio · 0 von ${parts.length} Abschnitten fertig`});
  const files = await mapConcurrent(parts, 32, async part => {
    const hash = createHash('sha256').update(JSON.stringify([s.ttsProvider,s.ttsUrl,s.ttsModel,s.voice,part])).digest('hex');
    let job = pendingAudio.get(hash);
    if (!job) {
      job = (async () => {
        const filename = `audio-${hash}.mp3`; const file = join(dir, filename);
        if (!existsSync(file)) {
          await ttsSlot(async () => {
            const response = await speech(s, part);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length) throw new Error('Das TTS-Modell hat kein Audio zurückgegeben.');
            writeFileSync(file+'.tmp', bytes, {mode: 0o600}); renameSync(file+'.tmp', file);
          });
        }
        return filename;
      })();
      pendingAudio.set(hash, job);
    }
    const filename = await job;
    patchArticle(article.id, {progress: `Audio · ${++completedAudio} von ${parts.length} Abschnitten fertig`});
    return filename;
  });
  patchArticle(article.id, {progress: 'Audiodatei zusammenfügen'});
  writeFileSync(join(dir,'concat.txt'), files.map(f => `file '${f}'`).join('\n'));
  await exec('ffmpeg', ['-y','-v','error','-f','concat','-safe','1','-i',join(dir,'concat.txt'),'-codec:a','libmp3lame','-b:a','128k',join(dir,'episode.tmp.mp3')], {timeout: 300000});
  const {stdout} = await exec('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',join(dir,'episode.tmp.mp3')]);
  renameSync(join(dir,'episode.tmp.mp3'), join(dir,'episode.mp3'));
  patchArticle(article.id, {status:'ready',progress:'Im Podcastfeed',error:'',publishedAt:new Date().toISOString(), duration: Number(stdout.trim()) || 0, audioBytes: statSync(join(dir,'episode.mp3')).size});
}
