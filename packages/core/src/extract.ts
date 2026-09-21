import { lookup } from 'node:dns';
import { Agent, fetch } from 'undici';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { articleTextFromDocument } from './text';

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
// Validate the address used by the actual connection, not just a preceding DNS query.
const dispatcher = new Agent({connect: {lookup(hostname, options, callback) {
  lookup(hostname, {all: true}, (error, addresses) => {
    if (error) return callback(error, '', 4);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
      return callback(new Error('Private network addresses are blocked for article imports.'), '', 4);
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}}});
export async function extractArticle(input: string) {
  let url = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Please use a public HTTP(S) URL.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new Error('Private network addresses are blocked for article imports.');
    const response = await fetch(url, {dispatcher, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: {'User-Agent': 'redread/0.1 (article reader)'}});
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a destination.');
      url = new URL(location, url); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The website responded with HTTP ${response.status}. You can paste the text instead.`); }
    if (!response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('Only HTML articles are supported. Please paste the text directly.'); }
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        length += value.length;
        if (length > 5_000_000) throw new Error('The website is too large (maximum 5 MB).');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const dom = new JSDOM(Buffer.concat(chunks).toString('utf8'), {url: url.href});
    try {
      const parsed = new Readability(dom.window.document).parse();
      const content = new JSDOM(parsed?.content || '');
      let original: string;
      try { original = articleTextFromDocument(content.window.document); }
      finally { content.window.close(); }
      if (!original || original.length < 80) throw new Error('No readable article was found. Please paste the article text directly.');
      if (original.length > 200_000) throw new Error('The article is too long (maximum 200,000 characters).');
      return {title: (parsed?.title || url.hostname).slice(0,300), original, source: url.hostname.replace(/^www\./,''), url: url.href};
    } finally { dom.window.close(); }
  }
  throw new Error('Too many redirects.');
}
