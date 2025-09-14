// screens/UserProfileScreen.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Image,
  Pressable,
  Alert,
  FlatList,
  TextInput,
  TouchableOpacity,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';
import * as Deso from '../lib/deso';

const NODE = 'https://node.deso.org';

async function postJson(url: string, body: any, abortMs = 20000) {
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

type Post = {
  PostHashHex: string;
  Body?: string;
  BodyObj?: { Body?: string; ImageURLs?: string[] };
  ImageURLs?: string[];
  ProfileEntryResponse?: { Username?: string; PublicKeyBase58Check?: string };
  PosterPublicKeyBase58Check?: string;
  TimestampNanos?: number;
  CommentCount?: number;
  LikeCount?: number;
};

// Moggel custom icons like in FeedScreen
const MOGGEL_PK = 'BC1YLgCTkGwjBjD6c6dGogWwMuDmuRYVCSGvN8gqQmajVDaoTg4hAKj';
function getAuthorPk(raw: any): string {
  return raw?.PosterPublicKeyBase58Check
      || raw?.ProfileEntryResponse?.PublicKeyBase58Check
      || '';
}
function isMoggel(raw: any): boolean {
  return getAuthorPk(raw) === MOGGEL_PK;
}
function tipLabel(raw: any, level: 1|2|3): string {
  if (isMoggel(raw)) {
    if (level === 1) return '🍎 x1';
    if (level === 2) return '🍎🍏 x2';
    return '🍯 x3';
  }
  return `💎x${level}`;
}

export default function UserProfileScreen({ route, navigation }: any) {
  const { publicKey: readerPk } = useAuth();
  const { publicKey, username } = route.params || {};
  const { theme } = useSettings();
  const dark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [toggling, setToggling] = useState(false);

  // posts
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 30;

  // actions state (like, diamonds, reply, comments) — similar to FeedScreen
  const [busy, setBusy] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const [commentsOpen, setCommentsOpen] = useState<Record<string, boolean>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({});
  const [commentsByPost, setCommentsByPost] = useState<Record<string, Post[]>>({});
  const [commentReplyText, setCommentReplyText] = useState<Record<string, string>>({});
  const [commentsPageSize, setCommentsPageSize] = useState<Record<string, number>>({});

  const colors = useMemo(() => ({
    bg: dark ? '#0a0a0a' : '#ffffff',
    text: dark ? '#ffffff' : '#111111',
    dim: dark ? '#bdbdbd' : '#666666',
    border: dark ? '#222222' : '#e2e2e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    card: dark ? '#141414' : '#f7f7f9',
    danger: '#d9534f',
  }), [dark]);

  useEffect(() => {
    navigation?.setOptions?.({ title: username ? `@${username}` : 'Profile' });
  }, [username, navigation]);

  const targetPk = profile?.PublicKeyBase58Check || publicKey;
  const isFollowing = !!profile?.IsFollowedByReader;

  const fetchProfile = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const resp = await postJson(`${NODE}/api/v0/get-single-profile`, {
        PublicKeyBase58Check: publicKey,
        Username: username || undefined,
        NoErrorOnMissing: true,
        ReaderPublicKeyBase58Check: readerPk || undefined,
      }, 15000);
      setProfile(resp?.Profile ?? null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [publicKey, username, readerPk]);

  // Reset list when switching to another user (prevents stale posts)
  useEffect(() => {
    setPosts([]);
    setHasMore(true);
  }, [username, publicKey]);

  const fetchPosts = useCallback(async (append: boolean) => {
    const pkToUse = profile?.PublicKeyBase58Check || publicKey;
    if (!pkToUse && !username) return;
    setPostsError(null);
    if (!append) setPostsLoading(true);
    try {
      const last = append ? posts[posts.length - 1]?.PostHashHex : undefined;
      // Prefer Username when available to avoid wrong PK edge-cases
      const req: any = username
        ? { Username: username, ReaderPublicKeyBase58Check: readerPk || undefined, NumToFetch: PAGE, MediaRequired: false, LastPostHashHex: last || undefined }
        : { PublicKeyBase58Check: pkToUse, ReaderPublicKeyBase58Check: readerPk || undefined, NumToFetch: PAGE, MediaRequired: false, LastPostHashHex: last || undefined };
      const resp: any = await postJson(`${NODE}/api/v0/get-posts-for-public-key`, req, 20000);
      const list: Post[] = (resp?.Posts || resp?.PostsFound || []).filter(Boolean);
      if (append) {
        const seen = new Set(posts.map(p => p.PostHashHex));
        const extra = list.filter(p => !seen.has(p.PostHashHex));
        setPosts(prev => [...prev, ...extra]);
      } else {
        setPosts(list);
      }
      setHasMore((list?.length || 0) >= PAGE);
    } catch (e: any) {
      setPostsError(e?.message ?? String(e));
      if (!append) setPosts([]);
    } finally {
      if (!append) setPostsLoading(false);
    }
  }, [username, publicKey, profile?.PublicKeyBase58Check, readerPk, posts]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (publicKey || profile?.PublicKeyBase58Check || username) {
      fetchPosts(false);
    }
  }, [profile?.PublicKeyBase58Check, publicKey, username, fetchPosts]);

  // ── Actions (like, diamonds, reply) ────────────────────────────────────────
  async function signAndSubmit(unsigned: any) {
    const unsignedHex = unsigned?.TransactionHex || unsigned?.transactionHex || unsigned;
    if (!unsignedHex) throw new Error('Unsigned tx missing TransactionHex');
    const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
    await (Deso as any).submitTransactionHex(signedTransactionHex);
  }

  async function doLike(post: Post) {
    if (!readerPk) return Alert.alert('Login required', 'Please log in to like.');
    setBusy(post.PostHashHex + ':like');
    try {
      const unsigned = await (Deso as any).likeUnsigned({ readerPublicKey: readerPk, likedPostHashHex: post.PostHashHex, isUnlike: false });
      await signAndSubmit(unsigned);
      await fetchPosts(false);
    } catch (e: any) { Alert.alert('Like failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function doDiamond(post: Post, level: 1|2|3) {
    if (!readerPk) return Alert.alert('Login required', 'Please log in to send diamonds.');
    setBusy(post.PostHashHex + ':diamond');
    try {
      const receiver = post.PosterPublicKeyBase58Check || post.ProfileEntryResponse?.PublicKeyBase58Check;
      const unsigned = await (Deso as any).sendDiamondsUnsigned({
        senderPublicKey: readerPk,
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
    if (!readerPk) return Alert.alert('Login required', 'Please log in to reply.');
    const body = replyText.trim(); if (!body) return;
    setBusy(parentHashHex + ':reply');
    try {
      const unsigned = await (Deso as any).replyUnsigned({ updaterPublicKey: readerPk, parentPostHashHex: parentHashHex, body });
      await signAndSubmit(unsigned);
      setReplyText(''); setReplyTarget(null);
      await fetchPosts(false);
    } catch (e: any) { Alert.alert('Reply failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  // ── Comments (load/toggle + load more) ─────────────────────────────────────
  function mapPost(raw: any): Post {
    return {
      PostHashHex: raw?.PostHashHex,
      Body: raw?.Body || raw?.BodyObj?.Body || '',
      BodyObj: raw?.BodyObj,
      ImageURLs: raw?.ImageURLs || raw?.BodyObj?.ImageURLs || [],
      ProfileEntryResponse: raw?.ProfileEntryResponse,
      PosterPublicKeyBase58Check: raw?.PosterPublicKeyBase58Check,
      TimestampNanos: raw?.TimestampNanos,
      CommentCount: raw?.CommentCount,
      LikeCount: raw?.LikeCount,
    };
  }

  async function loadCommentsFor(parentHashHex: string) {
    setCommentsLoading(prev => ({ ...prev, [parentHashHex]: true }));
    try {
      const size = commentsPageSize[parentHashHex] ?? 30;
      const resp = await postJson(NODE + '/api/v0/get-single-post', {
        PostHashHex: parentHashHex,
        ReaderPublicKeyBase58Check: readerPk || '',
        FetchParents: false,
        FetchSubcomments: true,
        CommentLimit: size,
        ThreadLevelLimit: 2,
      }, 12000);
      const rawComments = resp?.PostFound?.Comments || resp?.PostFound?.CommentList || [];
      const mapped = rawComments.map((c: any) => mapPost(c)).filter(Boolean);
      setCommentsByPost(prev => ({ ...prev, [parentHashHex]: mapped }));
    } catch (e: any) {
      Alert.alert('Comments', e?.message || 'Greška pri dohvaćanju komentara.');
      setCommentsByPost(prev => ({ ...prev, [parentHashHex]: [] }));
    } finally {
      setCommentsLoading(prev => ({ ...prev, [parentHashHex]: false }));
    }
  }

  function toggleComments(parentHashHex: string) {
    setCommentsOpen(prev => {
      const next = { ...prev, [parentHashHex]: !prev[parentHashHex] };
      return next;
    });
    if (!commentsOpen[parentHashHex]) {
      void loadCommentsFor(parentHashHex);
    }
  }

  const onToggleFollow = async (unfollow: boolean) => {
    if (!readerPk || !targetPk) { Alert.alert('Not logged in', 'Please log in first.'); return; }
    setToggling(true);
    try {
      const unsigned = await postJson(`${NODE}/api/v0/create-follow-txn-stateless`, {
        FollowerPublicKeyBase58Check: readerPk,
        FollowedPublicKeyBase58Check: targetPk,
        IsUnfollow: unfollow,
        MinFeeRateNanosPerKB: 1000,
      }, 20000);
      const unsignedHex = (unsigned as any)?.TransactionHex;
      if (!unsignedHex) throw new Error('Node did not return TransactionHex');
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      await postJson(`${NODE}/api/v0/submit-transaction`, { TransactionHex: signedTransactionHex }, 20000);
      Alert.alert(unfollow ? 'Unfollowed' : 'Followed', 'Action submitted.');
      await fetchProfile();
    } catch (e: any) {
      Alert.alert('Action failed', e?.message ?? String(e));
    } finally {
      setToggling(false);
    }
  };

  // UI subcomponents
  const ProfileHeader = () => {
    if (loading) return <View style={styles.center}><ActivityIndicator /></View>;
    if (err) return <View style={styles.center}><Text style={{ color: '#f33' }}>{err}</Text></View>;
    if (!profile) return <View style={styles.center}><Text style={{ color: colors.text }}>Profile not found.</Text></View>;
    return (
      <View style={{ padding: 16, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.bg }}>
        <View style={styles.header}>
          <Ionicons name="person-circle-outline" size={22} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={{ fontWeight: '800', fontSize: 19, color: colors.text }}>@{profile?.Username}</Text>
        </View>
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Image
            source={{ uri: profile?.ExtraData?.LargeProfilePicURL || profile?.ProfilePic || 'https://placehold.co/120x120' }}
            style={{ width: 120, height: 120, borderRadius: 60 }}
          />
          <Text style={{ color: colors.dim, marginTop: 8 }} numberOfLines={1}>{profile?.PublicKeyBase58Check}</Text>
        </View>
        {!!profile?.Description && (
          <Text style={{ color: colors.text, marginTop: 12, lineHeight: 20 }}>
            {profile.Description}
          </Text>
        )}
        <View style={{ marginTop: 16 }}>
          {!isFollowing ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, opacity: pressed || toggling ? 0.7 : 1 },
              ]}
              onPress={() => onToggleFollow(false)}
              disabled={toggling}
            >
              <Text style={styles.btnText}>Follow</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.danger, opacity: pressed || toggling ? 0.7 : 1 },
              ]}
              onPress={() => onToggleFollow(true)}
              disabled={toggling}
            >
              <Text style={styles.btnText}>Unfollow</Text>
            </Pressable>
          )}
        </View>

        {/* Posts header */}
        <View style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="document-text-outline" size={18} color={colors.accent} style={{ marginRight: 6 }} />
          <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>Posts</Text>
        </View>
      </View>
    );
  };

  const renderPost = ({ item }: { item: Post }) => {
    const body = item.Body ?? item.BodyObj?.Body ?? '';
    const imgs: string[] = item.ImageURLs ?? item.BodyObj?.ImageURLs ?? [];
    const authorPk: string = item.PosterPublicKeyBase58Check || item.ProfileEntryResponse?.PublicKeyBase58Check || '';
    const handle = (Deso as any).usernameOrPk?.(item) ?? (item?.ProfileEntryResponse?.Username ? '@' + item.ProfileEntryResponse.Username : (authorPk || ''));
    const commentCount = typeof item?.CommentCount === 'number' ? item.CommentCount : undefined;

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Post header */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!!authorPk && (
            <Image source={{ uri: (Deso as any).getProfilePicUrl ? (Deso as any).getProfilePicUrl(authorPk) : `${NODE}/api/v0/get-single-profile-picture/${authorPk}` }} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, marginRight: 8 }} />
          )}
          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{handle}</Text>
        </View>

        {!!body && <Text style={{ color: colors.text, marginTop: 8 }}>{body}</Text>}
        {!!imgs?.length && (
          <Image
            source={{ uri: imgs[0] }}
            style={{ width: '100%', height: 220, borderRadius: 10, marginTop: 8 }}
            resizeMode="cover"
          />
        )}

        {/* Actions */}
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Pressable onPress={() => doLike(item)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>{busy === item.PostHashHex + ':like' ? 'Liking…' : 'Like'}</Text>
          </Pressable>
          <View style={{ width: 8 }} />
          {([1,2,3] as const).map((x) => {
            const base = tipLabel(item as any, x);
            const label = busy === item.PostHashHex + ':diamond' ? `${base}…` : base;
            return (
              <Pressable key={x} onPress={() => doDiamond(item, x)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: colors.accent, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            );
          })}

          <View style={{ width: 8 }} />
          <Pressable onPress={() => { setReplyTarget(item.PostHashHex); setReplyText(''); }} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Reply</Text>
          </Pressable>

          <View style={{ width: 8 }} />
          <Pressable onPress={() => toggleComments(item.PostHashHex)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>
              {`Comments${commentCount ? ` (${commentCount})` : ''}`}
            </Text>
          </Pressable>
        </View>

        {replyTarget === item.PostHashHex && (
          <View style={{ marginTop: 8 }}>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Reply…"
              placeholderTextColor={colors.dim}
              style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 8, padding: 10, marginBottom: 8 }}
              multiline
            />
            <TouchableOpacity
              onPress={() => doReply(item.PostHashHex)}
              disabled={busy != null || !replyText.trim()}
              style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy != null || !replyText.trim() ? 0.6 : 1 }]}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === item.PostHashHex + ':reply' ? 'Replying…' : 'Post reply'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* COMMENTS BLOCK */}
        {commentsOpen[item.PostHashHex] && (
          <View style={{ marginTop: 12 }}>
            {commentsLoading[item.PostHashHex] ? (
              <ActivityIndicator />
            ) : !commentsByPost[item.PostHashHex]?.length ? (
              <Text style={{ color: colors.dim }}>Nema komentara.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {commentsByPost[item.PostHashHex].map((cmt) => {
                  const cp = cmt as any;
                  const chandle = (Deso as any).usernameOrPk?.(cp) ?? (cp?.ProfileEntryResponse?.Username ? '@' + cp.ProfileEntryResponse.Username : (cp?.PosterPublicKeyBase58Check || ''));
                  const cpk: string = cp?.PosterPublicKeyBase58Check || cp?.ProfileEntryResponse?.PublicKeyBase58Check || '';
                  const imgs: string[] = cp?.ImageURLs || cp?.BodyObj?.ImageURLs || [];
                  const textVal = commentReplyText[cmt.PostHashHex] ?? '';
                  const busyKey = cmt.PostHashHex + ':reply';
                  return (
                    <View key={cmt.PostHashHex} style={{ padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {!!cpk && (
                          <Image source={{ uri: (Deso as any).getProfilePicUrl ? (Deso as any).getProfilePicUrl(cpk) : `${NODE}/api/v0/get-single-profile-picture/${cpk}` }} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border, marginRight: 8 }} />
                        )}
                        <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{chandle}</Text>
                      </View>
                      {!!cmt.Body && <Text style={{ color: colors.text, marginTop: 6 }}>{cmt.Body}</Text>}
                      {!!imgs?.length && <Image source={{ uri: imgs[0] }} style={{ width: '100%', height: 160, borderRadius: 8, marginTop: 6 }} resizeMode="cover" />}
                      <View style={{ marginTop: 8 }}>
                        <TextInput
                          value={textVal}
                          onChangeText={(t) => setCommentReplyText(prev => ({ ...prev, [cmt.PostHashHex]: t }))}
                          placeholder="Reply to comment…"
                          placeholderTextColor={colors.dim}
                          style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 8, padding: 8, marginBottom: 6 }}
                          multiline
                        />
                        <TouchableOpacity
                          onPress={async () => {
                            if (!readerPk) return Alert.alert('Login required', 'Please log in to reply.');
                            const body = (commentReplyText[cmt.PostHashHex] || '').trim();
                            if (!body) return;
                            setBusy(busyKey);
                            try {
                              const unsigned = await (Deso as any).replyUnsigned({ updaterPublicKey: readerPk, parentPostHashHex: cmt.PostHashHex, body });
                              await signAndSubmit(unsigned);
                              setCommentReplyText(prev => ({ ...prev, [cmt.PostHashHex]: '' }));
                              await loadCommentsFor(item.PostHashHex);
                            } catch (e: any) { Alert.alert('Reply failed', e?.message ?? String(e)); }
                            finally { setBusy(null); }
                          }}
                          disabled={busy != null || !(commentReplyText[cmt.PostHashHex] || '').trim()}
                          style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy != null || !(commentReplyText[cmt.PostHashHex] || '').trim() ? 0.6 : 1 }]}
                        >
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === busyKey ? 'Replying…' : 'Reply'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
                {/* LOAD MORE COMMENTS */}
                <View style={{ marginTop: 8 }}>
                  <Pressable
                    onPress={() => {
                      setCommentsPageSize(prev => {
                        const next = { ...prev, [item.PostHashHex]: (prev[item.PostHashHex] ?? 30) + 30 };
                        return next;
                      });
                      loadCommentsFor(item.PostHashHex);
                    }}
                    style={{ paddingVertical: 8 }}
                  >
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>Load more comments</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const ListFooter = () => (
    <View style={{ padding: 16 }}>
      {postsLoading ? (
        <ActivityIndicator />
      ) : hasMore ? (
        <Pressable
          onPress={() => fetchPosts(true)}
          style={({ pressed }) => ({
            paddingVertical: 12, borderRadius: 999, alignItems: 'center',
            backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>Load more posts</Text>
        </Pressable>
      ) : (
        <Text style={{ textAlign: 'center', color: colors.dim }}>— No more —</Text>
      )}
      {!!postsError && <Text style={{ color: '#f33', marginTop: 8 }}>{postsError}</Text>}
    </View>
  );

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <FlatList
        data={posts}
        keyExtractor={(it) => it.PostHashHex}
        renderItem={renderPost}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={<ProfileHeader />}
        ListFooterComponent={<ListFooter />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center' },
  button: {
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 12 },
  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
});
