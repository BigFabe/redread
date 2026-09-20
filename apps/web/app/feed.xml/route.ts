import { listArticles, settings } from '@redread/core/db';
import { renderFeed } from '@redread/core/feed';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request: Request) {
  const s=settings();
  const base=s.publicUrl || process.env.PUBLIC_URL || new URL(request.url).origin;
  return new Response(renderFeed(listArticles(),base,s.feedTitle),{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-cache'}});
}
