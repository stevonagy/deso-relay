// components/DeriveModal.tsx
import React, { useMemo, useRef, useState } from 'react';
import { Modal, View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

// ⛑️ Tvoj webview relay HTML (onaj koji si poslao)
const RELAY_WEBVIEW_HTML = 'https://stevonagy.github.io/deso-relay/deso-relay-webview.html';

type Props = {
  visible: boolean;
  publicKeyBase58Check: string;
  onClose: () => void;
  onSuccess: (params: Record<string, string>) => void;
  spending?: { SUBMIT_POST?: number };
};

function encJSON(obj: any) {
  return encodeURIComponent(JSON.stringify(obj));
}

export default function DeriveModal(props: Props) {
  const { visible, publicKeyBase58Check, onClose, onSuccess, spending } = props;
  const [loading, setLoading] = useState(true);
  const webRef = useRef<WebView>(null);

  const deriveUrl = useMemo(() => {
    const txLimit = { TransactionCountLimitMap: { SUBMIT_POST: spending?.SUBMIT_POST ?? 10 } };
    const redirectFallback = encodeURIComponent('desomobile://derive'); // samo fallback
    const callback = `${RELAY_WEBVIEW_HTML}?redirect=${redirectFallback}`;

    const pk = encodeURIComponent(publicKeyBase58Check);
    const tx = encJSON(txLimit);

    const url =
      `https://identity.deso.org/derive` +
      `?callback=${encodeURIComponent(callback)}` +
      `&webview=true` +
      `&PublicKeyBase58Check=${pk}` +
      `&PublicKey=${pk}` +
      `&publicKey=${pk}` +
      `&TransactionSpendingLimitResponse=${tx}` +
      `&TransactionSpendingLimit=${tx}`;

    console.log('[WV] /derive URL =', url);
    return url;
  }, [publicKeyBase58Check, spending]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      console.log('[WV] message =', data);
      if (data?.event === 'derive-complete' && data?.params) {
        onSuccess(data.params as Record<string, string>);
        onClose();
      }
    } catch (err) {
      console.warn('[WV] parse message err:', err);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        )}
        <WebView
          ref={webRef}
          source={{ uri: deriveUrl }}
          onMessage={onMessage}
          onLoadStart={(ev) => console.log('[WV] load start:', ev.nativeEvent.url)}
          onLoadEnd={() => { setLoading(false); console.log('[WV] load end'); }}
          onNavigationStateChange={(nav) => console.log('[WV] nav:', nav.url)}
          onError={(ev) => console.error('[WV] onError:', ev.nativeEvent)}
          onHttpError={(ev) => console.error('[WV] onHttpError:', ev.nativeEvent)}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith('desomobile://')) {
              console.log('[WV] blocked app-scheme nav:', req.url);
              return false;
            }
            return true;
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0000000D' },
  loader: {
    position: 'absolute',
    zIndex: 9,
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
