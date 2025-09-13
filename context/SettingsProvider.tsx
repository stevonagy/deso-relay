// context/SettingsProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { getItem, setItem } from '../lib/secureStore';
import { setNodeBase as setNodeBaseInLib, getNodeBase as getNodeBaseFromLib } from '../lib/deso';

type ThemeMode = 'light' | 'dark';
type Ctx = {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  nodeBase: string;
  setNodeBase: (url: string) => void;
};

const Ctx = createContext<Ctx>({} as any);
export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [nodeBase, setNodeBaseState] = useState<string>('https://desocialworld.com');

  useEffect(() => {
    (async () => {
      try {
        const t = await getItem<string>('app.theme');
        if (t === 'light' || t === 'dark') setThemeState(t);
      } catch {}
      try {
        const nb = await getItem<string>('app.nodeBase');
        if (nb) setNodeBaseState(nb);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    // Sync lib/deso base
    try { setNodeBaseInLib(nodeBase); } catch {}
  }, [nodeBase]);

  const setTheme = (m: ThemeMode) => {
    setThemeState(m);
    setItem('app.theme', m).catch(()=>{});
  };
  const setNodeBase = (url: string) => {
    setNodeBaseState(url);
    setItem('app.nodeBase', url).catch(()=>{});
  };

  const value = useMemo(() => ({ theme, setTheme, nodeBase, setNodeBase }), [theme, nodeBase]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
