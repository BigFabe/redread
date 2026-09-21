import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@redread/core'],
  serverExternalPackages: ['jsdom', 'undici', 'pdf-parse', '@napi-rs/canvas'],
  poweredByHeader: false,
  experimental: {useTypeScriptCli: false},
};
export default config;
