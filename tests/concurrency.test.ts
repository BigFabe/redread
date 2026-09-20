import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLimiter, mapConcurrent } from '../packages/core/src/concurrency';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('bounded mapping preserves input order and drains failures before returning',async()=>{
  let active=0,peak=0;
  const result=await mapConcurrent([60,10,30,5],2,async(value,index)=>{
    peak=Math.max(peak,++active);await sleep(value);active--;return index;
  });
  assert.deepEqual(result,[0,1,2,3]);assert.equal(peak,2);
  const started:number[]=[];let drained=false;
  await assert.rejects(mapConcurrent([0,1,2,3],2,async value=>{
    started.push(value);
    if(value===0){await sleep(10);throw new Error('failure');}
    await sleep(40);drained=true;return value;
  }),/failure/);
  assert.deepEqual(started,[0,1]);assert.equal(drained,true);
});

test('shared limiter caps independent batches and releases slots after errors',async()=>{
  const slot=createLimiter(3);let active=0,peak=0;
  const batch=()=>mapConcurrent([0,1,2,3],3,i=>slot(async()=>{
    peak=Math.max(peak,++active);try{await sleep(10);return i;}finally{active--;}
  }));
  await Promise.all([batch(),batch()]);assert.equal(peak,3);assert.equal(active,0);
  await assert.rejects(slot(async()=>{throw new Error('upstream');}),/upstream/);
  assert.equal(await slot(async()=>42),42);
});

test('parallel article pipelines keep text/audio order, global limits and cached chunks',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'redread-parallel-'));
  process.env.DATA_DIR=dir;process.env.REDREAD_ENV_FILE='';
  process.env.LLM_CONCURRENCY='3';process.env.TTS_CONCURRENCY='2';process.env.LLM_CHUNK_CHARS='3000';
  const {addArticle,saveSettings,getArticle,articleDir}=await import('../packages/core/src/db');
  const {defaults}=await import('../packages/core/src/types');
  const {processArticle,splitText}=await import('../packages/core/src/pipeline');
  const mp3=join(dir,'fixture.mp3');
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-codec:a','libmp3lame',mp3]);
  const audio=readFileSync(mp3);
  let llmActive=0,ttsActive=0,llmPeak=0,ttsPeak=0,llmCalls=0,ttsCalls=0;
  const upstream=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);
    if(req.url==='/v1/chat/completions'){
      llmCalls++;llmPeak=Math.max(llmPeak,++llmActive);
      await sleep(llmCalls%3===1?100:15);
      llmActive--;res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{message:{content:input.messages[1].content},finish_reason:'stop'}]}));
    }else{
      ttsCalls++;ttsPeak=Math.max(ttsPeak,++ttsActive);
      await sleep(ttsCalls%2?70:10);ttsActive--;
      res.setHeader('Content-Type','audio/mpeg');res.end(audio);
    }
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const url=`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`;
  const config={...defaults,llmUrl:url,ttsUrl:url,llmModel:'test',ttsModel:'test'};
  saveSettings(config);
  try{
    const articles=['A','B'].map(prefix=>addArticle({title:prefix,url:'',source:'test',original:Array.from({length:12},(_,i)=>`${prefix}${i} ${'Ein lesbarer Satz. '.repeat(55)}`).join('\n\n')}));
    await Promise.all(articles.map(a=>processArticle(a)));
    assert.equal(llmPeak,3);assert.equal(ttsPeak,2);assert.equal(llmActive,0);assert.equal(ttsActive,0);
    for(const article of articles){
      const saved=getArticle(article.id)!;
      assert.equal(saved.status,'ready');
      assert.equal(saved.script,splitText(article.original,3000).join('\n\n'));
      const expected=splitText(saved.script).map(part=>{
        const hash=createHash('sha256').update(JSON.stringify([config.ttsProvider,url,'test',config.voice,part])).digest('hex');
        return `file 'audio-${hash}.mp3'`;
      }).join('\n');
      assert.equal(readFileSync(join(articleDir(article.id),'concat.txt'),'utf8'),expected);
    }
    const before=[llmCalls,ttsCalls];
    await processArticle(getArticle(articles[0].id)!);
    assert.deepEqual([llmCalls,ttsCalls],before);
    // Identical parallel chunks share one in-flight request and one cache file.
    const repeated=addArticle({title:'Repeated',url:'',source:'test',original:'x'.repeat(9000)});
    const beforeRepeated=llmCalls;
    await processArticle(repeated);
    assert.equal(llmCalls-beforeRepeated,1);
    assert.equal(getArticle(repeated.id)!.status,'ready');
  }finally{
    upstream.close();rmSync(dir,{recursive:true,force:true});
  }
});
