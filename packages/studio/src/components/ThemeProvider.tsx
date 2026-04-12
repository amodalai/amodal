/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface ThemeContextValue {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ dark: false, toggle: () => {} });

const THEME_KEY = 'studio-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark =
      stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle('dark', prefersDark);
  }, []);

  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
