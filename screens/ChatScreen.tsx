// screens/ChatScreen.tsx
// Enhanced Chat screen with optimistic send + better encrypted detection.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity,
  FlatList, Alert, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsProvider';
import { useAuth } from '../context/AuthProvider';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';

let decryptMessagesViaIdentity:
  | ((
      envs: Array<{
        EncryptedHex: string;
        Nonce: string;
        SenderPublicKeyBase58Check: string;
        RecipientPublicKeyBase58Check: string;
      }>
    ) => Promise<(string | null)[]>)
  | undefined;
try {
  decryptMessagesViaIdentity = require('../lib/identityAuth').decryptMessagesViaIdentity;
} catch (e) {}

const SUBMIT_BASE = 'https://node.deso.org';

async function postJson(url: string, body: any, abortMs = 15000) {
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
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return json ?? {};
  } finally { clearTimeout(timer); }
}

async function resolvePublicKey(usernameOrPk: string): Promise<string> {
  const q = (usernameOrPk || '').replace(/^@/, '').trim();
  if (!q) throw new Error('Empty recipient');
  if (/^[A-Za-z0-9]{20,}$/.test(q)) return q;
  const resp = await postJson(`${SUBMIT_BASE}/api/v0/get-single-profile`, { Username: q });
  const pk = resp?.Profile?.PublicKeyBase58Check;
  if (!pk) throw new Error('Username not found');
  return pk;
}

async function fetchBox(userPk: string, box: 'inbox' | 'outbox') {
  try {
    const r1: any = await postJson(`${SUBMIT_BASE}/api/v0/get-user-messages-stateless`, {
      UserPublicKeyBase58Check: userPk,
      NumToFetch: 60,
      Box: box,
    });
    return r1?.OrderedContactsWithMessages || r1?.ContactsWithMessages || [];
  } catch (e) {}
  try {
    const r2: any = await postJson(`${SUBMIT_BASE}/api/v0/get-messages-stateless`, {
      PublicKeyBase58Check: userPk,
      NumToFetch: 60,
    });
    return r2?.OrderedContactsWithMessages || r2?.ContactsWithMessages || [];
  } catch (e) {}
  return [];
}

function extractContactKey(c: any, me: string): string | null {
  const msg = c.Messages?.[0];
  if (!msg) return c.ProfileEntryResponse?.PublicKeyBase58Check || c.PublicKeyBase58Check || null;
  const s = msg.SenderPublicKeyBase58Check;
  const r = msg.RecipientPublicKeyBase58Check;
  if (s && s !== me) return s;
  if (r && r !== me) return r;
  return c.ProfileEntryResponse?.PublicKeyBase58Check || c.PublicKeyBase58Check || null;
}

function shortPk(pk?: string) {
  return pk ? pk.slice(0, 10) + '…' : 'unknown';
}

