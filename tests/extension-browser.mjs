import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium,firefox,expect} from '@playwright/test';
const temp=await mkdtemp(join(tmpdir(),'redread-extension-'));
const base='http://127.0.0.1:3212';
const results=new Map();let serverLogs='';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(100);}throw new Error('Timed out\n'+serverLogs);}
const fixture=createServer(async(req,res)=>{
  if(req.url.startsWith('/result/')){let text='';for await(const c of req)text+=c;results.set(req.url.split('/').pop(),JSON.parse(text));res.end('ok');return;}
  res.setHeader('Content-Type','text/html');
  res.end(`<!doctype html><html lang="de"><head><title>Ein echter Browserartikel</title></head><body><nav>Navigation</nav><article><h1>Ein echter Browserartikel</h1><p>${'Ein interessanter Artikel über Browsererweiterungen und Podcasts. '.repeat(30)}</p><form><input value="do-not-send-me"></form></article><script>document.querySelector('article').append(Object.assign(document.createElement('p'),{textContent:'Dieser Absatz wurde erst im Browser erzeugt.'}));</script></body></html>`);
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const fixtureUrl=`http://127.0.0.1:${fixture.address().port}`;
const web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3212'],{env:{...process.env,DATA_DIR:join(temp,'data'),REDREAD_ENV_FILE:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
web.stdout.on('data',b=>serverLogs+=b);web.stderr.on('data',b=>serverLogs+=b);
const children=[];
try{
  await until(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}});
  const config=await(await fetch(base+'/api/settings')).json();
  const setup=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,llmModel:'test-only-no-worker',ttsModel:'test-only-no-worker'})});assert(setup.ok);
  for(const browser of ['chrome','firefox']){
    const dir=join(temp,browser);await cp(resolve(`apps/extension/dist/${browser}`),dir,{recursive:true});
    // Test-only host grants replace clicking the browser toolbar/permission prompt
    // in headless mode. Neither grant nor harness is included in release archives.
    const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
    manifest.host_permissions=['http://127.0.0.1/*'];
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
    const entry=`
      import {submitTab,checkConnection} from './background';
      import {ext} from './shared';
      (async()=>{
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        let result;
        try{
          await ext.storage.local.set({serverUrl:${JSON.stringify(base)}});
          const connection=await checkConnection();if(!connection.ready)throw new Error('Health check failed');
          const tab=await ext.tabs.create({url:${JSON.stringify(fixtureUrl+'/article')},active:true});
          for(let i=0;i<100;i++){const loaded=await ext.tabs.get(tab.id);if(loaded.status==='complete'&&loaded.url===${JSON.stringify(fixtureUrl+'/article')})break;await sleep(50);}
          const [first,second]=await Promise.all([submitTab(tab.id),submitTab(tab.id)]);
          if(first.state!=='saved'||first.articleId!==second.articleId)throw new Error(first.message||'Duplicate import');
          const article=await(await fetch(${JSON.stringify(base)}+'/api/articles/'+first.articleId)).json();
          if(article.status!=='queued')throw new Error('Processing not queued: '+article.status);
          if(!article.original.includes('Dieser Absatz wurde erst im Browser erzeugt.'))throw new Error('Rendered DOM was not captured');
          if(article.original.includes('do-not-send-me'))throw new Error('Form value leaked');
          const repeat=await submitTab(tab.id);if(repeat.articleId!==first.articleId)throw new Error('Repeated submit duplicated');
          const state=await ext.storage.local.get('submission:'+tab.id);if(state['submission:'+tab.id].state!=='saved')throw new Error('Status missing');
          result={ok:true,id:first.articleId,title:article.title,popup:ext.runtime.getURL('popup.html'),options:ext.runtime.getURL('options.html')};
        }catch(error){result={ok:false,error:error.message};}
        await fetch(${JSON.stringify(fixtureUrl+'/result/'+browser)},{method:'POST',body:JSON.stringify(result)});
      })();
    `;
    await build({stdin:{contents:entry,resolveDir:resolve('apps/extension/src'),loader:'ts'},bundle:true,format:'iife',outfile:join(dir,'background.js'),target:['chrome120','firefox142']});
    if(browser==='chrome'){
      const context=await chromium.launchPersistentContext(join(temp,'chrome-profile'),{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});
      try{
        await until(()=>results.has(browser));assert.equal(results.get(browser).ok,true,JSON.stringify(results.get(browser)));
        const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
        // Open extension UI in inactive tabs so the article remains the active tab.
        const popupCreated=context.waitForEvent('page');
        await worker.evaluate(url=>chrome.tabs.create({url,active:false}),results.get(browser).popup);
        const popup=await popupCreated;await popup.waitForLoadState();
        await expect(popup.getByRole('heading',{name:'Ein echter Browserartikel'})).toBeVisible();
        await expect(popup.getByRole('button',{name:'✓ In deiner Bibliothek'})).toBeDisabled();
        await expect(popup.getByRole('link',{name:'Artikel in redread öffnen ↗'})).toHaveAttribute('href',new RegExp('article='+results.get(browser).id));
        await popup.screenshot({path:'/tmp/redread-extension-popup.png'});
        const options=await context.newPage();await options.goto(results.get(browser).options);
        await expect(options.getByLabel('Adresse deiner redread-Webapp')).toHaveValue(base);
        await options.getByRole('button',{name:'Speichern & verbinden'}).click();
        await expect(options.getByRole('status')).toContainText('Verbunden.');
        await options.screenshot({path:'/tmp/redread-extension-options.png'});
      }finally{await context.close();}
    }else{
      const runner=spawn(process.execPath,['node_modules/web-ext/bin/web-ext.js','run','--source-dir',dir,'--firefox',process.env.FIREFOX_PATH||firefox.executablePath(),'--no-reload','--no-input','--no-config-discovery','--args=-headless'],{stdio:['ignore','pipe','pipe']});children.push(runner);
      let log='';runner.stdout.on('data',b=>log+=b);runner.stderr.on('data',b=>log+=b);
      try{await until(()=>results.has(browser));assert.equal(results.get(browser).ok,true,JSON.stringify(results.get(browser)));}
      catch(error){throw new Error(`${error.message}\nFirefox: ${log}`);}
    }
    console.log(`${browser}: real extension APIs passed extraction, background upload, process queue, duplicate guard and persisted status.`);
  }
  const articles=await(await fetch(base+'/api/articles')).json();assert.equal(articles.length,2);
}finally{
  for(const child of children)child.kill('SIGTERM');
  if(web.exitCode===null){const exit=once(web,'exit');web.kill('SIGTERM');await exit;}
  fixture.close();await sleep(500);await rm(temp,{recursive:true,force:true});
}
