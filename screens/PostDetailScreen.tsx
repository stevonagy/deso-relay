// screens/PostDetailScreen.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Image,
  StyleSheet,
  TextInput,
  Button,
  Alert,
  useColorScheme,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import * as Deso from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';

type DesoPost = any;

function collectChildren(raw: any): any[] {
  if (!raw) return [];
  const candidates = [raw.Comments, raw.Subcomments, raw.CommentList, raw.Replies, raw.Children];
  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

export default function PostDetailScreen() {
  const route = useRoute<any>();
  const { publicKey } = useAuth();
  const { nodeBase: ctxNode, theme } = useSettings();
  const scheme = useColorScheme();

  const postHashHex: string | undefined = route.params?.postHashHex;
  const focusCommentHashHex: string | undefined = route.params?.focusCommentHashHex;
  const nodeBase: string = route.params?.nodeBase || ctxNode || 'https://node.deso.org';

  const dark = (theme ? theme === 'dark' : scheme === 'dark');

  const colors = useMemo(() => ({
    bg: dark ? '#0b0b0c' : '#ffffff',
    text: dark ? '#ffffff' : '#0b0b0c',
    sub: dark ? '#a4a4a7' : '#666a73',
    border: dark ? '#1f1f22' : '#e3e3e6',
    card: dark ? '#121315' : '#ffffff',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    inputBg: dark ? '#141518' : '#fff',
    inputText: dark ? '#fff' : '#000',
    inputPlaceholder: dark ? '#8b8b92' : '#888',
    highlightBg: dark ? 'rgba(78,163,255,0.12)' : 'rgba(11,105,255,0.06)',
    highlightBorder: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  const [post, setPost] = useState<DesoPost | null>(null);
  const [loading, setLoading] = useState(true);

  // busy key for replies (post or any comment)
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // main reply to parent post
  const [replyToPostText, setReplyToPostText] = useState('');

  // per-comment reply input state
  const [replyTextByHash, setReplyTextByHash] = useState<Record<string, string>>({});
  const setReplyText = useCallback((hash: string, val: string) => {
    setReplyTextByHash(prev => ({ ...prev, [hash]: val }));
  }, []);

  const fetchPost = useCallback(async () => {
    try {
      const res = await fetch(`${nodeBase}/api/v0/get-single-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          PostHashHex: postHashHex,
          ReaderPublicKeyBase58Check: publicKey || '',
          FetchParents: true,
          FetchSubcomments: true,
          CommentLimit: 120,
          ThreadLevelLimit: 2,
        }),
      });
      const json = await res.json();
      setPost(json?.PostFound || null);
    } catch (e) {
      console.error(e);
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [postHashHex, publicKey, nodeBase]);

  useEffect(() => {
    if (postHashHex) fetchPost();
  }, [postHashHex, fetchPost]);

  const commentsFlat = useMemo(() => {
    const res: any[] = [];
    const first = post?.Comments || post?.CommentList || [];
    first.forEach((c: any) => {
      res.push(c);
      const kids = collectChildren(c) || [];
      kids.forEach((k: any) => res.push({ ...k, __isChild: true }));
    });
    return res;
  }, [post]);

  // --- actions ---
  async function signAndSubmit(unsigned: any) {
    const unsignedHex = unsigned?.TransactionHex || unsigned?.transactionHex || unsigned;
    if (!unsignedHex) throw new Error('Unsigned tx missing TransactionHex');
    const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
    await (Deso as any).submitTransactionHex(signedTransactionHex);
  }

  const doReplyToPost = useCallback(
    async () => {
      if (!publicKey) {
        Alert.alert('Login required', 'Please log in to reply.');
        return;
      }
      const body = (replyToPostText || '').trim();
      if (!body || !post?.PostHashHex) return;

      const key = post.PostHashHex + ':reply';
      setBusyKey(key);
      try {
        const unsigned = await (Deso as any).replyUnsigned({
          updaterPublicKey: publicKey,
          parentPostHashHex: post.PostHashHex,
          body,
        });
        await signAndSubmit(unsigned);
        setReplyToPostText('');
        await fetchPost(); // refresh thread after reply
      } catch (e: any) {
        Alert.alert('Reply failed', e?.message ?? String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [publicKey, replyToPostText, post, fetchPost]
  );

  const doReplyToComment = useCallback(
    async (parentHashHex: string) => {
      if (!publicKey) {
        Alert.alert('Login required', 'Please log in to reply.');
        return;
      }
      const body = (replyTextByHash[parentHashHex] || '').trim();
      if (!body) return;

      const key = parentHashHex + ':reply';
      setBusyKey(key);
      try {
        const unsigned = await (Deso as any).replyUnsigned({
          updaterPublicKey: publicKey,
          parentPostHashHex: parentHashHex,
          body,
        });
        await signAndSubmit(unsigned);
        setReplyText(parentHashHex, '');
        await fetchPost(); // refresh comments
      } catch (e: any) {
        Alert.alert('Reply failed', e?.message ?? String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [publicKey, replyTextByHash, setReplyText, fetchPost]
  );

  if (!postHashHex) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.text }}>Missing post hash</Text>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!post) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.text }}>Post not found</Text>
      </View>
    );
  }

  const busyMain = busyKey === (post?.PostHashHex + ':reply');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Parent post */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.author, { color: colors.text }]}>@{post.ProfileEntryResponse?.Username}</Text>
        {!!post.Body && <Text style={[styles.body, { color: colors.text }]}>{post.Body}</Text>}
        {post.ImageURLs?.map((url: string, idx: number) => (
          <Image key={idx} source={{ uri: url }} style={styles.image} />
        ))}
        {!!post.PostHashHex && <Text style={[styles.hash, { color: colors.sub }]}>#{post.PostHashHex}</Text>}
      </View>

      {/* Reply to post */}
      <View style={{ marginTop: 14 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text }}>Reply to post</Text>
        <TextInput
          value={replyToPostText}
          onChangeText={setReplyToPostText}
          placeholder={publicKey ? 'Write your reply…' : 'Login to reply…'}
          placeholderTextColor={colors.inputPlaceholder}
          style={[
            styles.replyInput,
            { backgroundColor: colors.inputBg, color: colors.inputText, borderColor: colors.border },
          ]}
          multiline
          editable={!!publicKey}
        />
        <Button
          title={busyMain ? 'Replying…' : 'Reply'}
          onPress={doReplyToPost}
          disabled={!publicKey || !replyToPostText.trim() || !!busyMain}
        />
      </View>

      {/* Comments */}
      <View style={{ marginTop: 18 }}>
        <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: 8, color: colors.text }}>Comments</Text>
        {commentsFlat.length === 0 ? (
          <Text style={{ color: colors.sub }}>No comments.</Text>
        ) : commentsFlat.map((c: any) => {
          const isFocus = focusCommentHashHex && c?.PostHashHex === focusCommentHashHex;
          const pk = c?.PosterPublicKeyBase58Check || c?.ProfileEntryResponse?.PublicKeyBase58Check || '';
          const uname = c?.ProfileEntryResponse?.Username;
          const imgs: string[] = c?.ImageURLs || c?.BodyObj?.ImageURLs || [];
          const chash = c?.PostHashHex;
          const val = replyTextByHash[chash] || '';
          const isBusy = busyKey === chash + ':reply';

          return (
            <View
              key={chash || Math.random().toString(36).slice(2)}
              style={[
                styles.comment,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
                c?.__isChild && { marginLeft: 16 },
                isFocus && { borderColor: colors.highlightBorder, backgroundColor: colors.highlightBg },
              ]}
            >
              <Text style={{ fontWeight: '700', color: colors.text }}>
                {uname ? '@' + uname : pk ? pk.slice(0, 6) + '…' + pk.slice(-4) : 'User'}
              </Text>
              {!!c?.Body && <Text style={{ marginTop: 4, color: colors.text }}>{c.Body}</Text>}
              {!!imgs?.length && imgs.map((u: string, i: number) => (
                <Image key={i} source={{ uri: u }} style={{ width: '100%', height: 160, borderRadius: 8, marginTop: 6 }} />
              ))}

              {/* Reply to this comment */}
              {chash && (
                <View style={{ marginTop: 8 }}>
                  <TextInput
                    value={val}
                    onChangeText={(t) => setReplyText(chash, t)}
                    placeholder={publicKey ? 'Reply to this comment…' : 'Login to reply…'}
                    placeholderTextColor={colors.inputPlaceholder}
                    style={[
                      styles.replyInput,
                      { backgroundColor: colors.inputBg, color: colors.inputText, borderColor: colors.border },
                    ]}
                    multiline
                    editable={!!publicKey}
                  />
                  <Button
                    title={isBusy ? 'Replying…' : 'Reply'}
                    onPress={() => doReplyToComment(chash)}
                    disabled={!publicKey || !val.trim() || !!isBusy}
                  />
                </View>
              )}

              {!!isFocus && <Text style={{ color: colors.accent, marginTop: 6, fontSize: 12 }}>← This is the reply</Text>}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  card: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },

  author: { fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 16, marginTop: 6 },
  image: { width: '100%', height: 220, marginTop: 12, borderRadius: 8 },
  hash: { marginTop: 12, fontSize: 12 },

  comment: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 12,
  },

  replyInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    minHeight: 40,
  },
});
