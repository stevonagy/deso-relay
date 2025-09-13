// screens/NotificationsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import * as Deso from '../lib/deso';



// ───────────────────────────────────────────────────────────────────────────
// Utils
const HEX64 = /^[0-9A-Fa-f]{64}$/;

const atobSafe = (input: string) => {
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
      const decoded = atobSafe(s);
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
    } catch {}
  }
  return s;
}

async function postJson(url: string, body: any, abortMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), abortMs);
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
    return json;
  } finally { clearTimeout(timer); }
}

function fmtTimeMs(ms?: number | null) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

// Robustan extractor vremena (pa nema “Invalid date” rubova)
function extractTimestampMs(n: any): number | undefined {
  const candidates: any[] = [
    n?.TimestampNanos,
    n?.timestampNanos,
    n?.Metadata?.TimestampNanos,
    n?.metadata?.TimestampNanos,
    n?.Block?.TimestampNanos,
    n?.Block?.timestampNanos,
    n?.Block?.TstampNanos,
    n?.TstampNanos,
  ];
  for (const c of candidates) {
    const num = Number(c);
    if (Number.isFinite(num) && num > 0) return Math.floor(num / 1e6); // nanos → ms
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Deep hash extraction — GLAVNI FIX
type DeepExtract = { first?: string; all: string[]; paths: Record<string,string> };

function extractPostHashesDeep(root: any): DeepExtract {
  const all: string[] = [];
  const paths: Record<string,string> = {};
  const seenObjs = new Set<any>();

  function pushHex(val: string, path: string) {
    if (!HEX64.test(val)) return;
    if (!all.includes(val)) {
      all.push(val);
      paths[val] = path;
    }
  }

  function scanStringMaybeJsonBase64(str: string, path: string) {
    if (HEX64.test(str)) { pushHex(str, path); return; }
    const b = tryB64(str);
    if (HEX64.test(b)) { pushHex(b, path + ' (b64)'); return; }
    try {
      const at = atobSafe(str);
      if (HEX64.test(at)) pushHex(at, path + ' (atob)');
      try {
        const j = JSON.parse(at);
        scanNode(j, path + ' (b64.json)');
      } catch {}
    } catch {}
    try {
      const j2 = JSON.parse(str);
      scanNode(j2, path + ' (json)');
    } catch {}
  }

  function scanNode(node: any, path: string) {
    if (!node) return;
    if (typeof node === 'string') { scanStringMaybeJsonBase64(node, path); return; }
    if (typeof node !== 'object') return;
    if (seenObjs.has(node)) return;
    seenObjs.add(node);

    if (node.PostHashHex && typeof node.PostHashHex === 'string') pushHex(node.PostHashHex, path + '.PostHashHex');

    for (const key of Object.keys(node)) {
      const val = node[key];
      const p = path ? `${path}.${key}` : key;

      if (typeof val === 'string') {
        if (/post.*hash.*hex/i.test(key) || /hashhex/i.test(key) || /reclout.*hash/i.test(key) || /repost.*hash/i.test(key) || /quoted.*hash/i.test(key)) {
          if (HEX64.test(val)) pushHex(val, p);
          else scanStringMaybeJsonBase64(val, p);
          continue;
        }
        scanStringMaybeJsonBase64(val, p);
        continue;
      }

      scanNode(val, p);
    }
  }

  scanNode(root, 'root');
  return { first: all[0], all, paths };
}

// ───────────────────────────────────────────────────────────────────────────
// TYPE DETECTION + HASH EXTRACT
function diamondLevelFromMd(md: any): number {
  const ex = md?.ExtraData || md?.extraData || {};
  return (
    Number(md?.DiamondLevel ?? 0) ||
    Number(md?.DiamondTxindexMetadata?.DiamondLevel ?? 0) ||
    Number(md?.BasicTransferTxindexMetadata?.DiamondLevel ?? 0) ||
    Number(md?.CreatorCoinTransferTxindexMetadata?.DiamondLevel ?? 0) ||
    Number(ex?.DiamondLevel ?? 0)
  ) || (md?.DiamondPostHashHex ? 1 : 0);
}

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
    return 'POST'; // mention / new-post
  }

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

  const t = String(md.NotificationType || md.TxnType || n?.TxnType || '').toUpperCase();
  if (t.includes('ATOMIC_TXNS_WRAPPER')) return diamondLevel > 0 ? 'DIAMOND' : 'ACTIVITY';
  if (t.includes('CREATE_POST_ASSOCIATION')) return 'LIKE';
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

// — hash helpers (s deep scan fallback) —
function getPostHashFromNotification(n: any): string | null {
  const md = n?.Metadata || n?.metadata || {};
  const assoc = md?.Association || md?.association || {};
  const assocVal = assoc?.AssociationValue || assoc?.associationValue || '';

  // 1) poznata mjesta
  const candidates: Array<string | undefined> = [
    md?.PostHashHex,
    md?.DiamondPostHashHex,
    md?.LikedPostHashHex,
    md?.RepostedPostHashHex,
    md?.RecloutPostHashHex,
    md?.RecloutedPostHashHex,
    md?.QuotedRepostHashHex,
    md?.ParentPostHashHex,
    md?.CommentedPostHashHex,
    md?.MentionedPostHashHex,
    md?.NFTPostHashHex,
    md?.LikeTxindexMetadata?.LikedPostHashHex,
    md?.DiamondTxindexMetadata?.DiamondPostHashHex,
    md?.SubmitPostTxindexMetadata?.PostHashHex,
    md?.SubmitPostTxindexMetadata?.RecloutPostHashHex,
    md?.SubmitPostTxindexMetadata?.RecloutedPostHashHex,
    n?.PostHashHex,
    n?.PostEntryResponse?.PostHashHex,
    n?.CommentEntryResponse?.PostHashHex,
    n?.txIndexMetadata?.PostHashHex,
    n?.txIndexMetadata?.PostHashBeingModifiedHex,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && HEX64.test(c)) return c;
  }

  // 2) AssociationValue (plain/b64/json)
  if (typeof assocVal === 'string' && assocVal) {
    const plain = tryB64(assocVal);
    if (HEX64.test(plain)) return plain;
    try {
      const decoded = atobSafe(assocVal);
      if (HEX64.test(decoded)) return decoded;
      const maybeJson = JSON.parse(decoded);
      const deep = extractPostHashesDeep(maybeJson);
      if (deep.first) return deep.first;
    } catch {}
    try {
      const maybeJson2 = JSON.parse(assocVal);
      const deep2 = extractPostHashesDeep(maybeJson2);
      if (deep2.first) return deep2.first;
    } catch {}
  }

  // 3) deep scan cijele notifikacije
  const deep = extractPostHashesDeep(n);
  return deep.first || null;
}

