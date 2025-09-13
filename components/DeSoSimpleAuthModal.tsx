// components/DeSoSimpleAuthModal.tsx
import React, { useMemo, useRef, useState } from 'react';
import { Modal, View, ActivityIndicator, Text, Pressable, Platform } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

type DeriveResult = {
  publicKey?: string;
  derivedPublicKeyBase58Check?: string;
  jwt?: string;
  encryptedSeedHex?: string;
  expirationBlock?: string | number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: (r: DeriveResult) => void;
  appName?: string;               // npr. "DesoMobile"
  submitPostCount?: number;       // default 10
  expirationDays?: number;        // default 30
  globalDESO?: number;            // default 0.05 DESO (u nanos)
};

function parseQuery(url: string): Record<string, string> {
  try {
    const qraw = url.split('#')[0].split('?')[1] || '';
    return qraw.split('&').reduce((acc, kv) => {
      const [k, v] = kv.split('=');
      if (k) acc[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      return acc;
    }, {} as Record<string, string>);
  } catch {
    return {};
  }
}

export default function DeSoSimpleAuthModal({
  visible,
  onClose,
  onSuccess,
  appName = 'DesoMobile',
  submitPostCount = 10,
  expirationDays = 30,
  globalDESO = 0.05,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const webRef = useRef<WebView>(null);

  // DESO limit objekt → string za URL
  const limitJson = useMemo(() => {
    const nanos = Math.round((globalDESO || 0) * 1e9);
    return encodeURIComponent(
      JSON.stringify({
        AppName: appName,
        DerivedKeyExpirationDays: expirationDays,
        GlobalDESOLimit: nanos,
        TransactionCountLimitMap: { SUBMIT_POST: Math.max(1, submitPostCount) },
      })
    );
  }, [appName, expirationDays, globalDESO, submitPostCount]);

  // Callback domena koju samo koristimo da uhvatimo parametre iz URL-a
  const CALLBACK = 'https://node.deso.org';

  // Početni URL: login; nakon što se uhvati publicKeyAdded → ručno idemo na derive
  const LOGIN_URL = useMemo(() => {
    const u =
      `https://identity.deso.org/log-in` +
      `?callback=${encodeURIComponent(CALLBACK)}` +
      `&accessLevelRequest=2` +
      `&webview=true`;
    return u;
  }, []);

  const goToDerive = (pk: string) => {
    const url =
      `https://identity.deso.org/derive` +
      `?callback=${encodeURIComponent(CALLBACK)}` +
      `&webview=true` +
      `&accessLevel=2` +
      `&PublicKey=${encodeURIComponent(pk)}` +
      `&PublicKeyBase58Check=${encodeURIComponent(pk)}` +
      `&TransactionSpendingLimitResponse=${limitJson}`;
    webRef.current?.stopLoading();
    webRef.current?.loadUrl?.(url);
    // iOS nema loadUrl – fallback:
    if (Platform.OS === 'ios') {
      (webRef.current as any)?.injectJavaScript?.(
        `window.location.href=${JSON.stringify(url)};true;`
      );
    }
  };

  const handleNavChange = (nav: WebViewNavigation) => {
    const { url } = nav;
    // Sve debug logove slobodno ostavi – pomažu
    console.log('[DeSoSimpleAuth] nav:', url);

    const p = parseQuery(url);
    // 1) Nakon login redirecta stiže publicKeyAdded
    const pk =
      p.publicKeyAdded || p.publicKey || p.PublicKey || p.PublicKeyBase58Check;
    if (!publicKey && pk) {
      setPublicKey(pk);
      goToDerive(pk);
      return;
    }

    // 2) Nakon derive redirecta tražimo jwt ili derived PK
    const haveJwt =
      p.jwt || p.JWT || p.authToken || p.AuthToken || p.derivedJwt || p.DerivedJwt;
    const haveDerived =
      p.derivedPublicKeyBase58Check || p.DerivedPublicKeyBase58Check;

    if (haveJwt || haveDerived) {
      onSuccess({
        publicKey: pk || publicKey || p.PublicKeyBase58Check,
        derivedPublicKeyBase58Check:
          p.derivedPublicKeyBase58Check || p.DerivedPublicKeyBase58Check,
        jwt:
          (haveJwt as string) || undefined,
        encryptedSeedHex: p.encryptedSeedHex || p.EncryptedSeedHex,
        expirationBlock: p.expirationBlock || p.ExpirationBlock,
      });
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {loading && (
          <View style={{ position:'absolute', top:'50%', left:0, right:0, alignItems:'center', zIndex:9 }}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={{ color:'#fff', marginTop:8 }}>Opening DeSo Identity…</Text>
          </View>
        )}

        <WebView
          ref={webRef}
          source={{ uri: LOGIN_URL }}
          onLoadStart={() => console.log('[DeSoSimpleAuth] load start')}
          onLoadEnd={() => { setLoading(false); console.log('[DeSoSimpleAuth] load end'); }}
          onNavigationStateChange={handleNavChange}
          originWhitelist={['*']}
          mixedContentMode="always"
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically
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
