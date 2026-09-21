import type { Metadata } from 'next';
import { settings } from '@redread/core/db';
export const dynamic = 'force-dynamic';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import './globals.css';
export const metadata: Metadata = {title: 'redread — Your articles. Ready to listen.',description:'Your personal audio library. Save and prepare articles, then listen to them as a podcast.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" data-theme={settings().theme} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"if(document.documentElement.dataset.theme==='auto'){document.documentElement.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}"}}/></head><body>{children}</body></html>;
}
