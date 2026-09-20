'use client';
import { useState, useEffect, useRef, useCallback, type FormEvent, type ReactNode } from 'react';
import { AudioLines, Library, Settings2, Plus, Search, ArrowUpRight, Link as LinkIcon, FileText, X, Check, Clock3, Play, Pause, RotateCcw, Download, Trash2, LoaderCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import AudioPlayer from './audio-player';
import LanguageVoices, { voiceRowsToSettings } from './language-voices';
import { normalizeArticleText } from '@redread/core/text';
import { type Article, type PublicSettings, type Status, busy } from '@redread/core/types';

type CardArticle = Omit<Article,'original'|'script'|'recipe'> & {excerpt:string;wordCount:number;hasScript:boolean};
type View = 'library'|'settings';
const statusLabels: Record<Status,string> = {draft:'Entwurf',queued:'In Warteschlange',preparing:'Text wird aufbereitet',speaking:'Audio entsteht',ready:'Bereit zum Hören',failed:'Fehlgeschlagen'};
async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response=await fetch(`/api/${path}`, {method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.'); return data;
}
const minutes=(a:CardArticle|Article)=>Math.max(1,Math.round(a.duration ? a.duration/60 : ('wordCount' in a?a.wordCount:a.original.split(/\s+/).length)/150));
const date=(s:string)=>new Date(s).toLocaleDateString('de-DE',{day:'numeric',month:'short'});
function Wave() {return <div className="wave" aria-hidden="true">{[12,24,38,20,48,66,36,76,54,88,42,68,94,58,32,72,50,84,40,64,28,48,20,34,14].map((height,i)=><i key={i} style={{height:`${height}%`}}/>)}</div>;}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} aria-label={title} className={wide?'modal modal-wide':'modal'} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Schließen" onClick={onClose}><X size={21}/></button></div>{children}</dialog>;
}
export default function Home() {
  const [view,setView]=useState<View>('library'); const [articles,setArticles]=useState<CardArticle[]>([]);
  const [settings,setSettings]=useState<PublicSettings|null>(null); const [loading,setLoading]=useState(true);
  const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [importPending,setImportPending]=useState(false); const importLock=useRef(false); const [importError,setImportError]=useState(''); const [importTitle,setImportTitle]=useState(''); const [importProcess,setImportProcess]=useState(true); const [importUrl,setImportUrl]=useState(''); const [importText,setImportText]=useState(''); const [importMode,setImportMode]=useState<'url'|'text'>('url');
  const [selected,setSelected]=useState<Article|null>(null); const [playing,setPlaying]=useState<Article|null>(null);
  const playerAudio=useRef<HTMLAudioElement>(null); const [playerPaused,setPlayerPaused]=useState(true);
  const [playPending,setPlayPending]=useState<string|null>(null);
  const [search,setSearch]=useState(''); const [filter,setFilter]=useState('all');
  const refresh=useCallback(async()=>{try {const [a,s]=await Promise.all([api<CardArticle[]>('articles'),api<PublicSettings>('settings')]);setArticles(a);setSettings(s);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('article');
    if(id&&/^[a-f0-9-]{36}$/.test(id))void api<Article>(`articles/${id}`).then(setSelected).catch(e=>setNotice(e.message));
  },[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
  const ready=articles.filter(a=>a.status==='ready'); const pending=articles.filter(a=>busy(a.status));
  const configured=!!settings?.llmModel && !!settings?.ttsModel;
  const filtered=articles.filter(a=>(filter==='all'||(filter==='ready'?a.status==='ready':filter==='active'?busy(a.status):a.status==='draft'||a.status==='failed')) && `${a.title} ${a.source} ${a.excerpt}`.toLowerCase().includes(search.toLowerCase()));
  async function openArticle(id:string) {try{setSelected(await api<Article>(`articles/${id}`));}catch(e){setNotice((e as Error).message);}}
  async function importArticle(e:FormEvent) {
    e.preventDefault();
    if(importLock.current)return;
    importLock.current=true;setImportPending(true);setImportError('');
    try {
      const article=await api<Article>('articles','POST',{url:importMode==='url'?importUrl:'',text:importMode==='text'?importText:undefined,title:importTitle,process:configured&&importProcess});
      setImportUrl('');setImportText('');setImportTitle('');setSearch('');setFilter('all');
      void refresh();
      setNotice(article.status==='queued'?'Artikel hinzugefügt. Die Verarbeitung startet.':'Artikel als Entwurf gespeichert.');
    } catch(e) {setImportError((e as Error).message);}
    finally {importLock.current=false;setImportPending(false);}
  }
  async function playCard(id:string) {
    if(playing?.id===id&&playerAudio.current) {
      try { if(playerAudio.current.paused) await playerAudio.current.play(); else playerAudio.current.pause(); }
      catch { setNotice('Wiedergabe konnte nicht gestartet werden.'); }
      return;
    }
    setPlayPending(id);
    try { setPlaying(await api<Article>(`articles/${id}`)); }
    catch(e) { setNotice((e as Error).message); }
    finally { setPlayPending(null); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="redread Startseite"><img className="brand-mark" src="/logo.png" alt="" width={36} height={39}/>redread<span className="brand-dot">.</span></a>
      <nav aria-label="Hauptnavigation">
        <button className={view==='library'?'nav-item active':'nav-item'} onClick={()=>setView('library')}><Library size={19}/>Bibliothek<span className="nav-count">{articles.length}</span></button>
        <button className={view==='settings'?'nav-item active':'nav-item'} onClick={()=>setView('settings')}><Settings2 size={19}/>Einstellungen</button>
      </nav>
    </aside>
    <div className="workspace">
      <main>
        {error&&<div className="error-banner" role="alert"><AlertCircle size={18}/>{error}<button onClick={()=>void refresh()}>Erneut versuchen</button></div>}
        {view==='library'&&<>
          <div className="page-heading"><div><h1>Deine Bibliothek<span>.</span></h1></div></div>
          <section className="import-panel" aria-label="Artikel hinzufügen">
            <form className="import-form" onSubmit={importArticle} aria-busy={importPending}>
              <h2>Artikel hinzufügen</h2>
              <div className="import-modes" role="group" aria-label="Importart">
                <button type="button" disabled={importPending} aria-pressed={importMode==='url'} onClick={()=>setImportMode('url')}><LinkIcon size={16}/>Link</button>
                <button type="button" disabled={importPending} aria-pressed={importMode==='text'} onClick={()=>setImportMode('text')}><FileText size={16}/>Text</button>
              </div>
              <div className={importMode==='text'?'import-input-row import-text-row':'import-input-row'}>
                {importMode==='url'
                  ?<input disabled={importPending} aria-label="Artikel-Link" type="url" required placeholder="https://…" value={importUrl} onChange={e=>setImportUrl(e.target.value)}/>
                  :<textarea disabled={importPending} aria-label="Artikeltext" required rows={4} maxLength={200000} placeholder="Artikeltext einfügen …" value={importText} onChange={e=>setImportText(e.target.value)}/>}
                <button className="button primary" aria-label="Artikel hinzufügen" title="Artikel hinzufügen" disabled={loading||!settings||importPending}>{importPending?<LoaderCircle size={18} className="spin"/>:<Plus size={18}/>}</button>
              </div>
              <details className="import-options"><summary>Optionen</summary><div>
                <label>Titel (optional)<input disabled={importPending} value={importTitle} maxLength={300} onChange={e=>setImportTitle(e.target.value)} placeholder="Wird automatisch übernommen"/></label>
                {configured&&<label className="checkbox-row"><input disabled={importPending} type="checkbox" checked={importProcess} onChange={e=>setImportProcess(e.target.checked)}/>Audio automatisch erstellen</label>}
              </div></details>
              {!loading&&!configured&&<p className="import-note">Wird als Entwurf gespeichert.</p>}
              {importError&&<p className="form-error" role="alert">{importError}</p>}
            </form>
            <div className="audio-art" aria-hidden="true"><div className="art-disc"><span>redread</span><Wave/><AudioLines size={22}/></div></div>
          </section>
          <div className="collection-head"><div className="filter-tabs" role="group" aria-label="Artikel filtern">{[['all','Alle Artikel',articles.length],['ready','Hörbereit',ready.length],['active','In Arbeit',pending.length],['draft','Entwürfe',articles.filter(a=>a.status==='draft'||a.status==='failed').length]].map(([key,label,count])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(String(key))}>{label}<span>{count}</span></button>)}</div><label className="search"><Search size={17}/><input aria-label="Bibliothek durchsuchen" placeholder="Bibliothek durchsuchen …" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
          {loading?<div className="empty-state"><LoaderCircle className="spin"/><h3>Bibliothek wird geladen …</h3></div>:!articles.length?null:!filtered.length?<section className="empty-state"><Search size={25}/><h3>Keine passenden Artikel.</h3><button className="text-link" onClick={()=>{setSearch('');setFilter('all');}}>Filter zurücksetzen</button></section>:<div className="article-grid">{filtered.map((a,i)=><article key={a.id} className="article-card"><button className="card-open" aria-label={`Artikel öffnen: ${a.title}`} onClick={()=>void openArticle(a.id)}><div className={`card-art tone-${i%4}`}><span className="card-source">{a.source}</span><span className="card-monogram">{a.title.slice(0,1).toUpperCase()}<span>↗</span></span><Wave/><span className={`status-badge ${a.status}`}>{busy(a.status)?<LoaderCircle size={12} className="spin"/>:a.status==='ready'?<Check size={12}/>:a.status==='failed'?<AlertCircle size={12}/>:<FileText size={12}/>} {statusLabels[a.status]}</span></div><div className="card-body"><h3>{a.title}</h3><p>{a.excerpt}</p></div></button><div className="card-footer"><div className="card-meta"><span><Clock3 size={13}/>{a.duration?'':'ca. '}{minutes(a)} Min.</span><span>{date(a.createdAt)}</span></div><div className="card-actions">
            <button className="card-play" title={a.status!=='ready'?'Noch kein Audio':playing?.id===a.id&&!playerPaused?'Pausieren':'Abspielen'} disabled={a.status!=='ready'||playPending!==null} aria-label={playing?.id===a.id&&!playerPaused?`Pausieren: ${a.title}`:`Abspielen: ${a.title}`} onClick={()=>void playCard(a.id)}>
              {playPending===a.id?<LoaderCircle size={16} className="spin"/>:playing?.id===a.id&&!playerPaused?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}
            </button>
            {a.url&&<a className="card-original" title="Originalartikel öffnen" href={a.url} target="_blank" rel="noreferrer" aria-label={`Originalartikel öffnen: ${a.title}`}><ArrowUpRight size={18}/></a>}
          </div></div></article>)}</div>}
        </>}
        {view==='settings'&&<><div className="page-heading"><div><h1>Einstellungen<span>.</span></h1></div></div>{settings?<SettingsForm initial={settings} onSave={s=>{setSettings(s);setNotice('Einstellungen gespeichert.');}}/>:<p>Einstellungen werden geladen …</p>}</>}
      </main>
    </div>
    {notice&&<div className="toast" role="status">{notice}<button className="icon-button" aria-label="Meldung schließen" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {selected&&<ArticleModal initial={selected} configured={configured} onReprocess={()=>{if(playing?.id===selected.id)setPlaying(null);}} onClose={()=>setSelected(null)} onChange={()=>void refresh()} onPlay={a=>{if(playing?.id===a.id&&playerAudio.current)void playerAudio.current.play().catch(()=>setNotice('Wiedergabe konnte nicht gestartet werden.'));else setPlaying(a);setSelected(null);}} onSettings={()=>{setSelected(null);setView('settings');}}/>}
    {playing&&<AudioPlayer key={playing.id} article={playing} audioRef={playerAudio} onPausedChange={setPlayerPaused} onClose={()=>setPlaying(null)} onOpen={()=>void openArticle(playing.id)}/>}
  </div>;
}
function ArticleModal({initial,configured,onClose,onChange,onPlay,onSettings,onReprocess}:{onReprocess:()=>void;initial:Article;configured:boolean;onClose:()=>void;onChange:()=>void;onPlay:(a:Article)=>void;onSettings:()=>void}) {
  const [article,setArticle]=useState(initial); const [tab,setTab]=useState('original');const [draft,setDraft]=useState(initial.script); const [pending,setPending]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(!busy(article.status))return;const timer=setInterval(async()=>{try{const next=await api<Article>(`articles/${article.id}`);setArticle(next);setDraft(next.script);if(!busy(next.status))onChange();}catch(e){setError((e as Error).message);}},2000);return()=>clearInterval(timer);},[article.id,article.status,onChange]);
  async function action(kind:'process'|'reprocess'|'save'|'delete') {
    if(kind==='delete'&&!confirm('Diesen Artikel mit Text und Audio endgültig löschen?'))return;
    setPending(true);setError('');
    try{if(kind==='delete'){await api(`articles/${article.id}`,'DELETE');onChange();onClose();return;}
      const next=await api<Article>(`articles/${article.id}${kind==='process'?'/process':kind==='reprocess'?'/reprocess':''}`,kind==='process'||kind==='reprocess'?'POST':'PATCH',kind==='save'?{script:draft}:{});setArticle(next);setDraft(next.script);if(kind==='reprocess')onReprocess();onChange();
    }catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  const editable=!busy(article.status)&&article.status!=='ready';
  return <Modal title="In deiner Bibliothek" wide onClose={onClose}><div className="article-detail"><div className="detail-meta"><span className={`status-badge inline ${article.status}`}>{statusLabels[article.status]}</span><span>{article.source} · {date(article.createdAt)}</span>{article.language&&<span title="Erkannte Artikelsprache">{article.language.toUpperCase()}</span>}{article.url&&<a href={article.url} target="_blank" rel="noreferrer" aria-label="Originalseite öffnen"><ArrowUpRight size={18}/></a>}</div><h1>{article.title}</h1><div className="detail-actions">{article.status==='ready'?<><button className="button primary" onClick={()=>onPlay(article)}><Play size={17}/>Anhören · {minutes(article)} Min.</button><a className="button secondary" href={`/api/articles/${article.id}/audio?v=${encodeURIComponent(article.publishedAt)}`} download><Download size={16}/>MP3</a></>:busy(article.status)?<div className="processing"><LoaderCircle size={18} className="spin"/>{article.progress}</div>:<button className="button primary" disabled={pending} onClick={()=>configured?void action('process'):onSettings()}><AudioLines size={17}/>{configured?article.status==='failed'?'Verarbeitung fortsetzen':'Audio erstellen':'Modelle verbinden'}</button>}{(article.status==='ready'||article.status==='failed'||busy(article.status))&&<button className="icon-button" aria-label="Neu verarbeiten" title="Hörfassung und Audio neu erstellen" disabled={pending||busy(article.status)||!configured} onClick={()=>void action('reprocess')}><RotateCcw size={18}/></button>}<button className="icon-button danger" aria-label="Artikel löschen" disabled={busy(article.status)||pending} onClick={()=>void action('delete')}><Trash2 size={18}/></button></div>{article.error&&<div className="form-error" role="alert">{article.error}</div>}{error&&<div className="form-error" role="alert">{error}</div>}<div className="reader-tabs"><button className={tab==='original'?'selected':''} onClick={()=>setTab('original')}><FileText size={16}/>Originaltext</button><button className={tab==='script'?'selected':''} onClick={()=>setTab('script')}><AudioLines size={16}/>Hörfassung{article.script&&<Check size={13}/>}</button></div>{tab==='original'?<div className="reader-text">{normalizeArticleText(article.original)}</div>:article.script?<>{editable?<><textarea className="script-editor" aria-label="Hörfassung bearbeiten" value={draft} onChange={e=>setDraft(e.target.value)}/><button className="button secondary" disabled={pending||draft===article.script||!draft.trim()} onClick={()=>void action('save')}>Hörfassung speichern</button></>:<div className="reader-text">{article.script}</div>}</>:<div className="empty-state compact"><AudioLines size={28}/><h3>Noch keine Hörfassung.</h3></div>}</div></Modal>;
}
function SettingsForm({initial,onSave}:{initial:PublicSettings;onSave:(s:PublicSettings)=>void}) {
  const [s,setS]=useState(initial);const [voiceRows,setVoiceRows]=useState(()=>Object.entries(initial.languageVoices||{}).map(([language,voice])=>({language,voice})));const [pending,setPending]=useState(false);const [error,setError]=useState('');const [clearLlmKey,setClearLlmKey]=useState(false);const [clearTtsKey,setClearTtsKey]=useState(false);
  const field=(key:keyof PublicSettings,value:string|number)=>setS(prev=>({...prev,[key]:value}));
  async function submit(e:FormEvent){e.preventDefault();setPending(true);setError('');try{const saved=await api<PublicSettings>('settings','PUT',{...s,languageVoices:voiceRowsToSettings(voiceRows),clearLlmKey,clearTtsKey});setS(saved);setVoiceRows(Object.entries(saved.languageVoices).map(([language,voice])=>({language,voice})));setClearLlmKey(false);setClearTtsKey(false);onSave(saved);}catch(e){setError((e as Error).message);}finally{setPending(false);}}
  return <form className="settings-form" onSubmit={submit}><div className="settings-grid"><section className="settings-section"><h2>Textaufbereitung</h2><label>LLM-Basis-URL<input type="url" required value={s.llmUrl} onChange={e=>field('llmUrl',e.target.value)}/></label><label>Modell<input value={s.llmModel} onChange={e=>field('llmModel',e.target.value)} placeholder="Modell-ID deines Anbieters"/></label><label>API-Key<input type="password" autoComplete="new-password" value={s.llmKey} onChange={e=>field('llmKey',e.target.value)} placeholder={s.hasLlmKey?'Gespeichert · leer lassen zum Beibehalten':'Optional bei lokalen Modellen'}/></label>{s.hasLlmKey&&<label className="checkbox-row"><input type="checkbox" checked={clearLlmKey} onChange={e=>setClearLlmKey(e.target.checked)}/>Gespeicherten Key entfernen</label>}</section><section className="settings-section"><h2>Sprachausgabe</h2><label>TTS-Anbieter<select value={s.ttsProvider} onChange={e=>field('ttsProvider',e.target.value)}><option value="openai">OpenAI-kompatibel</option><option value="fish">Fish Audio</option></select></label><label>{s.ttsProvider==='fish'?'Fish Audio TTS-URL':'TTS-Basis-URL'}<input type="url" required value={s.ttsUrl} onChange={e=>field('ttsUrl',e.target.value)}/></label><div className="field-pair"><label>Modell<input value={s.ttsModel} onChange={e=>field('ttsModel',e.target.value)} placeholder="TTS-Modell-ID"/></label><label>{s.ttsProvider==='fish'?'Standardstimme (optional: Reference-ID)':'Standardstimme'}<input required={s.ttsProvider!=='fish'} value={s.voice} onChange={e=>field('voice',e.target.value)} placeholder={s.ttsProvider==='fish'?'Standardstimme':'Stimmen-ID'}/></label></div><label>API-Key<input type="password" autoComplete="new-password" value={s.ttsKey} onChange={e=>field('ttsKey',e.target.value)} placeholder={s.hasTtsKey?'Gespeichert · leer lassen zum Beibehalten':'Optional bei lokalen Modellen'}/></label>{s.hasTtsKey&&<label className="checkbox-row"><input type="checkbox" checked={clearTtsKey} onChange={e=>setClearTtsKey(e.target.checked)}/>Gespeicherten Key entfernen</label>}</section></div><LanguageVoices rows={voiceRows} onChange={setVoiceRows} fish={s.ttsProvider==='fish'} disabled={pending}/><section className="settings-section"><h2>Parallele Verarbeitung</h2><div className="field-pair"><label>Gleichzeitige Artikel<input type="number" required min={1} max={8} step={1} value={s.articleConcurrency} onChange={e=>field('articleConcurrency',Number(e.target.value))}/></label><label>Gleichzeitige LLM-Aufrufe<input type="number" required min={1} max={32} step={1} value={s.llmConcurrency} onChange={e=>field('llmConcurrency',Number(e.target.value))}/><small>Teilt auch kurze Artikel auf. Das Limit gilt über alle Artikel zusammen.</small></label><label>Gleichzeitige TTS-Aufrufe<input type="number" required min={1} max={32} step={1} value={s.ttsConcurrency} onChange={e=>field('ttsConcurrency',Number(e.target.value))}/><small>Teilt auch kurze Hörfassungen auf. Das Limit gilt über alle Artikel zusammen.</small></label><label>LLM-Abschnittslänge (Zeichen)<input type="number" required min={1000} max={12000} step={1} value={s.llmChunkChars} onChange={e=>field('llmChunkChars',Number(e.target.value))}/><small>Gilt wie Modell und Prompt für neu gestartete Artikel.</small></label></div></section><section className="settings-section"><label>System-Prompt<textarea rows={6} required value={s.prompt} onChange={e=>field('prompt',e.target.value)}/></label></section><section className="settings-section"><h2>Dein Podcast</h2><div className="field-pair"><label>Feed-Titel<input required value={s.feedTitle} onChange={e=>field('feedTitle',e.target.value)}/></label><label>Erreichbare App-URL<input type="url" value={s.publicUrl} onChange={e=>field('publicUrl',e.target.value)} placeholder="Automatisch / Serverkonfiguration"/><small>Basis für die Audio-Links im RSS-Feed. Ohne abschließenden Pfad.</small></label></div></section>{error&&<p className="form-error" role="alert">{error}</p>}<div className="settings-actions"><button className="button primary" disabled={pending}>{pending?<LoaderCircle size={17} className="spin"/>:<CheckCircle2 size={17}/>}Einstellungen speichern</button></div></form>;
}
