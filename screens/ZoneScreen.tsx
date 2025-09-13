// screens/ZoneScreen.tsx
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export default function ZoneScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <WebView source={{ uri: 'https://mytalkzone.xyz' }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
