export const sessionPlaceholder = '{{session_id}}';
export const legacyOpenCodeHeaders = {'x-opencode-session': `ses_${sessionPlaceholder}`, 'user-agent': 'Redread/0.1'};

const reserved = new Set(['authorization', 'host', 'cookie', 'content-type', 'content-length', 'content-encoding', 'connection', 'keep-alive', 'expect', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'forwarded']);

export function parseLlmHeaders(input: string): Record<string, string> {
  let data: unknown;
  try { data = JSON.parse(input); }
  catch { throw new Error('Enter headers as a JSON object, for example {"X-Client": "redread"}.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Headers must be a JSON object.');
  const entries = Object.entries(data);
  if (entries.length > 16) throw new Error('Use no more than 16 custom headers.');
  const headers = new Map<string, string>();
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (!name || name.length > 80 || /[^!#$%&'*+.^_`|~0-9a-z-]/.test(name)) throw new Error('Enter valid HTTP header names.');
    if (reserved.has(name) || /^(proxy-|x-forwarded-)/.test(name)) throw new Error(`The ${name} header is managed by Redread or the HTTP client.`);
    if (headers.has(name)) throw new Error('Use each header name only once.');
    if (typeof value !== 'string' || value.length > 2048 || /[^\x20-\x7e]/.test(value) || !value.trim()) throw new Error('Header values must be non-empty strings of up to 2,048 printable ASCII characters.');
    headers.set(name, value.trim());
  }
  return Object.fromEntries(headers);
}
