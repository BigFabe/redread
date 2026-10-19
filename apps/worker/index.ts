import { claimArticle, getArticle, failArticle, recoverJobs, settings } from '@redread/core/db';
import { processArticle } from '@redread/core/pipeline';

recoverJobs();
const initial = settings();
console.log(`redread worker ready: ${initial.articleConcurrency} articles, ${initial.llmConcurrency} LLM / ${initial.ttsConcurrency} TTS requests globally (one worker process supported)`);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const active = new Set<Promise<void>>();
while (!stopping) {
  while (!stopping && active.size < settings().articleConcurrency) {
    const article = claimArticle();
    if (!article) break;
    const job = (async () => {
      const controller = new AbortController();
      const checkCancellation = () => {
        if (getArticle(article.id)?.status === 'cancelling') controller.abort();
      };
      const cancellation = setInterval(checkCancellation, 100);
      try { checkCancellation(); await processArticle(article, controller.signal); }
      catch (error) {
        // Never persist upstream response bodies or headers: they can contain credentials.
        const message = error instanceof Error ? error.message : 'Processing failed.';
        failArticle(article.id, message.slice(0,1000));
        if (getArticle(article.id)?.status === 'failed') console.error('Article failed:', article.id);
      } finally { clearInterval(cancellation); }
    })();
    active.add(job);
    void job.then(() => active.delete(job));
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}
await Promise.all(active);
