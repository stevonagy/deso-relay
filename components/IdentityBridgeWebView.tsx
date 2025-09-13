// components/IdentityBridgeWebView.tsx
import React, { useMemo, useRef, useState } from 'react';
import { Modal, View, ActivityIndicator, Text, Pressable, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type Props = {
  visible: boolean;
  onClose: () => void;
  onDerive: (params: Record<string, string>) => void;
  appName: string;              // npr. 'DesoMobile'
  submitPostCount?: number;     // default 10
  expirationDays?: number;      // default 30
  globalDESO?: number;          // default 0.05
};

function parseQueryFromUrl(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const qIndex = url.indexOf('?');
    const hIndex = url.indexOf('#');
    const take = (s?: string) => {
      if (!s) return;
      const raw = s.replace(/^[?#]/, '');
      if (!raw) return;
      for (const part of raw.split('&')) {
        if (!part) continue;
        const [k, v] = part.split('=');
        if (!k) continue;
        out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      }
    };
    if (qIndex >= 0) {
      take(url.slice(qIndex, hIndex >= 0 ? hIndex : url.length));
    }
    if (hIndex >= 0) {
      take(url.slice(hIndex));
    }
  } catch {}
  return out;
}

// Tolerantni JSON parser – pokuša izvući prvi {...} payload ako ima “smeća” okolo
function safeParseJSON(input: any): any | null {
  if (input == null) return null;
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    try {
      const start = input.indexOf('{');
      const end = input.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(input.slice(start, end + 1));
      }
    } catch {}
  }
  return null;
}

export default function IdentityBridgeWebView({
  visible,
  onClose,
  onDerive,
  appName,
  submitPostCount = 10,
  expirationDays = 30,
  globalDESO = 0.05,
}: Props) {
  const [loading, setLoading] = useState(true);
  const webRef = useRef<WebView>(null);

  // Parametri šaljemo kao query – zgodno za tweaking bez redeploya appa
  const BRIDGE_URL = useMemo(() => {
    const base = 'https://stevonagy.github.io/deso-relay/identity-bridge.html';
    const qs = new URLSearchParams({
      appName,
      submitPost: String(Math.max(1, submitPostCount)),
      expDays: String(Math.max(1, expirationDays)),
      deso: String(globalDESO ?? 0.05),
    }).toString();
    const u = `${base}?${qs}`;
    console.log('[IdentityBridgeWV] URL =', u);
    return u;
  }, [appName, submitPostCount, expirationDays, globalDESO]);

  const onMessage = (e: WebViewMessageEvent) => {
    const raw = e.nativeEvent.data;
    const data = safeParseJSON(raw);

    if (data?.kind === 'debug') {
      console.log('[IdentityBridgeWV]', data.data);
      return;
    }

    // Preferirani oblik s relay-a:
    //   { event:'derive-complete', params:{...} }
    if (data?.event === 'derive-complete' && data?.params) {
      console.log('[IdentityBridgeWV] derive-complete', data.params);
      onDerive(data.params);
      onClose();
      return;
    }

    // Ako nije stigao postMessage JSON, pokušaj parsirati URL (fallback)
    const navUrl = (e as any)?.nativeEvent?.url;
    if (typeof navUrl === 'string') {
      const p = parseQueryFromUrl(navUrl);
      if (p.derivedPublicKeyBase58Check || p.DerivedPublicKeyBase58Check) {
        console.log('[IdentityBridgeWV] fallback derive-complete via URL', p);
        onDerive(p);
        onClose();
        return;
      }
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {loading && (
          <View style={{ position:'absolute', top:'50%', left:0, right:0, alignItems:'center', zIndex:9 }}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={{ color:'#fff', marginTop:8 }}>Opening Identity…</Text>
          </View>
        )}

        <WebView
          ref={webRef}
          source={{ uri: BRIDGE_URL }}
          onLoadStart={() => console.log('[IdentityBridgeWV] load start')}
          onLoadEnd={() => { setLoading(false); console.log('[IdentityBridgeWV] load end'); }}
          onMessage={onMessage}
          originWhitelist={['*']}
          mixedContentMode="always"
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically
          // stabilniji UA za Android
          userAgent={
            Platform.OS === 'android'
              ? 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
              : undefined
          }
        />

        <Pressable
          onPress={onClose}
          style={{ position:'absolute', top:40, right:20, backgroundColor:'#222', paddingHorizontal:10, paddingVertical:6, borderRadius:6 }}
        >
          <Text style={{ color:'#fff' }}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
