// screens/FeedScreen.tsx — Following strict parse + node URL normalize (auto-fix common typo), loops prevented
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet,
  Image, TextInput, Button, Alert, Pressable, SafeAreaView, TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import * as Deso from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';

type Post = { PostHashHex: string; Body: string; Raw: any; };
type FeedMode = 'following' | 'recent';

const PAGE = 60;

async function postJson(url: string, body: any, abortMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: ctrl.signal as any });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as any;
      (err as any).body = text;
      throw err;
    }
    return json;
  } finally { clearTimeout(timer); }
}

// Extract following PKs from get-follows-stateless with strict paths plus a generic sweep
function parseFollowingKeys(resp: any): string[] {
  const out = new Set<string>();
  if (!resp) return [];
  // Common shapes:
  // 1) resp.PublicKeyToProfileEntry (map) + resp.NumFollowers / NumFollowing
  if (resp.PublicKeyToProfileEntry && typeof resp.PublicKeyToProfileEntry === 'object') {
    Object.values(resp.PublicKeyToProfileEntry).forEach((entry: any) => {
      const pk = entry?.PublicKeyBase58Check || entry?.Profile?.PublicKeyBase58Check;
      if (pk) out.add(pk);
    });
  }
  // 2) resp.UsersFollowedByTargetUser (array of profiles)
  if (Array.isArray(resp.UsersFollowedByTargetUser)) {
    resp.UsersFollowedByTargetUser.forEach((entry: any) => {
      const pk = entry?.PublicKeyBase58Check || entry?.Profile?.PublicKeyBase58Check;
      if (pk) out.add(pk);
    });
  }
  // 3) resp.PublicKeysBase58Check (array)
  if (Array.isArray(resp.PublicKeysBase58Check)) {
    resp.PublicKeysBase58Check.forEach((pk: any) => { if (typeof pk === 'string') out.add(pk); });
  }
  // 4) resp.Entries? (array with FollowedPublicKeyBase58Check)
  if (Array.isArray(resp.Entries)) {
    resp.Entries.forEach((e: any) => { const pk = e?.FollowedPublicKeyBase58Check || e?.PublicKeyBase58Check; if (pk) out.add(pk); });
  }
  // 5) generic sweep for PublicKeyBase58Check fields
  const stack = [resp];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (Array.isArray(cur)) cur.forEach(v => stack.push(v));
    else if (typeof cur === 'object') {
      for (const [k, v] of Object.entries(cur)) {
        if (k === 'PublicKeyBase58Check' && typeof v === 'string') out.add(v);
        if (v && (typeof v === 'object' || Array.isArray(v))) stack.push(v);
      }
    }
  }
  return Array.from(out);
}

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { publicKey } = useAuth();
  const { theme, setTheme, nodeBase, setNodeBase } = useSettings();
  const dark = theme === 'dark';

  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<FeedMode>('following');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [followingLoaded, setFollowingLoaded] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    card: dark ? '#0a0a0a' : '#fff',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  // Normalize node: add https if missing; fix common typo 'desocilaworld.com' -> 'desocialworld.com'
  useEffect(() => {
    let nb = nodeBase || '';
    if (nb && !/^https?:\/\//i.test(nb)) nb = 'https://' + nb.replace(/^\/+/, '');
    if (/desocilaworld\.com/i.test(nb)) nb = nb.replace(/desocilaworld\.com/i, 'desocialworld.com');
    if (nb !== nodeBase) {
      setNodeBase(nb);
      Alert.alert('Node corrected', `Using node: ${nb}`);
    }
  }, []); // run once

  async function loadBlocked() {
    try {
      const store = await import('../lib/secureStore');
      const arr = (await store.getItem<string[]>('deso.blocked')) || [];
      const next = new Set(arr);
      // Update only if changed
      let changed = next.size !== blocked.size;
      if (!changed) for (const v of next) { if (!blocked.has(v)) { changed = true; break; } }
      if (changed) setBlocked(next);
    } catch {}
  }

  const resolveFollowing = useCallback(async () => {
    try {
      if (!publicKey) { setFollowingSet(new Set()); setFollowingLoaded(true); return; }
      // 1) by PK
      let resp = await postJson(`${nodeBase}/api/v0/get-follows-stateless`, {
        PublicKeyBase58Check: publicKey,
        GetEntriesFollowingUsername: true,
        NumToFetch: 500,
      }, 10000);
      let keys = parseFollowingKeys(resp);
      // 2) fallback by username
      if (!keys.length) {
        try {
          const me: any = await (Deso as any).getSingleProfile({ publicKeyOrUsername: publicKey });
          const uname = me?.Profile?.Username;
          if (uname) {
            resp = await postJson(`${nodeBase}/api/v0/get-follows-stateless`, {
              Username: uname,
              GetEntriesFollowingUsername: true,
              NumToFetch: 500,
            }, 10000);
            keys = parseFollowingKeys(resp);
          }
        } catch {}
      }
      const uniq = Array.from(new Set(keys.filter(Boolean)));
      setFollowingSet(new Set(uniq));
    } catch (e) {
      setFollowingSet(new Set());
    } finally { setFollowingLoaded(true); }
  }, [publicKey, nodeBase]);

  const loadRecent = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      await loadBlocked();
      let arr: Post[] = [];
      try {
        const data: any = await (Deso as any).getGlobalFeed(PAGE);
        arr = (data?.PostsFound || []).map((p: any) => ({ PostHashHex: p.PostHashHex, Body: p.Body || p.BodyObj?.Body || '', Raw: p }));
      } catch {
        const data: any = await postJson(`${nodeBase}/api/v0/get-posts-stateless`, {
          NumToFetch: PAGE, ReaderPublicKeyBase58Check: publicKey || '', OrderBy: 'newest', StartTstampSecs: 0, FetchSubcomments: true,
        }, 10000);
        arr = (data?.PostsFound || data?.Posts || []).map((p: any) => ({ PostHashHex: p.PostHashHex, Body: p.Body || p.BodyObj?.Body || '', Raw: p }));
      }
      arr = arr.filter((p) => {
        const pk = p.Raw?.PosterPublicKeyBase58Check || p.Raw?.ProfileEntryResponse?.PublicKeyBase58Check || '';
        return pk && !blocked.has(pk);
      });
      setPosts(arr);
    } catch (e: any) { setError(e?.message ?? String(e)); setPosts([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [nodeBase, publicKey, blocked]);

  const loadFollowing = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      await loadBlocked();
      if (!followingLoaded) await resolveFollowing();
      const list = Array.from(followingSet);
      if (!list.length) { setPosts([]); return; }
      const slice = list.slice(0, 40);
      const chunks: Post[][] = await Promise.all(slice.map(async (pk) => {
        try {
          const resp: any = await (Deso as any).getPostsForPublicKey({ publicKeyOrUsername: pk, numToFetch: 2 });
          return (resp?.Posts ?? []).map((p: any) => ({ PostHashHex: p.PostHashHex, Body: p.Body || p.BodyObj?.Body || '', Raw: p }));
        } catch {
          const data: any = await postJson(`${nodeBase}/api/v0/get-posts-for-public-key`, {
            PublicKeyBase58Check: pk, NumToFetch: 2, MediaRequired: false, FetchSubcomments: true,
          }, 10000);
          return (data?.Posts ?? data ?? []).map((p: any) => ({ PostHashHex: p.PostHashHex, Body: p.Body || p.BodyObj?.Body || '', Raw: p }));
        }
      }));
      let out: Post[] = []; chunks.forEach(c => out.push(...c));
      const seen = new Set<string>(); out = out.filter(p => (seen.has(p.PostHashHex) ? false : (seen.add(p.PostHashHex), true)));
      out.sort((a, b) => Number(b.Raw?.TimestampNanos || 0) - Number(a.Raw?.TimestampNanos || 0));
      out = out.filter((p) => {
        const pk = p.Raw?.PosterPublicKeyBase58Check || p.Raw?.ProfileEntryResponse?.PublicKeyBase58Check || '';
        return pk && !blocked.has(pk);
      });
      setPosts(out);
    } catch (e: any) { setError(e?.message ?? String(e)); setPosts([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [followingSet, followingLoaded, nodeBase, blocked, resolveFollowing]);

  const load = useCallback(async () => {
    if (mode === 'following') return loadFollowing();
    return loadRecent();
  }, [mode, loadFollowing, loadRecent]);

  useEffect(() => { resolveFollowing(); }, [resolveFollowing]);
  useEffect(() => { load(); }, [load, nodeBase]);
  useEffect(() => { if (followingLoaded) load(); }, [mode, followingLoaded, followingSet]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await resolveFollowing(); await load(); }, [resolveFollowing, load]);

  async function signAndSubmit(unsigned: any) {
    const unsignedHex = unsigned?.TransactionHex || unsigned?.transactionHex || unsigned;
    if (!unsignedHex) throw new Error('Unsigned tx missing TransactionHex');
    const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
    await (Deso as any).submitTransactionHex(signedTransactionHex);
  }

  async function toggleFollow(targetPk: string) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to follow/unfollow.');
    try {
      const isFollowing = followingSet.has(targetPk);
      const data = await postJson(`${nodeBase}/api/v0/create-follow-txn-stateless`, {
        FollowerPublicKeyBase58Check: publicKey, FollowedPublicKeyBase58Check: targetPk, IsUnfollow: isFollowing, MinFeeRateNanosPerKB: 1000,
      }, 10000);
      const unsignedHex = data?.TransactionHex; if (!unsignedHex) throw new Error('Node did not return TransactionHex');
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      await (Deso as any).submitTransactionHex(signedTransactionHex);
      setFollowingSet(prev => { const next = new Set(prev); if (isFollowing) next.delete(targetPk); else next.add(targetPk); return next; });
      await load();
    } catch (e: any) { Alert.alert('Follow failed', e?.message ?? String(e)); }
  }

  async function doLike(post: Post) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to like.'); setBusy(post.PostHashHex + ':like');
    try { const unsigned = await (Deso as any).likeUnsigned({ readerPublicKey: publicKey, likedPostHashHex: post.PostHashHex, isUnlike: false });
      await signAndSubmit(unsigned); await load(); } catch (e: any) { Alert.alert('Like failed', e?.message ?? String(e)); } finally { setBusy(null); }
  }

  async function doDiamond(post: Post, level: 1|2|3) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to send diamonds.'); setBusy(post.PostHashHex + ':diamond');
    try {
      const receiver = post.Raw?.PosterPublicKeyBase58Check || post.Raw?.ProfileEntryResponse?.PublicKeyBase58Check;
      const unsigned = await (Deso as any).sendDiamondsUnsigned({ senderPublicKey: publicKey, receiverPublicKeyOrUsername: receiver, diamondLevel: level, diamondPostHashHex: post.PostHashHex });
      await signAndSubmit(unsigned); Alert.alert('Success', `Sent ${level}x diamond.`);
    } catch (e: any) { Alert.alert('Diamond failed', e?.message ?? String(e)); } finally { setBusy(null); }
  }

  const [replyTextLocal, setReplyTextLocal] = useState('');
  async function doReply(postHash: string) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to reply.');
    const body = replyTextLocal.trim(); if (!body) return;
    setBusy(postHash + ':reply');
    try { const unsigned = await (Deso as any).replyUnsigned({ updaterPublicKey: publicKey, parentPostHashHex: postHash, body });
      await signAndSubmit(unsigned); setReplyTarget(null); setReplyTextLocal(''); await load(); } catch (e: any) { Alert.alert('Reply failed', e?.message ?? String(e)); } finally { setBusy(null); }
  }

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
      <Pressable onPress={() => setMenuOpen(true)} style={{ marginLeft: 'auto', padding: 8 }}>
        <Ionicons name="menu-outline" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );

  const MenuModal = () => {
    const close = () => setMenuOpen(false);
    const chooseNode = (url: string) => { setNodeBase(url); };
    const goWallet = () => { close(); navigation.navigate('Wallet'); };
    const goBlocked = () => { close(); navigation.navigate('BlockedUsers'); };
    const openNFTZ = () => { close(); Linking.openURL('https://nftz.me'); };
    const toggleTheme = () => { setTheme(theme === 'dark' ? 'light' : 'dark'); };

    const NodeItem = ({ url, label }: { url: string, label: string }) => {
      const selected = nodeBase === url || nodeBase?.toLowerCase().includes(label.toLowerCase());
      return (
        <Pressable onPress={() => chooseNode(url)} style={{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selected ? '#11c26d' : 'transparent', marginRight: 8, borderWidth: 1, borderColor: colors.border }} />
          <Text style={{ color: colors.text }}>{label}</Text>
        </Pressable>
      );
    };

    if (!menuOpen) return null;
    return (
      <View style={{ position: 'absolute', top: 54, right: 12, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, zIndex: 9999, width: 260, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12 }}>
        <Text style={{ color: colors.sub, fontWeight: '700', marginBottom: 8 }}>Nodes</Text>
        <NodeItem url="https://node.deso.org" label="node.deso.org" />
        <NodeItem url="https://desocialworld.com" label="desocialworld.com" />
        <NodeItem url="https://safetynet.social" label="safetynet.social" />

        <View style={{ height: 10 }} />
        <Pressable onPress={goWallet} style={{ paddingVertical: 10 }}><Text style={{ color: colors.text }}>Wallet</Text></Pressable>
        <Pressable onPress={goBlocked} style={{ paddingVertical: 10 }}><Text style={{ color: colors.text }}>Blocked users</Text></Pressable>
        <Pressable onPress={openNFTZ} style={{ paddingVertical: 10 }}><Text style={{ color: colors.text }}>NFT zone</Text></Pressable>
        <Pressable onPress={toggleTheme} style={{ paddingVertical: 10 }}><Text style={{ color: colors.text }}>Theme: {theme === 'dark' ? 'Dark' : 'Light'}</Text></Pressable>
        <Pressable onPress={close} style={{ paddingTop: 6, alignSelf: 'flex-end' }}><Text style={{ color: colors.sub }}>Close</Text></Pressable>
      </View>
    );
  };

  const FilterChip = ({ label, active, onPress }: any) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? colors.accent : 'transparent', borderWidth: 1, borderColor: active ? colors.accent : colors.border, marginRight: 8 }}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );

  function FeedTabs() {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <FilterChip label="Following" active={mode === 'following'} onPress={() => setMode('following')} />
          <FilterChip label="Recent" active={mode === 'recent'} onPress={() => setMode('recent')} />
          <Pressable onPress={() => { setSearchOpen(!searchOpen); setTimeout(() => inputRef.current?.focus(), 50); }} style={{ marginLeft: 'auto', padding: 8 }}>
            <Ionicons name={searchOpen ? 'close-outline' : 'search-outline'} size={20} color={colors.accent} />
          </Pressable>
        </View>
        {!!searchOpen && (
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                ref={inputRef}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search @username"
                placeholderTextColor={colors.sub}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  const q = (searchQuery || '').trim();
                  if (!q) return;
                  navigation.navigate('Profile', { usernameOrPk: q });
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: colors.text }}
              />
              <View style={{ width: 8 }} />
              <Button title="Search" onPress={() => {
                const q = (searchQuery || '').trim();
                if (!q) return;
                navigation.navigate('Profile', { usernameOrPk: q });
                setSearchOpen(false);
                setSearchQuery('');
              }} />
            </View>
          </View>
        )}
      </View>
    );
  }

  const renderItem = ({ item }: { item: Post }) => {
    const p = item.Raw;
    const handle = (Deso as any).usernameOrPk?.(p) ?? (p?.ProfileEntryResponse?.Username ? '@' + p.ProfileEntryResponse.Username : (p?.PosterPublicKeyBase58Check || ''));
    const imgs: string[] = p?.ImageURLs || p?.BodyObj?.ImageURLs || [];
    const authorPk: string = p?.PosterPublicKeyBase58Check || p?.ProfileEntryResponse?.PublicKeyBase58Check || '';
    const isMe = !!publicKey && authorPk === publicKey;
    const amIFollowing = authorPk && followingSet.has(authorPk);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!!authorPk && (
            <Image source={{ uri: (Deso as any).getProfilePicUrl ? (Deso as any).getProfilePicUrl(authorPk) : `${nodeBase}/api/v0/get-single-profile-picture/${authorPk}` }} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, marginRight: 8 }} />
          )}
          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{handle}</Text>
          {!isMe && !!authorPk && (
            <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => toggleFollow(authorPk)} disabled={busy != null} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: amIFollowing ? '#14223b' : '#0b69ff' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{amIFollowing ? 'Unfollow' : 'Follow'}</Text>
              </TouchableOpacity>
              <View style={{ width: 8 }} />
              <TouchableOpacity onPress={() => addBlocked(authorPk)} disabled={busy != null} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#2b0000' }}>
                <Text style={{ color: '#ff6666', fontWeight: '700', fontSize: 12 }}>Block</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {!!item.Body && <Text style={{ color: colors.text, marginTop: 8 }}>{item.Body}</Text>}
        {!!imgs?.length && <Image source={{ uri: imgs[0] }} style={{ width: '100%', height: 220, borderRadius: 10, marginTop: 8 }} resizeMode="cover" />}
      </View>
    );
  };

  if (loading && !posts.length && !error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header />
        <MenuModal />
        <FeedTabs />
        <View style={[styles.center]}>
          <ActivityIndicator />
          <Text style={{ color: colors.sub, marginTop: 8 }}>Loading feed…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <MenuModal />
      <FeedTabs />
      {error ? (
        <View style={{ padding: 16 }}><Text style={{ color: '#f33' }}>{error}</Text></View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(it) => it.PostHashHex}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={{ color: colors.sub, padding: 16 }}>{mode === 'following' ? 'No posts from followed users.' : 'No posts.'}</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
