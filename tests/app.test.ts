import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { languagePrompt } from '../packages/core/src/language';
const temp=mkdtempSync(join(tmpdir(),'redread-test-'));
process.env.DATA_DIR=temp;
process.env.REDREAD_ENV_FILE=''; // Never load real credentials or providers during tests.
const {splitText,speech,prepareText}=await import('../packages/core/src/pipeline');
const {defaults}=await import('../packages/core/src/types');
let fishRequest: {headers: Record<string,unknown>; body: Record<string,unknown>} | undefined;
const {isPublicAddress}=await import('../packages/core/src/extract');
const base='http://127.0.0.1:3211';
let web:ChildProcess,worker:ChildProcess; let logs='';let llmCalls=0;let ttsCalls=0;let failTts=true;
const audioFile=join(temp,'test.mp3');
execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.3','-codec:a','libmp3lame',audioFile]);
const audio=readFileSync(audioFile);
let slowLlm=false,activeLlm=0,peakLlm=0;
const model=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const data=JSON.parse(body);
  if(req.url==='/v1/chat/completions'){
    if(data.messages[0].content===languagePrompt){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"language":"de"}'},finish_reason:'stop'}]}));return;}
    if(slowLlm){peakLlm=Math.max(peakLlm,++activeLlm);await new Promise(r=>setTimeout(r,250));activeLlm--;}
    llmCalls++;assert.equal(data.model,'test-llm');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Eine gut vorlesbare Hörfassung des Testartikels.'},finish_reason:'stop'}]}));
  }else if(req.url==='/v1/audio/speech'){
    ttsCalls++;assert.equal(data.model,'test-tts');if(failTts){res.writeHead(503);res.end('temporary failure');}else{res.setHeader('Content-Type','audio/mpeg');res.end(audio);}
  }else if(req.url==='/v1/tts'){
    fishRequest={headers:req.headers,body:data};res.setHeader('Content-Type','audio/mpeg');res.end(audio);
  }else{res.writeHead(404);res.end();}
});
async function request(path:string,method='GET',body?:unknown,headers:Record<string,string>={}) {
  const res=await fetch(base+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
}
async function until(fn:()=>Promise<boolean>,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out\n'+logs);}
before(async()=>{
  model.listen(0,'127.0.0.1');await once(model,'listening');
  const env={...process.env,DATA_DIR:temp,PUBLIC_URL:base,NEXT_TELEMETRY_DISABLED:'1',ARTICLE_CONCURRENCY:'2',LLM_CONCURRENCY:'3',TTS_CONCURRENCY:'2'};
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3211'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  web.stdout?.on('data',b=>logs+=b);web.stderr?.on('data',b=>logs+=b);
  await until(async()=>{try{return (await fetch(base+'/api/settings')).ok;}catch{return false;}});
  worker=spawn(process.execPath,['--import','tsx','apps/worker/index.ts'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  worker.stderr?.on('data',b=>logs+=b);
});
after(async()=>{
  for(const p of [worker,web])if(p&&p.exitCode===null){const exited=once(p,'exit');p.kill('SIGTERM');await exited;}
  model.close();rmSync(temp,{recursive:true,force:true});
});
test('chunking preserves all words and respects model limit',()=>{
  const input='Das ist ein vollständiger Satz. '.repeat(700);
  const parts=splitText(input,3000);
  assert(parts.length>1);assert(parts.every(p=>p.length<=3000));
  assert.equal(parts.join(' ').split(/\s+/).join(' '),input.trim().split(/\s+/).join(' '));
  assert.deepEqual(splitText(''),[]);
  assert(splitText('a'.repeat(8000),3000).every(p=>p.length<=3000));
});
test('article imports exclude private and special network addresses',()=>{
  for(const address of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','0.0.0.0'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
});
test('Fish Audio sends the model header and optional reference_id',async()=>{
  const addr=model.address() as {port:number};
  const config={...defaults,ttsProvider:'fish' as const,ttsUrl:`http://127.0.0.1:${addr.port}/v1/tts`,ttsModel:'s2.1-pro-free',ttsKey:'fake-fish-key',voice:''};
  const response=await speech(config,'Ein kurzer Test.');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),audio);
  assert.equal(fishRequest?.headers.model,'s2.1-pro-free');
  assert.equal(fishRequest?.headers.authorization,'Bearer fake-fish-key');
  assert.deepEqual(fishRequest?.body,{text:'Ein kurzer Test.',format:'mp3'});
  await (await speech({...config,voice:'reference-test'},'Andere Stimme.')).arrayBuffer();
  assert.equal(fishRequest?.body.reference_id,'reference-test');
});
test('LLM retries empty output once and identifies provider, length and refusal failures',async()=>{
  let responses: unknown[]=[]; let calls=0;
  const upstream=createServer(async(req,res)=>{
    for await (const _ of req) { /* consume the request */ }
    calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(responses.shift()));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const config={...defaults,llmUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`};
  const empty={choices:[{message:{content:null,reasoning:'Not a transcript'},finish_reason:'stop'}],usage:{completion_tokens_details:{reasoning_tokens:42}}};
  try {
    responses=[empty,{choices:[{message:{content:'  Hörfassung  '},finish_reason:'stop'}]}];
    assert.equal(await prepareText(config,'Artikel'),'Hörfassung');assert.equal(calls,2);
    calls=0;responses=[empty,empty];
    await assert.rejects(prepareText(config,'Artikel'),/zweiten Versuch.*42 Reasoning-Tokens/);assert.equal(calls,2);
    for(const [response,pattern] of [
      [{error:{code:503,message:'private upstream details'}},/Code 503/],
      [{choices:[{error:{code:502},finish_reason:'error',message:{content:'partial output'}}]},/Code 502/],
      [{choices:[{finish_reason:'length',message:{content:null}}]},/Ausgabelimit/],
      [{choices:[{finish_reason:'content_filter',message:{content:null}}]},/Inhaltsfilter/],
    ] as const) {
      calls=0;responses=[response];await assert.rejects(prepareText(config,'Artikel'),pattern);assert.equal(calls,1);
    }
  } finally {upstream.close();}
});
test('temporary settings override .env without changing it or copying its keys',()=>{
  const envFile=join(temp,'test.env');
  writeFileSync(envFile,'LLM_MODEL=env-model\nLLM_API_KEY=env-secret\nTTS_VOICE=\n');
  const script=`
    import assert from 'node:assert/strict';
    import {DatabaseSync} from 'node:sqlite';
    import {settings,saveSettings,publicSettings,resetSettings} from './packages/core/src/db.ts';
    saveSettings({...settings(),llmModel:'temporary-model',llmConcurrency:1});
    assert.equal(settings().llmModel,'temporary-model');
    assert.equal(settings().llmConcurrency,1);
    assert.equal(settings().llmKey,'env-secret');
    assert.equal(settings().voice,'');
    assert.equal(publicSettings().llmKey,'');
    assert.equal(publicSettings().hasLlmKey,true);
    assert(publicSettings().envFields.includes('llmModel'));
    const db=new DatabaseSync(process.env.DATA_DIR+'/redread.sqlite');
    const stored=JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
    assert.equal(stored.llmKey,undefined);
    assert.equal(stored.llmModel,'temporary-model');
    assert(publicSettings().overriddenFields.includes('llmModel'));
    saveSettings({...settings(),llmKey:'temporary-key'});
    assert.equal(settings().llmKey,'temporary-key');
    assert.equal(publicSettings().llmKey,'');
    resetSettings();
    assert.equal(settings().llmModel,'env-model');
    assert.equal(settings().llmKey,'env-secret');
    assert.equal(publicSettings().overriddenFields.length,0);
    console.log('env settings OK');
  `;
  const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:{...process.env,REDREAD_ENV_FILE:envFile,DATA_DIR:join(temp,'env-check')},encoding:'utf8'});
  assert.match(output,/env settings OK/);
  assert.equal(readFileSync(envFile,'utf8'),'LLM_MODEL=env-model\nLLM_API_KEY=env-secret\nTTS_VOICE=\n');
});
test('extension imports are allowed narrowly without weakening website CSRF protection',async()=>{
  assert.equal((await request('/api/health')).data.app,'redread');
  for(const origin of ['chrome-extension://'+'a'.repeat(32),'moz-extension://12345678-1234-1234-1234-123456789abc']){
    const headers={Origin:origin,'X-Redread-Extension':'1','Sec-Fetch-Site':'cross-site'};
    const imported=await request('/api/articles','POST',{title:'Extension test',url:'https://example.com/article',text:'Article extracted in the browser, without a server-side download.',process:false},headers);
    assert.equal(imported.status,201);
    assert.equal((await request('/api/settings','PUT',{},headers)).status,403);
    const preflight=await fetch(base+'/api/articles',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-redread-extension'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
    await request(`/api/articles/${imported.data.id}`,'DELETE');
  }
  for(const origin of ['https://evil.example','null','chrome-extension://invalid']){
    assert.equal((await request('/api/articles','POST',{text:'Never import'},{Origin:origin,'X-Redread-Extension':'1','Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await fetch(base+'/api/articles',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-redread-extension'}})).status,403);
  }
});
test('web API, persistence, failure recovery, RSS and ranged audio',async()=>{
  const first=await request('/api/settings');assert.equal(first.status,200);
  assert.equal((await request('/api/articles','POST',{text:'Nicht speichern'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/articles','POST',{url:'http://127.0.0.1:3211'})).status,400);
  assert.equal((await request('/api/articles','POST',{url:'file:///etc/passwd'})).status,400);
  const draft=await request('/api/articles','POST',{url:'',title:'Test <Artikel> & Audio',text:'Ein Testartikel mit mehreren Wörtern. Der Originaltext soll unverändert erhalten bleiben.'});
  assert.equal(draft.status,201);const id=draft.data.id;
  assert.equal(draft.data.status,'draft');assert.equal((await request(`/api/articles/${id}/process`,'POST',{})).status,400);
  const addr=model.address() as {port:number};
  const saved=await request('/api/settings','PUT',{...first.data,llmUrl:`http://127.0.0.1:${addr.port}/v1`,ttsUrl:`http://127.0.0.1:${addr.port}/v1`,llmModel:'test-llm',ttsModel:'test-tts',llmKey:'test-secret',ttsKey:'test-secret-2',publicUrl:base,ttsConcurrency:1,languageVoices:{de:'german-test'}});
  assert.equal((await request('/api/settings','PUT',{...saved.data,llmConcurrency:0})).status,400);
  assert.equal((await request('/api/settings','PUT',{...saved.data,llmChunkChars:999})).status,400);
  assert.equal((await request('/api/settings','PUT',{...saved.data,languageVoices:{'not a code':'x'}})).status,400);
  assert.equal((await request('/api/settings','PUT',{...saved.data,languageVoices:{de:''}})).status,400);
  assert.deepEqual(saved.data.languageVoices,{de:'german-test'});
  assert.equal(saved.status,200);assert.equal(saved.data.llmKey,'');assert.equal(saved.data.hasLlmKey,true);
  assert(!JSON.stringify(saved.data).includes('test-secret'));
  assert.equal((await request('/api/settings','PUT',saved.data)).data.hasLlmKey,true);
  assert.equal((await request(`/api/articles/${id}/process`,'POST',{})).status,200);
  await until(async()=>(await request(`/api/articles/${id}`)).data.status==='failed');
  const failed=(await request(`/api/articles/${id}`)).data;
  assert.equal(failed.language,'de');assert.equal(JSON.parse(failed.recipe).voice,'german-test');assert.match(failed.error,/503/);assert(failed.script);assert.equal(llmCalls,3);
  assert.equal(readFileSync(join(temp,'articles',id,'original.txt'),'utf8'),draft.data.original);
  assert.equal(readFileSync(join(temp,'articles',id,'script.txt'),'utf8'),failed.script);
  const newScript='Diese von Hand angepasste Hörfassung bleibt gespeichert.';
  assert.equal((await request(`/api/articles/${id}`,'PATCH',{script:newScript})).status,200);
  failTts=false;
  assert.equal((await request(`/api/articles/${id}/process`,'POST',{})).status,200);
  await until(async()=>(await request(`/api/articles/${id}`)).data.status==='ready');
  const ready=(await request(`/api/articles/${id}`)).data;
  assert.equal(llmCalls,3);assert.equal(ttsCalls,2);assert.equal(ready.script,newScript);assert(ready.audioBytes>0);assert(ready.duration>0);
  assert.equal((await request(`/api/articles/${id}`,'PATCH',{script:'cannot overwrite published audio'})).status,409);
  const list=(await request('/api/articles')).data;assert.equal(list.length,1);assert.equal(list[0].hasScript,true);assert.equal(list[0].original,undefined);
  const feed=await (await fetch(base+'/feed.xml')).text();
  const doc=new JSDOM(feed,{contentType:'text/xml'}).window.document;
  assert.equal(doc.querySelector('item title')?.textContent,'Test <Artikel> & Audio');assert.equal(doc.querySelector('enclosure')?.getAttribute('length'),String(ready.audioBytes));
  const audioResponse=await fetch(base+`/api/articles/${id}/audio`,{headers:{Range:'bytes=0-99'}});
  assert.equal(audioResponse.status,206);assert.equal((await audioResponse.arrayBuffer()).byteLength,100);assert.match(audioResponse.headers.get('content-range')!,/^bytes 0-99\//);
  const head=await fetch(base+`/api/articles/${id}/audio`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),ready.audioBytes);
  assert.equal((await fetch(base+`/api/articles/${id}/audio`,{headers:{Range:'bytes=999999999-'}})).status,416);
  assert.equal((await request(`/api/articles/${id}`,'DELETE')).status,200);assert.equal((await request('/api/articles')).data.length,0);
  assert(!(await (await fetch(base+'/feed.xml')).text()).includes('<item>'));
});
test('worker applies temporary article and LLM limits without restart',async()=>{
  slowLlm=true;
  for(const [articleConcurrency,llmConcurrency,expected] of [[1,3,3],[2,1,1],[2,3,3]]){
    peakLlm=0;
    const current=(await request('/api/settings')).data;
    assert.equal((await request('/api/settings','PUT',{...current,articleConcurrency,llmConcurrency})).status,200);
    const ids:string[]=[];
    try{
      for(const title of ['Parallel one','Parallel two']){
        const result=await request('/api/articles','POST',{title,text:`${title}: Ein kurzer Testartikel.`});
        ids.push(result.data.id);
      }
      await Promise.all(ids.map(id=>request(`/api/articles/${id}/process`,'POST',{})));
      await until(async()=>{
        const items=await Promise.all(ids.map(id=>request(`/api/articles/${id}`)));
        return items.every(item=>item.data.status==='ready');
      });
      assert.equal(peakLlm,expected);
    }finally{
      for(const id of ids)await request(`/api/articles/${id}`,'DELETE');
    }
  }
  slowLlm=false;
});
test('reset endpoint and worker restart restore permanent settings',async()=>{
  const reset=await request('/api/settings','DELETE');
  assert.equal(reset.status,200);assert.deepEqual(reset.data.overriddenFields,[]);
  assert.equal(reset.data.llmModel,'');
  const changed=await request('/api/settings','PUT',{...reset.data,llmModel:'temporary',llmConcurrency:1,ttsConcurrency:1,llmChunkChars:1500});
  assert.equal(changed.data.llmModel,'temporary');
  const exited=once(worker,'exit');worker.kill('SIGTERM');await exited;
  worker=spawn(process.execPath,['--import','tsx','apps/worker/index.ts'],{cwd:resolve('.'),env:{...process.env,DATA_DIR:temp,REDREAD_ENV_FILE:'',ARTICLE_CONCURRENCY:'2',LLM_CONCURRENCY:'3',TTS_CONCURRENCY:'2'},stdio:['ignore','pipe','pipe']});
  worker.stderr?.on('data',b=>logs+=b);
  await until(async()=>(await request('/api/settings')).data.overriddenFields.length===0);
  const restored=(await request('/api/settings')).data;
  assert.equal(restored.llmModel,'');assert.equal(restored.llmConcurrency,3);assert.equal(restored.ttsConcurrency,2);assert.equal(restored.llmChunkChars,3000);
});
