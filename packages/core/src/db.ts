import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, writeFileSync, renameSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Article, AudioVersion, PlaybackProgress, PlaybackMutation, ReprocessMode, Settings, defaults, busy } from './types';
import { environmentSettings } from './env';
import { resolveDataDir } from './data-path';

export const dataDir = resolveDataDir(process.cwd(), process.env.DATA_DIR);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dataDir, 'redread.sqlite'));
chmodSync(join(dataDir, 'redread.sqlite'), 0o600);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), serverId TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS articles (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL,
 original TEXT NOT NULL, script TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
 progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL,
 publishedAt TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0,
 audioBytes INTEGER NOT NULL DEFAULT 0, recipe TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS playback_progress (
 articleId TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, audioId TEXT NOT NULL,
 positionMs INTEGER NOT NULL, completed INTEGER NOT NULL, revision INTEGER NOT NULL,
 mutationId TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY (articleId,audioId)
);
CREATE TABLE IF NOT EXISTS playback_mutations (
 articleId TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, audioId TEXT NOT NULL,
 mutationId TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL,
 PRIMARY KEY (articleId,audioId,mutationId)
);`);
db.prepare('INSERT OR IGNORE INTO instance (id,serverId) VALUES (1,?)').run(randomUUID());
export const serverId = (db.prepare('SELECT serverId FROM instance WHERE id=1').get() as {serverId:string}).serverId;
if (!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='language')) {
  try { db.exec("ALTER TABLE articles ADD COLUMN language TEXT NOT NULL DEFAULT ''"); }
  catch (error) {
    // Another web/worker process may have migrated the shared database first.
    if (!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='language')) throw error;
  }
}
if (!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='voice')) {
  try { db.exec("ALTER TABLE articles ADD COLUMN voice TEXT NOT NULL DEFAULT ''"); }
  catch(error){if(!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='voice'))throw error;}
}
if (!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='audioId')) {
  try { db.exec("ALTER TABLE articles ADD COLUMN audioId TEXT NOT NULL DEFAULT ''"); }
  catch(error){if(!(db.prepare('PRAGMA table_info(articles)').all() as {name:string}[]).some(column=>column.name==='audioId'))throw error;}
}
// Add identities to existing current files without rewriting or regenerating audio.
for (const row of db.prepare("SELECT id FROM articles WHERE status='ready' AND audioId=''").all() as {id:string}[]) {
  db.prepare("UPDATE articles SET audioId=? WHERE id=? AND audioId=''").run(randomUUID(),row.id);
}
function storedSettings(): Partial<Settings> {
  const row = db.prepare('SELECT data FROM settings WHERE id=1').get() as {data: string} | undefined;
  return row ? JSON.parse(row.data) : {};
}
export function settings(): Settings {
  return { ...defaults, ...environmentSettings(), ...storedSettings() };
}
export function resetSettings() {
  db.prepare('DELETE FROM settings WHERE id=1').run();
}
export function publicSettings() {
  const s = settings();
  return { ...s, llmKey: '', ttsKey: '', hasLlmKey: !!s.llmKey, hasTtsKey: !!s.ttsKey, envFields: Object.keys(environmentSettings()), overriddenFields: Object.keys(storedSettings()) };
}
export function saveSettings(s: Settings) {
  // Persist overrides shared by web and worker across restarts. Never change .env
  // or copy unchanged environment credentials into the stored overrides.
  const base = {...defaults, ...environmentSettings()};
  const stored = Object.fromEntries(Object.entries(s).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key as keyof Settings])));
  db.prepare('INSERT INTO settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(stored));
}
export const listArticles = () => db.prepare('SELECT * FROM articles ORDER BY createdAt DESC').all() as unknown as Article[];
export const getArticle = (id: string) => db.prepare('SELECT * FROM articles WHERE id=?').get(id) as unknown as Article | undefined;
export function articleDir(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid article ID.');
  return join(dataDir, 'articles', id);
}
export function storeText(id: string, name: 'original' | 'script', text: string) {
  const dir = articleDir(id);
  mkdirSync(dir, {recursive: true, mode: 0o700});
  const file = join(dir, `${name}.txt`);
  writeFileSync(file + '.tmp', text, {mode: 0o600});
  renameSync(file + '.tmp', file);
}
export function addArticle(input: Pick<Article, 'title' | 'url' | 'source' | 'original'>) {
  const id = randomUUID();
  storeText(id, 'original', input.original);
  db.prepare('INSERT INTO articles (id,title,url,source,original,createdAt) VALUES (?,?,?,?,?,?)')
    .run(id, input.title, input.url, input.source, input.original, new Date().toISOString());
  return getArticle(id)!;
}
export function patchArticle(id: string, patch: Partial<Omit<Article, 'id'>>, unlessCancelled = false) {
  const entries = Object.entries(patch);
  const allowed = new Set(['title','url','source','original','script','status','progress','error','publishedAt','duration','audioBytes','recipe','language','voice','audioId']);
  if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new Error('Invalid change.');
  const result = db.prepare(`UPDATE articles SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?${unlessCancelled ? " AND status NOT IN ('cancelling','cancelled')" : ''}`).run(...entries.map(([,v]) => v!), id);
  if (unlessCancelled && !result.changes) throw new DOMException('Processing cancelled.', 'AbortError');
  if (patch.script !== undefined) storeText(id, 'script', patch.script);
  return getArticle(id)!;
}
export function queueArticle(id: string, voice?:string) {
  const s = settings();
  if (!s.llmModel || !s.ttsModel) throw new Error('Please configure the LLM and TTS models in Settings first.');
  const a = getArticle(id);
  if (!a) throw new Error('Article not found.');
  if (busy(a.status) || a.status === 'ready') throw new Error('This article is already being processed or is complete.');
  return patchArticle(id, {status: 'queued', error: '', progress: 'Waiting to be processed',...(voice!==undefined?{voice}:{})});
}
export function claimArticle() {
  return db.prepare(`UPDATE articles SET status='preparing', progress='Preparing listening version'
    WHERE id=(SELECT id FROM articles WHERE status='queued' ORDER BY createdAt LIMIT 1) RETURNING *`).get() as unknown as Article | undefined;
}
export function versionDir(id: string, versionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(versionId)) throw new Error('Invalid version ID.');
  return join(articleDir(id), 'previous', versionId);
}
export function getAudioVersion(id: string, versionId: string): AudioVersion | undefined {
  const dir = versionDir(id, versionId);
  if (!existsSync(join(dir, 'article.json')) || !existsSync(join(dir, 'episode.mp3'))) return;
  const article: Article = JSON.parse(readFileSync(join(dir, 'article.json'), 'utf8'));
  if (article.status !== 'ready' || !article.audioBytes) return;
  const recipe = article.recipe ? JSON.parse(article.recipe) : {};
  return {versionId, audioId:versionId, publishedAt:article.publishedAt, duration:article.duration, audioBytes:article.audioBytes, voice:recipe.voice || article.voice || ''};
}
export function listAudioVersions(id: string): AudioVersion[] {
  const dir = join(articleDir(id), 'previous');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name=>/^[a-f0-9-]{36}$/.test(name))
    .map(name=>getAudioVersion(id,name)).filter((version): version is AudioVersion=>!!version)
    .sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
}
// A pinned URL resolves to the same file before and after archival.
export function audioAsset(id: string, audioId: string) {
  if (!/^[a-f0-9-]{36}$/.test(audioId)) return;
  const article = getArticle(id);
  if (!article) return;
  if (article.status === 'ready' && article.audioId === audioId) {
    const file = join(articleDir(id),'episode.mp3');
    if (existsSync(file)) return {file,duration:article.duration};
    return;
  }
  const version = getAudioVersion(id,audioId);
  if (version) return {file:join(versionDir(id,audioId),'episode.mp3'),duration:version.duration};
}
export function getPlayback(id: string, audioId: string): PlaybackProgress {
  const row = db.prepare('SELECT * FROM playback_progress WHERE articleId=? AND audioId=?').get(id,audioId) as unknown as (Omit<PlaybackProgress,'completed'> & {completed:number}) | undefined;
  return row ? {...row,completed:!!row.completed} : {articleId:id,audioId,positionMs:0,completed:false,revision:0,mutationId:'',updatedAt:''};
}
export function savePlayback(id: string, audioId: string, input: PlaybackMutation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const asset = audioAsset(id,audioId);
    if (!asset) throw new Error('Audio is not available.');
    const request = JSON.stringify([input.baseRevision,input.positionMs,input.completed]);
    const receipt = db.prepare('SELECT request,response FROM playback_mutations WHERE articleId=? AND audioId=? AND mutationId=?').get(id,audioId,input.mutationId) as {request:string;response:string} | undefined;
    if (receipt) {
      if (receipt.request !== request) throw new Error('A mutation ID cannot be reused for a different update.');
      db.exec('COMMIT');
      return {conflict:false,current:JSON.parse(receipt.response) as PlaybackProgress};
    }
    const current = getPlayback(id,audioId);
    if (input.baseRevision !== current.revision) {
      db.exec('COMMIT');
      return {conflict:true,current};
    }
    // MP3 duration estimates can differ slightly between players. Clamp only
    // this small rounding margin; reject unrelated or corrupt positions.
    const end = Math.max(0,Math.round(asset.duration*1000));
    if (input.positionMs > end + 2000) throw new Error('Playback position exceeds the audio duration.');
    const next: PlaybackProgress = {
      articleId:id,audioId,positionMs:input.completed?end:Math.min(end,input.positionMs),
      completed:input.completed,revision:current.revision+1,mutationId:input.mutationId,updatedAt:new Date().toISOString(),
    };
    db.prepare(`INSERT INTO playback_progress (articleId,audioId,positionMs,completed,revision,mutationId,updatedAt) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(articleId,audioId) DO UPDATE SET positionMs=excluded.positionMs,completed=excluded.completed,revision=excluded.revision,mutationId=excluded.mutationId,updatedAt=excluded.updatedAt`)
      .run(id,audioId,next.positionMs,Number(next.completed),next.revision,next.mutationId,next.updatedAt);
    db.prepare('INSERT INTO playback_mutations (articleId,audioId,mutationId,request,response) VALUES (?,?,?,?,?)').run(id,audioId,input.mutationId,request,JSON.stringify(next));
    db.exec('COMMIT');
    return {conflict:false,current:next};
  } catch(error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function reprocessArticle(id: string, voice?:string, mode:ReprocessMode='all') {
  const s = settings();
  if (!s.llmModel || !s.ttsModel) throw new Error('Please configure the LLM and TTS models in Settings first.');
  const dir = articleDir(id);
  let archive = '';
  const moved: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const article = getArticle(id);
    if (!article) throw new Error('Article not found.');
    if (busy(article.status)) throw new Error('This article is already being processed.');
    if (mode==='audio' && !article.script.trim()) throw new Error('Create a listening version before regenerating only audio.');
    // Keep the identity of the actual MP3 when moving it into history.
    archive = join(dir, 'previous', article.audioId || randomUUID());
    // Retain the previous result, but keep it outside the worker's chunk cache.
    mkdirSync(archive, {recursive:true, mode:0o700});
    writeFileSync(join(archive,'article.json'), JSON.stringify(article), {mode:0o600});
    for (const name of readdirSync(dir)) {
      if (!/^(?:text-[a-f0-9]+\.txt|audio-[a-f0-9]+\.mp3(?:\.tmp)?|script\.txt|episode(?:\.tmp)?\.mp3|concat\.txt)$/.test(name)) continue;
      renameSync(join(dir,name),join(archive,name)); moved.push(name);
    }
    const result = patchArticle(id, {...(voice!==undefined?{voice}:{}),script:mode==='audio'?article.script:'',language:mode==='audio'?article.language:'',status:'queued',error:'',progress:mode==='audio'?'Recreating audio':'Recreating text and audio',recipe:'',publishedAt:'',duration:0,audioBytes:0,audioId:''});
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    for (const name of moved.reverse()) renameSync(join(archive,name),join(dir,name));
    throw error;
  }
}
export function cancelArticle(id: string) {
  const result = db.prepare(`UPDATE articles SET
    status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,
    progress=CASE WHEN status='queued' THEN 'Processing cancelled' ELSE 'Stopping processing' END, error=''
    WHERE id=? AND status IN ('queued','preparing','speaking')`).run(id);
  const article = getArticle(id);
  if (!article) throw new Error('Article not found.');
  if (!result.changes && !['cancelling','cancelled'].includes(article.status)) throw new Error('This article is not being processed.');
  return article;
}
export function failArticle(id: string, message: string) {
  // Resolve cancellation atomically, including requests arriving as a job fails.
  db.prepare(`UPDATE articles SET
    error=CASE WHEN status='cancelling' THEN '' ELSE ? END,
    progress=CASE WHEN status='cancelling' THEN 'Processing cancelled' ELSE '' END,
    status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END
    WHERE id=? AND status IN ('preparing','speaking','cancelling')`).run(message, id);
}
export function recoverJobs() {
  db.prepare("UPDATE articles SET status='cancelled', progress='Processing cancelled', error='' WHERE status='cancelling'").run();
  db.prepare("UPDATE articles SET status='queued', progress='Resuming after restart' WHERE status IN ('preparing','speaking')").run();
}
export function deleteArticle(id: string) {
  const a = getArticle(id);
  if (!a) throw new Error('Article not found.');
  if (busy(a.status)) throw new Error('Wait until processing is complete.');
  db.prepare('DELETE FROM articles WHERE id=?').run(id);
  rmSync(articleDir(id), {recursive: true, force: true});
}
