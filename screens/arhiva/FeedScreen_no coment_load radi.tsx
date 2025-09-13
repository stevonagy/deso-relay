// screens/FeedScreen.tsx
// Following feed is a FILTERED VIEW of the always-fresh Recent feed.
// Badge on "Following" shows # of new posts in the last X minutes.
// FIX: Resolve following list using robust get-follows-stateless parsing (like the OK version) so Recent shows correct Follow/Unfollow.

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
const NEW_WINDOW_MIN = 30; // minutes for badge

// HTTP helper
async function postJson(url: string, body: any, abortMs = 12000) {
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

// Robustly parse following PKs from get-follows-stateless (copied/adapted from working file)
function parseFollowingKeys(resp: any): string[] {
  const out = new Set<string>();
  if (!resp) return [];
  if (resp.PublicKeyToProfileEntry && typeof resp.PublicKeyToProfileEntry === 'object') {
    Object.values(resp.PublicKeyToProfileEntry).forEach((entry: any) => {
      const pk = entry?.PublicKeyBase58Check || entry?.Profile?.PublicKeyBase58Check;
      if (pk) out.add(pk);
    });
  }
  if (Array.isArray(resp.UsersFollowedByTargetUser)) {
    resp.UsersFollowedByTargetUser.forEach((entry: any) => {
      const pk = entry?.PublicKeyBase58Check || entry?.Profile?.PublicKeyBase58Check;
      if (pk) out.add(pk);
    });
  }
  if (Array.isArray(resp.PublicKeysBase58Check)) {
    resp.PublicKeysBase58Check.forEach((pk: any) => { if (typeof pk === 'string') out.add(pk); });
  }
  if (Array.isArray(resp.Entries)) {
    resp.Entries.forEach((e: any) => { const pk = e?.FollowedPublicKeyBase58Check || e?.PublicKeyBase58Check; if (pk) out.add(pk); });
  }
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

  // UI state
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<FeedMode>('following');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);


  // Source of truth (Recent)
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);

  // Following + blocked
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Busy / reply
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

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  async function loadBlocked() {
    try {
      const store = await import('../lib/secureStore');
      const arr = (await store.getItem<string[]>('deso.blocked')) || [];
      const next = new Set(arr);
      let changed = next.size !== blocked.size;
      if (!changed) for (const v of next) { if (!blocked.has(v)) { changed = true; break; } }
      if (changed) setBlocked(next);
    } catch {}
  }

  // FIX: use robust get-follows-stateless (nodeBase aware)
  const resolveFollowing = useCallback(async () => {
    try {
      if (!publicKey) { setFollowingSet(new Set()); setFollowingLoaded(true); return; }
      // 1) by PublicKey
      let resp = await postJson(`${nodeBase}/api/v0/get-follows-stateless`, {
        PublicKeyBase58Check: publicKey,
        GetEntriesFollowingUsername: true,
        NumToFetch: 500,
      }, 10000);
      let keys = parseFollowingKeys(resp);
      // 2) fallback by Username
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
    } catch {
      setFollowingSet(new Set());
    } finally { setFollowingLoaded(true); }
  }, [publicKey, nodeBase]);

  // Load Recent (source of truth)
  
  const loadRecent = useCallback(async (nextPage: number = 1, append: boolean = false) => {
    setError(null);
    if (!append) setLoading(true);

    try {
      await loadBlocked();
      let arr: Post[] = [];
      const toFetch = PAGE * nextPage;

      try {
        const data: any = await (Deso as any).getGlobalFeed(toFetch);
        arr = (data?.PostsFound || []).map((p: any) => ({
          PostHashHex: p.PostHashHex,
          Body: p.Body || p.BodyObj?.Body || '',
          Raw: p,
        }));
      } catch {
        const data: any = await postJson(`${nodeBase}/api/v0/get-posts-stateless`, {
          NumToFetch: toFetch,
          ReaderPublicKeyBase58Check: publicKey || '',
          OrderBy: 'newest',
          StartTstampSecs: 0,
          FetchSubcomments: true,
        });
        arr = (data?.PostsFound || data?.Posts || []).map((p: any) => ({
          PostHashHex: p.PostHashHex,
          Body: p.Body || p.BodyObj?.Body || '',
          Raw: p,
        }));
      }

      setHasMore(arr.length >= toFetch);

      if (append) {
        setRecentPosts(prev => {
          const seen = new Set(prev.map(p => p.PostHashHex));
          const extra = arr.filter(p => !seen.has(p.PostHashHex));
          return [...prev, ...extra];
        });
      } else {
        setRecentPosts(arr);
      }

      if (!followingLoaded) { await resolveFollowing(); }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      if (!append) setRecentPosts([]);
    } finally {
      if (!append) setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [nodeBase, publicKey, resolveFollowing, followingLoaded]);

  useEffect(() => { setPage(1); loadRecent(1, false); }, [loadRecent, nodeBase]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await resolveFollowing();
    await loadRecent(1, false);
  }, [resolveFollowing, loadRecent]);

  
  const onLoadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    setPage(next);
    await loadRecent(next, true);
  }, [loadingMore, loading, hasMore, page, loadRecent]);
