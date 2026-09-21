import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { articleTextFromDocument, normalizeArticleText } from '../packages/core/src/text';
import { resolveDataDir } from '../packages/core/src/data-path';
import { resolve } from 'node:path';

test('extracts paragraphs without HTML indentation or audio fallbacks', () => {
  const dom = new JSDOM(`<article>\n  <p>Some <a href="/">linked</a> text\n with a line break.</p>\n <audio>Audio fallback</audio><div hidden>Hidden</div><p>Second paragraph.</p><ul><li>Entry one</li><li>Entry two</li></ul></article>`);
  try { assert.equal(articleTextFromDocument(dom.window.document), 'Some linked text with a line break.\n\nSecond paragraph.\n\n-   Entry one\n-   Entry two'); }
  finally { dom.window.close(); }
});

function extract(html: string): string {
  const dom = new JSDOM(html);
  try { return articleTextFromDocument(dom.window.document); }
  finally { dom.window.close(); }
}

test('preserves table captions, headers, empty cells and multiline values', () => {
  const text = extract(`<table><caption>Quarterly figures</caption>
    <thead><tr><th>Area</th><th>Value</th></tr></thead>
    <tbody><tr><td>A | B</td><td>10<br>million</td></tr><tr><td>Unknown</td><td></td></tr></tbody></table>`);
  assert.equal(text, 'Quarterly figures\n\n| Area | Value |\n| --- | --- |\n| A \\| B | 10<br>million |\n| Unknown |  |');
});

test('keeps complex and headerless tables as inert HTML without losing cell relationships', () => {
  for (const html of [
    '<table><tr><td>A</td><td>10</td></tr></table>',
    '<table><tr><th colspan="2">Group</th></tr><tr><td rowspan="2">A</td><td>10</td></tr><tr><td>20</td></tr></table>',
    '<table><tr><th>A</th><th>B</th></tr><tr><td><table><tr><td>Inside</td><td>10</td></tr></table></td><td>20</td></tr></table>',
    '<table><thead><tr><th>A</th></tr><tr><th>B</th></tr></thead><tbody><tr><td>10</td></tr></tbody></table>',
  ]) {
    const text = extract(html);
    assert.match(text, /^<table>/);
    const original = new JSDOM(html), result = new JSDOM(text);
    try {
      const cells = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll('th,td'), cell => [cell.tagName, cell.textContent, cell.getAttribute('colspan'), cell.getAttribute('rowspan')]);
      assert.deepEqual(cells(result), cells(original));
    } finally { original.window.close(); result.window.close(); }
  }
  const text = extract('<table class="noise" onclick="bad()"><tr><td data-secret="secret"><a href="javascript:bad()">A &amp; B</a><script>bad()</script></td></tr></table>');
  assert.equal(text, '<table><tbody><tr><td>A &amp; B</td></tr></tbody></table>');
  assert.equal(extract('<table></table><p>Afterwards.</p>'), 'Afterwards.');
});

test('preserves headings, nested lists, quotes and code indentation without mutating the document', () => {
  const dom = new JSDOM('<h2>Result</h2><blockquote><p>An <strong>important</strong> quote.</p></blockquote><ol><li>First<ul><li>Detail</li></ul></li><li>Second</li></ol><pre><code class="language-python">if ready:\n    run()\n</code></pre><div hidden>Invisible</div>');
  try {
    const before = dom.window.document.body.innerHTML;
    const text = articleTextFromDocument(dom.window.document);
    assert.match(text, /^## Result/);
    assert.match(text, /> An \*\*important\*\* quote\./);
    assert.match(text, /1\.\s+First\n\s+-\s+Detail\n2\.\s+Second/);
    assert.match(text, /```python\nif ready:\n    run\(\)\n```/);
    assert(!text.includes('Invisible'));
    assert.equal(dom.window.document.body.innerHTML, before);
  } finally { dom.window.close(); }
});

test('Readability and Markdown conversion preserve an article table together', () => {
  const dom = new JSDOM(`<article><h1>Business figures</h1><p>${'The report explains the current business figures. '.repeat(20)}</p><table><caption>Revenue</caption><tr><th>Year</th><th>Euro</th></tr><tr><td>2025</td><td>100</td></tr><tr><td>2026</td><td>120</td></tr></table></article>`);
  try {
    const article = new Readability(dom.window.document).parse();
    assert(article?.content);
    const text = extract(article.content);
    assert.match(text, /Revenue/);
    assert.match(text, /\| Year \| Euro \|\n\| --- \| --- \|\n\| 2025 \| 100 \|\n\| 2026 \| 120 \|/);
  } finally { dom.window.close(); }
});

test('normalizes existing imports without dropping article paragraphs', () => {
  assert.equal(normalizeArticleText(' Paragraph one.\n   \n\n  \n Your browser does not support audio playback. Download mp3: https://example.com/audio\n\n Paragraph two. '), 'Paragraph one.\n\nParagraph two.');
});

test('web and worker resolve the same database from root or workspaces', () => {
  const root = process.cwd();
  for (const cwd of [root, resolve(root, 'apps/web'), resolve(root, 'apps/worker')]) {
    assert.equal(resolveDataDir(cwd), resolve(root, 'data'));
    assert.equal(resolveDataDir(cwd, '/tmp/redread-test-data'), '/tmp/redread-test-data');
  }
});
