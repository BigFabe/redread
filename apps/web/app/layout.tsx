import type { Metadata } from 'next';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import './globals.css';
export const metadata: Metadata = {title: 'redread — Deine Artikel. Zum Hören.',description:'Deine persönliche Audiobibliothek. Artikel sammeln, aufbereiten und als Podcast hören.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="de"><body>{children}</body></html>;
}
