// screens/ComposeScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ActivityIndicator, useColorScheme, Image, SafeAreaView } from 'react-native';
import { useAuth } from '../context/AuthProvider';
import { submitPostUnsigned, submitTransactionHex, uploadImageFromDevice, getSingleProfile } from '../lib/deso';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';
import { getItem } from '../lib/secureStore';
import { Ionicons } from '@expo/vector-icons';

export default function ComposeScreen() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const { publicKey } = useAuth();

  const [username, setUsername] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<{ uri: string; mime?: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!publicKey) { setUsername(null); return; }
      try {
        const resp: any = await getSingleProfile({ publicKeyOrUsername: publicKey });
        setUsername(resp?.Profile?.Username ?? null);
      } catch { setUsername(null); }
    })();
  }, [publicKey]);

  const canPost = useMemo(() => !!publicKey && (!!text.trim() || !!picked || !!uploadedUrl) && !posting && !uploading, [publicKey, text, picked, uploadedUrl, posting, uploading]);

  const colors = {
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    border: dark ? '#222' : '#ccc',
    dim: dark ? '#bbb' : '#666',
    accent: dark ? '#4ea3ff' : '#0b69ff',
  };

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
    </View>
  );

  const pickImage = async () => {
    let ImagePicker: any;
    try { ImagePicker = await import('expo-image-picker'); }
    catch {
      Alert.alert('Image picker nije instaliran', 'Pokreni:\n\nnpx expo install expo-image-picker\n\nZatim: npx expo start -c');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access to attach images.'); return; }

    const opts: any = {
      mediaTypes: ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images,
      allowsMultipleSelection: false,
      quality: 0.9,
    };
    const result = await ImagePicker.launchImageLibraryAsync(opts);
    if (!result.canceled) {
      const asset = result.assets[0];
      setPicked({ uri: asset.uri, mime: asset.mimeType || 'image/jpeg' });
      setUploadedUrl(null);
    }
  };

  const ensureUploadIfNeeded = async (): Promise<string[]> => {
    if (uploadedUrl) return [uploadedUrl];
    if (!picked || !publicKey) return [];
    setUploading(true);
    try {
      const jwtPrimary = (await getItem<string>('deso.jwt')) as string | null;
      const jwtDerived = (await getItem<string>('deso.derivedJwt')) as string | null;
      const token = jwtPrimary || jwtDerived;
      if (!token) throw new Error('Nedostaje JWT. Ponovno se prijavi (Identity) za media upload.');
      const url = await uploadImageFromDevice({ jwt: token, userPublicKey: publicKey, fileUri: picked.uri, mimeType: picked.mime });
      setUploadedUrl(url);
      return [url];
    } finally { setUploading(false); }
  };

  const onPost = async () => {
    if (!publicKey) { Alert.alert('Not logged in', 'Please log in first.'); return; }
    const body = text.trim();

    setPosting(true);
    try {
      const imageUrls = await ensureUploadIfNeeded();
      const unsigned = await submitPostUnsigned({ updaterPublicKey: publicKey, body, imageUrls });
      const unsignedHex = (unsigned as any)?.TransactionHex;
      if (!unsignedHex) throw new Error('Node did not return TransactionHex');
      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      const submitRes = await submitTransactionHex(signedTransactionHex);
      const postHash =
        (submitRes as any)?.PostEntryResponse?.PostHashHex ||
        (submitRes as any)?.TxnHashHex ||
        (unsigned as any)?.PostHashHex || null;
      Alert.alert('Objavljeno 🎉', postHash ? `PostHash: ${postHash.substring(0,10)}…` : 'Transaction submitted.');
      setText(''); setPicked(null); setUploadedUrl(null);
    } catch (e: any) {
      console.warn('[Compose] error:', e);
      Alert.alert('Post failed', e?.message ?? String(e));
    } finally { setPosting(false); }
  };

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Header />
      {!publicKey ? (
        <Text style={[styles.warn, { color: '#c60' }]}>You are not logged in. Log in to create a post.</Text>
      ) : (
        <Text style={{ opacity: 0.7, marginBottom: 8, color: colors.dim }}>
          Posting as: {username ? `@${username}` : publicKey}
        </Text>
      )}

      <TextInput
        placeholder="What's happening?"
        placeholderTextColor="#888"
        value={text}
        onChangeText={setText}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
        multiline
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Button title="Pick image" onPress={pickImage} />
        {uploading && <ActivityIndicator />}
      </View>

      {picked && (
        <View style={{ marginBottom: 12 }}>
          <Image source={{ uri: picked.uri }} style={{ width: '100%', aspectRatio: 1, borderRadius: 8 }} />
          <Text style={{ color: colors.dim, marginTop: 6 }}>Image selected (uploads on Post)</Text>
        </View>
      )}

      {posting ? (
        <View style={styles.row}><ActivityIndicator /><Text style={{ marginLeft: 8, color: colors.text }}>Submitting…</Text></View>
      ) : (
        <Button title="Post" onPress={onPost} disabled={!canPost} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  warn: { marginBottom: 8 },
  input: {
    // +~75% u odnosu na početno
    minHeight: 210,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
});
