// screens/ProfileScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Button, useColorScheme /* unused; replaced by SettingsProvider theme */, SafeAreaView } from 'react-native';
import { useSettings } from '../context/SettingsProvider';
import { useAuth } from '../context/AuthProvider';
import { getSingleProfile } from '../lib/deso';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen() {
  const scheme = useColorScheme /* unused; replaced by SettingsProvider theme */();
  const dark = scheme === 'dark';
  const { publicKey, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    (async () => {
      if (!publicKey) return;
      setLoading(true);
      setErr(null);
      try {
        const resp = await getSingleProfile({ publicKeyOrUsername: publicKey });
        setProfile(resp?.Profile ?? null);
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
  };

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 19 }}>MyDeSoMobile</Text>
    </View>
  );

  if (!publicKey) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <Header />
        <Text style={{ color: colors.text }}>You are not logged in.</Text>
        <View style={{ height: 12 }} />
        <Button title="Log out" onPress={logout} />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <Header />
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: colors.text }}>Loading profile…</Text>
      </SafeAreaView>
    );
  }

  if (err) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <Header />
        <Text style={{ color: '#c00', fontWeight: '600' }}>Failed to load profile</Text>
        <Text style={{ color: colors.dim, textAlign: 'center' }}>{err}</Text>
        <View style={{ height: 12 }} />
        <Button title="Log out" onPress={logout} />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <Header />
        <Text style={{ color: colors.text }}>No profile found for:</Text>
        <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{publicKey}</Text>
        <View style={{ height: 12 }} />
        <Button title="Log out" onPress={logout} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]}>
      <Header />

      <Text style={[styles.title, { color: colors.text }]}>Profile</Text>

      <Text style={[styles.label, { color: colors.text }]}>Public Key</Text>
      <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>{publicKey}</Text>

      <Text style={[styles.label, { color: colors.text }]}>Username</Text>
      <Text style={[styles.value, { color: colors.text }]}>{profile?.Username || '—'}</Text>

      <Text style={[styles.label, { color: colors.text }]}>Description</Text>
      <Text style={[styles.value, { color: colors.text }]}>{profile?.Description || '—'}</Text>

      <View style={{ height: 16 }} />
      <Button title="Log out" onPress={logout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  center: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { marginTop: 10, fontWeight: '600', opacity: 0.8 },
  value: { marginTop: 4 },
});
