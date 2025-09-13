// screens/NodesScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getItem, setItem } from '../lib/secureStore';

const NODES = [
  { label: 'node.deso.org', value: 'https://node.deso.org' },
{ label: 'focus.xyz', value: 'https://focus.xyz/' },
  { label: 'desocialworld.com', value: 'https://desocialworld.com' }, // default
  { label: 'safetynet.social', value: 'https://safetynet.social' },
];

export default function NodesScreen() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  const [current, setCurrent] = useState<string>('https://desocialworld.com');

  useEffect(() => { (async () => {
    const saved = (await getItem<string>('deso.nodeBase')) as string | null;
    if (saved) setCurrent(saved);
  })(); }, []);

  const onPick = async (val: string) => {
    setCurrent(val);
    await setItem('deso.nodeBase', val); // picked node persists
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 12 }}>Nodes</Text>
      {NODES.map((n) => {
        const active = current === n.value;
        return (
          <TouchableOpacity key={n.value} onPress={() => onPick(n.value)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border }}>
            <View style={{ width: 18, height: 18, marginRight: 10, borderRadius: 9, borderWidth: 2, borderColor: active ? '#2ecc71' : colors.border, backgroundColor: active ? '#2ecc71' : 'transparent' }} />
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: active ? '700' : '500' }}>{n.label}</Text>
            {active && <Ionicons name="checkmark-circle" size={18} color="#2ecc71" style={{ marginLeft: 8 }} />}
          </TouchableOpacity>
        );
      })}
      <Text style={{ color: colors.sub, marginTop: 12 }}>The green dot marks the currently active node.</Text>
    </SafeAreaView>
  );
}
