// screens/DesoUserSearchScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  useColorScheme,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';

const NODE = 'https://node.deso.org';

async function postJson(url: string, body: any, signal?: AbortSignal, abortMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: signal ?? (ctrl.signal as any),
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
  } finally { clearTimeout(timer); }
}

type ProfileLite = {
  Username: string;
  PublicKeyBase58Check: string;
  Description?: string;
  ProfilePic?: string;
  ExtraData?: Record<string, any>;
};

export default function DesoUserSearchScreen() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProfileLite[]>([]);

  // lifecycle + network guards
  const mounted = useRef(true);
  const navAway = useRef(false);
  const inFlightCtrl = useRef<AbortController | null>(null);
  const reqSeq = useRef(0);
  const debounceTimer = useRef<any>(null);

  useEffect(() => {
    mounted.current = true;
    navAway.current = false;
    return () => {
      mounted.current = false;
      navAway.current = true;
      if (inFlightCtrl.current) {
        try { inFlightCtrl.current.abort(); } catch {}
        inFlightCtrl.current = null;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const colors = useMemo(() => ({
    bg: dark ? '#0a0a0a' : '#ffffff',
    text: dark ? '#ffffff' : '#111111',
    dim: dark ? '#bdbdbd' : '#666666',
    border: dark ? '#222222' : '#e2e2e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    card: dark ? '#141414' : '#f7f7f9',
  }), [dark]);

  const performPrefixSearch = useCallback(async (prefixRaw: string) => {
    const prefix = (prefixRaw || '').trim().replace(/^@/, '');
    if (!prefix) { setResults([]); setError(null); return; }

    // cancel previous request
    if (inFlightCtrl.current) {
      try { inFlightCtrl.current.abort(); } catch {}
    }
    const ctrl = new AbortController();
    inFlightCtrl.current = ctrl;

    const mySeq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      // DeSo username prefix search
      const resp: any = await postJson(`${NODE}/api/v0/get-profiles`, {
        UsernamePrefix: prefix,
        NumToFetch: 25,
        SkipForLeaderboard: true,
      }, ctrl.signal, 15000);

      if (!mounted.current || mySeq !== reqSeq.current) return; // stale

      const arr = (resp?.ProfilesFound || resp?.Profiles || [])
        .filter(Boolean)
        .map((p: any) => ({
          Username: p?.Username,
          PublicKeyBase58Check: p?.PublicKeyBase58Check,
          Description: p?.Description,
          ProfilePic: p?.ProfilePic || p?.ExtraData?.LargeProfilePicURL,
          ExtraData: p?.ExtraData || {},
        }))
        .filter((p: ProfileLite) => !!p.Username);

      setResults(arr);
    } catch (e: any) {
      if (!mounted.current || mySeq !== reqSeq.current) return;
      // suppress late error if not focused or navigated
      if (!isFocused || navAway.current || e?.name === 'AbortError') return;
      setError('Search failed');
    } finally {
      if (mounted.current && mySeq === reqSeq.current) setLoading(false);
    }
  }, [isFocused]);

  // Debounce on query change
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      performPrefixSearch(query);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, performPrefixSearch]);

  const onSubmit = () => {
    Keyboard.dismiss();
    performPrefixSearch(query);
  };

  const Header = () => (
    <View style={[styles.header, { borderColor: colors.border }]}>
      <Ionicons name="search-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>DeSo users</Text>
    </View>
  );

  const renderItem = ({ item }: { item: ProfileLite }) => (
    <Pressable
      onPress={() => {
        navAway.current = true;
        navigation.navigate('UserProfile', { username: item.Username });
      }}
      style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' }}
    >
      <Image source={{ uri: item.ProfilePic || 'https://placehold.co/48x48' }} style={{ width: 48, height: 48, borderRadius: 24, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>@{item.Username}</Text>
        {!!item.Description && <Text numberOfLines={2} style={{ color: colors.dim, marginTop: 4 }}>{item.Description}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.accent} />
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search @username"
            placeholderTextColor={colors.dim}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.text }}
            returnKeyType="search"
            onSubmitEditing={onSubmit}
          />
          <Pressable
            onPress={onSubmit}
            style={({ pressed }) => ({
              marginLeft: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
              backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>Search</Text>
          </Pressable>
        </View>
      </View>

      {loading && results.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : error ? (
        <Text style={{ color: '#f33', marginTop: 12, paddingHorizontal: 16 }}>{error}</Text>
      ) : results.length === 0 && (query?.trim()?.length ?? 0) > 0 ? (
        <Text style={{ color: colors.dim, marginTop: 12, paddingHorizontal: 16 }}>No results.</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(it) => it.PublicKeyBase58Check}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
});
