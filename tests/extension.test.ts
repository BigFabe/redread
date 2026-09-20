import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {buildSync} from 'esbuild';
const source=buildSync({entryPoints:['apps/extension/src/capture.ts'],bundle:true,write:false,format:'iife',globalName:'RedreadCapture',footer:{js:'RedreadCapture.capture();'}}).outputFiles[0].text;

test('browser extraction preserves article text and leaves the original DOM untouched',()=>{
  const paragraphs=['Der erste Abschnitt eines lesenswerten Artikels. '.repeat(12),'Der zweite Abschnitt enthält weitere interessante Informationen. '.repeat(12)];
  const dom=new JSDOM(`<html><head><title>Ein Artikel</title></head><body><nav>Navigation entfernen</nav><article><h1>Ein Artikel</h1><p>${paragraphs[0]}</p><p>${paragraphs[1]}</p><form><input value="secret-value"><textarea>private form content</textarea></form><script>window.pageExecuted=true;</script></article></body></html>`,{url:'https://example.com/article#section',runScripts:'outside-only'});
  try{
    const before=dom.window.document.documentElement.outerHTML;
    const captured=dom.window.eval(source);
    assert.equal(captured.url,'https://example.com/article');assert.equal(captured.title,'Ein Artikel');
    assert(captured.text.includes(paragraphs[0].trim()));assert(captured.text.includes(paragraphs[1].trim()));assert(captured.text.includes('\n\n'));
    assert(!captured.text.includes('secret-value'));assert(!captured.text.includes('private form content'));assert(!captured.text.includes('pageExecuted'));
    assert.equal(dom.window.document.documentElement.outerHTML,before);
  }finally{dom.window.close();}
});
test('browser extraction rejects empty and unsupported pages',()=>{
  for(const [url,html] of [['https://example.com','<body>Hi</body>'],['file:///tmp/file.html','<body>Some article</body>']]){
    const dom=new JSDOM(html,{url,runScripts:'outside-only'});
    try{assert.throws(()=>dom.window.eval(source));}finally{dom.window.close();}
  }
});
test('release packages use minimal permissions and browser-specific backgrounds',()=>{
  for(const browser of ['chrome','firefox']){
    const manifest=JSON.parse(readFileSync(`apps/extension/dist/${browser}/manifest.json`,'utf8'));
    assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);
    assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.externally_connectable,undefined);
    if(browser==='chrome')assert.equal(manifest.background.service_worker,'background.js');
    else{assert.deepEqual(manifest.background.scripts,['background.js']);assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required,['websiteContent','browsingActivity']);}
  }
});
