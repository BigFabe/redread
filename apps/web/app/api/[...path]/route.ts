import { z } from 'zod';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { addArticle, listArticles, getArticle, publicSettings, settings, saveSettings, resetSettings, queueArticle, patchArticle, deleteArticle, articleDir } from '@redread/core/db';
import { busy } from '@redread/core/types';
import { reprocessArticle } from '@redread/core/db';
import { languageVoices } from '@redread/core/language';
import { extractArticle } from '@redread/core/extract';
import { extensionOrigin, extensionImport } from '@redread/core/extension-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, {status,headers:{'Cache-Control':'no-store'}});
const httpUrl = z.string().url().refine(s => { try { const u = new URL(s); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }, 'HTTP(S)-URL ohne Zugangsdaten erforderlich.');
const settingsSchema = z.object({
  ttsProvider: z.enum(['openai','fish']).default('openai'),
  llmUrl: httpUrl, ttsUrl: httpUrl, llmModel: z.string().trim().max(200), ttsModel: z.string().trim().max(200),
  llmKey: z.string().max(2000).optional(), ttsKey: z.string().max(2000).optional(),
  clearLlmKey: z.boolean().optional(), clearTtsKey: z.boolean().optional(),
  prompt: z.string().trim().min(1).max(20000), voice:z.string().trim().max(200),
  languageVoices: z.record(z.string(),z.string()).optional(),
  publicUrl: z.union([httpUrl,z.literal('')]), feedTitle:z.string().trim().min(1).max(200),
  articleConcurrency: z.number().int().min(1).max(8),
  llmConcurrency: z.number().int().min(1).max(32),
  ttsConcurrency: z.number().int().min(1).max(32),
  llmChunkChars: z.number().int().min(1000).max(12000),
});
type Context = {params: Promise<{path: string[]}>};
async function handleRequest(req: Request, context: Context) {
  try {
    const {path} = await context.params;
    const [resource,id,action] = path;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.get('origin');
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
      let sameOrigin=!origin;
      if(origin){try{const url=new URL(origin);sameOrigin=['http:','https:'].includes(url.protocol)&&url.host===host;}catch{sameOrigin=false;}}
      if (!extensionImport(req,path) && (!sameOrigin || req.headers.get('sec-fetch-site') === 'cross-site')) return json({error:'Fremde Herkunft nicht erlaubt.'},403);
      if (!req.headers.get('content-type')?.includes('application/json')) return json({error:'JSON erforderlich.'},415);
    }
    if (resource === 'health' && req.method === 'GET') {
      const s=settings();return json({app:'redread',version:'0.1',ready:!!s.llmModel&&!!s.ttsModel});
    }
    if (resource === 'settings' && req.method === 'GET') return json(publicSettings());
    if (resource === 'settings' && req.method === 'DELETE') { resetSettings(); return json(publicSettings()); }
    if (resource === 'settings' && req.method === 'PUT') {
      const input = settingsSchema.parse(await req.json()); const current = settings();
      const {clearLlmKey,clearTtsKey,...values} = input;
      values.languageVoices=languageVoices(input.languageVoices ?? current.languageVoices);
      saveSettings({...current,...values,llmKey:clearLlmKey ? '' : input.llmKey || current.llmKey, ttsKey:clearTtsKey ? '' : input.ttsKey || current.ttsKey});
      return json(publicSettings());
    }
    if (resource !== 'articles') return json({error:'Nicht gefunden.'},404);
    if (!id && req.method === 'GET') return json(listArticles().map(({original,script,recipe,...a}) => ({...a,excerpt:original.slice(0,220),wordCount:original.split(/\s+/).length,hasScript:!!script})));
    if (!id && req.method === 'POST') {
      const input = z.object({url:z.union([httpUrl,z.literal('')]).optional(), title:z.string().trim().max(300).optional(),text:z.string().trim().max(200000).optional(),process:z.boolean().optional()}).parse(await req.json());
      if (!input.text && !input.url) return json({error:'Bitte eine URL oder einen Artikeltext einfügen.'},400);
      const data = input.text
        ? {title:input.title || input.text.split('\n')[0].slice(0,100), original:input.text, url:input.url || '',source:input.url ? new URL(input.url).hostname : 'Eigener Text'}
        : await extractArticle(input.url!);
      const a = addArticle({...data,title:input.title || data.title});
      if (input.process && settings().llmModel && settings().ttsModel) queueArticle(a.id);
      return json(getArticle(a.id),201);
    }
    const article = getArticle(id);
    if (!article) return json({error:'Artikel nicht gefunden.'},404);
    if (action === 'audio' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (article.status !== 'ready') return json({error:'Audio ist noch nicht fertig.'},404);
      const file = join(articleDir(id),'episode.mp3'); const size = statSync(file).size;
      const headers: Record<string,string> = {'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'private, no-cache','Content-Disposition':`inline; filename="redread-${id}.mp3"`};
      let start=0,end=size-1; const range=req.headers.get('range');
      if (range) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        if (!match[1]) start=Math.max(0,size-Number(match[2]));
        else {start=Number(match[1]); if(match[2]) end=Math.min(Number(match[2]),size-1);}
        if(start>end || start>=size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        headers['Content-Range']=`bytes ${start}-${end}/${size}`;
      }
      headers['Content-Length']=String(end-start+1);
      return new Response(req.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream, {status:range?206:200,headers});
    }
    if (action === 'process' && req.method === 'POST') return json(queueArticle(id));
    if (action === 'reprocess' && req.method === 'POST') return json(reprocessArticle(id));
    if (!action && req.method === 'GET') return json(article);
    if (!action && req.method === 'PATCH') {
      if (busy(article.status) || article.status === 'ready') return json({error:'Nur Entwürfe und fehlgeschlagene Artikel können bearbeitet werden.'},409);
      const patch=z.object({script:z.string().trim().min(1).max(250000)}).parse(await req.json());
      return json(patchArticle(id,patch));
    }
    if (!action && req.method === 'DELETE') { deleteArticle(id); return json({ok:true}); }
    return json({error:'Nicht gefunden.'},404);
  } catch(error) {
    if (error instanceof z.ZodError) return json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(' · ')},400);
    return json({error: error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen.'},400);
  }
}
async function handle(req:Request,context:Context) {
  const response=await handleRequest(req,context);
  if(extensionImport(req,(await context.params).path)){
    response.headers.set('Access-Control-Allow-Origin',extensionOrigin(req)!);
    response.headers.set('Vary','Origin');
  }
  return response;
}
export async function OPTIONS(req:Request,context:Context) {
  const {path}=await context.params;const origin=extensionOrigin(req);
  const headers=(req.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  if(!origin||path.length!==1||path[0]!=='articles'||req.headers.get('access-control-request-method')!=='POST'||headers.some(h=>!['content-type','x-redread-extension'].includes(h)))return json({error:'Fremde Herkunft nicht erlaubt.'},403);
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Redread-Extension','Vary':'Origin'}});
}
export {handle as GET,handle as HEAD,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