// ───────────────────────────────────────────────────────────────────────────
  // Actions
  async function signAndSubmit(unsigned: any) {
    const unsignedHex = unsigned?.TransactionHex || unsigned?.transactionHex || unsigned;
    if (!unsignedHex) throw new Error('Unsigned tx missing TransactionHex');
    const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
    await (Deso as any).submitTransactionHex(signedTransactionHex);
  }

  async function doLike(post: Post) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to like.');
    setBusy(post.PostHashHex + ':like');
    try {
      const unsigned = await (Deso as any).likeUnsigned({ readerPublicKey: publicKey, likedPostHashHex: post.PostHashHex, isUnlike: false });
      await signAndSubmit(unsigned);
      await onRefresh();
    } catch (e: any) { Alert.alert('Like failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function doDiamond(post: Post, level: 1|2|3) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to send diamonds.');
    setBusy(post.PostHashHex + ':diamond');
    try {
      const receiver = post.Raw?.PosterPublicKeyBase58Check || post.Raw?.ProfileEntryResponse?.PublicKeyBase58Check;
      const unsigned = await (Deso as any).sendDiamondsUnsigned({
        senderPublicKey: publicKey,
        receiverPublicKeyOrUsername: receiver,
        diamondLevel: level,
        diamondPostHashHex: post.PostHashHex,
      });
      await signAndSubmit(unsigned);
      Alert.alert('Success', `Sent ${level}x diamond.`);
    } catch (e: any) { Alert.alert('Diamond failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function doReply(parentHashHex: string) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to reply.');
    const body = replyText.trim(); if (!body) return;
    setBusy(parentHashHex + ':reply');
    try {
      const unsigned = await (Deso as any).replyUnsigned({ updaterPublicKey: publicKey, parentPostHashHex: parentHashHex, body });
      await signAndSubmit(unsigned);
      setReplyText(''); setReplyTarget(null);
      await onRefresh();
    } catch (e: any) { Alert.alert('Reply failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function toggleFollow(targetPk: string) {
    if (!publicKey) return Alert.alert('Login required', 'Please log in to follow/unfollow.');
    try {
      const isFollowing = followingSet.has(targetPk);
      const body = {
        FollowerPublicKeyBase58Check: publicKey,
        FollowedPublicKeyBase58Check: targetPk,
        IsUnfollow: isFollowing,
        MinFeeRateNanosPerKB: 1000,
      };
      const data = await postJson(`${nodeBase}/api/v0/create-follow-txn-stateless`, body, 10000);
      const unsignedHex = data?.TransactionHex;
      if (!unsignedHex) throw new Error('Node did not return TransactionHex');
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      await (Deso as any).submitTransactionHex(signedTransactionHex);
      setFollowingSet(prev => {
        const next = new Set(prev);
        if (isFollowing) next.delete(targetPk); else next.add(targetPk);
        return next;
      });
      await onRefresh();
    } catch (e: any) { Alert.alert('Follow failed', e?.message ?? String(e)); }
  }

  async function addBlocked(pk: string) {
    try {
      const store = await import('../lib/secureStore');
      const arr = (await store.getItem<string[]>('deso.blocked')) || [];
      const set = new Set(arr); set.add(pk);
      await store.setItem('deso.blocked', Array.from(set));
      setBlocked(set);
      setRecentPosts(prev => prev.filter(p => (p.Raw?.PosterPublicKeyBase58Check || p.Raw?.ProfileEntryResponse?.PublicKeyBase58Check) !== pk));
      Alert.alert('Blocked', 'User has been blocked.');
    } catch (e: any) { Alert.alert('Block failed', e?.message ?? String(e)); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Derived lists
  const recentFiltered = useMemo(() => {
    if (!recentPosts?.length) return [];
    return recentPosts.filter(p => {
      const pk = p.Raw?.PosterPublicKeyBase58Check || p.Raw?.ProfileEntryResponse?.PublicKeyBase58Check || '';
      return pk && !blocked.has(pk);
    });
  }, [recentPosts, blocked]);

  const followingFiltered = useMemo(() => {
    if (!recentFiltered.length) return [];
    if (!followingSet.size) return [];
    return recentFiltered.filter(p => {
      const pk = p.Raw?.PosterPublicKeyBase58Check || p.Raw?.ProfileEntryResponse?.PublicKeyBase58Check || '';
      return followingSet.has(pk);
    });
  }, [recentFiltered, followingSet]);

  // Badge count (new posts in Following within X minutes)
  function getPostTimeMs(p: Post): number {
    const nanos = Number(p.Raw?.TimestampNanos || 0);
    if (Number.isFinite(nanos) && nanos > 0) return Math.floor(nanos / 1e6);
    const millis = Number(p.Raw?.TimestampMillis || 0);
    if (Number.isFinite(millis) && millis > 0) return millis;
    const ts = p.Raw?.Timestamp || p.Raw?.time || 0;
    return Number(ts) || 0;
  }
  const followingNewCount = useMemo(() => {
    if (!followingFiltered.length) return 0;
    const now = Date.now();
    const windowMs = NEW_WINDOW_MIN * 60 * 1000;
    let cnt = 0;
    for (const p of followingFiltered) {
      const t = getPostTimeMs(p);
      if (t && now - t <= windowMs) cnt++;
    }
    return cnt;
  }, [followingFiltered]);

  // ───────────────────────────────────────────────────────────────────────────
  // Header + Menu
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

  // Search + filter row
  const FilterChip = ({ label, active, onPress, badgeCount }: any) => (
    <Pressable onPress={onPress} style={{
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      backgroundColor: active ? colors.accent : 'transparent',
      borderWidth: 1, borderColor: active ? colors.accent : colors.border, marginRight: 8, flexDirection: 'row', alignItems: 'center'
    }}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700' }}>{label}</Text>
      {(typeof badgeCount === 'number' && badgeCount > 0) && (
        <View style={{
          marginLeft: 8, minWidth: 18, paddingHorizontal: 6, height: 18, borderRadius: 9,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: active ? '#fff' : colors.accent
        }}>
          <Text style={{ color: active ? colors.accent : '#fff', fontSize: 12, fontWeight: '800' }}>{badgeCount > 99 ? '99+' : String(badgeCount)}</Text>
        </View>
      )}
    </Pressable>
  );

  function FeedTabs() {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <FilterChip label="Following" active={mode === 'following'} onPress={() => setMode('following')} badgeCount={followingNewCount} />
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

  // Render item
  const renderItem = ({ item }: { item: Post }) => {
    const p = item.Raw;
    const handle = (Deso as any).usernameOrPk?.(p) ?? (p?.ProfileEntryResponse?.Username ? '@' + p.ProfileEntryResponse.Username : (p?.PosterPublicKeyBase58Check || ''));
    const imgs: string[] = p?.ImageURLs || p?.BodyObj?.ImageURLs || [];
    const authorPk: string = p?.PosterPublicKeyBase58Check || p?.ProfileEntryResponse?.PublicKeyBase58Check || '';
    const isMe = !!publicKey && authorPk === publicKey;
    const amIFollowing = authorPk && followingSet.has(authorPk);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!!authorPk && (
            <Image source={{ uri: (Deso as any).getProfilePicUrl ? (Deso as any).getProfilePicUrl(authorPk) : `${nodeBase}/api/v0/get-single-profile-picture/${authorPk}` }} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, marginRight: 8 }} />
          )}
          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{handle}</Text>

          {/* Follow / Unfollow + Block */}
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

        {/* Actions */}
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Pressable onPress={() => doLike(item)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>{busy === item.PostHashHex + ':like' ? 'Liking…' : 'Like'}</Text>
          </Pressable>
          <View style={{ width: 8 }} />
          {[1,2,3].map(x => (
            <Pressable key={x} onPress={() => doDiamond(item, x as 1|2|3)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>{busy === item.PostHashHex + ':diamond' ? `💎x${x}…` : `💎x${x}`}</Text>
            </Pressable>
          ))}
          <View style={{ width: 8 }} />
          <Pressable onPress={() => { setReplyTarget(item.PostHashHex); setReplyText(''); }} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Reply</Text>
          </Pressable>
        </View>

        {replyTarget === item.PostHashHex && (
          <View style={{ marginTop: 8 }}>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Reply…"
              placeholderTextColor={colors.sub}
              style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 8, padding: 10, marginBottom: 8 }}
              multiline
            />
            <Button title={busy === item.PostHashHex + ':reply' ? 'Replying…' : 'Post reply'} onPress={() => doReply(item.PostHashHex)} disabled={busy != null || !replyText.trim()} />
          </View>
        )}
      </View>
    );
  };

  // Loading state
  if (loading && !recentPosts.length && !error) {
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

  // Visible list
  const recentVisible = recentFiltered;
  const followingVisible = followingFiltered;
  const visible = mode === 'recent' ? recentVisible : followingVisible;

  const ListFooter = () => (
    <View style={{ padding: 16 }}>
      {hasMore ? (
        <Button
          title={loadingMore ? 'Loading…' : 'Load more'}
          onPress={onLoadMore}
          disabled={loadingMore || loading}
        />
      ) : (
        <Text style={{ textAlign: 'center', color: colors.sub }}>— No more —</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <MenuModal />
      <FeedTabs />

      {error ? (
        <View style={{ padding: 16 }}><Text style={{ color: '#f33' }}>{error}</Text></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(it) => it.PostHashHex}
          ListFooterComponent={<ListFooter />}
contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={{ color: colors.sub, padding: 16 }}>{mode === 'following' ? 'No posts from followed users (based on Recent).' : 'No posts.'}</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
