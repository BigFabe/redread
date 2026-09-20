import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@redread/core'],
  serverExternalPackages: ['jsdom', 'undici'],
  poweredByHeader: false,
};
export default config;
