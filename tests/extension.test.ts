import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {buildSync} from 'esbuild';
const source=buildSync({entryPoints:['apps/extension/src/capture.ts'],bundle:true,write:false,format:'iife',globalName:'RedreadCapture',footer:{js:'RedreadCapture.capture();'}}).outputFiles[0].text;

test('browser extraction preserves article text and leaves the original DOM untouched',()=>{
  const paragraphs=['The first section of an article worth reading. '.repeat(12),'The second section contains more interesting information. '.repeat(12)];
  const dom=new JSDOM(`<html><head><title>An article</title></head><body><nav>Remove navigation</nav><article><h1>An article</h1><p>${paragraphs[0]}</p><p>${paragraphs[1]}</p><form><input value="secret-value"><textarea>private form content</textarea></form><script>window.pageExecuted=true;</script></article></body></html>`,{url:'https://example.com/article#section',runScripts:'outside-only'});
  try{
    const before=dom.window.document.documentElement.outerHTML;
    const captured=dom.window.eval(source);
    assert.equal(captured.url,'https://example.com/article');assert.equal(captured.title,'An article');
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
test('browser capture retains table structure for LLM processing',()=>{
  const dom=new JSDOM(`<article><h1>Results</h1><p>${'This report compares the results from two years. '.repeat(20)}</p><table><tr><th>Year</th><th>Value</th></tr><tr><td>2025</td><td>100</td></tr><tr><td>2026</td><td>120</td></tr></table></article>`,{url:'https://example.com/report',runScripts:'outside-only'});
  try{
    const captured=dom.window.eval(source);
    assert.match(captured.text,/\| Year \| Value \|\n\| --- \| --- \|\n\| 2025 \| 100 \|\n\| 2026 \| 120 \|/);
  }finally{dom.window.close();}
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
