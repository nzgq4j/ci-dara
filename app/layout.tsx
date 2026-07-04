import { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Footer from '@/components/ui/Footer';
import Navbar from '@/components/ui/Navbar';
import ChromeGate from '@/components/layout/ChromeGate';
import ThemeProvider from '@/components/layout/ThemeProvider';
import { Toaster } from '@/components/ui/Toasts/toaster';
import { PropsWithChildren, Suspense } from 'react';
import { getURL } from '@/utils/helpers';
import 'styles/main.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap'
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});

const title = 'DARA — Crucible Insight';
const description =
  'AI-powered proposal screening for acquisition professionals.';

export const metadata: Metadata = {
  metadataBase: new URL(getURL()),
  title: title,
  description: description,
  icons: {
    icon: '/dara-logo.png',
    shortcut: '/dara-logo.png',
    apple: '/dara-logo.png'
  },
  openGraph: {
    title: title,
    description: description
  }
};

export default async function RootLayout({ children }: PropsWithChildren) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${mono.variable}`}
    >
      <body className="bg-bg">
        <ThemeProvider>
          <ChromeGate navbar={<Navbar />} footer={<Footer />}>
            {children}
          </ChromeGate>
          <Suspense>
            <Toaster />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
