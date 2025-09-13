// components/IdentityAuthModal.tsx
import React, { useRef } from 'react';
import { Modal, View, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  visible: boolean;
  startUrl: string;                // https://identity.deso.org/log-in?... ili /derive?...
  onResult: (returnUrl: string) => void; // desomobile://login?... ili desomobile://derive?...
  onClose: () => void;
};

export default function IdentityAuthModal({ visible, startUrl, onResult, onClose }: Props) {
  const webRef = useRef<WebView>(null);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <WebView
          ref={webRef}
          source={{ uri: startUrl }}
          originWhitelist={['*']}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          setSupportMultipleWindows
          cacheEnabled={false}
          allowsBackForwardNavigationGestures
          startInLoadingState
          renderLoading={() => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator />
            </View>
          )}
          onLoadStart={(e) => {
            console.log('[Identity WebView] loadStart:', e.nativeEvent.url);
          }}
          onNavigationStateChange={(nav) => {
            const url = nav.url || '';
            console.log('[Identity WebView] nav:', url);
            if (url.startsWith('desomobile://login') || url.startsWith('desomobile://derive')) {
              onResult(url);
              // NE zatvaramo modal ovdje — roditelj odlučuje kada zatvoriti
            }
          }}
          onShouldStartLoadWithRequest={(req) => {
            const url = req.url;
            console.log('[Identity WebView] shouldStart:', url);
            if (url.startsWith('desomobile://login') || url.startsWith('desomobile://derive')) {
              onResult(url);
              // NE zatvaramo modal ovdje — roditelj odlučuje
              return false;
            }
            return true;
          }}
          userAgent={
            Platform.OS === 'android'
              ? 'Mozilla/5.0 (Linux; Android 14; WebView App) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
              : undefined
          }
          mixedContentMode="always"
          allowsInlineMediaPlayback
        />
      </View>
    </Modal>
  );
}
