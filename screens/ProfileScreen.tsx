// screens/ProfileScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import { getSingleProfile, submitTransactionHex } from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';

const NODE_HELPER = 'https://desocialworld.com'; // helper endpoint to build unsigned update-profile

type UpdateProfileOpts = {
  updaterPublicKey: string;
  newDescription?: string;
  // data URL, e.g. "data:image/jpeg;base64,...." or "data:image/webp;base64,..."
  newProfilePicDataUrl?: string;
};

// Build an unsigned UpdateProfile TX (supports description + avatar)
async function updateProfileUnsigned(opts: UpdateProfileOpts) {
  const body = {
    UpdaterPublicKeyBase58Check: opts.updaterPublicKey,
    ProfilePublicKeyBase58Check: opts.updaterPublicKey,
    NewUsername: '',
    NewDescription: opts.newDescription ?? '',
    NewProfilePic: opts.newProfilePicDataUrl ?? '',
    NewCreatorBasisPoints: 10000, // keep existing values (do not change royalties)
    NewStakeMultipleBasisPoints: 12500,
    IsHidden: false,
    MinFeeRateNanosPerKB: 1000,
  };
  const res = await fetch(`${NODE_HELPER}/api/v0/update-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = data?.error || `Failed to prepare update-profile (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const hex = data?.TransactionHex || data?.TransactionHexResponse;
  if (!hex) throw new Error('update-profile did not return TransactionHex');
  return hex as string;
}

export default function ProfileScreen() {
  const { theme } = useSettings();
  const dark = theme === 'dark';
  const { publicKey, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [desc, setDesc] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

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

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    dim: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    success: '#28a745',
    danger: '#d9534f',
    card: dark ? '#0a0a0a' : '#f7f7f9',
  }), [dark]);

  const Header = () => (
    <View style={styles.header}>
      <Ionicons name="person-circle-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={[styles.headerText, { color: colors.text }]}>My Profile</Text>
    </View>
  );

  async function pickAvatar() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to change your avatar.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        base64: false,
      });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      // Resize to a square and compress → base64 data URL (JPEG is OK; WEBP also works)
      const manip = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manip.base64) throw new Error('Failed to read image');
      const dataUrl = `data:image/jpeg;base64,${manip.base64}`;
      setAvatarDataUrl(dataUrl);
      setAvatarPreview(manip.uri);
    } catch (e: any) {
      Alert.alert('Avatar', e?.message ?? String(e));
    }
  }

  const onSaveProfile = async () => {
    if (!publicKey) return;
    try {
      setSaving(true);
      // 1) Build unsigned TX
      const unsignedHex = await updateProfileUnsigned({
        updaterPublicKey: publicKey,
        newDescription: desc,
        newProfilePicDataUrl: avatarDataUrl || undefined,
      });
      if (!unsignedHex || typeof unsignedHex !== 'string') {
        throw new Error('Unsigned transaction hex is invalid.');
      }
      // 2) Ask Identity to sign — IMPORTANT: pass raw hex string, expect { signedTransactionHex }
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      if (!signedTransactionHex) {
        throw new Error('Signing was cancelled or failed.');
      }
      // 3) Submit
      await submitTransactionHex(signedTransactionHex);
      Alert.alert('Profile updated', 'Your profile was updated successfully.');
      // clear local pending avatar flag
      setAvatarDataUrl(null);
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
                source={{ uri: avatarPreview || profile?.ExtraData?.LargeProfilePicURL || profile?.ProfilePic || 'https://placehold.co/120x120' }}
                style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: colors.card }}
              />
              <TouchableOpacity onPress={pickAvatar} style={{ marginTop: 8 }}>
                <Text style={{ color: colors.accent, fontWeight: '700' }}>{avatarPreview ? 'Change selected avatar' : 'Change Avatar'}</Text>
              </TouchableOpacity>
              {!!avatarPreview && (
                <Text style={{ color: colors.dim, fontSize: 12, marginTop: 4 }}>New avatar selected (not yet saved)</Text>
              )}
            </View>

            {/* Username */}
            <Text style={[styles.username, { color: colors.text }]}>
              {profile?.Username || 'Profile'}
            </Text>

            {/* Public key */}
            <Text style={[styles.pubkey, { color: colors.dim }]} numberOfLines={1} ellipsizeMode="middle">
              {profile?.PublicKeyBase58Check}
            </Text>

            {/* Description */}
            <Text style={[styles.label, { color: colors.text }]}>Description</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              multiline
              style={[styles.input, { borderColor: colors.border, color: colors.text, flex: 1 }]}
              placeholder="Tell something about yourself…"
              placeholderTextColor={dark ? '#888' : '#777'}
            />
          </ScrollView>

          {/* Action buttons at bottom */}
          <View style={{ marginTop: 12 }}>
            <Pressable
              style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, opacity: pressed || saving ? 0.8 : 1 }]}
              onPress={onSaveProfile}
              disabled={saving}
            >
              <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.button, { backgroundColor: colors.danger, opacity: pressed ? 0.7 : 1 }]}
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
  button: { borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
