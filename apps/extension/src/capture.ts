import { Readability } from '@mozilla/readability';
import type { Capture } from './shared';
import { articleTextFromDocument } from '../../../packages/core/src/text';

export function capture():Capture {
  if(!['http:','https:'].includes(location.protocol)) throw new Error('This page cannot be saved as an article.');
  const documentCopy=document.cloneNode(true) as Document;
  // Remove private inputs before article extraction. The result is Markdown
  // with minimal inert HTML only for tables Markdown cannot represent.
  documentCopy.querySelectorAll('script,style,form,input,textarea,select,[contenteditable="true"]').forEach(node=>node.remove());
  const article=new Readability(documentCopy,{charThreshold:80}).parse();
  if(!article?.content)throw new Error('No article was found. You can paste the text directly into the web app.');
  const parsed=new DOMParser().parseFromString(article.content,'text/html');
  const text=articleTextFromDocument(parsed);
  if(text.length<80)throw new Error('Too little article text was found. Please open an article page.');
  if(text.length>200000)throw new Error('The article is too long (maximum 200,000 characters). Please paste shorter sections into the web app.');
  const url=new URL(location.href);url.hash='';url.username='';url.password='';
  return {title:(article.title||document.title||url.hostname).slice(0,300),url:url.href,text};
}
