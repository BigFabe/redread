import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readArticleFile} from '../apps/web/app/file-import';

test('text file imports retain Unicode and Markdown structure',async()=>{
  const text='# Greetings\n\n- First\n  - Nested\n\n    code';
  assert.equal(await readArticleFile(new File(['\ufeff'+text], 'article.MD')),text);
  assert.equal(await readArticleFile(new File(['Plain article'], 'article.txt')),'Plain article');
});

test('reject unsupported, empty, binary and invalid UTF-8 documents',async()=>{
  for(const [name,content,message] of [
    ['article.docx','unsupported','TXT, Markdown or PDF'],
    ['empty.txt',' \n ','empty'],
    ['binary.txt','a\0b','binary data'],
  ])await assert.rejects(readArticleFile(new File([content],name)),new RegExp(message));
  await assert.rejects(readArticleFile(new File([new Uint8Array([0xff])],'bad.txt')),/UTF-8/);
});

test('enforce the existing article character limit and bound file reads',async()=>{
  assert.equal((await readArticleFile(new File(['é'.repeat(200_000)],'valid.txt'))).length,200_000);
  await assert.rejects(readArticleFile(new File(['a'.repeat(200_001)],'long.md')),/too long/);
  await assert.rejects(readArticleFile(new File([new Uint8Array(800_001)],'big.txt')),/too large/);
});
