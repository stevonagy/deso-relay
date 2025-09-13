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

function makeLabelFromNotification(n: any) {
  const md = n?.Metadata || {};
  const t = detectTypeFull(n);
  const from = pickFromPk(md);
  const post = pickPostHash(md);

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
async function fetchPage(nodeBase: string, publicKey: string, limit: number, startIndex: number | undefined, filterByUnread?: boolean) {
  const resp: any = await getNotificationsOnNode(nodeBase, { publicKey, limit, startIndex, filterByUnread });
  return {
    notifications: resp?.Notifications || [],
    next: (typeof resp?.NextStartIndex === 'number' ? resp?.NextStartIndex :
           typeof resp?.FetchStartIndex === 'number' ? resp?.FetchStartIndex :
           typeof resp?.LastSeenIndex === 'number' ? resp?.LastSeenIndex : undefined),
  };
}

async function fetchAllNotificationsForPk(nodeBase: string, publicKey: string, unreadOnly: boolean) {
  // First page: no startIndex; ask for unread if node supports it
  let startIndex: number | undefined = undefined;
  const maxPages = 6;
  let all: any[] = [];

  // first page
  const first = await fetchPage(nodeBase, publicKey, 50, startIndex, unreadOnly || undefined);
  all = all.concat(first.notifications);
  let nextIndex = first.next;

  // Fallback: some nodes return only 1 item unless startIndex:-1
  if (all.length < 2) {
    const latest = await fetchPage(nodeBase, publicKey, 50, -1 as any, unreadOnly || undefined);
    all = latest.notifications.concat(all);
    if (typeof latest.next === 'number') nextIndex = latest.next;
  }

  // more pages
  for (let i = 1; i < maxPages; i++) {
    if (typeof nextIndex !== 'number') break;
    const pg = await fetchPage(nodeBase, publicKey, 50, nextIndex, unreadOnly || undefined);
    all = all.concat(pg.notifications);
    nextIndex = pg.next;
    if (!pg.notifications.length) break;
  }

  return all;
}

async function fetchAllNotifications(nodeBase: string, publicKey: string, derivedPk?: string | null, unreadOnly?: boolean) {
  const lists: any[] = [];
  if (publicKey) lists.push(await fetchAllNotificationsForPk(nodeBase, publicKey, !!unreadOnly));
  if (derivedPk && derivedPk !== publicKey) lists.push(await fetchAllNotificationsForPk(nodeBase, derivedPk, !!unreadOnly));
  const seen = new Set<string>();
  const all = ([] as any[]).concat(...lists).filter((n:any, idx:number) => {
    const txh = n?.TransactionHash || n?.transactionHash;
    const kh = n?.BlockHashHex || n?.blockHash || '';
    const ki = (n?.TxnIndexInBlock ?? n?.indexInBlock ?? '');
    const ph = n?.Metadata?.PostHashHex || '';
    const tp = n?.Metadata?.TxnType || n?.TxnType || '';
    let k = txh || `${kh}|${ki}`;
    if (!k || k === '|') k = `${tp}|${ph}|${idx}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  all.sort((a:any,b:any)=> {
    const ta = Number(a?.TimestampNanos||0);
    const tb = Number(b?.TimestampNanos||0);
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


// ────────────────────────────────────────────────────────────────────────────
// Post preview fallback (if navigation can't open the post inside Feed tab)
// ────────────────────────────────────────────────────────────────────────────
async function fetchPostByHash(nodeBase: string, postHashHex: string, readerPk?: string | null) {
  try {
    const res = await fetch(nodeBase + '/api/v0/get-single-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        PostHashHex: postHashHex,
        ReaderPublicKeyBase58Check: readerPk || '',
        FetchParents: false,
        CommentLimit: 0,
        ThreadLevelLimit: 0,
      })
    });
    const json = await res.json();
    return json?.PostFound || null;
  } catch (e) {
    return null;
  }
}
// ────────────────────────────────────────────────────────────────────────────
// UI Components
// ────────────────────────────────────────────────────────────────────────────
function NotiRow({ item, colors, onPress }: { item: any, colors: any, onPress: (it:any)=>void }) {
  const [fromName, setFromName] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    async function resolveHandle(pk: string) {
      if (!pk) return '';
      try {
        const prof: any = await getSingleProfile({ publicKeyOrUsername: pk });
        if (!mounted) return '';
        if (prof?.Profile?.Username) return '@' + prof.Profile.Username;
      } catch {}
      return pk.slice(0, 6) + '…' + pk.slice(-4);
    }
    (async () => {
      const n = await resolveHandle(item.from || '');
      if (mounted) setFromName(n);
    })();
    return () => { mounted = false; };
  }, [item.from]);

  const ts = typeof item?.ts === 'number' ? item.ts : null;

  return (
    <TouchableOpacity onPress={() => onPress(item)} activeOpacity={0.8} style={{ width: '100%' }}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.title}</Text>
        {!!fromName && <Text style={{ color: colors.sub, marginTop: 2 }}>From: {fromName}</Text>}
        {!!item.post && <Text style={{ color: colors.sub, marginTop: 2 }}>Post: {String(item.post).slice(0, 12)}…</Text>}
        {!!ts && <Text style={{ color: colors.sub, marginTop: 2 }}>{fmtTime(ts)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const { publicKey, derivedPublicKeyBase58Check } = useAuth();
  const scheme = useColorScheme();
  const nav: any = useNavigation();
  const dark = scheme === 'dark';

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [nodeBase, setNodeBase] = useState<'https://node.deso.org' | 'https://desocialworld.com'>('https://node.deso.org');
  const [unreadOnly, setUnreadOnly] = useState(true);

  const toggleNode = useCallback(() => {
    setNodeBase((n) => (n === 'https://node.deso.org' ? 'https://desocialworld.com' : 'https://node.deso.org'));
  }, []);

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    card: dark ? '#111' : '#f4f4f6',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  }), [dark]);

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12 }}>
      <Ionicons name="notifications-outline" size={22} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20, flex: 1 }}>Notifications</Text>

      {/* Node toggle */}
      <TouchableOpacity onPress={toggleNode} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 12 }}>{nodeBase.replace('https://','')}</Text>
      </TouchableOpacity>

      {/* Unread toggle */}
      <TouchableOpacity onPress={() => setUnreadOnly((s)=>!s)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
        <Text style={{ color: colors.accent, fontSize: 12 }}>{unreadOnly ? 'Unread' : 'All'}</Text>
      </TouchableOpacity>
    </View>
  );

  // Fallback post preview modal
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPost, setPreviewPost] = useState<any>(null);

  const openFromNotification = useCallback((it: any) => {
    // If we have a PostHash, try to open a Post detail screen (route name may differ in your app)
    if (it?.post) {
      // adjust route name/params to match your navigator
      try {
        nav.navigate('FeedScreen', { postHashHex: it.post });
        return;
      } catch {}
    }
    // Otherwise open the profile of the sender
    if (it?.from) {
      try {
        nav.navigate('ProfileScreen', { publicKey: it.from });
        return;
      } catch {}
    }
  }, [nav]);

  const load = useCallback(async () => {
    if (!publicKey) { setItems([]); return; }
    setLoading(true); setErr(null);
    try {
      const list = await fetchAllNotifications(nodeBase, publicKey, derivedPublicKeyBase58Check, unreadOnly);
      // Fallback client-side unread filter if the node ignored `filterByUnread`
      const filtered = unreadOnly
        ? (list || []).filter((n:any) => n?.IsUnread === true || n?.isUnread === true || n?.Metadata?.IsUnread === true || n?.Metadata?.Viewed === false || typeof n?.IsUnread === 'undefined')
        : (list || []);

      const arr = filtered.map((n: any) => {
        const label = makeLabelFromNotification(n);
        const ts = n?.TimestampNanos ? Number(n.TimestampNanos) / 1e6 : null;
        return { ...label, ts };
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
        <Text style={{ color: colors.sub, fontSize: 12 }}>PK: {publicKey ? publicKey.slice(0,6) + '…' + publicKey.slice(-4) : '—'}</Text>
        <Text style={{ color: colors.sub, fontSize: 12, marginTop: 2 }}>Node: {nodeBase.replace('https://','')}</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator /><Text style={{ color: colors.sub, marginTop: 8 }}>Učitavam obavijesti…</Text></View>
      ) : err ? (
        <View style={styles.center}><Text style={{ color: colors.sub, textAlign: 'center' }}>{err}</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <NotiRow item={item} colors={colors} onPress={openFromNotification} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: 12, paddingTop: 8 }}
          ListEmptyComponent={<View style={styles.center}><Text style={{ color: colors.sub }}>Nema obavijesti za prikaz.</Text></View>}
        />
      )}
    
      {/* Post preview modal (fallback) */}
      <Modal visible={previewVisible} animationType="slide" transparent onRequestClose={() => setPreviewVisible(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.55)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius:16, borderTopRightRadius:16, maxHeight: '80%' }}>
            <View style={{ flexDirection:'row', alignItems:'center', padding:12 }}>
              <Text style={{ color: colors.text, fontWeight:'700', fontSize:16, flex:1 }}>Post preview</Text>
              <TouchableOpacity onPress={() => setPreviewVisible(false)} style={{ padding:6 }}>
                <Ionicons name="close" size={20} color={colors.sub} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding:12 }}>
              {previewLoading ? (
                <View style={{ alignItems:'center', padding:24 }}><ActivityIndicator /></View>
              ) : previewPost ? (
                <View>
                  {!!previewPost?.ProfileEntryResponse?.Username && (
                    <Text style={{ color: colors.text, fontWeight:'600' }}>@{previewPost.ProfileEntryResponse.Username}</Text>
                  )}
                  {!!previewPost?.Body && (
                    <Text style={{ color: colors.text, marginTop:8 }}>{previewPost.Body}</Text>
                  )}
                  {!!previewPost?.ImageURLs?.length && previewPost.ImageURLs.map((u:string, i:number) => (
                    <Text key={i} style={{ color: colors.sub, marginTop:6 }}>{u}</Text>
                  ))}
                  {!!previewPost?.PostHashHex && (
                    <Text style={{ color: colors.sub, marginTop:8, fontSize:12 }}>#{previewPost.PostHashHex}</Text>
                  )}
                </View>
              ) : (
                <Text style={{ color: colors.sub }}>Unable to load post.</Text>
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
