// src/components/DeriveWebView.tsx
import React, { useMemo, useRef } from "react";
import { Modal, View, ActivityIndicator, Platform } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { buildDeriveUrl, RELAY_BASE } from "../auth/identityAuth";

type Props = {
  visible: boolean;
  publicKey: string;
  spendingLimitJson?: string; // ne mora, koristimo default unutar buildDeriveUrl
  onResult: (params: Record<string, string>) => void;
  onClose: () => void;
};

const INJECT_RELAY_SAFETY = `
  (function(){
    // Relay već radi postMessage na RN ako postoji; ovo je samo safety log
    window.addEventListener('message', function(ev){
      try{
        if (ev && ev.data) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
            typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)
          );
        }
      }catch(_){}
    }, false);
  })();
`;

export default function DeriveWebView({
  visible,
  publicKey,
  onResult,
  onClose,
}: Props) {
  const webRef = useRef<WebView>(null);

  const sourceUri = useMemo(() => {
    const url = buildDeriveUrl({ publicKeyBase58Check: publicKey });
    console.log("[DeriveWebView] derive URL =", url);
    return url;
  }, [publicKey]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const raw = e.nativeEvent.data;
      const payload = typeof raw === "string" ? JSON.parse(raw) : raw;

      // Prihvatimo oba formata:
      // 1) { event:'derive-complete', params:{...} } (relay varijanta)
      // 2) samo plosnati objekt s derive parametrima
      const params =
        payload?.event === "derive-complete" ? payload.params : payload;

      if (params && params.derivedPublicKeyBase58Check) {
        // dobili smo derive podatke – gotovo
        onResult(params);
        onClose();
        return;
      }

      // fallback: ako je stigao login payload, ignoriramo ovdje
    } catch {
      // noop
    }
  };

  const onNavChange = (navState: any) => {
    // Kad se Identity vrati na relay, relay će napraviti postMessage u RN.
    // Ne moramo ništa posebno ovdje, ali možemo logirati:
    if (typeof navState?.url === "string" && navState.url.startsWith(RELAY_BASE)) {
      console.log("[DeriveWebView] relay nav =", navState.url);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <WebView
          ref={webRef}
          source={{ uri: sourceUri }}
          onNavigationStateChange={onNavChange}
          onMessage={handleMessage}
          startInLoadingState
          renderLoading={() => (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator />
            </View>
          )}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
          // relay već šalje postMessage; ovo je dodatni safety injection
          injectedJavaScript={INJECT_RELAY_SAFETY}
          // Android ponekad voli mixed-content dopušten:
          mixedContentMode="always"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          // Iz iskustva: ova dva pomažu oko kolačića/3rd-party u WebViewu
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
        />
      </View>
    </Modal>
  );
}
