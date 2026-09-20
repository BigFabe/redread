/** Normalize imported whitespace while retaining paragraph boundaries. */
export function normalizeArticleText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .filter(line => !/^Ihr Browser unterstützt die Wiedergabe von Audio Dateien nicht\./i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Readability HTML still contains formatting whitespace and media fallbacks. */
export function articleTextFromDocument(document: Document): string {
  document.querySelectorAll('script,style,audio,video,iframe,form,button,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  const blocks = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','TR','FIGCAPTION']);
  function walk(node: Node): string {
    if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const content = Array.from(node.childNodes).map(walk).join('');
    return blocks.has(element.tagName) ? `\n\n${content}\n\n` : content;
  }
  return normalizeArticleText(walk(document.body));
}
