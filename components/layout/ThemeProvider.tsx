'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

// Drives the [data-theme] attribute on <html>. The MVP is light-theme only: forcedTheme
// pins every session to the navy/gold light theme (the ThemeToggle has been removed).
// Tokens in styles/main.css / tailwind.config.js resolve against the active theme.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="light"
      forcedTheme="light"
      enableSystem={false}
      themes={['light', 'dark']}
    >
      {children}
    </NextThemesProvider>
  );
}
