// screens/LoginScreen.tsx
import * as React from 'react';
import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';

export default function LoginScreen() {
  const { publicKey, login, authing } = useAuth();
  const { theme } = useSettings();
  const dark = theme === 'dark';

  const colors = useMemo(() => ({
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#666',
    border: dark ? '#222' : '#e3e3e6',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    card: dark ? '#0a0a0a' : '#fff',
  }), [dark]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* App title */}
      <View style={styles.headerRow}>
        <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.accent} style={{ marginRight: 10 }} />
        <Text style={[styles.title, { color: colors.text }]}>MyDeSoMobile</Text>
      </View>

      {/* Welcome text */}
      <Text style={[styles.welcome, { color: colors.text }]}>
        Welcome to <Text style={{ fontWeight: '800' }}>MyDeSoMobile</Text> — your window into the DeSo blockchain.
        Connect and interact with people across the network in a streamlined, social-first way.
        The app keeps things simple and fast, so some advanced features from web apps may not be included.
      </Text>

      {/* Status */}
      <Text style={[styles.status, { color: colors.sub }]}>
        {publicKey ? `Logged in as: ${publicKey}` : 'Not logged in'}
      </Text>

      {/* Login action */}
      <View style={{ marginTop: 20, width: '70%' }}>
        {authing ? (
          <View style={styles.row}>
            <ActivityIndicator />
            <Text style={[styles.loading, { color: colors.sub }]}> Authorizing…</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.accent, opacity: pressed || publicKey ? 0.7 : 1 },
            ]}
            onPress={login}
            disabled={!!publicKey}
          >
            <Text style={styles.buttonText}>
              {publicKey ? 'Logged in' : 'Log in with DeSo'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Helper text */}
      {!publicKey && !authing && (
        <Text style={[styles.helper, { color: colors.sub }]}>
          New to DeSo? Tap the login button above and follow the steps in the Identity screen to create your account.{"\n\n"}
          Already have a DeSo profile? Sign in with your existing account to get started.
        </Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  welcome: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  status: {
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    marginLeft: 8,
    fontSize: 14,
  },
  button: {
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  helper: {
    marginTop: 20,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
});
