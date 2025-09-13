// screens/NotificationsScreen.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet,
  FlatList, RefreshControl, SafeAreaView, useColorScheme, TouchableOpacity, Modal, Pressable, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { getNotificationsOnNode, getSingleProfile } from '../lib/deso';
import { useNavigation } from '@react-navigation/native';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const atobPoly = (input: string) => {
  try {
    // @ts-ignore
    if (typeof global !== 'undefined' && typeof (global as any).atob === 'function') return (global as any).atob(input);
  } catch {}
  try {
    // @ts-ignore
    return Buffer.from(input, 'base64').toString('binary');
  } catch {
    return input;
  }
};

function tryB64(s: any): string {
  if (!s || typeof s !== 'string') return String(s || '');
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) {
    try {
      const decoded = atobPoly(s);
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
    } catch {}
  }
  return s;
}

function fmtTime(ms: number | null) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

// ────────────────────────────────────────────────────────────────────────────
// DETEKCIJA TIPOVA
// ────────────────────────────────────────────────────────────────────────────
function detectTypeFull(n: any) {
  const md = n?.Metadata || {};

  const assocTypeRaw = String(md.AssociationType || '');
  const assocValRaw  = String(md.AssociationValue || '');
  const assocType = tryB64(assocTypeRaw).toUpperCase();
  const assocVal  = tryB64(assocValRaw).toUpperCase();
  if (assocType === 'REACTION') {
    if (assocVal === 'LIKE') return 'LIKE';
    if (assocVal === 'REPOST' || assocVal === 'REQUOTE') return 'REPOST';
    if (assocVal === 'REPLY' || assocVal === 'COMMENT') return 'REPLY';
    if (assocVal === 'DIAMOND') return 'DIAMOND';
  }

  if (md.LikeTxindexMetadata) return 'LIKE';
  if (md.DiamondTxindexMetadata) return 'DIAMOND';
  if (md.FollowTxindexMetadata) return 'FOLLOW';

  if (md.SubmitPostTxindexMetadata) {
    if (md.SubmitPostTxindexMetadata?.IsQuotedReclout) return 'REPOST';
    if (md.SubmitPostTxindexMetadata?.ParentPostHashHex) return 'REPLY';
    if (md.SubmitPostTxindexMetadata?.RecloutedPostHashHex || md.SubmitPostTxindexMetadata?.RecloutPostHashHex) return 'REPOST';
    return 'POST';
  }

  // Diamonds via BasicTransfer / CreatorCoinTransfer / extras
  const diamondLevel =
    Number(md?.BasicTransferTxindexMetadata?.DiamondLevel ?? 0) ||
    Number(md?.CreatorCoinTransferTxindexMetadata?.DiamondLevel ?? 0) ||
    Number(md?.DiamondLevel ?? 0) ||
    Number((md?.ExtraData || md?.extraData || {})?.DiamondLevel ?? 0);
  if (diamondLevel > 0) return 'DIAMOND';

  if (
    md.NFTBidTxindexMetadata ||
    md.AcceptNFTBidTxindexMetadata ||
    md.NFTTransferTxindexMetadata ||
    md.NFTBurnTxindexMetadata ||
    md.CreateNFTTxindexMetadata
  ) return 'NFT';

  // Fallback textual types
  const t = String(md.NotificationType || md.TxnType || n?.TxnType || '').toUpperCase();
  if (t.includes('ATOMIC_TXNS_WRAPPER')) return diamondLevel > 0 ? 'DIAMOND' : 'ACTIVITY';
  if (t.includes('CREATE_POST_ASSOCIATION')) return 'LIKE'; // treat as a "like"
  if (t.includes('LIKE')) return 'LIKE';
  if (t.includes('DIAMOND')) return 'DIAMOND';
  if (t.includes('FOLLOW')) return 'FOLLOW';
  if (t.includes('REPLY') || t.includes('COMMENT')) return 'REPLY';
  if (t.includes('SUBMIT_POST')) return 'POST';
  if (t.includes('REPOST') || t.includes('REQUOTE')) return 'REPOST';
  if (t.includes('BASIC_TRANSFER')) return diamondLevel > 0 ? 'DIAMOND' : 'TRANSFER';
  if (t.includes('NFT')) return 'NFT';

  return t || 'NOTIFICATION';
}

function pickFromPk(md: any) {
  return (
    md.TransactorPublicKeyBase58Check ||
    md.AffectedPublicKeyBase58Check ||
    md.ProfilePublicKeyBase58Check ||
    md.PosterPublicKeyBase58Check ||
    ''
  );
}

function pickPostHash(md: any) {
  return (
    md.PostHashHex ||
    md.DiamondPostHashHex ||
    md.RecloutPostHashHex ||
    md.ParentPostHashHex ||
    ''
  );
}



