// screens/ProfileScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  SafeAreaView,
  TextInput,
  Alert,
  Image,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { getSingleProfile, submitTransactionHex } from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';

// Prepare an unsigned UpdateProfile transaction (description only for now)
async function updateProfileUnsigned(opts: { updaterPublicKey: string; newDescription?: string }) {
  const body = {
    UpdaterPublicKeyBase58Check: opts.updaterPublicKey,
    ProfilePublicKeyBase58Check: opts.updaterPublicKey,
    NewUsername: '',
    NewDescription: opts.newDescription ?? '',
    NewProfilePic: '',
    NewCreatorBasisPoints: 0,
    NewStakeMultipleBasisPoints: 12500,
    IsHidden: false,
    MinFeeRateNanosPerKB: 1000,
  };
  const res = await fetch('https://desocialworld.com/api/v0/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to prepare update-profile transaction');
  const data = await res.json();
  const hex = data?.TransactionHex || data?.TransactionHexResponse;
  if (!hex) throw new Error('update-profile did not return TransactionHex');
  return hex as string;
}

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const { publicKey, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [desc, setDesc] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!publicKey) return;
      setLoading(true);
      setErr(null);
      try {
        const resp = await getSingleProfile({ publicKeyOrUsername: publicKey });
        const prof = resp?.Profile ?? null;
        setProfile(prof);
        setDesc(prof?.Description ?? '');
      } catch (e: any) {
        setErr(e?.message ?? String(e));
        setProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [publicKey]);

  const colors = {
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    dim: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    success: '#28a745',
    danger: '#d9534f',
  };

  const Header = () => (
    <View style={styles.header}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={[styles.headerText, { color: colors.text }]}>MyDeSoMobile</Text>
    </View>
  );

  const onSaveProfile = async () => {
    if (!publicKey) return;
    try {
      setSaving(true);
      const unsigned = await updateProfileUnsigned({
        updaterPublicKey: publicKey,
        newDescription: desc,
      });
      const signed = await signTransactionHexViaIdentity({ unsignedTxHex: unsigned });
      await submitTransactionHex(signed);
      Alert.alert('Profile updated', 'Your description was updated successfully.');
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!publicKey) {
    return (
      <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
        <Header />
        <View style={styles.center}>
          <Text style={{ color: colors.dim }}>You are not logged in.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Header />

      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : err ? (
        <View style={styles.center}><Text style={{ color: '#f33' }}>{err}</Text></View>
      ) : profile ? (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            {/* Avatar */}
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Image
                source={{
                  uri:
                    profile?.ExtraData?.LargeProfilePicURL ||
                    profile?.ProfilePic ||
                    'https://placehold.co/120x120',
                }}
                style={{ width: 120, height: 120, borderRadius: 60 }}
              />
              <TouchableOpacity
                onPress={() => Alert.alert('Change Avatar', 'Avatar change is not implemented in this demo.')}
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: colors.accent }}>Change Avatar</Text>
              </TouchableOpacity>
            </View>

            {/* Username */}
            <Text style={[styles.username, { color: colors.text }]}>
              {profile?.Username || 'Profile'}
            </Text>

            {/* Public key */}
            <Text
              style={[styles.pubkey, { color: colors.dim }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {profile?.PublicKeyBase58Check}
            </Text>

            {/* Description */}
            <Text style={[styles.label, { color: colors.text }]}>Description</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              multiline
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text, flex: 1 },
              ]}
              placeholder="Tell something about yourself…"
              placeholderTextColor={dark ? '#888' : '#777'}
            />
          </ScrollView>

          {/* Action buttons at bottom - Pressable styled like Login button */}
          <View style={{ marginTop: 12 }}>
    

            {/* Logout */}
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.danger, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={logout}
            >
              <Text style={styles.buttonText}>Log out</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.center}><Text style={{ color: colors.text }}>No profile data.</Text></View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  center: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  headerText: { fontWeight: '800', fontSize: 19 },
  username: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  pubkey: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  label: { marginTop: 10, fontWeight: '600', opacity: 0.8 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', minHeight: 200 },

  // New rounded mobile buttons (match LoginScreen style)
  button: {
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
