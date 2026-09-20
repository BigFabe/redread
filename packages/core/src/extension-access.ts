// Only article creation accepts extension-origin writes. Other browser origins
// still need same-origin requests, including when they spoof the marker header.
export function extensionOrigin(request: Request): string | null {
  const origin=request.headers.get('origin');
  return origin && /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/i.test(origin) ? origin : null;
}
export function extensionImport(request: Request, path: string[]): boolean {
  return request.method==='POST' && path.length===1 && path[0]==='articles'
    && request.headers.get('x-redread-extension')==='1' && !!extensionOrigin(request);
}
