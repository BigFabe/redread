import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {customVoices} from '../packages/core/src/voices';

test('named voices validate, trim and reject duplicate names',()=>{
  assert.deepEqual(customVoices([{name:' Erzähler ',voice:' id '}]),[{name:'Erzähler',voice:'id'}]);
  for(const value of [null,{},[{name:'',voice:'id'}],[{name:'Name',voice:''}],[{name:'A',voice:'one'},{name:'a',voice:'two'}],Array(101).fill({name:'A',voice:'id'})])assert.throws(()=>customVoices(value));
});
test('named voices load from env and reset temporary settings; selected voice survives settings reset',()=>{
  const dir=mkdtempSync(join(tmpdir(),'redread-voices-'));const file=join(dir,'.env');
  const contents='TTS_CUSTOM_VOICES=\'[{"name":"Erzähler","voice":"env-id"}]\'\n';writeFileSync(file,contents);
  try{
    execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`
      import assert from 'node:assert/strict';
      const {settings,saveSettings,resetSettings,addArticle,queueArticle,getArticle}=await import('./packages/core/src/db.ts');
      assert.deepEqual(settings().customVoices,[{name:'Erzähler',voice:'env-id'}]);
      saveSettings({...settings(),llmModel:'test',ttsModel:'test',customVoices:[{name:'Temporär',voice:'temp-id'}]});
      assert.equal(settings().customVoices[0].voice,'temp-id');
      const article=addArticle({title:'Test',url:'',source:'test',original:'Test'});
      assert.equal(article.voice,'');
      queueArticle(article.id,'temp-id');resetSettings();
      assert.equal(settings().customVoices[0].voice,'env-id');
      assert.equal(getArticle(article.id).voice,'temp-id');
    `],{env:{...process.env,DATA_DIR:dir,REDREAD_ENV_FILE:file,TTS_CUSTOM_VOICES:undefined}});
    assert.equal(readFileSync(file,'utf8'),contents);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
