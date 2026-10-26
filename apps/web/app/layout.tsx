import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Next, Barlow_Semi_Condensed } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Fonts are downloaded at build time and served from this origin (CSP font-src 'self').
const text = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--font-text', display: 'swap' });
const cond = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cond',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agent chat',
  description: 'Chat with the agent. Actions that change something wait for your approval.',
};

export const viewport: Viewport = {
  themeColor: '#1c2530',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${text.variable} ${cond.variable}`}>
      <body>{children}</body>
    </html>
  );
}
