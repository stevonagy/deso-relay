// screens/HelpScreen.tsx
import React from 'react';
import { SafeAreaView, View, Text, ScrollView, useColorScheme /* unused; replaced by SettingsProvider theme */ } from 'react-native';
import { useSettings } from '../context/SettingsProvider';
import { Ionicons } from '@expo/vector-icons';

export default function HelpScreen() {
  const scheme = useColorScheme /* unused; replaced by SettingsProvider theme */();
  const dark = scheme === 'dark';
  const colors = {
    bg: dark ? '#000' : '#fff',
    text: dark ? '#fff' : '#000',
    sub: dark ? '#bbb' : '#444',
    accent: dark ? '#4ea3ff' : '#0b69ff',
    border: dark ? '#222' : '#e5e5ea',
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal:16, paddingTop: 24, paddingBottom: 12, flexDirection:'row', alignItems:'center' }}>
        <Ionicons name="help-circle-outline" size={22} color={colors.accent} style={{ marginRight: 8 }} />
        <Text style={{ color: colors.text, fontWeight:'800', fontSize: 20 }}>MyDeSoMobile — Quick Help</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding:16 }}>
        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>What is this app?</Text>
        <Text style={{ color: colors.sub, marginBottom: 16 }}>A lightweight mobile window into the DeSo blockchain, focused on social features.</Text>

        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Navigation</Text>
        <Text style={{ color: colors.sub, marginBottom: 2 }}>• Tabs (bottom): Feed, Compose, Notifications, Chat, Profile.</Text>
        <Text style={{ color: colors.sub, marginBottom: 2 }}>• Hamburger menu (on Feed): Node settings, Wallet, Blocked users, Theme, NFT Zone.</Text>

        <Text style={{ color: colors.text, fontWeight: '700', marginVertical: 8 }}>Login</Text>
        <Text style={{ color: colors.sub, marginBottom: 16 }}>Tap Login and follow Identity. Existing users can use their DeSo account; new users can create one via Identity.</Text>

        <Text style={{ color: colors.text, fontWeight: '700', marginVertical: 8 }}>Wallet</Text>
        <Text style={{ color: colors.sub, marginBottom: 16 }}>View DESO balance and send DESO. The app signs transactions via Identity.</Text>

        <Text style={{ color: colors.text, fontWeight: '700', marginVertical: 8 }}>Chat</Text>
        <Text style={{ color: colors.sub, marginBottom: 16 }}>End-to-end encrypted DMs. Use Decrypt to view messages; ensure Messaging permissions in your spending limits.</Text>

        <Text style={{ color: colors.text, fontWeight: '700', marginVertical: 8 }}>Theme</Text>
        <Text style={{ color: colors.sub, marginBottom: 16 }}>Choose Light or Dark. The app can also follow your system setting.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
