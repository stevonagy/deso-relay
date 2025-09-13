// screens/ComposeScreen.tsx
// Multi-image compose (up to 3). Thumbnails, non-blocking layout. Networking stays on node.deso.org.
// Now includes: dynamic count label (e.g., "Pick images (2/3)") and "Take photo" camera capture.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  
  Image,
  SafeAreaView,
  Pressable,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthProvider';
import { signTransactionHexViaIdentity } from '../lib/identityAuth';
import { getItem } from '../lib/secureStore';
import { Ionicons } from '@expo/vector-icons';

const SUBMIT_BASE = 'https://node.deso.org';
import { useSettings } from '../context/SettingsProvider';

async function postJson(url: string, body: any, abortMs = 20000) {
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
    return json ?? {};
  } finally { clearTimeout(timer); }
}

async function postMultipart(url: string, form: FormData, abortMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal as any });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as any;
      (err as any).body = text;
      throw err;
    }
    return json ?? {};
  } finally { clearTimeout(timer); }
}

type Picked = { uri: string; mime?: string };

export default function ComposeScreen() {
  const { publicKey } = useAuth();
  const { theme } = useSettings();
  const dark = theme === 'dark';

  const [username, setUsername] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      if (!publicKey) { setUsername(null); return; }
      try {
        const resp = await postJson(`${SUBMIT_BASE}/api/v0/get-single-profile`, { PublicKeyBase58Check: publicKey }, 12000);
        setUsername(resp?.Profile?.Username ?? null);
      } catch { setUsername(null); }
    })();
  }, [publicKey]);

  const canPost = useMemo(() =>
    !!publicKey && (!!text.trim() || picked.length > 0 || uploadedUrls.length > 0) && !posting && !uploading,
    [publicKey, text, picked, uploadedUrls, posting, uploading]
  );

  const colors = {
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    border: dark ? '#222' : '#e3e3e6',
    dim: dark ? '#bbb' : '#666',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    success: '#28a745',
    teal: '#20c997',
  };

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
    </View>
  );

  const mergeAndClamp = (existing: Picked[], add: Picked[]) => {
    return [...existing, ...add].slice(0, 3);
  };

  const pickImages = async () => {
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
      allowsMultipleSelection: true,
      selectionLimit: 3,
      quality: 0.9,
    };
    const result = await ImagePicker.launchImageLibraryAsync(opts);
    if (!result.canceled) {
      const assets = (result as any).assets || [];
      const mapped: Picked[] = assets.map((a: any) => ({ uri: a.uri, mime: a.mimeType || 'image/jpeg' }));
      setPicked(prev => {
        const next = mergeAndClamp(prev, mapped);
        if (next.length !== prev.length) setUploadedUrls([]); // reset uploads if selection changed
        return next;
      });
    }
  };

  const takePhoto = async () => {
    let ImagePicker: any;
    try { ImagePicker = await import('expo-image-picker'); }
    catch {
      Alert.alert('Image picker nije instaliran', 'Pokreni:\n\nnpx expo install expo-image-picker\n\nZatim: npx expo start -c');
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Allow camera to take a photo.'); return; }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: false,
    } as any);
    if (!result.canceled) {
      const asset = (result as any).assets?.[0];
      if (asset?.uri) {
        setPicked(prev => {
          const next = mergeAndClamp(prev, [{ uri: asset.uri, mime: asset.mimeType || 'image/jpeg' }]);
          if (next.length !== prev.length) setUploadedUrls([]);
          return next;
        });
      }
    }
  };

  const removePickedAt = (idx: number) => {
    setPicked(prev => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length !== prev.length) setUploadedUrls([]);
      return next;
    });
  };

  const ensureUploadIfNeeded = async (): Promise<string[]> => {
    if (uploadedUrls.length && uploadedUrls.length === picked.length) return uploadedUrls;
    if (picked.length === 0 || !publicKey) return [];
    setUploading(true);
    try {
      const jwtPrimary = (await getItem<string>('deso.jwt')) as string | null;
      const jwtDerived = (await getItem<string>('deso.derivedJwt')) as string | null;
      const token = jwtPrimary || jwtDerived;
      if (!token) throw new Error('Nedostaje JWT. Ponovno se prijavi (Identity) za media upload.');

      const uploads = await Promise.all(picked.map(async (p) => {
        const form = new FormData();
        form.append('UserPublicKeyBase58Check', publicKey || '');
        form.append('JWT', token);
        // @ts-ignore React Native file
        form.append('file', { uri: p.uri, name: 'upload.jpg', type: p.mime || 'image/jpeg' });
        const json: any = await postMultipart(`${SUBMIT_BASE}/api/v0/upload-image`, form, 45000);
        const url = json?.ImageURL || json?.imageURL || json?.ImageURLHTTPS || '';
        if (!url) {
          const err = new Error('Missing ImageURL in response') as any;
          (err as any).body = JSON.stringify(json);
          throw err;
        }
        return url;
      }));
      setUploadedUrls(uploads);
      return uploads;
    } finally { setUploading(false); }
  };

  const onPost = async () => {
    if (!publicKey) { Alert.alert('Not logged in', 'Please log in first.'); return; }
    const body = text.trim();

    setPosting(true);
    try {
      const imageUrls = await ensureUploadIfNeeded();

      const unsigned = await postJson(`${SUBMIT_BASE}/api/v0/submit-post`, {
        UpdaterPublicKeyBase58Check: publicKey,
        BodyObj: { Body: body, ImageURLs: imageUrls },
      }, 20000);

      const unsignedHex = (unsigned as any)?.TransactionHex;
      if (!unsignedHex) throw new Error('Node did not return TransactionHex');

      const { signedTransactionHex } = await signTransactionHexViaIdentity(unsignedHex);
      const submitRes = await postJson(`${SUBMIT_BASE}/api/v0/submit-transaction`, { TransactionHex: signedTransactionHex }, 20000);

      const postHash =
        (submitRes as any)?.PostEntryResponse?.PostHashHex ||
        (submitRes as any)?.TxnHashHex ||
        (unsigned as any)?.PostHashHex || null;

      Alert.alert('Posted 🎉', postHash ? `PostHash: ${postHash.substring(0,10)}…` : 'Transaction submitted.');
      setText(''); setPicked([]); setUploadedUrls([]);
    } catch (e: any) {
      console.warn('[Compose] error:', e);
      Alert.alert('Post failed', e?.message ?? String(e));
    } finally { setPosting(false); }
  };

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Header />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!publicKey ? (
          <Text style={[styles.warn, { color: '#c60' }]}>You are not logged in. Log in to create a post.</Text>
        ) : (
          <Text style={{ opacity: 0.7, marginBottom: 8, color: colors.dim }}>
            Posting as: {username ? `@${username}` : publicKey}
          </Text>
        )}

        <TextInput
          placeholder="What's happening? (type your post here)"
          placeholderTextColor={colors.dim}
          value={text}
          onChangeText={setText}
          style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          multiline
        />

        {/* Media buttons row */}
        <View style={{ gap: 8 }}>
          {/* Pick images (gallery) with count */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.success, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={pickImages}
          >
            <Text style={styles.buttonText}>
              Pick images ({picked.length}/3)
            </Text>
          </Pressable>

          {/* Take photo (camera) */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.teal, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={takePhoto}
          >
            <Text style={styles.buttonText}>Take photo</Text>
          </Pressable>
        </View>

        {uploading && <ActivityIndicator style={{ marginTop: 8 }} />}

        {/* Thumbnails row (non-blocking size) */}
        {picked.length > 0 && (
          <View style={styles.thumbRow}>
            {picked.map((p, i) => (
              <View key={i} style={styles.thumbWrap}>
                <Image source={{ uri: p.uri }} style={styles.thumb} />
                <Pressable style={styles.thumbRemove} onPress={() => removePickedAt(i)}>
                  <Text style={styles.thumbRemoveTxt}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Post button */}
        {posting ? (
          <View style={[styles.row, { marginTop: 12 }]}><ActivityIndicator /><Text style={{ marginLeft: 8, color: colors.text }}>Submitting…</Text></View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.accent, opacity: pressed || !canPost ? 0.7 : 1 },
            ]}
            onPress={onPost}
            disabled={!canPost}
          >
            <Text style={styles.buttonText}>Post</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  warn: { marginBottom: 8 },
  input: {
    minHeight: 210,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', alignItems: 'center' },

  // Buttons
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

  // Thumbnails layout
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  thumbWrap: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveTxt: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 16,
  },
});
