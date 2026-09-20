import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLimiter, mapConcurrent } from '../packages/core/src/concurrency';
import { languagePrompt } from '../packages/core/src/language';
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
  const {addArticle,saveSettings,getArticle,articleDir,reprocessArticle,queueArticle}=await import('../packages/core/src/db');
  const {defaults}=await import('../packages/core/src/types');
  const {processArticle,splitText,splitSpeech}=await import('../packages/core/src/pipeline');
  const mp3=join(dir,'fixture.mp3');
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-codec:a','libmp3lame',mp3]);
  const audio=readFileSync(mp3);
  let llmActive=0,ttsActive=0,llmPeak=0,ttsPeak=0,llmCalls=0,ttsCalls=0;
  let detectionCalls=0;
  let detected='de';
  const voices:string[]=[];
  const upstream=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);
    if(req.url==='/v1/chat/completions'){
      const detection=input.messages[0].content===languagePrompt;
      if(detection)detectionCalls++;else llmCalls++;
      llmPeak=Math.max(llmPeak,++llmActive);
      await sleep(llmCalls%3===1?100:15);
      llmActive--;res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{message:{content:detection?JSON.stringify({language:detected}):input.messages[1].content},finish_reason:'stop'}]}));
    }else{
      ttsCalls++;ttsPeak=Math.max(ttsPeak,++ttsActive);
      voices.push(input.voice||input.reference_id||'');
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
      const expected=splitSpeech(saved.script,config.ttsConcurrency).map(part=>{
        const hash=createHash('sha256').update(JSON.stringify([config.ttsProvider,url,'test',config.voice,part])).digest('hex');
        return `file 'audio-${hash}.mp3'`;
      }).join('\n');
      assert.equal(readFileSync(join(articleDir(article.id),'concat.txt'),'utf8'),expected);
    }
    assert.equal(detectionCalls,2);
    const before=[llmCalls,ttsCalls,detectionCalls];
    await processArticle(getArticle(articles[0].id)!);
    assert.deepEqual([llmCalls,ttsCalls,detectionCalls],before);
    // Identical parallel chunks share one in-flight request and one cache file.
    const repeated=addArticle({title:'Repeated',url:'',source:'test',original:'x'.repeat(9000)});
    const beforeRepeated=llmCalls;
    await processArticle(repeated);
    assert.equal(llmCalls-beforeRepeated,1);
    assert.equal(getArticle(repeated.id)!.status,'ready');

    // Short articles and scripts must fill the configured slots, not become one request.
    const shortText=Array.from({length:6},(_,i)=>`Abschnitt ${i}: Dieser kurze Satz bleibt vollständig erhalten.`).join(' ');
    const llmParts=splitText(shortText,3000,6);
    assert.equal(llmParts.length,6);
    assert.equal(llmParts.join(' '),shortText);
    assert.throws(()=>splitText(shortText,3000,0),/Zielzahl/);
    const parts=splitSpeech(shortText,6);
    assert.equal(parts.length,6);
    assert.equal(parts.join(' '),shortText);
    assert(parts.every(part=>part.endsWith('.')));
    assert.deepEqual(splitSpeech('Ein einzelnes Wortgefüge',3),['Ein','einzelnes','Wortgefüge']);
    assert.deepEqual(splitSpeech('Wort',32),['Wort']);
    assert.deepEqual(splitSpeech('   ',6),[]);
    const longParts=splitSpeech('Langwort'.repeat(1000),6);
    assert(longParts.every(part=>part.length<=3000));
    assert.equal(longParts.join(''),'Langwort'.repeat(1000));

    saveSettings({...config,llmConcurrency:10,ttsConcurrency:1});
    llmPeak=0;
    const tenSentences=Array.from({length:10},(_,i)=>`Kurzer eindeutiger Satz Nummer ${i}.`).join(' ');
    const shortLlm=addArticle({title:'Short LLM',url:'',source:'test',original:tenSentences});
    const previousLlmCalls=llmCalls;
    await processArticle(shortLlm);
    assert.equal(llmPeak,10);
    assert.equal(llmCalls-previousLlmCalls,10);
    assert.equal(getArticle(shortLlm.id)!.script,splitText(tenSentences,3000,10).join('\n\n'));

    saveSettings({...config,ttsConcurrency:6});
    ttsPeak=0;
    const short=addArticle({title:'Short',url:'',source:'test',original:shortText});
    const previousTtsCalls=ttsCalls;
    await processArticle(short);
    assert.equal(ttsPeak,6);
    assert.equal(ttsCalls-previousTtsCalls,6);
    assert.equal(getArticle(short.id)!.status,'ready');
    const cachedCalls=ttsCalls;
    await processArticle(getArticle(short.id)!);
    assert.equal(ttsCalls,cachedCalls);
    const beforeReprocess={llm:llmCalls,tts:ttsCalls};
    const queued=reprocessArticle(short.id)!;
    assert.equal(queued.status,'queued');
    assert.equal(queued.script,'');
    assert.equal(queued.language,'');
    assert.equal(queued.audioBytes,0);
    assert.equal(queued.original,shortText);
    assert.throws(()=>reprocessArticle(short.id),/bereits verarbeitet/);
    const archives=readdirSync(join(articleDir(short.id),'previous'));
    assert.equal(archives.length,1);
    assert(readFileSync(join(articleDir(short.id),'previous',archives[0],'episode.mp3')).length>0);
    await processArticle(queued);
    assert.equal(llmCalls,beforeReprocess.llm+3);
    assert.equal(ttsCalls,beforeReprocess.tts+6);
    assert.equal(getArticle(short.id)!.status,'ready');
    // Recognition precedes processing and selects one voice for all chunks.
    saveSettings({...config,ttsConcurrency:2,languageVoices:{de:'german-voice',en:'english-voice'}});
    for(const [language,expected] of [['de','german-voice'],['en-US','english-voice'],['fr',config.voice],['und',config.voice]]) {
      detected=language;
      const item=addArticle({title:language,url:'',source:'test',original:`${language}: First sentence for recognition. Second sentence for parallel speech.`});
      const beforeDetection=detectionCalls;
      const beforeVoices=voices.length;
      await processArticle(item);
      assert.equal(detectionCalls,beforeDetection+1);
      assert.equal(getArticle(item.id)!.language,language.toLowerCase());
      assert.equal(JSON.parse(getArticle(item.id)!.recipe).voice,expected);
      assert.deepEqual(voices.slice(beforeVoices),[expected,expected]);
    }
    detected='de';
    const custom=addArticle({title:'Eigene Stimme',url:'',source:'test',original:'First sentence for recognition. Second sentence for parallel speech.'});
    const beforeCustom=voices.length;
    await processArticle(queueArticle(custom.id,'custom-reference'));
    assert.equal(getArticle(custom.id)!.voice,'custom-reference');
    assert.deepEqual(voices.slice(beforeCustom),['custom-reference','custom-reference']);
    const auto=reprocessArticle(custom.id,'');
    const beforeAuto=voices.length;
    await processArticle(auto);
    assert.deepEqual(voices.slice(beforeAuto),['german-voice','german-voice']);
  }finally{
    upstream.close();rmSync(dir,{recursive:true,force:true});
  }
});
