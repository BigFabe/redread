import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base=process.env.TEST_URL || 'http://127.0.0.1:3210';
const temp=mkdtempSync(join(tmpdir(),'redread-version-browser-'));
execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-codec:a','libmp3lame',join(temp,'test.mp3')]);
const audio=readFileSync(join(temp,'test.mp3'));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const id='00000000-0000-0000-0000-000000000001';
let article={id,title:'Schlangengraben (Beetzsee)',url:'',source:'Test library',original:'The original article.',script:'The existing listening text.',language:'de',voice:'voice-one',status:'ready',error:'',progress:'',createdAt:'2026-01-01T12:00:00.000Z',publishedAt:'2026-01-03T12:00:00.000Z',duration:60,audioBytes:audio.length,recipe:''};
const versions=[{versionId:'00000000-0000-0000-0000-000000000002',publishedAt:'2026-01-02T12:00:00.000Z',duration:60,audioBytes:audio.length,voice:'voice-two'},{versionId:'00000000-0000-0000-0000-000000000003',publishedAt:'2026-01-01T12:00:00.000Z',duration:60,audioBytes:audio.length,voice:'voice-one'}];
const submissions=[];let failNext=false;
try {
  const settings={...await (await page.request.get(base+'/api/settings')).json(),llmModel:'test',ttsModel:'test',theme:'dark',customVoices:[{name:'First voice',voice:'voice-one'},{name:'Second voice',voice:'voice-two'}]};
  // All browser API calls are mocked: no real articles, settings or model jobs are changed.
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=body=>route.fulfill({json:body});
    if(path==='/api/settings')return json(settings);
    if(path==='/api/articles')return json([{...article,excerpt:article.script,wordCount:4,hasScript:!!article.script}]);
    if(path===`/api/articles/${id}`)return json(article);
    if(path.endsWith('/versions'))return json(versions);
    if(path.endsWith('/audio'))return route.fulfill({contentType:'audio/mpeg',body:audio});
    if(path.endsWith('/reprocess')){
      const body=route.request().postDataJSON();submissions.push(body);
      if(failNext){failNext=false;return route.fulfill({status:500,json:{error:'Test generation failure'}});}
      article={...article,status:'queued',progress:'Reprocessing',script:body.mode==='all'?'':article.script,voice:body.voice};
      return json(article);
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  await page.goto(`${base}/?article=${id}`);
  const reader=page.getByRole('dialog',{name:'In your library',exact:true});
  await expect(reader).toBeVisible();
  await expect(reader.getByLabel('Voice',{exact:true})).toHaveCount(0);
  await reader.getByRole('button',{name:'Reprocess',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Create a new version',exact:true});
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('radio',{name:/Audio only/})).toBeChecked();
  await expect(popup.getByLabel('Voice',{exact:true})).toHaveValue('voice-one');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);await expect(reader).toBeVisible();
  expect(submissions).toHaveLength(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await reader.getByRole('button',{name:'Reprocess',exact:true}).click();
  await popup.getByLabel('Voice',{exact:true}).selectOption('voice-two');
  await page.screenshot({path:'/tmp/redread-reprocess-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(popup.getByRole('button',{name:'Recreate audio',exact:true})).toBeVisible();
  expect(await popup.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
  await page.screenshot({path:'/tmp/redread-reprocess-mobile.png'});
  failNext=true;
  await popup.getByRole('button',{name:'Recreate audio',exact:true}).click();
  await expect(popup.getByRole('alert')).toHaveText('Test generation failure');
  await popup.getByRole('button',{name:'Recreate audio',exact:true}).click();
  await expect(popup).toHaveCount(0);
  expect(submissions.at(-1)).toEqual({voice:'voice-two',mode:'audio'});
  expect(article.script).toBe('The existing listening text.');
  await reader.locator('summary').click();
  await expect(reader.getByText('Previous versions')).toBeVisible();
  await page.screenshot({path:'/tmp/redread-versions-mobile.png'});
  await reader.getByRole('button',{name:/Listen to version/}).first().click();
  await expect(page.locator('.player-bar audio')).toHaveAttribute('src',`/api/articles/${id}/audio?version=${versions[0].versionId}`);
  await page.getByRole('button',{name:`Open article: ${article.title}`,exact:true}).last().click();
  await reader.locator('summary').click();
  await reader.getByRole('button',{name:/Listen to version/}).last().click();
  await expect(page.locator('.player-bar audio')).toHaveAttribute('src',`/api/articles/${id}/audio?version=${versions[1].versionId}`);
  article={...article,status:'ready'};
  await page.getByRole('button',{name:`Open article: ${article.title}`,exact:true}).last().click();
  await reader.getByRole('button',{name:/Listen ·/}).click();
  await expect(page.locator('.player-bar audio')).toHaveAttribute('src',`/api/articles/${id}/audio?v=${encodeURIComponent(article.publishedAt)}`);
  await page.getByRole('button',{name:`Open article: ${article.title}`,exact:true}).last().click();
  await reader.getByRole('button',{name:'Reprocess',exact:true}).click();
  await popup.getByRole('radio',{name:/Text \+ audio/}).check();
  await popup.getByLabel('Voice',{exact:true}).selectOption('');
  await popup.getByRole('button',{name:'Recreate text + audio',exact:true}).click();
  await expect(popup).toHaveCount(0);
  expect(submissions.at(-1)).toEqual({voice:'',mode:'all'});expect(article.script).toBe('');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
  expect(errors).toEqual([]);
  console.log('Browser checks passed: popup, voice selection, both modes, error recovery, archived playback switching, and mobile layout.');
} finally {
  await browser.close();rmSync(temp,{recursive:true,force:true});
}
