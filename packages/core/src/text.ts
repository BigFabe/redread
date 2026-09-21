/// <reference path="./turndown-plugin-gfm.d.ts" />
import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';

/** Normalize imported whitespace while retaining paragraph boundaries. */
export function normalizeArticleText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .filter(line => !/^Your browser does not support (?:the )?audio(?: playback| element)\./i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Keep structure from Readability for both URL imports and browser capture. */
export function articleTextFromDocument(document: Document): string {
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll('script,style,noscript,audio,video,iframe,form,input,textarea,select,button,img,svg,[contenteditable="true"],[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  const converter = new TurndownService({headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced'});
  converter.use(tables);
  // Keep link labels, without navigation URLs consuming the LLM context.
  converter.addRule('linkLabels', {filter: 'a', replacement: content => content});
  converter.addRule('tableCells', {
    filter: ['th', 'td'],
    replacement: (content, node) => `${node.previousElementSibling ? ' ' : '| '}${content.trim().replace(/\|/g, '\\|').replace(/ *\n\s*/g, '<br>')} |`,
  });
  // GFM cannot represent merged cells, nested tables or multiple header rows.
  // Keep those as minimal, inert HTML instead of silently changing their meaning.
  converter.addRule('complexTables', {
    filter: node => node.nodeName === 'TABLE' && !isSimpleTable(node as HTMLTableElement),
    replacement: (_content, node) => `\n\n${tableHtml(node)}\n\n`,
  });
  for (const table of body.querySelectorAll('table')) {
    if (!table.rows.length) { table.remove(); continue; }
    // Captions are not handled by the GFM plugin.
    if (table.caption) {
      const caption = document.createElement('p');
      caption.textContent = table.caption.textContent;
      table.before(caption);
      table.caption.remove();
    }
  }
  // Do not run the plain-text normalizer here: indentation is meaningful in
  // nested Markdown lists and code blocks.
  return converter.turndown(body).trim();
}

function isSimpleTable(table: HTMLTableElement): boolean {
  const rows = Array.from(table.rows);
  const first = rows[0];
  return !!first?.cells.length && Array.from(first.cells).every(cell => cell.tagName === 'TH')
    && !table.querySelector('table,[rowspan],[colspan]')
    && rows.slice(1).every(row => row.cells.length === first.cells.length && !row.querySelector('th') && row.parentElement?.tagName !== 'THEAD');
}

function tableHtml(node: Node): string {
  if (node.nodeType === 3) return (node.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const content = Array.from(node.childNodes).map(tableHtml).join('');
  if (tag === 'br') return '<br>';
  if (!['table','thead','tbody','tfoot','tr','th','td','caption','p','strong','em','code','pre','ul','ol','li','blockquote'].includes(tag)) return content;
  const attributes = ['th','td'].includes(tag) ? ['rowspan','colspan'].map(name => {
    const value = element.getAttribute(name);
    return value && /^\d+$/.test(value) ? ` ${name}="${value}"` : '';
  }).join('') : '';
  return `<${tag}${attributes}>${content}</${tag}>`;
}
