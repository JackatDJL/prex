import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './styles.css';

export const metadata: Metadata = {
  title: { default: 'Prex — Previews Extended', template: '%s | Prex' },
  description: 'Lokale Dev-Server mit freien Ports starten.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
