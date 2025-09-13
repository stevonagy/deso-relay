// components/LoginWebView.tsx
import React, { useMemo } from 'react';
import { Modal, View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type Props = {
  visible: boolean;
  relayBase: string;
  onLoggedIn: (payload: { publicKeyAdded?: string; users?: any; signedUp?: string }) => void;
  onCancel: () => void;
};

function parseParamsFromUrl(url: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    const u = new URL(url);
    u.searchParams.forEach((v, k) => (out[k] = v));
    const h = (u.hash || '').replace(/^#/, '');
    if (h) new URLSearchParams(h).forEach((v, k) => (out[k] = v));
    return out;
  } catch {
    return {};
  }
}

const LoginWebView: React.FC<Props> = ({ visible, relayBase, onLoggedIn, onCancel }) => {
  const callback = useMemo(
    () => `${relayBase}?redirect=${encodeURIComponent('desomobile://login')}`,
    [relayBase]
  );

  const loginUrl = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('callback', callback);
    qs.set('accessLevelRequest', '2');
    qs.set('webview', 'true');
    const url = `https://identity.deso.org/log-in?${qs.toString()}`;
    console.log('[LoginWebView] LOGIN URL =', url);
    return url;
  }, [callback]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) || {};
      onLoggedIn({
        publicKeyAdded: data.publicKeyAdded,
        users: data.users,
        signedUp: data.signedUp,
      });
    } catch (err) {
      console.warn('[LoginWebView] onMessage parse error', err);
    }
  };

  return (
    <Modal visible={visible} onRequestClose={onCancel} animationType="slide" transparent>
      <View style={styles.wrap}>
        <WebView
          source={{ uri: loginUrl }}
          onMessage={onMessage}
          onError={(e) => console.warn('[LoginWebView] error', e.nativeEvent)}
          onLoadStart={() => console.log('[LoginWebView] load start')}
          onLoadEnd={() => console.log('[LoginWebView] load end')}
          startInLoadingState
          renderLoading={() => <ActivityIndicator size="large" style={styles.loading} />}
          onNavigationStateChange={(nav) => {
            const url = nav.url || '';
            const baseNoQuery = relayBase.split('?')[0];
            if (url.startsWith(baseNoQuery)) {
              const params = parseParamsFromUrl(url);
              if (params.publicKeyAdded) {
                onLoggedIn({
                  publicKeyAdded: params.publicKeyAdded,
                  users: params.users,
                  signedUp: params.signedUp,
                });
              }
            }
          }}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          originWhitelist={['*']}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000000cc', paddingTop: 36 },
  loading: { marginTop: 24 },
});

export default LoginWebView;