function getParentPostHashFromNotification(n: any): string | null {
  const md = n?.Metadata || n?.metadata || {};
  const cand: Array<string | undefined> = [
    md?.ParentPostHashHex,
    md?.CommentedPostHashHex,
    md?.SubmitPostTxindexMetadata?.ParentPostHashHex,
    n?.txIndexMetadata?.ParentPostHashHex,
  ];
  for (const c of cand) {
    if (typeof c === 'string' && HEX64.test(c)) return c;
  }
  const deep = extractPostHashesDeep(md?.SubmitPostTxindexMetadata || n);
  const parent = deep.all.find(h => (deep.paths[h] || '').toLowerCase().includes('parentposthashhex'));
  return parent || null;
}

function getReplyCommentHashFromNotification(n: any): string | null {
  const md = n?.Metadata || n?.metadata || {};
  const cand: Array<string | undefined> = [
    md?.SubmitPostTxindexMetadata?.PostHashHex,
    n?.CommentEntryResponse?.PostHashHex,
    md?.CommentPostHashHex,
  ];
  for (const c of cand) {
    if (typeof c === 'string' && HEX64.test(c)) return c;
  }
  const deep = extractPostHashesDeep(md?.SubmitPostTxindexMetadata || n?.CommentEntryResponse || n);
  const comment = deep.all.find(h => {
    const p = (deep.paths[h] || '').toLowerCase();
    return p.includes('comment') || p.includes('submitposttxindexmetadata.posthashhex');
  });
  return comment || deep.first || null;
}

function pickFromPk(md: any) {
  return (
    md?.TransactorPublicKeyBase58Check ||
    md?.AffectedPublicKeyBase58Check ||
    md?.ProfilePublicKeyBase58Check ||
    md?.PosterPublicKeyBase58Check ||
    ''
  );
}

