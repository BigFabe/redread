import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Article, Settings, defaults, busy } from './types';
import { environmentSettings } from './env';

export const dataDir = resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || '../../data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dataDir, 'redread.sqlite'));
chmodSync(join(dataDir, 'redread.sqlite'), 0o600);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS articles (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL,
 original TEXT NOT NULL, script TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
 progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL,
 publishedAt TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0,
 audioBytes INTEGER NOT NULL DEFAULT 0, recipe TEXT NOT NULL DEFAULT ''
);`);
function temporarySettings(): Partial<Settings> {
  const row = db.prepare('SELECT data FROM settings WHERE id=1').get() as {data: string} | undefined;
  return row ? JSON.parse(row.data) : {};
}
export function settings(): Settings {
  return { ...defaults, ...environmentSettings(), ...temporarySettings() };
}
export function resetSettings() {
  db.prepare('DELETE FROM settings WHERE id=1').run();
}
export function publicSettings() {
  const s = settings();
  return { ...s, llmKey: '', ttsKey: '', hasLlmKey: !!s.llmKey, hasTtsKey: !!s.ttsKey, envFields: Object.keys(environmentSettings()), overriddenFields: Object.keys(temporarySettings()) };
}
export function saveSettings(s: Settings) {
  // Shared between web and worker, but cleared on worker startup. Never change .env
  // or copy unchanged environment credentials into the temporary overrides.
  const base = {...defaults, ...environmentSettings()};
  const stored = Object.fromEntries(Object.entries(s).filter(([key, value]) => value !== base[key as keyof Settings]));
  db.prepare('INSERT INTO settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(stored));
}
export const listArticles = () => db.prepare('SELECT * FROM articles ORDER BY createdAt DESC').all() as unknown as Article[];
export const getArticle = (id: string) => db.prepare('SELECT * FROM articles WHERE id=?').get(id) as unknown as Article | undefined;
export function articleDir(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Ungültige Artikel-ID.');
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
export function patchArticle(id: string, patch: Partial<Omit<Article, 'id'>>) {
  const entries = Object.entries(patch);
  const allowed = new Set(['title','url','source','original','script','status','progress','error','publishedAt','duration','audioBytes','recipe']);
  if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new Error('Ungültige Änderung.');
  db.prepare(`UPDATE articles SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...entries.map(([,v]) => v!), id);
  if (patch.script !== undefined) storeText(id, 'script', patch.script);
  return getArticle(id)!;
}
export function queueArticle(id: string) {
  const s = settings();
  if (!s.llmModel || !s.ttsModel) throw new Error('Bitte zuerst LLM- und TTS-Modell in den Einstellungen eintragen.');
  const a = getArticle(id);
  if (!a) throw new Error('Artikel nicht gefunden.');
  if (busy(a.status) || a.status === 'ready') throw new Error('Dieser Artikel ist bereits in Verarbeitung oder fertig.');
  return patchArticle(id, {status: 'queued', error: '', progress: 'Wartet auf Verarbeitung'});
}
export function claimArticle() {
  return db.prepare(`UPDATE articles SET status='preparing', progress='Hörfassung vorbereiten'
    WHERE id=(SELECT id FROM articles WHERE status='queued' ORDER BY createdAt LIMIT 1) RETURNING *`).get() as unknown as Article | undefined;
}
export function recoverJobs() {
  db.prepare("UPDATE articles SET status='queued', progress='Nach Neustart fortsetzen' WHERE status IN ('preparing','speaking')").run();
}
export function deleteArticle(id: string) {
  const a = getArticle(id);
  if (!a) throw new Error('Artikel nicht gefunden.');
  if (busy(a.status)) throw new Error('Warte, bis die Verarbeitung beendet ist.');
  db.prepare('DELETE FROM articles WHERE id=?').run(id);
  rmSync(articleDir(id), {recursive: true, force: true});
}
