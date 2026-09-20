import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { articleTextFromDocument, normalizeArticleText } from '../packages/core/src/text';
import { resolveDataDir } from '../packages/core/src/data-path';
import { resolve } from 'node:path';

test('extracts paragraphs without HTML indentation or audio fallbacks', () => {
  const dom = new JSDOM(`<article>\n  <p>Ein <a href="/">verlinkter</a> Text\n mit Umbruch.</p>\n <audio>Audio fallback</audio><div hidden>Hidden</div><p>Zweiter Absatz.</p><ul><li>Eintrag eins</li><li>Eintrag zwei</li></ul></article>`);
  try { assert.equal(articleTextFromDocument(dom.window.document), 'Ein verlinkter Text mit Umbruch.\n\nZweiter Absatz.\n\nEintrag eins\n\nEintrag zwei'); }
  finally { dom.window.close(); }
});

test('normalizes existing imports without dropping article paragraphs', () => {
  assert.equal(normalizeArticleText(' Absatz eins.\n   \n\n  \n Ihr Browser unterstützt die Wiedergabe von Audio Dateien nicht. Download mp3: https://example.com/audio\n\n Absatz zwei. '), 'Absatz eins.\n\nAbsatz zwei.');
});

test('web and worker resolve the same database from root or workspaces', () => {
  const root = process.cwd();
  for (const cwd of [root, resolve(root, 'apps/web'), resolve(root, 'apps/worker')]) {
    assert.equal(resolveDataDir(cwd), resolve(root, 'data'));
    assert.equal(resolveDataDir(cwd, '/tmp/redread-test-data'), '/tmp/redread-test-data');
  }
});