function makeLabel(n: any) {
  const md = n?.Metadata || {};
  const type = detectTypeFull(n);
  const from = pickFromPk(md);
  const post = getPostHashFromNotification(n) || undefined;
  const diamondLevel = diamondLevelFromMd(md);

  switch (type) {
    case 'LIKE':    return { title: '❤️ Liked your post', type, from, post };
    case 'DIAMOND': return { title: `💎 Gave you x${diamondLevel || 1}`, type, from, post };
    case 'REPLY':   return { title: '💬 Replied to your post', type, from, post,
                              parent: getParentPostHashFromNotification(n),
                              comment: getReplyCommentHashFromNotification(n) };
    case 'REPOST':  return { title: '🔁 Reposted your post', type, from, post };
    case 'POST':    return { title: '🔔 Mentioned you', type, from, post };
    case 'FOLLOW':  return { title: '➕ Started following you', type, from };
    case 'NFT':     return { title: '🎨 NFT activity', type, from, post };
    case 'TRANSFER':{
      const amt = typeof md.AmountNanos === 'number' ? (md.AmountNanos / 1e9).toFixed(6) : '';
      return { title: `💰 Received ${amt} DESO`, type: 'TRANSFER', from };
    }
    default:        return { title: 'Notification', type, from, post };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Fetch notifications
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
  const { theme } = useSettings();
  const nav = useNavigation<any>();
  const dark = theme === 'dark';

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

    
    </View>
  );

  // OnPress ponašanje po tipu

// Pokušaj pronaći PRAVI hash na koji backend stvarno vraća post.
// Koristi poznate putanje + deep scan kandidate i prefetch-a svaki dok ne nađe valjan post.
const resolveAndOpenPost = useCallback(async (raw: any) => {
  // prikupi kandidate
  const primary = getPostHashFromNotification(raw);
  const deep = extractPostHashesDeep(raw);
  const set = new Set<string>();
  const candidates: string[] = [];
  const push = (h?: string | null) => { if (h && /^[0-9A-Fa-f]{64}$/.test(h) && !set.has(h)) { set.add(h); candidates.push(h); } };

  // prioritet: ono što već koristimo
  push(primary);

  // dodatne “poznate” putanje (nekad različite od primary)
  const md = raw?.Metadata || {};
  push(md?.LikeTxindexMetadata?.LikedPostHashHex);
  push(md?.DiamondTxindexMetadata?.DiamondPostHashHex);
  push(md?.SubmitPostTxindexMetadata?.PostHashHex);
  push(md?.SubmitPostTxindexMetadata?.RecloutedPostHashHex);
  push(md?.SubmitPostTxindexMetadata?.RecloutPostHashHex);
  push(md?.MentionedPostHashHex);
  push(raw?.PostEntryResponse?.PostHashHex);
  push(raw?.CommentEntryResponse?.PostHashHex);
  push(raw?.txIndexMetadata?.PostHashHex);

  // deep kandidati na kraju (može ih biti puno – uzmi prvih 8 da ne radiš previše poziva)
  for (const h of (deep.all || [])) { push(h); if (candidates.length > 12) break; }

  // safety: ako NIŠTA, nema smisla dalje
  if (candidates.length === 0) throw new Error('No post hash candidates.');

  // prefetch u nizu; prvi koji uspije → navigacija
  for (const h of candidates) {
    try {
      const found = await fetchPostByHash(nodeBase, h, publicKey);
      if (found && found.PostHashHex) {
        // koristimo ISTI put kao za reply (dokazano radi)
        try {
          nav.navigate('Feed', { screen: 'PostDetail', params: { postHashHex: h, nodeBase } });
        } catch {
          nav.navigate('PostDetail', { postHashHex: h, nodeBase });
        }
        return true;
      }
    } catch {
      // ignoriši i probaj sljedećeg
    }
  }

  // nijedan kandidat nije prošao
  throw new Error('Backend did not return any post for the provided candidates.');
}, [nav, nodeBase, publicKey]);


  const openFromNotification = useCallback(async (it: any) => {
    const raw = it?.raw || it;
    const type = it?.type || detectTypeFull(raw);

    // 1) REPLY → zadržavamo postojeći flow (parent + fokus na reply)
    if (type === 'REPLY') {
      const parent = it?.parent || getParentPostHashFromNotification(raw) || getPostHashFromNotification(raw);
      const comment = it?.comment || getReplyCommentHashFromNotification(raw);
      if (parent) {
        try { nav.navigate('Feed', { screen: 'PostDetail', params: { postHashHex: parent, focusCommentHashHex: comment, nodeBase } }); return; } catch {}
        try { nav.navigate('PostDetail', { postHashHex: parent, focusCommentHashHex: comment, nodeBase }); return; } catch {}
        const post = await fetchPostByHash(nodeBase, parent, publicKey);
        if (post) { setPreviewPost(post); setPreviewVisible(true); return; }
      }
      Alert.alert('Greška', 'Nije moguće otvoriti razgovor za ovaj reply.');
      return;
    }

    // 2) TRANSFER (“Received DESO”) → ne otvara ništa
    if (type === 'TRANSFER') {
      return;
    }

    // 3) FOLLOW → otvori profil pošiljatelja
    if (type === 'FOLLOW') {
      const md = raw?.Metadata || {};
      const pk =
        md?.TransactorPublicKeyBase58Check ||
        md?.AffectedPublicKeyBase58Check ||
        md?.ProfilePublicKeyBase58Check ||
        md?.PosterPublicKeyBase58Check ||
        null;

      if (pk) { try { nav.navigate('Profile', { publicKey: pk }); } catch {} }
      return;
    }

// 4) LIKE / DIAMOND / POST (MENTION) / REPOST / NFT → koristi resolver s prefetchom
try {
  const ok = await resolveAndOpenPost(raw);
  if (ok) return;
} catch (e: any) {
  // padamo na alert niže
}

Alert.alert('Post nije pronađen', 'Nije moguće dohvatiti post za ovu notifikaciju.');
return;


    // Ako je tip koji očekuje post, a hasha nema — samo obavijesti
    Alert.alert('Nedostaje post', 'Ova notifikacija nema vezani PostHash.');
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
        const tsMs = extractTimestampMs(n); // robustno
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
