'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

// Drives the [data-theme] attribute on <html>. Dark is the default; the toggle
// (ThemeToggle) flips between 'dark' and 'light'. Tokens in styles/main.css /
// tailwind.config.js resolve against the active theme.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      themes={['light', 'dark']}
    >
      {children}
    </NextThemesProvider>
  );
}
