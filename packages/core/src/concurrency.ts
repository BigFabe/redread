export function createLimiter(limit: number | (() => number)) {
  const getLimit = () => typeof limit === 'function' ? limit() : limit;
  if (!Number.isInteger(getLimit()) || getLimit() < 1) throw new Error('Concurrency must be a positive integer.');
  let active = 0;
  const waiting: (() => void)[] = [];
  function pump() {
    while (waiting.length && active < getLimit()) {
      active++;
      waiting.shift()!();
    }
  }
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => { waiting.push(resolve); pump(); });
    try { return await task(); }
    finally { active--; pump(); }
  };
}

// Keep input order; after a failure, stop scheduling and drain running tasks
// before the caller marks the article failed or allows a retry/deletion.
export async function mapConcurrent<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency must be a positive integer.');
  const result = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { result[index] = await task(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return result;
}
