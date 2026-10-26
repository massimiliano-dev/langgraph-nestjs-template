import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Agent chat',
  description: 'Minimal chat for the LangGraph + NestJS agent template',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#fafafa', color: '#111' }}>
        {children}
      </body>
    </html>
  );
}
