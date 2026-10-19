import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Article, AudioChapter, Settings } from './types';
import { articleDir, patchArticle, settings } from './db';
import { createLimiter, mapConcurrent } from './concurrency';
import { languagePrompt, parseDetectedLanguage, voiceForLanguage } from './language';
import { normalizeArticleText } from './text';
import { chapterPrompt, chapterSections, chapterMetadata } from './chapters';
const exec = promisify(execFile);
// Global within the single worker process, not multiplied by active articles.
const llmSlot = createLimiter(() => settings().llmConcurrency);
const ttsSlot = createLimiter(() => settings().ttsConcurrency);

export function splitText(text: string, limit = 3000, targetParts = 1): string[] {
  if (!Number.isInteger(targetParts) || targetParts < 1) throw new Error('Invalid target number of text sections.');
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
  const segmenter = new Intl.Segmenter('en', {granularity:'sentence'});
  while (parts.length < targetParts) {
    const candidates = parts.map((part,index) => ({part,index})).sort((a,b) => b.part.length-a.part.length);
    let divided = false;
    for (const {part,index} of candidates) {
      let boundaries = Array.from(segmenter.segment(part), segment => segment.index).filter(i => i > 0);
      if (!boundaries.length) boundaries = Array.from(part.matchAll(/\s+/g), match => match.index!).filter(i => i > 0);
      if (!boundaries.length) continue;
      const midpoint = part.length/2;
      const cut = boundaries.reduce((best,value) => Math.abs(value-midpoint)<Math.abs(best-midpoint)?value:best);
      parts.splice(index,1,part.slice(0,cut).trim(),part.slice(cut).trim());
      divided = true;
      break;
    }
    if (!divided) break; // A single word cannot be split usefully.
  }
  return parts;
}
export function splitSpeech(text: string, concurrency: number): string[] {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid TTS concurrency.');
  // Preserve the provider's maximum chunk size, then supply enough work even
  // when the whole script is under 3000 characters.
  return splitText(text, 3000, concurrency);
}
async function provider(url: string, path: string, key: string, body: object, headers: Record<string,string> = {}, signal?: AbortSignal) {
  const response = await fetch(path ? `${url.replace(/\/$/, '')}/${path}` : url, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    headers: {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {}), ...headers},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model endpoint ${path || 'TTS'}: HTTP ${response.status}. Check the model, API key, and base URL in Settings.`);
  }
  return response;
}
export async function prepareText(s: Settings, input: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider(s.llmUrl, 'chat/completions', s.llmKey, {model: s.llmModel, messages: [{role:'system',content:s.prompt},{role:'user',content:input}]}, {}, signal);
    const json = await response.json();
    const choice = json.choices?.[0];
    const error = json.error || choice?.error;
    if (error || choice?.finish_reason === 'error') {
      const code = typeof error?.code === 'number' ? ` (code ${error.code})` : '';
      throw new Error(`The LLM provider reported an error${code} even though the HTTP request succeeded. Please try again.`);
    }
    if (choice?.finish_reason === 'length') throw new Error('The LLM reached its output limit. Reasoning models may use up this limit before producing the actual text. Use a higher output limit or a different model.');
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new Error('The LLM refused to process the article (content filter).');
    const text = choice?.message?.content;
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (attempt === 0) { await delay(750, undefined, {signal}); continue; }
    const reasoning = Number(json.usage?.completion_tokens_details?.reasoning_tokens);
    const detail = Number.isFinite(reasoning) && reasoning > 0 ? ` It used ${reasoning} reasoning tokens but returned no listening version.` : '';
    throw new Error(`The LLM returned no text on the second attempt either.${detail} Please try again or switch models.`);
  }
  throw new Error('No LLM output.');
}
export function speech(s: Settings, text: string, signal?: AbortSignal) {
  if (s.ttsProvider === 'fish') {
    return provider(s.ttsUrl, '', s.ttsKey, {text, format: 'mp3', ...(s.voice ? {reference_id: s.voice} : {})}, {model: s.ttsModel}, signal);
  }
  return provider(s.ttsUrl, 'audio/speech', s.ttsKey, {model: s.ttsModel, voice: s.voice, input: text, response_format: 'mp3'}, {}, signal);
}
export async function detectLanguage(s: Settings, original: string, signal?: AbortSignal): Promise<string> {
  const text=normalizeArticleText(original);
  const sample=text.length<=6000?text:[text.slice(0,2000),text.slice(Math.floor(text.length/2)-1000,Math.floor(text.length/2)+1000),text.slice(-2000)].join('\n\n[...]\n\n');
  return parseDetectedLanguage(await llmSlot(()=>prepareText({...s,prompt:languagePrompt},sample,signal),signal));
}
async function audioDuration(file: string, signal?: AbortSignal) {
  const {stdout} = await exec('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file], {timeout:30000, signal});
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The generated audio has no valid duration.');
  return duration;
}
export async function processArticle(article: Article, signal?: AbortSignal) {
  const update = (patch: Partial<Omit<Article, 'id' | 'chapters'>>) => {
    signal?.throwIfAborted();
    return patchArticle(article.id, patch, true);
  };
  signal?.throwIfAborted();
  const s = settings();
  const dir = articleDir(article.id);
  let language=article.language;
  if (!language) {
    update({progress:'Detecting language'});
    language=await detectLanguage(s,article.original,signal);
    update({language});
  }
  s.voice=article.voice||voiceForLanguage(language,s.languageVoices,s.voice);
  const textSettings = {...s, prompt: `${s.prompt}\n\n${chapterPrompt}`};
  const recipe = {llmUrl: s.llmUrl, llmModel: s.llmModel, prompt: textSettings.prompt, ttsProvider: s.ttsProvider, ttsUrl: s.ttsUrl, ttsModel: s.ttsModel, voice: s.voice, language};
  update({recipe: JSON.stringify(recipe)});
  let script = article.script;
  if (!script) {
    const sections = chapterSections(article.original);
    const parts = sections.flatMap(section => splitText(section.text, s.llmChunkChars, Math.ceil(s.llmConcurrency / sections.length)));
    const pending = new Map<string, Promise<string>>();
    let completed = 0;
    update({progress: `Listening version · 0 of ${parts.length} sections complete`});
    const result = await mapConcurrent(parts, 32, async part => {
      signal?.throwIfAborted();
      const hash = createHash('sha256').update(JSON.stringify([s.llmUrl,s.llmModel,textSettings.prompt,part])).digest('hex');
      let job = pending.get(hash);
      if (!job) {
        job = (async () => {
          const file = join(dir, `text-${hash}.txt`);
          if (existsSync(file)) return readFileSync(file, 'utf8');
          const text = await llmSlot(() => prepareText(textSettings, part, signal), signal);
          signal?.throwIfAborted();
          writeFileSync(file, text, {mode: 0o600});
          return text;
        })();
        pending.set(hash, job);
      }
      const text = await job;
      update({progress: `Listening version · ${++completed} of ${parts.length} sections complete`});
      return text;
    });
    script = result.join('\n\n');
    update({script});
  }
  update({status: 'speaking'});
  const sections = chapterSections(script);
  const hasChapters = sections.some(section => section.title !== undefined);
  const concurrency = settings().ttsConcurrency;
  const parts = sections.flatMap(section => {
    // Read the heading, never its navigation prefix.
    const text = section.text.replace(/^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*\r?$/gm, '$1');
    return splitSpeech(text, Math.ceil(concurrency / sections.length)).map((text, index) => ({
      text, chapter: hasChapters && index === 0 ? section.title || article.title : undefined,
    }));
  });
  if (!parts.length) throw new Error('The listening version contains no text to speak.');
  const pendingAudio = new Map<string, Promise<{filename: string; duration: number}>>();
  let completedAudio = 0;
  update({progress: `Audio · 0 of ${parts.length} sections complete`});
  const files = await mapConcurrent(parts, 32, async part => {
    signal?.throwIfAborted();
    const hash = createHash('sha256').update(JSON.stringify([s.ttsProvider,s.ttsUrl,s.ttsModel,s.voice,part.text])).digest('hex');
    let job = pendingAudio.get(hash);
    if (!job) {
      job = (async () => {
        const filename = `audio-${hash}.mp3`; const file = join(dir, filename);
        if (!existsSync(file)) {
          await ttsSlot(async () => {
            const response = await speech(s, part.text, signal);
            const bytes = Buffer.from(await response.arrayBuffer());
            signal?.throwIfAborted();
            if (!bytes.length) throw new Error('The TTS model returned no audio.');
            writeFileSync(file+'.tmp', bytes, {mode: 0o600}); renameSync(file+'.tmp', file);
          }, signal);
        }
        return {filename, duration: hasChapters ? await audioDuration(file, signal) : 0};
      })();
      pendingAudio.set(hash, job);
    }
    const file = await job;
    update({progress: `Audio · ${++completedAudio} of ${parts.length} sections complete`});
    return file;
  });
  update({progress: 'Combining audio file'});
  writeFileSync(join(dir,'concat.txt'), files.map(f => `file '${f.filename}'`).join('\n'));
  const chapters: AudioChapter[] = [];
  let elapsed = 0;
  files.forEach((file, index) => {
    if (parts[index].chapter) chapters.push({title: parts[index].chapter!, startTime: elapsed});
    elapsed += file.duration;
  });
  const metadata: string[] = [];
  if (chapters.length) {
    writeFileSync(join(dir,'chapters.ffmeta'), chapterMetadata(chapters, elapsed), {mode:0o600});
    metadata.push('-f','ffmetadata','-i',join(dir,'chapters.ffmeta'),'-map_metadata','1','-map_chapters','1');
  }
  await exec('ffmpeg', ['-y','-v','error','-f','concat','-safe','1','-i',join(dir,'concat.txt'),...metadata,'-codec:a','libmp3lame','-b:a','128k',join(dir,'episode.tmp.mp3')], {timeout: 300000, signal});
  const duration = await audioDuration(join(dir,'episode.tmp.mp3'), signal);
  signal?.throwIfAborted();
  renameSync(join(dir,'episode.tmp.mp3'), join(dir,'episode.mp3'));
  update({status:'ready',audioId:randomUUID(),progress:'In the podcast feed',error:'',publishedAt:new Date().toISOString(), duration, audioBytes: statSync(join(dir,'episode.mp3')).size, recipe:JSON.stringify({...recipe,chapters})});
}
