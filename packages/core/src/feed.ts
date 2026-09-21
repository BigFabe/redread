import type { Article } from './types';
export const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function renderFeed(articles: Article[], base: string, title: string) {
  base=base.replace(/\/$/,'');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(title)}</title><link>${xml(base)}</link><description>Your articles. Ready to listen.</description><language>en</language>
<itunes:author>redread</itunes:author><itunes:explicit>false</itunes:explicit><itunes:image href="${xml(base)}/cover.png"/>
<atom:link href="${xml(base)}/feed.xml" rel="self" type="application/rss+xml"/>
${articles.filter(a=>a.status==='ready').map(a=>`<item><title>${xml(a.title)}</title><guid isPermaLink="false">urn:redread:${a.id}</guid><link>${xml(a.url || base)}</link><description>${xml(`${a.source}\n\n${a.original.slice(0,600)}`)}</description><pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate><enclosure url="${xml(base)}/api/articles/${a.id}/audio" length="${a.audioBytes}" type="audio/mpeg"/><itunes:duration>${Math.round(a.duration)}</itunes:duration></item>`).join('\n')}
</channel></rss>`;
}
