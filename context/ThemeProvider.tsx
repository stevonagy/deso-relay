// context/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';
import { getItem, setItem } from '../lib/secureStore';

export type AppThemeMode = 'light' | 'dark';

type ThemeCtx = {
  mode: AppThemeMode;
  setMode: (m: AppThemeMode) => void;
  navTheme: Theme;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppThemeMode>('light');

  // Restore saved theme on start
  useEffect(() => {
    (async () => {
      const saved = (await getItem<string>('deso.theme')) as string | null;
      if (saved === 'dark' || saved === 'light') setMode(saved);
    })();
  }, []);

  const value = useMemo<ThemeCtx>(() => ({
    mode,
    setMode: (m) => { setMode(m); setItem('deso.theme', m).catch(() => {}); },
    navTheme: mode === 'dark' ? DarkTheme : DefaultTheme,
  }), [mode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}
