// screens/WalletScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  useColorScheme,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { useAuth } from '../context/AuthProvider';
import {
  getProfile,
  getRealBalanceNanos,
  sendDesoUnsigned,
  desoToNanos,
  nanosToDeso,
  submitTransactionHex,
} from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';
import { Ionicons } from '@expo/vector-icons';

export default function WalletScreen() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const { publicKey } = useAuth();
  const [loading, setLoading] = useState(false);
  const [balanceNanos, setBalanceNanos] = useState<number | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('0.0001');
  const [sending, setSending] = useState(false);

  const canSend = useMemo(
    () => !!publicKey && !!to.trim() && Number(amount) > 0 && !sending,
    [publicKey, to, amount, sending]
  );

  useEffect(() => {
    (async () => {
      if (!publicKey) { setBalanceNanos(null); setUsername(null); return; }
      setLoading(true);
      try {
        const prof: any = await getProfile(publicKey);
        setUsername(prof?.Profile?.Username ?? null);
        const nanos = await getRealBalanceNanos(publicKey); // Profile.DESOBalanceNanos
        setBalanceNanos(nanos);
      } catch {
        setBalanceNanos(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [publicKey]);

  const onSend = async () => {
    if (!publicKey) { Alert.alert('Not logged in', 'Please log in first.'); return; }
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) { Alert.alert('Invalid amount', 'Enter a positive DESO amount.'); return; }

    setSending(true);
    try {
      const unsigned = await sendDesoUnsigned({
        senderPublicKey: publicKey,
        recipient: to.trim(),
        amountNanos: desoToNanos(amt),
      });
      const unsignedHex = (unsigned as any)?.TransactionHex;
      if (!unsignedHex) throw new Error('Node did not return TransactionHex');

      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      const submitRes = await submitTransactionHex(signedTransactionHex);
      const txnHash = (submitRes as any)?.TxnHashHex || (submitRes as any)?.TransactionHashHex || null;

      if (txnHash) Alert.alert('Sent 🎉', `TxnHash: ${txnHash.substring(0, 10)}…`);
      else Alert.alert('Sent', 'Transaction submitted. (Check console for details)');
      console.log('[Wallet] submit TX result:', submitRes);
    } catch (e: any) {
      console.warn('[Wallet] send error:', e);
      const msg: string = e?.message ?? String(e);
      if (/insufficient/i.test(msg)) Alert.alert('Not enough DESO', 'Lower the amount and try again (include fee).');
      else if (/permission|limit/i.test(msg)) Alert.alert('Approvals', 'Spending limit may not allow BASIC_TRANSFER.');
      else if (/does not exist/i.test(msg)) Alert.alert('User not found', 'Check username or public key (BC1…).');
      else Alert.alert('Send failed', msg);
    } finally {
      setSending(false);
    }
  };

  const colors = {
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    dim: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#ccc',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  };

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Header />

      {!publicKey ? (
        <Text style={{ color: '#c60' }}>You are not logged in.</Text>
      ) : (
        <Text style={{ color: colors.dim }} numberOfLines={1}>
          Account: {username ? `@${username}` : publicKey}
        </Text>
      )}

      <View style={{ height: 12 }} />

      {loading ? (
        <View style={styles.row}><ActivityIndicator /><Text style={{ marginLeft: 8, color: colors.text }}>Loading balance…</Text></View>
      ) : (
        <Text style={{ color: colors.text }}>
          Balance: {balanceNanos == null ? '—' : `${nanosToDeso(balanceNanos).toFixed(6)} DESO`}
        </Text>
      )}

      <View style={{ height: 16 }} />

      <Text style={[styles.label, { color: colors.text }]}>Recipient (username or public key)</Text>
      <TextInput
        placeholder="@username or BC1Y..."
        placeholderTextColor="#888"
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />

      <Text style={[styles.label, { color: colors.text }]}>Amount (DESO)</Text>
      <TextInput
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />

      {/* Rounded mobile-style Send button */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.accent, opacity: pressed || !canSend ? 0.7 : 1 },
        ]}
        onPress={onSend}
        disabled={!canSend}
      >
        <Text style={styles.buttonText}>{sending ? 'Sending…' : 'Send DESO'}</Text>
      </Pressable>

      <Text style={{ marginTop: 10, opacity: 0.7, fontSize: 12, color: colors.dim }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { marginTop: 12, marginBottom: 6, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  button: {
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