export default function ChatScreen() {
  const { theme } = useSettings();
  const dark = theme === 'dark';
  const { publicKey } = useAuth();

  const colors = useMemo(
    () => ({
      bg: dark ? '#000' : '#fff',
      text: dark ? '#fff' : '#000',
      sub: dark ? '#bbb' : '#666',
      border: dark ? '#222' : '#e3e3e6',
      accent: dark ? '#4ea3ff' : '#0b69ff',
    }),
    [dark]
  );

  const [contacts, setContacts] = useState<any[]>([]);
  const [selectedPk, setSelectedPk] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [msg, setMsg] = useState('');
  const [typing, setTyping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoTimer = useRef<any>(null);

  // typing indicator
  useEffect(() => {
    if (!msg) {
      setTyping(false);
      return;
    }
    setTyping(true);
    const t = setTimeout(() => setTyping(false), 1200);
    return () => clearTimeout(t);
  }, [msg]);

  const loadAll = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const [inb, outb] = await Promise.all([fetchBox(publicKey, 'inbox'), fetchBox(publicKey, 'outbox')]);
      const map = new Map<string, any>();
      const add = (c: any) => {
        const otherPk = extractContactKey(c, publicKey);
        if (!otherPk) return;
        const current = map.get(otherPk) || { PublicKeyBase58Check: otherPk, Messages: [] };
        const merged = [...current.Messages, ...(c.Messages || [])];
        merged.sort((a, b) => (a?.TstampNanos || 0) - (b?.TstampNanos || 0));
        map.set(otherPk, {
          ...current,
          ProfileEntryResponse: c.ProfileEntryResponse || current.ProfileEntryResponse,
          Messages: merged,
        });
      };
      (inb || []).forEach(add);
      (outb || []).forEach(add);
      const list = Array.from(map.values());
      setContacts(list);

      if (selectedPk) {
        const found = list.find((c) => extractContactKey(c, publicKey) === selectedPk);
        setThread(found?.Messages || []);
        setSelectedUsername(found?.ProfileEntryResponse?.Username || selectedUsername || null);
      } else if (list.length) {
        // auto-select first thread if nothing selected
        const pk0 = extractContactKey(list[0], publicKey || '');
        setSelectedPk(pk0);
        setSelectedUsername(list[0]?.ProfileEntryResponse?.Username || null);
        setThread(list[0]?.Messages || []);
      }
    } finally {
      setLoading(false);
    }
  }, [publicKey, selectedPk, selectedUsername]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // auto-refresh
  useEffect(() => {
    if (!autoRefresh) {
      if (autoTimer.current) clearInterval(autoTimer.current);
      return;
    }
    autoTimer.current = setInterval(() => {
      loadAll();
    }, 20000);
    return () => {
      if (autoTimer.current) clearInterval(autoTimer.current);
    };
  }, [autoRefresh, loadAll]);

  // auto-decrypt (best effort; supports V2 fields too)
  useEffect(() => {
    if (!decryptMessagesViaIdentity || !thread?.length) return;
    (async () => {
      try {
        const envs = thread.map((m: any) => ({
          EncryptedHex:
            m?.EncryptedHex ||
            m?.EncryptedText || // some nodes
            m?.V2?.EncryptedText || // V2 nested
            '',
          Nonce: m?.Nonce || m?.V2?.Nonce || '',
          SenderPublicKeyBase58Check: m?.SenderPublicKeyBase58Check || '',
          RecipientPublicKeyBase58Check: m?.RecipientPublicKeyBase58Check || '',
        }));
        if (!envs.some((e) => e.EncryptedHex && e.Nonce)) return;
        const texts = await decryptMessagesViaIdentity!(envs);
        thread.forEach((m: any, i: number) => {
          if (texts[i]) m.DecryptedText = texts[i];
        });
        // trigger re-render
        setThread((t) => [...t]);
      } catch (e) {
        // ignore – keep encrypted placeholders
      }
    })();
  }, [thread]);

  const selectByInput = useCallback(async () => {
    const q = recipientInput.trim();
    if (!q) return;
    try {
      const pk = await resolvePublicKey(q);
      setSelectedPk(pk);
      setSelectedUsername(q.startsWith('@') ? q.slice(1) : null);
      await loadAll();
    } catch (e: any) {
      Alert.alert('Not found', e.message);
    }
  }, [recipientInput, loadAll]);

  const send = useCallback(async () => {
    if (!publicKey || !selectedPk) return;
    const body = msg.trim();
    if (!body) return;
    setSending(true);
    try {
      // 1) build unsigned
      const r: any = await postJson(`${SUBMIT_BASE}/api/v0/send-message-stateless`, {
        SenderPublicKeyBase58Check: publicKey,
        RecipientPublicKeyBase58Check: selectedPk,
        MessageText: body,
        MinFeeRateNanosPerKB: 1000,
      });
      const unsignedHex = r?.TransactionHex || r?.transactionHex;
      if (!unsignedHex) throw new Error('Failed to create unsigned tx');

      // 2) sign via Identity
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);

      // 3) submit
      await postJson(`${SUBMIT_BASE}/api/v0/submit-transaction`, { TransactionHex: signedTransactionHex });

      // 4) optimistic append so user immediately sees plaintext
      const optimistic = {
        SenderPublicKeyBase58Check: publicKey,
        RecipientPublicKeyBase58Check: selectedPk,
        MessageText: body,
        TstampNanos: Date.now() * 1e6,
        IsEncrypted: false,
      };
      setThread((t) => [...t, optimistic]);

      setMsg('');
      // (optional) refresh in background to align with server ordering
      setTimeout(() => loadAll(), 500);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSending(false);
    }
  }, [publicKey, selectedPk, msg, loadAll]);

  const ContactChip = ({ c }: { c: any }) => {
    const pk = extractContactKey(c, publicKey || '') || '';
    const active = pk === selectedPk;
    const uname = c?.ProfileEntryResponse?.Username;
    return (
      <TouchableOpacity
        onPress={() => {
          setSelectedPk(pk);
          setSelectedUsername(uname || null);
          setThread(c.Messages || []);
        }}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: active ? colors.accent : colors.border,
          borderRadius: 999,
          marginRight: 8,
          backgroundColor: active ? (dark ? '#061931' : '#eaf2ff') : 'transparent',
        }}
      >
        <Text style={{ color: active ? colors.accent : colors.text, fontWeight: '700' }}>
          {uname ? '@' + uname : shortPk(pk)}
        </Text>
      </TouchableOpacity>
    );
  };

  const MessageBubble = ({ it }: any) => {
    const isMe = it?.SenderPublicKeyBase58Check === publicKey;

    // better encrypted detection
    const isEncrypted =
      Boolean(it?.IsEncrypted) || Boolean(it?.EncryptedText) || Boolean(it?.V2?.EncryptedText);

    const text = it?.DecryptedText || it?.MessageText || (isEncrypted ? '[encrypted]' : '[no text]');

    return (
      <View
        style={{
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          maxWidth: '82%',
          marginVertical: 4,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 14,
          backgroundColor: isMe ? (dark ? '#0a1624' : '#eef5ff') : (dark ? '#121212' : '#f3f3f6'),
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.text }}>{text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
      </View>

      {/* Search row */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          value={recipientInput}
          onChangeText={setRecipientInput}
          placeholder="Search contact: @username or public key"
          placeholderTextColor={colors.sub}
          style={{ flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.text }}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={selectByInput}
        />
        <TouchableOpacity
          onPress={selectByInput}
          style={{ marginLeft: 8, backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}
        >
          <Ionicons name="search" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Contacts */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <FlatList
          data={contacts}
          keyExtractor={(_, i) => 'c' + i}
          renderItem={({ item }) => <ContactChip c={item} />}
          horizontal
          showsHorizontalScrollIndicator={false}
        />
      </View>

      {/* Auto-refresh toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: colors.sub, marginRight: 6 }}>Auto-refresh</Text>
        <Switch value={autoRefresh} onValueChange={setAutoRefresh} />
      </View>

      {/* Thread */}
      <FlatList
        data={thread}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <MessageBubble it={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        style={{ flex: 1 }}
        ListEmptyComponent={!loading ? <Text style={{ color: colors.sub, padding: 16 }}>No messages</Text> : null}
      />

      {/* Composer */}
      <View style={{ padding: 16, borderTopWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <TextInput
            value={msg}
            onChangeText={setMsg}
            placeholder={selectedPk ? 'Write a message…' : 'Pick or search a contact first…'}
            placeholderTextColor={colors.sub}
            style={{
              flex: 1,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 10,
              color: colors.text,
              minHeight: 44,
              maxHeight: 120,
            }}
            editable={!!selectedPk}
            multiline
          />
          <TouchableOpacity
            onPress={send}
            disabled={!selectedPk || sending || !msg.trim()}
            style={{
              marginLeft: 10,
              backgroundColor: colors.accent,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 12,
              opacity: !selectedPk || sending || !msg.trim() ? 0.6 : 1,
            }}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
        {typing && <Text style={{ color: colors.sub, marginTop: 6 }}>Typing…</Text>}
      </View>
    </SafeAreaView>
  );
}
