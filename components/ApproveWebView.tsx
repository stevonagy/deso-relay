// components/DeriveWebView.tsx
import React, { useMemo, useRef } from "react";
import { Modal, View, ActivityIndicator } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { buildDeriveUrl } from "../lib/identityAuth";

// Tolerantni JSON parser – isti kao u IdentityBridgeWebView
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

type Props = {
  visible: boolean;
  publicKey: string;
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
    const payload = safeParseJSON(e.nativeEvent.data);

    // Prihvatimo oba formata:
    // 1) { event:'derive-complete', params:{...} } (relay varijanta)
    // 2) plosnati objekt s derive parametrima
    const params =
      payload?.event === "derive-complete" ? payload.params : payload;

    if (params && (params.derivedPublicKeyBase58Check || params.DerivedPublicKeyBase58Check)) {
      onResult(params);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <WebView
          ref={webRef}
          source={{ uri: sourceUri }}
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
          injectedJavaScript={INJECT_RELAY_SAFETY}
          mixedContentMode="always"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
        />
      </View>
    </Modal>
  );
}
