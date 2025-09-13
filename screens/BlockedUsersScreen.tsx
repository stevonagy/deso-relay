// screens/BlockedUsersScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, TouchableOpacity, useColorScheme, ActivityIndicator, Alert } from 'react-native';
import { useSettings } from '../context/SettingsProvider';
import { Ionicons } from '@expo/vector-icons';
import { getItem, setItem } from '../lib/secureStore';

async function postJson(url: string, body: any, abortMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal as any,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as any;
      (err as any).body = text;
      throw err;
    }
    return json ?? {};
  } finally { clearTimeout(t); }
}

const isProbablyPk = (s: string) => /^BC1[PN][A-Za-z0-9]{10,}$/.test(s) || /^[A-Za-z0-9]{40,}$/.test(s);

export default function BlockedUsersScreen() {
  const { theme } = useSettings();
  const dark = theme === 'dark';
  const { nodeBase } = useSettings();

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  const [items, setItems] = useState<string[]>([]);               // stored identifiers (pk or @username)
  const [labels, setLabels] = useState<Record<string, string>>({}); // map id -> display label
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    const arr = (await getItem<string[]>('deso.blocked')) || [];
    const list = Array.isArray(arr) ? arr : [];
    setItems(list);
    // resolve human-readable labels
    setResolving(true);
    try {
      const entries = await Promise.all(list.map(async (id) => {
        if (!isProbablyPk(id)) {
          // looks like already a username (maybe with or without @)
          const uname = id.startsWith('@') ? id : `@${id}`;
          return [id, uname] as const;
        }
        try {
          const resp = await postJson(`${nodeBase}/api/v0/get-single-profile`, {
            PublicKeyBase58Check: id,
            NoErrorOnMissing: true,
          }, 12000);
          const uname = resp?.Profile?.Username ? `@${resp.Profile.Username}` : (id.slice(0, 6) + '…' + id.slice(-4));
          return [id, uname] as const;
        } catch {
          return [id, id.slice(0, 6) + '…' + id.slice(-4)] as const;
        }
      }));
      const map: Record<string,string> = {};
      entries.forEach(([id, label]) => { map[id] = label; });
      setLabels(map);
    } finally {
      setResolving(false);
    }
  }, [nodeBase]);

  useEffect(() => { load(); }, [load]);

  const unblock = useCallback(async (pkOrUser: string) => {
    const next = items.filter(x => x !== pkOrUser);
    setItems(next);
    const nextLabels = { ...labels };
    delete nextLabels[pkOrUser];
    setLabels(nextLabels);
    await setItem('deso.blocked', next);
    Alert.alert('Unblocked', labels[pkOrUser] || pkOrUser);
  }, [items, labels]);

  const Header = () => (
    <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>Blocked users</Text>
      </View>
      {resolving && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={{ color: colors.sub, marginLeft: 8, fontSize: 12 }}>Resolving usernames…</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <FlatList
        data={items}
        keyExtractor={(it) => it}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems:'center' }}>
            <Text style={{ color: colors.text }}>{labels[item] ?? item}</Text>
            <TouchableOpacity onPress={() => unblock(item)} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.accent, borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Unblock</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.sub, padding: 16 }}>No blocked users.</Text>}
      />
    </SafeAreaView>
  );
}
