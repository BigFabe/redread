'use client';
import { useState, useEffect, useRef, useCallback, type FormEvent, type ReactNode } from 'react';
import { AudioLines, Library, Settings2, Upload, Plus, Search, ArrowUpRight, Link as LinkIcon, FileText, X, Check, Clock3, Play, Pause, RotateCcw, Download, Trash2, LoaderCircle, AlertCircle, Pencil, History } from 'lucide-react';
import AudioPlayer from './audio-player';
import { readArticleFile } from './file-import';
import CustomVoices, {VoiceSelect} from './custom-voices';
import type {CustomVoice} from '@redread/core/voices';
import LanguageVoices, { voiceRowsToSettings } from './language-voices';
import { normalizeArticleText } from '@redread/core/text';
import { type Article, type AudioVersion, type PlayableArticle, type ReprocessMode, type PublicSettings, type Status, busy } from '@redread/core/types';

type CardArticle = Omit<Article,'original'|'script'|'recipe'> & {excerpt:string;wordCount:number;hasScript:boolean};
type View = 'library'|'settings';
const statusLabels: Record<Status,string> = {draft:'Draft',queued:'Queued',preparing:'Preparing text',speaking:'Creating audio',ready:'Ready to listen',failed:'Failed'};
async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response=await fetch(`/api/${path}`, {method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
const minutes=(a:CardArticle|Article)=>Math.max(1,Math.round(a.duration ? a.duration/60 : ('wordCount' in a?a.wordCount:a.original.split(/\s+/).length)/150));
const date=(s:string)=>new Date(s).toLocaleDateString('en-US',{day:'numeric',month:'short'});
function Wave() {return <div className="wave" aria-hidden="true">{[12,24,38,20,48,66,36,76,54,88,42,68,94,58,32,72,50,84,40,64,28,48,20,34,14].map((height,i)=><i key={i} style={{height:`${height}%`}}/>)}</div>;}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} aria-label={title} className={wide?'modal modal-wide':'modal'} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={21}/></button></div>{children}</dialog>;
}
export default function Home() {
  const [view,setView]=useState<View>('library'); const [articles,setArticles]=useState<CardArticle[]>([]);
  const [settings,setSettings]=useState<PublicSettings|null>(null); const [loading,setLoading]=useState(true);
  const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [importPending,setImportPending]=useState(false); const importLock=useRef(false); const [importError,setImportError]=useState(''); const [importTitle,setImportTitle]=useState(''); const [importUrl,setImportUrl]=useState(''); const [importText,setImportText]=useState(''); const [importMode,setImportMode]=useState<'url'|'text'|'file'>('url');
  const [importVoice,setImportVoice]=useState('');
  const [importFile,setImportFile]=useState<File|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const [fileDragging,setFileDragging]=useState(false);
  const fileDragDepth=useRef(0);
  const [selected,setSelected]=useState<Article|null>(null); const [playing,setPlaying]=useState<PlayableArticle|null>(null);
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
  const theme=settings?.theme;
  useEffect(()=>{
    if(!theme)return;
    const preference=window.matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{document.documentElement.dataset.theme=theme==='auto'?(preference.matches?'dark':'light'):theme;};
    apply();
    if(theme!=='auto')return;
    preference.addEventListener('change',apply);
    return()=>preference.removeEventListener('change',apply);
  },[theme]);
  const configured=!!settings?.llmModel && !!settings?.ttsModel;
  const filtered=articles.filter(a=>(filter==='all'||(filter==='ready'?a.status==='ready':filter==='active'?busy(a.status):a.status==='draft'||a.status==='failed')) && `${a.title} ${a.source} ${a.excerpt}`.toLowerCase().includes(search.toLowerCase()));
  async function openArticle(id:string) {try{setSelected(await api<Article>(`articles/${id}`));}catch(e){setNotice((e as Error).message);}}
  async function importArticle(e:FormEvent) {
    e.preventDefault();
    if(importLock.current)return;
    importLock.current=true;setImportPending(true);setImportError('');
    try {
      if(importMode==='file'&&!importFile)throw new Error('Please choose a file first.');
      const text=importMode==='file'?await readArticleFile(importFile!):importMode==='text'?importText:undefined;
      const title=importTitle||(importMode==='file'?importFile!.name.replace(/\.(txt|md|markdown|pdf)$/i,'').slice(0,300):'');
      const article=await api<Article>('articles','POST',{url:importMode==='url'?importUrl:'',text,title,process:configured,voice:importVoice});
      setImportFile(null);if(fileInput.current)fileInput.current.value='';
      setImportUrl('');setImportText('');setImportTitle('');setImportVoice('');setSearch('');setFilter('all');
      void refresh();
      setNotice(article.status==='queued'?'Article added. Processing is starting.':'Article saved as a draft.');
    } catch(e) {setImportError((e as Error).message);}
    finally {importLock.current=false;setImportPending(false);}
  }
  async function playCard(id:string) {
    if(playing?.id===id&&!playing.versionId&&playerAudio.current) {
      try { if(playerAudio.current.paused) await playerAudio.current.play(); else playerAudio.current.pause(); }
      catch { setNotice('Playback could not be started.'); }
      return;
    }
    setPlayPending(id);
    try { setPlaying(await api<Article>(`articles/${id}`)); }
    catch(e) { setNotice((e as Error).message); }
    finally { setPlayPending(null); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="redread home" onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();setView('library');}}><img className="brand-mark" src="/logo.png" alt="" width={36} height={39}/>redread<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation">
        <button className={view==='library'?'nav-item active':'nav-item'} onClick={()=>setView('library')}><Library size={19}/>Library<span className="nav-count">{articles.length}</span></button>
        <button className={view==='settings'?'nav-item active':'nav-item'} onClick={()=>setView('settings')}><Settings2 size={19}/>Settings</button>
      </nav>
    </aside>
    <div className="workspace">
      <main>
        {error&&<div className="error-banner" role="alert"><AlertCircle size={18}/>{error}<button onClick={()=>void refresh()}>Try again</button></div>}
        {view==='library'&&<>
          <div className="page-heading"><div><h1>Your library<span>.</span></h1></div></div>
          <section className="import-panel" aria-label="Add article">
            <form className="import-form" onSubmit={importArticle} aria-busy={importPending}>
              <h2>Add article</h2>
              <div className="import-modes" role="group" aria-label="Import method">
                <button type="button" disabled={importPending} aria-pressed={importMode==='url'} onClick={()=>setImportMode('url')}><LinkIcon size={16}/>Link</button>
                <button type="button" disabled={importPending} aria-pressed={importMode==='text'} onClick={()=>setImportMode('text')}><FileText size={16}/>Text</button>
                <button type="button" disabled={importPending} aria-pressed={importMode==='file'} onClick={()=>setImportMode('file')}><Upload size={16}/>File</button>
              </div>
              <div className="import-input-row">
                {importMode==='url'
                  ?<input disabled={importPending} aria-label="Article link" type="url" required placeholder="https://…" value={importUrl} onChange={e=>setImportUrl(e.target.value)}/>
                  :importMode==='file'
                  ?<label className={`import-file${fileDragging?' is-dragging':''}`}
                    onDragEnter={e=>{if(!importPending&&e.dataTransfer.types.includes('Files')){e.preventDefault();fileDragDepth.current++;setFileDragging(true);}}}
                    onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=importPending?'none':'copy';}}}
                    onDragLeave={()=>{fileDragDepth.current=Math.max(0,fileDragDepth.current-1);if(!fileDragDepth.current)setFileDragging(false);}}
                    onDrop={e=>{e.preventDefault();fileDragDepth.current=0;setFileDragging(false);if(!importPending){setImportFile(e.dataTransfer.files[0]||null);setImportError('');if(fileInput.current)fileInput.current.value='';}}}
                  ><Upload size={24}/><span>{fileDragging?'Drop file here':importFile?.name||'Choose a file'}</span><small>TXT, Markdown or PDF</small><input ref={fileInput} disabled={importPending} aria-label="Article file" type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={e=>{setImportFile(e.target.files?.[0]||null);setImportError('');}}/></label>
                  :<textarea disabled={importPending} aria-label="Article text" required rows={4} maxLength={200000} placeholder="Paste article text…" value={importText} onChange={e=>setImportText(e.target.value)}/>}
                <button className="button primary" aria-label="Add article" title="Add article" disabled={loading||!settings||importPending}>{importPending?<LoaderCircle size={18} className="spin"/>:<Plus size={18}/>}</button>
                <button type="button" className="import-options" aria-haspopup="dialog" popoverTarget="import-options"><Settings2 size={13}/>Options</button>
              </div>
              {!loading&&!configured&&<p className="import-note">Will be saved as a draft.</p>}
              {importError&&<p className="form-error" role="alert">{importError}</p>}
            </form>
            <div className="audio-art" aria-hidden="true"><div className="art-disc"><span>redread</span><Wave/><AudioLines size={22}/></div></div>
          </section>
          <div id="import-options" popover="auto" role="dialog" aria-label="Import options" className="import-options-popover">
            <div className="import-options-heading"><strong>Options</strong><button type="button" className="icon-button" aria-label="Close options" popoverTarget="import-options" popoverTargetAction="hide"><X size={16}/></button></div>
            <label>Title (optional)<input disabled={importPending} value={importTitle} maxLength={300} onChange={e=>setImportTitle(e.target.value)} placeholder="Detected automatically"/></label>
            <VoiceSelect voices={settings?.customVoices||[]} value={importVoice} onChange={setImportVoice} disabled={importPending}/>
          </div>
          <div className="collection-head"><div className="filter-tabs" role="group" aria-label="Filter articles">{[['all','All articles',articles.length],['ready','Ready to listen',ready.length],['active','In progress',pending.length],['draft','Drafts',articles.filter(a=>a.status==='draft'||a.status==='failed').length]].map(([key,label,count])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(String(key))}>{label}<span>{count}</span></button>)}</div><label className="search"><Search size={17}/><input aria-label="Search library" placeholder="Search library…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
          {loading?<div className="empty-state"><LoaderCircle className="spin"/><h3>Loading library…</h3></div>:!articles.length?null:!filtered.length?<section className="empty-state"><Search size={25}/><h3>No matching articles.</h3><button className="text-link" onClick={()=>{setSearch('');setFilter('all');}}>Reset filters</button></section>:<div className="article-grid">{filtered.map((a,i)=><article key={a.id} className="article-card"><button className="card-open" aria-label={`Open article: ${a.title}`} onClick={()=>void openArticle(a.id)}><div className={`card-art tone-${i%4}`}><span className="card-source">{a.source}</span><span className="card-monogram">{a.title.slice(0,1).toUpperCase()}<span>↗</span></span><Wave/><span className={`status-badge ${a.status}`}>{busy(a.status)?<LoaderCircle size={12} className="spin"/>:a.status==='ready'?<Check size={12}/>:a.status==='failed'?<AlertCircle size={12}/>:<FileText size={12}/>} {statusLabels[a.status]}</span></div><div className="card-body"><h3>{a.title}</h3><p>{a.excerpt}</p></div></button><div className="card-footer"><div className="card-meta"><span><Clock3 size={13}/>{a.duration?'':'approx. '}{minutes(a)} min</span><span>{date(a.createdAt)}</span></div><div className="card-actions">
            <button className="card-play" title={a.status!=='ready'?'No audio yet':playing?.id===a.id&&!playing.versionId&&!playerPaused?'Pause':'Play'} disabled={a.status!=='ready'||playPending!==null} aria-label={playing?.id===a.id&&!playing.versionId&&!playerPaused?`Pause: ${a.title}`:`Play: ${a.title}`} onClick={()=>void playCard(a.id)}>
              {playPending===a.id?<LoaderCircle size={16} className="spin"/>:playing?.id===a.id&&!playing.versionId&&!playerPaused?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}
            </button>
            {a.url&&<a className="card-original" title="Open original article" href={a.url} target="_blank" rel="noreferrer" aria-label={`Open original article: ${a.title}`}><ArrowUpRight size={18}/></a>}
          </div></div></article>)}</div>}
        </>}
        <div hidden={view!=='settings'}><div className="page-heading"><div><h1>Settings<span>.</span></h1></div></div>{settings?<SettingsForm initial={settings} onSave={setSettings}/>:<p>Loading settings…</p>}</div>
      </main>
    </div>
    {notice&&<div className="toast" role="status">{notice}<button className="icon-button" aria-label="Close notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {selected&&<ArticleModal initial={selected} voices={settings?.customVoices||[]} configured={configured} onReprocess={()=>{if(playing?.id===selected.id&&!playing.versionId)setPlaying(null);}} onClose={()=>setSelected(null)} onChange={()=>void refresh()} onPlay={a=>{if(playing?.id===a.id&&playing.versionId===a.versionId&&playing.publishedAt===a.publishedAt&&playerAudio.current)void playerAudio.current.play().catch(()=>setNotice('Playback could not be started.'));else setPlaying(a);setSelected(null);}} onSettings={()=>{setSelected(null);setView('settings');}}/>}
    {playing&&<AudioPlayer key={`${playing.id}:${playing.versionId||playing.publishedAt}`} article={playing} audioRef={playerAudio} onPausedChange={setPlayerPaused} onClose={()=>setPlaying(null)} onOpen={()=>void openArticle(playing.id)}/>}
  </div>;
}
function ArticleModal({initial,voices,configured,onClose,onChange,onPlay,onSettings,onReprocess}:{voices:CustomVoice[];onReprocess:()=>void;initial:Article;configured:boolean;onClose:()=>void;onChange:()=>void;onPlay:(a:PlayableArticle)=>void;onSettings:()=>void}) {
  const [generation,setGeneration]=useState<'process'|'reprocess'|null>(null);
  const [versions,setVersions]=useState<AudioVersion[]>([]);
  const [editingTitle,setEditingTitle]=useState(false);const [titleDraft,setTitleDraft]=useState(initial.title);
  async function saveTitle(event:FormEvent) {
    event.preventDefault();if(pending||!titleDraft.trim())return;
    setPending(true);setError('');
    try{const next=await api<Article>(`articles/${article.id}`,'PATCH',{title:titleDraft.trim()});setArticle(next);setEditingTitle(false);onChange();}
    catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  const [article,setArticle]=useState(initial); const [tab,setTab]=useState('original');const [draft,setDraft]=useState(initial.script); const [pending,setPending]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(!busy(article.status))return;const timer=setInterval(async()=>{try{const next=await api<Article>(`articles/${article.id}`);setArticle(next);setDraft(next.script);if(!busy(next.status))onChange();}catch(e){setError((e as Error).message);}},2000);return()=>clearInterval(timer);},[article.id,article.status,onChange]);
  useEffect(()=>{let active=true;void api<AudioVersion[]>(`articles/${article.id}/versions`).then(next=>{if(active)setVersions(next);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[article.id,article.status]);
  async function action(kind:'save'|'delete') {
    if(kind==='delete'&&!confirm('Permanently delete this article, including its text and audio?'))return;
    setPending(true);setError('');
    try{if(kind==='delete'){await api(`articles/${article.id}`,'DELETE');onChange();onClose();return;}
      const next=await api<Article>(`articles/${article.id}`,'PATCH',{script:draft});setArticle(next);setDraft(next.script);onChange();
    }catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  const editable=!busy(article.status)&&article.status!=='ready';
  return <><Modal title="In your library" wide onClose={onClose}><div className="article-detail"><div className="detail-meta"><span className={`status-badge inline ${article.status}`}>{statusLabels[article.status]}</span><span>{article.source} · {date(article.createdAt)}</span>{article.language&&<span title="Detected article language">{article.language.toUpperCase()}</span>}{article.url&&<a href={article.url} target="_blank" rel="noreferrer" aria-label="Open original page"><ArrowUpRight size={18}/></a>}</div>{editingTitle?<form className="detail-title" onSubmit={saveTitle} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!pending)setEditingTitle(false);}}}><input autoFocus aria-label="Article title" maxLength={500} value={titleDraft} disabled={pending} onChange={e=>setTitleDraft(e.target.value)}/><button className="icon-button" type="submit" aria-label="Save title" title="Save title" disabled={pending||!titleDraft.trim()}><Check size={18}/></button><button className="icon-button" type="button" aria-label="Cancel title edit" title="Cancel" disabled={pending} onClick={()=>setEditingTitle(false)}><X size={18}/></button></form>:<div className="detail-title"><h1>{article.title}</h1><button className="icon-button" aria-label="Edit title" title="Edit title" disabled={pending} onClick={()=>{setTitleDraft(article.title);setEditingTitle(true);}}><Pencil size={18}/></button></div>}<div className="detail-actions">{article.status==='ready'?<><button className="button primary" onClick={()=>onPlay(article)}><Play size={17}/>Listen · {minutes(article)} min</button><a className="button secondary" href={`/api/articles/${article.id}/audio?v=${encodeURIComponent(article.publishedAt)}`} download><Download size={16}/>MP3</a></>:busy(article.status)?<div className="processing"><LoaderCircle size={18} className="spin"/>{article.progress}</div>:<button className="button primary" disabled={pending} onClick={()=>configured?setGeneration('process'):onSettings()}><AudioLines size={17}/>{configured?article.status==='failed'?'Resume processing':'Create audio':'Connect models'}</button>}{(article.status==='ready'||article.status==='failed'||busy(article.status))&&<button className="icon-button" aria-label="Reprocess" title="Create a new version" aria-haspopup="dialog" disabled={pending||busy(article.status)||!configured} onClick={()=>setGeneration('reprocess')}><RotateCcw size={18}/></button>}<button className="icon-button danger" aria-label="Delete article" disabled={busy(article.status)||pending} onClick={()=>void action('delete')}><Trash2 size={18}/></button></div>{article.error&&<div className="form-error" role="alert">{article.error}</div>}{error&&<div className="form-error" role="alert">{error}</div>}{versions.length>0&&<details className="version-history"><summary><History size={16}/>Previous versions <span>{versions.length}</span></summary><ul>{versions.map(version=><li key={version.versionId}><div><strong>{new Date(version.publishedAt).toLocaleString()}</strong><small>{voices.find(v=>v.voice===version.voice)?.name||version.voice||'Default voice'} · {Math.max(1,Math.round(version.duration/60))} min</small></div><button className="icon-button" aria-label={`Listen to version from ${new Date(version.publishedAt).toLocaleString()}`} title="Listen to this version" onClick={()=>onPlay({...article,...version,status:'ready'})}><Play size={17}/></button><a className="icon-button" href={`/api/articles/${article.id}/audio?version=${encodeURIComponent(version.versionId)}`} download aria-label="Download this version" title="Download this version"><Download size={16}/></a></li>)}</ul></details>}<div className="reader-tabs"><button className={tab==='original'?'selected':''} onClick={()=>setTab('original')}><FileText size={16}/>Original text</button><button className={tab==='script'?'selected':''} onClick={()=>setTab('script')}><AudioLines size={16}/>Listening version{article.script&&<Check size={13}/>}</button></div>{tab==='original'?<div className="reader-text">{normalizeArticleText(article.original)}</div>:article.script?<>{editable?<><textarea className="script-editor" aria-label="Edit listening version" value={draft} onChange={e=>setDraft(e.target.value)}/><button className="button secondary" disabled={pending||draft===article.script||!draft.trim()} onClick={()=>void action('save')}>Save listening version</button></>:<div className="reader-text">{article.script}</div>}</>:<div className="empty-state compact"><AudioLines size={28}/><h3>No listening version yet.</h3></div>}</div></Modal>{generation&&<GenerationModal article={article} voices={voices} intent={generation} onClose={()=>setGeneration(null)} onComplete={next=>{setArticle(next);setDraft(next.script);if(generation==='reprocess')onReprocess();setGeneration(null);onChange();}}/>}</>;
}
function GenerationModal({article,voices,intent,onClose,onComplete}:{article:Article;voices:CustomVoice[];intent:'process'|'reprocess';onClose:()=>void;onComplete:(article:Article)=>void}) {
  const [voice,setVoice]=useState(article.voice||'');
  const [mode,setMode]=useState<ReprocessMode>(article.script?'audio':'all');
  const [pending,setPending]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();if(pending)return;
    setPending(true);setError('');
    try{onComplete(await api<Article>(`articles/${article.id}/${intent}`,'POST',{voice,mode}));}
    catch(e){setError((e as Error).message);setPending(false);}
  }
  return <Modal title={intent==='reprocess'?'Create a new version':article.status==='failed'?'Resume processing':'Create audio'} onClose={()=>{if(!pending)onClose();}}>
    <form className="modal-content generation-form" onSubmit={submit} aria-busy={pending}>
      {intent==='reprocess'&&<fieldset className="generation-modes" disabled={pending}><legend>What should be recreated?</legend>
        <label className={`generation-option${mode==='audio'?' selected':''}`}><input type="radio" name="generation-mode" value="audio" checked={mode==='audio'} disabled={!article.script} onChange={()=>setMode('audio')}/><span><strong>Audio only</strong><small>Keep the listening text and record it again with the selected voice.</small></span></label>
        <label className={`generation-option${mode==='all'?' selected':''}`}><input type="radio" name="generation-mode" value="all" checked={mode==='all'} onChange={()=>setMode('all')}/><span><strong>Text + audio</strong><small>Prepare a new listening text from the original and create new audio.</small></span></label>
      </fieldset>}
      <VoiceSelect voices={voices} value={voice} onChange={setVoice} disabled={pending}/>
      {intent==='reprocess'&&<p className="muted">Completed versions stay available under “Previous versions”, even if the new generation fails.</p>}
      {error&&<div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending?<LoaderCircle size={17} className="spin"/>:<AudioLines size={17}/>} {intent==='reprocess'?(mode==='audio'?'Recreate audio':'Recreate text + audio'):article.status==='failed'?'Resume processing':'Create audio'}</button></div>
    </form>
  </Modal>;
}
function SettingsForm({initial,onSave}:{initial:PublicSettings;onSave:(s:PublicSettings)=>void}) {
  const [s,setS]=useState(initial);
  const [voiceRows,setVoiceRows]=useState(()=>Object.entries(initial.languageVoices||{}).map(([language,voice])=>({language,voice})));
  const [pending,setPending]=useState(false);
  const [showSaved,setShowSaved]=useState(false);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const form=useRef<HTMLFormElement>(null);
  const snapshot=JSON.stringify({s,voiceRows});
  const savedSnapshot=useRef(snapshot);
  const failedSnapshot=useRef('');
  const onSaved=useRef(onSave);
  onSaved.current=onSave;
  const dirty=snapshot!==savedSnapshot.current;
  const field=(key:keyof PublicSettings,value:string|number)=>setS(prev=>({...prev,[key]:value}));

  useEffect(()=>{
    if(dirty){setShowSaved(false);return;}
    if(!showSaved)return;
    const timer=setTimeout(()=>setShowSaved(false),2000);
    return()=>clearTimeout(timer);
  },[dirty,showSaved]);

  useEffect(()=>{
    if(!dirty&&!pending)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty,pending]);

  useEffect(()=>{
    if(!dirty){setError('');return;}
    if(pending||failedSnapshot.current===snapshot)return;
    setError('');
    const timer=setTimeout(async()=>{
      if(!form.current?.checkValidity()){
        setError('Please check your entries. Your changes have not been saved yet.');
        return;
      }
      let languageVoices:PublicSettings['languageVoices'];
      try {languageVoices=voiceRowsToSettings(voiceRows);}
      catch(e){setError((e as Error).message);return;}
      setPending(true);
      try {
        const saved=await api<PublicSettings>('settings','PUT',{...s,languageVoices});
        failedSnapshot.current='';
        // Keep edits made during the request; only clear keys that were just saved.
        const metadata={hasLlmKey:saved.hasLlmKey,hasTtsKey:saved.hasTtsKey,envFields:saved.envFields,overriddenFields:saved.overriddenFields};
        savedSnapshot.current=JSON.stringify({s:{...s,...metadata,llmKey:'',ttsKey:''},voiceRows});
        setS(current=>({...current,...metadata,llmKey:current.llmKey===s.llmKey?'':current.llmKey,ttsKey:current.ttsKey===s.ttsKey?'':current.ttsKey}));
        setShowSaved(true);
        onSaved.current(saved);
      } catch(e) {
        failedSnapshot.current=snapshot;
        setError((e as Error).message);
      } finally {setPending(false);}
    },700);
    return()=>clearTimeout(timer);
  },[s,voiceRows,snapshot,dirty,pending,retry]);
  return <form ref={form} className="settings-form" onSubmit={e=>e.preventDefault()}><section className="settings-section"><h2>Appearance</h2><label>Color mode<select value={s.theme} onChange={e=>field('theme',e.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="auto">Automatic (system)</option></select></label></section><div className="settings-grid"><section className="settings-section"><h2>Text preparation</h2><label>LLM base URL<input type="url" required value={s.llmUrl} onChange={e=>field('llmUrl',e.target.value)}/></label><label>Model<input value={s.llmModel} onChange={e=>field('llmModel',e.target.value)} placeholder="Your provider's model ID"/></label><label>API key<input type="password" autoComplete="new-password" value={s.llmKey} onChange={e=>field('llmKey',e.target.value)} placeholder={s.hasLlmKey?'*****':''}/></label></section><section className="settings-section"><h2>Speech output</h2><label>TTS provider<select value={s.ttsProvider} onChange={e=>field('ttsProvider',e.target.value)}><option value="openai">OpenAI-compatible</option><option value="fish">Fish Audio</option></select></label><label>{s.ttsProvider==='fish'?'Fish Audio TTS URL':'TTS base URL'}<input type="url" required value={s.ttsUrl} onChange={e=>field('ttsUrl',e.target.value)}/></label><div className="field-pair"><label>Model<input value={s.ttsModel} onChange={e=>field('ttsModel',e.target.value)} placeholder="TTS model ID"/></label><label>{s.ttsProvider==='fish'?'Default voice (optional reference ID)':'Default voice'}<input required={s.ttsProvider!=='fish'} value={s.voice} onChange={e=>field('voice',e.target.value)} placeholder={s.ttsProvider==='fish'?'Default voice':'Voice ID'}/></label></div><label>API key<input type="password" autoComplete="new-password" value={s.ttsKey} onChange={e=>field('ttsKey',e.target.value)} placeholder={s.hasTtsKey?'*****':''}/></label></section></div><CustomVoices rows={s.customVoices||[]} onChange={customVoices=>setS(prev=>({...prev,customVoices}))} disabled={false}/><LanguageVoices rows={voiceRows} onChange={setVoiceRows} fish={s.ttsProvider==='fish'} disabled={false}/><section className="settings-section"><h2>Concurrent processing</h2><div className="field-pair"><label>Concurrent articles<input type="number" required min={1} max={8} step={1} value={s.articleConcurrency} onChange={e=>field('articleConcurrency',Number(e.target.value))}/></label><label>Concurrent LLM calls<input type="number" required min={1} max={32} step={1} value={s.llmConcurrency} onChange={e=>field('llmConcurrency',Number(e.target.value))}/></label><label>Concurrent TTS calls<input type="number" required min={1} max={32} step={1} value={s.ttsConcurrency} onChange={e=>field('ttsConcurrency',Number(e.target.value))}/></label><label>LLM section length (characters)<input type="number" required min={1000} max={12000} step={1} value={s.llmChunkChars} onChange={e=>field('llmChunkChars',Number(e.target.value))}/></label></div></section><section className="settings-section"><label>System prompt<textarea rows={6} required value={s.prompt} onChange={e=>field('prompt',e.target.value)}/></label></section><section className="settings-section"><h2>Your podcast</h2><div className="field-pair"><label>Feed title<input required value={s.feedTitle} onChange={e=>field('feedTitle',e.target.value)}/></label><label>Accessible app URL<input type="url" value={s.publicUrl} onChange={e=>field('publicUrl',e.target.value)} placeholder="Automatic / server configuration"/></label></div></section><div className="settings-actions"><span className="muted" role="status" style={{minHeight:22}}>{pending?<><LoaderCircle size={14} className="spin"/> Saving…</>:showSaved&&!dirty&&!error?<><Check size={14}/> Saved</>:null}</span></div>{error&&<p className="form-error" role="alert">{error}</p>}{error&&<div className="settings-actions"><button type="button" className="button secondary" onClick={()=>{failedSnapshot.current='';setRetry(value=>value+1);}}>Try again</button></div>}</form>;
}
