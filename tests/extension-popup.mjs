import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium,expect} from '@playwright/test';

const temp=await mkdtemp(join(tmpdir(),'redread-popup-'));
let healthy=true;
const server=createServer((req,res)=>{
  if(req.url==='/api/voices'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{name:'Erzähler',voice:'custom-reference'}]));
  }else if(req.url==='/api/health'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({app:healthy?'redread':'not-redread',ready:true}));
  }else{res.end('<html><title>Testartikel</title><body>Artikel</body></html>');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let context;
try{
  const dir=join(temp,'extension');await cp(resolve('apps/extension/dist/chrome'),dir,{recursive:true});
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  assert.equal(manifest.options_ui,undefined);
  // Test-only grant replaces the browser's native permission confirmation.
  manifest.host_permissions=['http://127.0.0.1/*'];
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(join(temp,'profile'),{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const articleCreated=context.waitForEvent('page');
  await worker.evaluate(url=>chrome.tabs.create({url,active:true}),base);
  await (await articleCreated).waitForLoadState();
  const created=context.waitForEvent('page');
  await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));
  const popup=await created;await popup.waitForLoadState();
  const input=popup.getByLabel('Adresse deiner redread-Webapp');
  await expect(input).toBeVisible();await expect(input).toHaveValue('');
  await expect(popup.locator('#article-view')).toBeHidden();
  await expect(popup.getByRole('button',{name:'Einstellungen',exact:true})).toBeHidden();
  await popup.screenshot({path:'/tmp/redread-popup-initial.png'});
  healthy=false;
  await input.fill(base);await popup.getByRole('button',{name:'Speichern & verbinden'}).click();
  await expect(popup.locator('#connection-status')).toContainText('kein redread-Server');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('serverUrl')).serverUrl),undefined);
  healthy=true;
  await popup.getByRole('button',{name:'Speichern & verbinden'}).click();
  await expect(popup.locator('#article-view')).toBeVisible();
  await expect(input).toBeHidden();
  await expect(popup.getByLabel('Stimme',{exact:true})).toBeVisible();
  await popup.getByLabel('Stimme',{exact:true}).selectOption('custom-reference');
  await expect(popup.getByLabel('Stimme',{exact:true})).toHaveValue('custom-reference');
  const pageCount=context.pages().length;
  await popup.getByRole('button',{name:'Einstellungen',exact:true}).click();
  await expect(input).toHaveValue(base);
  assert.equal(context.pages().length,pageCount,'Settings must not open another tab');
  await popup.getByRole('button',{name:'Zurück zum Artikel'}).click();
  await expect(popup.locator('#article-view')).toBeVisible();
  await popup.getByRole('button',{name:'Einstellungen',exact:true}).click();
  await popup.screenshot({path:'/tmp/redread-popup-settings.png'});
  await worker.evaluate(()=>chrome.storage.local.set({'submission:123':{state:'saved'}}));
  // Required test grants cannot be revoked. Assert the real popup requests
  // revocation; native optional permissions are used in the release manifest.
  await popup.evaluate(()=>{chrome.permissions.remove=async permissions=>{window.revokedOrigins=permissions.origins;return true;};});
  await popup.getByRole('button',{name:'Ausloggen',exact:true}).click();
  await expect(input).toHaveValue('');
  assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get(null)),{});
  assert.deepEqual(await popup.evaluate(()=>window.revokedOrigins),['http://127.0.0.1/*']);
  await popup.reload();await expect(input).toBeVisible();await expect(input).toHaveValue('');
  await expect(popup.locator('#article-view')).toBeHidden();
  console.log('Popup passed: initial URL field, failed/successful connection, inline settings, logout, persisted reset.');
}finally{
  await context?.close();server.close();await rm(temp,{recursive:true,force:true});
}
