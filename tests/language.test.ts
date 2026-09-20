import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {languageCode,languageVoices,parseDetectedLanguage,voiceForLanguage} from '../packages/core/src/language';

test('language codes, regional voice lookup and fallback',()=>{
  const voices=languageVoices({'EN-us':' american ','de':'german','en':'english'});
  assert.equal(languageCode(' EN-US '),'en-us');
  assert.equal(voiceForLanguage('en-US',voices,'default'),'american');
  assert.equal(voiceForLanguage('en-GB',voices,'default'),'english');
  assert.equal(voiceForLanguage('fr',voices,'default'),'default');
  assert.equal(voiceForLanguage('und',voices,''),'');
  for(const value of [[],null,{de:''},{de:4},{'Deutsch!':'voice'},{DE:'one',de:'two'}])assert.throws(()=>languageVoices(value));
});
test('detection accepts JSON or plain code, rejects unusable model replies',()=>{
  assert.equal(parseDetectedLanguage('{"language":"en-US"}'),'en-us');
  assert.equal(parseDetectedLanguage('```json\n{"language":"de"}\n```'),'de');
  assert.equal(parseDetectedLanguage('fr'),'fr');
  assert.equal(parseDetectedLanguage('{"language":"und"}'),'und');
  for(const text of ['German','The language is English.', '{"language":null}','{}',''])assert.throws(()=>parseDetectedLanguage(text));
});
test('voice mappings load from env, override temporarily and reset; old databases migrate',()=>{
  const dir=mkdtempSync(join(tmpdir(),'redread-language-'));
  const file=join(dir,'.env');
  const contents='TTS_LANGUAGE_VOICES=\'{"de":"env-german","en":"env-english"}\'\n';
  writeFileSync(file,contents);
  try {
    const script=`
      import assert from 'node:assert/strict';
      import {DatabaseSync} from 'node:sqlite';
      const db=new DatabaseSync(process.env.DATA_DIR+'/redread.sqlite');
      db.exec("CREATE TABLE articles(id TEXT PRIMARY KEY,title TEXT,url TEXT,source TEXT,original TEXT,script TEXT DEFAULT '',status TEXT DEFAULT 'draft',progress TEXT DEFAULT '',error TEXT DEFAULT '',createdAt TEXT,publishedAt TEXT DEFAULT '',duration REAL DEFAULT 0,audioBytes INTEGER DEFAULT 0,recipe TEXT DEFAULT '')");
      db.exec("INSERT INTO articles(id,title,original) VALUES('existing','Existing','Saved original')");
      db.close();
      const {settings,saveSettings,resetSettings,publicSettings,getArticle}=await import('./packages/core/src/db.ts');
      assert.equal(getArticle('existing').language,'');
      assert.equal(getArticle('existing').original,'Saved original');
      assert.deepEqual(settings().languageVoices,{de:'env-german',en:'env-english'});
      saveSettings({...settings()});
      assert(!publicSettings().overriddenFields.includes('languageVoices'));
      saveSettings({...settings(),languageVoices:{en:'temporary'}});
      assert.deepEqual(settings().languageVoices,{en:'temporary'});
      resetSettings();
      assert.deepEqual(settings().languageVoices,{de:'env-german',en:'env-english'});
    `;
    execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:{...process.env,DATA_DIR:dir,REDREAD_ENV_FILE:file,TTS_LANGUAGE_VOICES:undefined}});
    assert.equal(readFileSync(file,'utf8'),contents);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