function pickPostHashRobust(n: any, md: any) {
  return (
    md?.PostHashHex ||
    md?.DiamondPostHashHex ||
    md?.RecloutPostHashHex ||
    md?.ParentPostHashHex ||
    n?.txIndexMetadata?.ParentPostHashHex ||
    n?.txIndexMetadata?.PostHashBeingModifiedHex ||
    n?.txIndexMetadata?.PostHashHex ||
    n?.PostHashHex ||
    ''
  );
}

function makeLabelFromNotification(n: any) {
  const md = n?.Metadata || {};
  const t = detectTypeFull(n);
  const from = pickFromPk(md);
  const post = pickPostHashRobust(n, md);

  switch (t) {
    case 'LIKE':    return { title: '❤️ Liked your post', from, post };
    case 'DIAMOND': {
      const lvl = (md.DiamondLevel ?? md?.BasicTransferTxindexMetadata?.DiamondLevel ?? 1);
      return { title: `💎 Gave you x${lvl}`, from, post };
    }
    case 'REPLY':   return { title: '💬 Replied to your post', from, post };
    case 'POST':    return { title: '🔔 Mentioned you', from, post };
    case 'REPOST':  return { title: '🔁 Reposted your post', from, post };
    case 'FOLLOW':  return { title: '➕ Started following you', from };
    case 'TRANSFER': {
      const amt = typeof md.AmountNanos === 'number' ? (md.AmountNanos / 1e9).toFixed(6) : '';
      return { title: `💰 Received ${amt} DESO`, from };
    }
    case 'NFT':     return { title: '🎨 NFT activity', from, post };
    default:        return { title: t || 'Notification', from, post, raw: md };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch helpers
// ────────────────────────────────────────────────────────────────────────────
// Fetch notifications (lib or raw HTTP)
async function getNotificationsOnNodeSafe(nodeBase: string, params: { publicKey: string; limit?: number; startIndex?: number; filterByUnread?: boolean; }) {
  try {
    const fn: any = (Deso as any).getNotificationsOnNode;
    if (typeof fn === 'function') return await fn(nodeBase, params);
  } catch {}
  return await postJson(nodeBase + '/api/v0/get-notifications', {
    PublicKeyBase58Check: params.publicKey,
    NumToFetch: params.limit ?? 50,
    FetchStartIndex: typeof params.startIndex === 'number' ? params.startIndex : undefined,
    FilterByUnread: !!params.filterByUnread,
  });
}

async function fetchPage(nodeBase: string, publicKey: string, limit: number, startIndex?: number, unreadOnly?: boolean) {
  const resp: any = await getNotificationsOnNodeSafe(nodeBase, { publicKey, limit, startIndex, filterByUnread: unreadOnly });
  const list = resp?.Notifications || resp?.notifications || [];
  const next = (typeof resp?.NextStartIndex === 'number' ? resp?.NextStartIndex
    : typeof resp?.FetchStartIndex === 'number' ? resp?.FetchStartIndex
    : typeof resp?.LastSeenIndex === 'number' ? resp?.LastSeenIndex
    : undefined);
  return { list, next };
}

async function fetchAllNotificationsForPk(nodeBase: string, publicKey: string, unreadOnly: boolean) {
  let startIndex: number | undefined = undefined;
  let all: any[] = [];

  const first = await fetchPage(nodeBase, publicKey, 50, startIndex, unreadOnly);
  all = all.concat(first.list);
  let next = first.next;

  if (all.length < 1) {
    const latest = await fetchPage(nodeBase, publicKey, 50, -1 as any, unreadOnly);
    all = latest.list.concat(all);
    if (typeof latest.next === 'number') next = latest.next;
  }

  for (let i = 0; i < 5; i++) {
    if (typeof next !== 'number') break;
    const pg = await fetchPage(nodeBase, publicKey, 50, next, unreadOnly);
    all = all.concat(pg.list);
    next = pg.next;
    if (!pg.list.length) break;
  }
  return all;
}

async function fetchAllNotifications(nodeBase: string, publicKey: string, derivedPk?: string | null, unreadOnly?: boolean) {
  const buckets: any[][] = [];
  if (publicKey) buckets.push(await fetchAllNotificationsForPk(nodeBase, publicKey, !!unreadOnly));
  if (derivedPk && derivedPk !== publicKey) buckets.push(await fetchAllNotificationsForPk(nodeBase, derivedPk, !!unreadOnly));

  const seen = new Set<string>();
  const all = ([] as any[]).concat(...buckets).filter((n: any, idx: number) => {
    const txh = n?.TransactionHash || n?.transactionHash;
    const kh = n?.BlockHashHex || n?.blockHash || '';
    const ki = (n?.TxnIndexInBlock ?? n?.indexInBlock ?? '');
    const ph = getPostHashFromNotification(n) || '';
    const tp = n?.Metadata?.TxnType || n?.TxnType || '';
    let k = txh || `${kh}|${ki}`;
    if (!k || k === '|') k = `${tp}|${ph}|${idx}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  all.sort((a: any, b: any) => {
    const ta = Number(a?.TimestampNanos || 0);
    const tb = Number(b?.TimestampNanos || 0);
    if (ta !== tb) return tb - ta;
    const ha = Number(a?.Block?.height || a?.BlockHeight || 0);
    const hb = Number(b?.Block?.height || b?.BlockHeight || 0);
    if (ha !== hb) return hb - ha;
    const ia = Number(a?.TxnIndexInBlock ?? a?.indexInBlock ?? 0);
    const ib = Number(b?.TxnIndexInBlock ?? b?.indexInBlock ?? 0);
    return ib - ia;
  });

  return all;
}

// ───────────────────────────────────────────────────────────────────────────
// Post preview (fallback)
async function fetchPostByHash(nodeBase: string, postHashHex: string, readerPk?: string | null) {
  try {
    const json = await postJson(nodeBase + '/api/v0/get-single-post', {
      PostHashHex: postHashHex,
      ReaderPublicKeyBase58Check: readerPk || '',
      FetchParents: false,
      FetchSubcomments: true,
      CommentLimit: 60,
      ThreadLevelLimit: 2,
    });
    return json?.PostFound || null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// UI row
function NotiRow({
  item,
  colors,
  onPress,
}: {
  item: { title: string; type: string; from?: string; post?: string; parent?: string; comment?: string; ts?: number; raw?: any };
  colors: any;
  onPress: (it: any) => void;
}) {
  const [fromName, setFromName] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const pk = item?.from || '';
      if (!pk) return;
      try {
        const prof: any = await (Deso as any).getSingleProfile?.({ publicKeyOrUsername: pk });
        const name = prof?.Profile?.Username ? '@' + prof.Profile.Username : (pk.slice(0, 6) + '…' + pk.slice(-4));
        if (mounted) setFromName(name);
      } catch {
        if (mounted) setFromName(pk.slice(0, 6) + '…' + pk.slice(-4));
      }
    })();
    return () => { mounted = false; };
  }, [item?.from]);

  return (
    <TouchableOpacity onPress={() => onPress(item)} activeOpacity={0.85}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.title}</Text>
        {!!fromName && <Text style={{ color: colors.sub, marginTop: 2 }}>From: {fromName}</Text>}
        {!!item.post && <Text style={{ color: colors.sub, marginTop: 2 }}>Post: {String(item.post).slice(0, 12)}…</Text>}
        {!!item.ts && <Text style={{ color: colors.sub, marginTop: 2 }}>{fmtTimeMs(item.ts)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Screen
export default function NotificationsScreen() {
  const { publicKey, derivedPublicKeyBase58Check } = useAuth();
  const { nodeBase, setNodeBase } = useSettings();
  const scheme = useColorScheme();
  const nav = useNavigation<any>();
  const dark = scheme === 'dark';

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);

  // preview fallback
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewPost, setPreviewPost] = useState<any>(null);

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    card: dark ? '#0b0b0c' : '#f7f7f9',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  const toggleNode = useCallback(() => {
    const next = nodeBase?.includes('deso.org') ? 'https://desocialworld.com' : 'https://node.deso.org';
    setNodeBase(next);
  }, [nodeBase, setNodeBase]);

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12 }}>
      <Ionicons name="notifications-outline" size={22} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20, flex: 1 }}>Notifications</Text>

      <TouchableOpacity onPress={toggleNode} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 12 }}>{(nodeBase || '').replace('https://', '')}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setUnreadOnly(v => !v)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
        <Text style={{ color: colors.text, fontSize: 12 }}>{unreadOnly ? 'Unread' : 'All'}</Text>
      </TouchableOpacity>
    </View>
  );

  const openFromNotification = useCallback(async (it: any) => {
    const raw = it?.raw || it;
    const type = it?.type || detectType(raw);

    // REPLY → otvori parent post i fokusiraj reply
    if (type === 'REPLY') {
      const parent = it?.parent || getParentPostHashFromNotification(raw) || getPostHashFromNotification(raw);
      const comment = it?.comment || getReplyCommentHashFromNotification(raw);
      if (parent) {
        // pokušaj navigacije na PostDetail (gniježđeno pa direktno)
        try { nav.navigate('Feed', { screen: 'PostDetail', params: { postHashHex: parent, focusCommentHashHex: comment, nodeBase } }); return; } catch {}
        try { nav.navigate('PostDetail', { postHashHex: parent, focusCommentHashHex: comment, nodeBase }); return; } catch {}
        // fallback
        const post = await fetchPostByHash(nodeBase, parent, publicKey);
        if (post) { setPreviewPost(post); setPreviewVisible(true); return; }
      }
      Alert.alert('Greška', 'Nije moguće otvoriti razgovor za ovaj reply.');
      return;
    }

    // Ostali tipovi s postom → otvori post
    const hash = it?.post || getPostHashFromNotification(raw);
    if (hash) {
      try { nav.navigate('Feed', { screen: 'PostDetail', params: { postHashHex: hash, nodeBase } }); return; } catch {}
      try { nav.navigate('PostDetail', { postHashHex: hash, nodeBase }); return; } catch {}
      const post = await fetchPostByHash(nodeBase, hash, publicKey);
      if (post) { setPreviewPost(post); setPreviewVisible(true); return; }
      Alert.alert('Post nije pronađen', 'Nije moguće dohvatiti post za ovu notifikaciju.');
      return;
    }

    // TRANSFER ili bez hasha → otvori profil pošiljatelja (fallback)
    const md = raw?.Metadata || {};
    const pk =
      md?.TransactorPublicKeyBase58Check ||
      md?.AffectedPublicKeyBase58Check ||
      md?.ProfilePublicKeyBase58Check ||
      md?.PosterPublicKeyBase58Check ||
      null;

    if (pk) { try { nav.navigate('Profile', { publicKey: pk }); return; } catch {} }
    Alert.alert('Neuspješno otvaranje', 'Ova notifikacija nema povezani post ni profil.');
  }, [nav, nodeBase, publicKey]);

  const load = useCallback(async () => {
    if (!publicKey) { setItems([]); return; }
    setLoading(true); setErr(null);
    try {
      const list = await fetchAllNotifications(nodeBase, publicKey, derivedPublicKeyBase58Check, unreadOnly);
      const filtered = unreadOnly
        ? (list || []).filter((n: any) =>
            n?.IsUnread === true ||
            n?.isUnread === true ||
            n?.Metadata?.IsUnread === true ||
            n?.Metadata?.Viewed === false ||
            typeof n?.IsUnread === 'undefined'
          )
        : (list || []);

      const arr = filtered.map((n: any) => {
        const lab = makeLabel(n);
        const tsMs = n?.TimestampNanos ? Math.floor(Number(n.TimestampNanos) / 1e6) : undefined;
        return { ...lab, ts: tsMs, raw: n };
      });

      setItems(arr);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setItems([]);
    } finally { setLoading(false); }
  }, [publicKey, derivedPublicKeyBase58Check, nodeBase, unreadOnly]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: colors.sub, fontSize: 12 }}>
          PK: {publicKey ? publicKey.slice(0, 6) + '…' + publicKey.slice(-4) : '—'}
        </Text>
        <Text style={{ color: colors.sub, fontSize: 12, marginTop: 2 }}>
          Node: {(nodeBase || '').replace('https://', '')}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={{ color: colors.sub, marginTop: 8 }}>Učitavam obavijesti…</Text>
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={{ color: colors.sub, textAlign: 'center' }}>{err}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <NotiRow item={item} colors={colors} onPress={openFromNotification} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: 12, paddingTop: 8 }}
          ListEmptyComponent={
            <View style={styles.center}><Text style={{ color: colors.sub }}>Nema obavijesti za prikaz.</Text></View>
          }
        />
      )}

      {/* Fallback preview modal */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, flex: 1 }}>Post preview</Text>
              <Pressable onPress={() => setPreviewVisible(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={colors.sub} />
              </Pressable>
            </View>
            <ScrollView style={{ padding: 12 }}>
              {!previewPost ? (
                <Text style={{ color: colors.sub }}>Unable to load post.</Text>
              ) : (
                <View>
                  {!!previewPost?.ProfileEntryResponse?.Username && (
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      @{previewPost.ProfileEntryResponse.Username}
                    </Text>
                  )}
                  {!!previewPost?.Body && (
                    <Text style={{ color: colors.text, marginTop: 8 }}>{previewPost.Body}</Text>
                  )}
                  {!!previewPost?.ImageURLs?.length && previewPost.ImageURLs.map((u: string, i: number) => (
                    <Text key={i} style={{ color: colors.sub, marginTop: 6 }}>{u}</Text>
                  ))}
                  {!!previewPost?.PostHashHex && (
                    <Text style={{ color: colors.sub, marginTop: 8, fontSize: 12 }}>
                      #{previewPost.PostHashHex}
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
});
