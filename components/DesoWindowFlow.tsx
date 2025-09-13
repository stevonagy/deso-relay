// components/DesoWindowFlow.tsx
import React, { useMemo, useRef, useState } from 'react';
import { Modal, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type Props = {
  visible: boolean;
  onClose: () => void;
  onLogin: (payload: { users: any; publicKeyAdded: string; signedUp?: boolean }) => void;
  onDerive: (payload: Record<string, string>) => void;
  accessLevelRequest?: 2 | 3 | 4;
  spending?: { SUBMIT_POST?: number };
  relayUrl?: string; // https://stevonagy.github.io/deso-relay/deso-relay-webview.html
};

function encJSON(obj: any) { return encodeURIComponent(JSON.stringify(obj)); }

export default function DesoWindowFlow({
  visible,
  onClose,
  onLogin,
  onDerive,
  accessLevelRequest = 2,
  spending,
  relayUrl = 'https://stevonagy.github.io/deso-relay/deso-relay-webview.html',
}: Props) {
  const webRef = useRef<WebView>(null);
  const [stage, setStage] = useState<'login'|'derive'>('login');
  const [publicKey, setPublicKey] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const loginUrl = useMemo(() => {
    const url = `https://identity.deso.org/log-in?webview=true&accessLevelRequest=${accessLevelRequest}`;
    console.log('[DeSo] LOGIN URL =', url);
    return url;
  }, [accessLevelRequest]);

  const deriveUrl = useMemo(() => {
    const txLimit = { TransactionCountLimitMap: { SUBMIT_POST: spending?.SUBMIT_POST ?? 10 } };
    const redirect = encodeURIComponent('desomobile://derive'); // fallback ako RN nije prisutan
    const callback = `${relayUrl}?redirect=${redirect}`;
    const pk = encodeURIComponent(publicKey); // MORA biti postavljen nakon login-a
    const tx = encJSON(txLimit);
    const url =
      `https://identity.deso.org/derive` +
      `?webview=true` +
      `&callback=${encodeURIComponent(callback)}` +
      `&PublicKey=${pk}` +
      `&TransactionSpendingLimitResponse=${tx}`;
    console.log('[DeSo] DERIVE URL =', url);
    return url;
  }, [publicKey, spending, relayUrl]);

  const injected = `
    (function(){
      // presretni postMessage iz Identity (Window API) i forwardaj u RN
      window.addEventListener('message', function(e){
        try {
          var msg = e && e.data ? e.data : null;
          if (!msg || msg.service !== 'identity') return;
          window.ReactNativeWebView.postMessage(JSON.stringify({ kind:'identity', data: msg }));
        } catch(_) {}
      }, false);
    })();
  `;

  // Kriterij za "novi prozor/popup":
  // RN WebView pošalje request gdje topFrame=false ili navigationType='other' / 'click' s target=_blank.
  // Mi "gutamo" to i ručno navigiramo u ISTOM WebViewu.
  const onShouldStartLoadWithRequest = (req: any) => {
    const { url, isTopFrame, navigationType } = req;
    // Blokiraj pokušaj otvaranja app scheme-a iz WebViewa (ako se slučajno dogodi)
    if (url.startsWith('desomobile://')) {
      console.log('[WV] blocked app-scheme:', url);
      return false;
    }

    // Ako nije top frame (popup) — preusmjeri u isti webview:
    if (isTopFrame === false) {
      console.log('[WV] intercept popup -> navigate same WebView:', url);
      // Nažalost nemamo webRef.current?.loadUrl; koristimo JS ustrcavanje:
      setTimeout(() => {
        try {
          webRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(url)}; true;`);
        } catch {}
      }, 0);
      return false;
    }

    // Neki Android buildovi ne šalju isTopFrame, pa koristimo heuristiku:
    if (Platform.OS === 'android' && navigationType === 'other' && url.startsWith('https://')) {
      // Ako je identitet isti host i već smo na loginu, propuštamo.
      // Ako nije, a izgleda kao popup target, preusmjeri:
      // (ovdje smo oprezni: propustit ćemo, a fallback je gornji isTopFrame=false grana)
    }

    return true;
  };

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const parsed = JSON.parse(e.nativeEvent.data);

      // Relay HTML šalje: { event:'derive-complete', params:{...} }
      if (parsed?.event === 'derive-complete' && parsed?.params) {
        console.log('[DeSo] Relay → derive payload =', parsed.params);
        onDerive(parsed.params);
        onClose();
        return;
      }

      // Identity Window API → pakiramo kao { kind:'identity', data: msg }
      if (parsed?.kind === 'identity' && parsed?.data) {
        const msg = parsed.data;

        // method: "login" — dobijemo publicKeyAdded bez da koristimo callback
        if (msg.method === 'login' && msg.payload?.publicKeyAdded) {
          const pk = msg.payload.publicKeyAdded;
          console.log('[DeSo] WindowAPI login payload =', msg.payload);

          setPublicKey(pk);
          onLogin({ users: msg.payload.users || {}, publicKeyAdded: pk, signedUp: msg.payload.signedUp });

          // prema derive koraku (u istom WebViewu)
          setStage('derive');
          setLoading(true);
          setTimeout(() => {
            webRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(deriveUrl)}; true;`);
          }, 0);
        }

        // method: "derive" — ako Identity pošalje payload bez redirect/callbacka
        if (msg.method === 'derive' && msg.payload?.derivedPublicKeyBase58Check) {
          console.log('[DeSo] WindowAPI derive payload =', msg.payload);
          onDerive(msg.payload);
          onClose();
        }
      }
    } catch {
      // ignoriramo ne-JSON poruke
    }
  };

  const src = stage === 'login' ? { uri: loginUrl } : { uri: deriveUrl };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {loading && <View style={styles.loader}><ActivityIndicator /></View>}
        <WebView
          ref={webRef}
          source={src}
          onLoadStart={(ev) => console.log('[WV] load start:', ev.nativeEvent.url)}
          onLoadEnd={() => { setLoading(false); console.log('[WV] load end'); }}
          onNavigationStateChange={(nav) => console.log('[WV] nav:', nav.url)}
          onMessage={onMessage}
          injectedJavaScript={injected}
          originWhitelist={['*']}
          mixedContentMode="always"
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          // ✅ ključno za popup prozore:
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          // user-agent kao mobilni chrome (nekim CDN-ovima pomaže)
          userAgent={
            Platform.OS === 'android'
              ? 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
              : undefined
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' }, // crna pozadina iza webview-a
  loader: { position:'absolute', zIndex:9, top:0,left:0,right:0,bottom:0, alignItems:'center', justifyContent:'center' },
});
