import { Readability } from '@mozilla/readability';
import type { Capture } from './shared';

export function capture():Capture {
  if(!['http:','https:'].includes(location.protocol)) throw new Error('Diese Seite kann nicht als Artikel gespeichert werden.');
  const documentCopy=document.cloneNode(true) as Document;
  // No input values, forms, scripts or page HTML leave the browser.
  documentCopy.querySelectorAll('script,style,form,input,textarea,select,[contenteditable="true"]').forEach(node=>node.remove());
  const article=new Readability(documentCopy,{charThreshold:80}).parse();
  if(!article?.content)throw new Error('Keinen Artikel gefunden. Du kannst den Text direkt in der Webapp einfügen.');
  const parsed=new DOMParser().parseFromString(article.content,'text/html');
  parsed.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,br').forEach(node=>node.appendChild(parsed.createTextNode('\n\n')));
  const text=(parsed.body.textContent||'').replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(text.length<80)throw new Error('Zu wenig Artikeltext gefunden. Bitte eine Artikelseite öffnen.');
  if(text.length>200000)throw new Error('Der Artikel ist zu lang (maximal 200.000 Zeichen). Bitte kürzere Abschnitte in der Webapp einfügen.');
  const url=new URL(location.href);url.hash='';url.username='';url.password='';
  return {title:(article.title||document.title||url.hostname).slice(0,300),url:url.href,text};
}
