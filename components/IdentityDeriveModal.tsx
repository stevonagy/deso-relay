// components/IdentityDeriveModal.tsx
import React, { useMemo } from 'react';
import { Modal, View, ActivityIndicator, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export type SpendingLimitOptions = {
  globalDESOLimit?: number;
  txLimits?: Partial<{
    SUBMIT_POST: number;
    CREATE_LIKE: number;
    SEND_DIAMONDS: number;
    BASIC_TRANSFER: number;
    NFT_CREATE: number;
    NFT_UPDATE: number;
    NFT_BID: number;
    NFT_TRANSFER: number;
  }>;
  expirationDays?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onMessage?: (data: any) => void;
  accessLevelRequest?: number; // 2 ili 4
  testnet?: boolean;
  limits?: SpendingLimitOptions;
};

// Identity iframe URL
const IDENTITY_SRC = 'https://identity.deso.org/?webview=true&iframe=true';

// DESO → nanos
function buildSpendingLimitResponse(limits?: SpendingLimitOptions) {
  const global = Math.round((limits?.globalDESOLimit ?? 0.05) * 1e9);
  return {
    GlobalDESOLimit: global,
    TransactionCountLimitMap: {
      SUBMIT_POST: limits?.txLimits?.SUBMIT_POST ?? 50,
      CREATE_LIKE: limits?.txLimits?.CREATE_LIKE ?? 200,
      SEND_DIAMONDS: limits?.txLimits?.SEND_DIAMONDS ?? 100,
      BASIC_TRANSFER: limits?.txLimits?.BASIC_TRANSFER ?? 10,
      NFT_CREATE: limits?.txLimits?.NFT_CREATE ?? 0,
      NFT_UPDATE: limits?.txLimits?.NFT_UPDATE ?? 0,
      NFT_BID: limits?.txLimits?.NFT_BID ?? 0,
      NFT_TRANSFER: limits?.txLimits?.NFT_TRANSFER ?? 0,
    },
    DerivedKeyExpirationDays: limits?.expirationDays ?? 30,
    AppName: 'DesoMobile',
  };
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

export default function IdentityDeriveModal({
  visible,
  onClose,
  onMessage,
  accessLevelRequest = 4,
  testnet = false,
  limits,
}: Props) {
  const limitObj = useMemo(() => buildSpendingLimitResponse(limits), [limits]);

  // Parent HTML koji embedd-a Identity u <iframe>
  const html = useMemo(() => {
    const DERIVE_ID = uuidv4();
    const INIT_ID = uuidv4();

    const INIT_MSG = {
      id: INIT_ID,
      service: 'identity',
      method: 'initialize',
      payload: {},
    };

    const DERIVE_MSG = {
      id: DERIVE_ID,
      service: 'identity',
      method: 'derive',
      payload: {
        accessLevelRequest,
        webview: true,
        TransactionSpendingLimitResponse: limitObj,
        ...(testnet ? { testnet: true } : {}),
      },
    };

    return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    html,body { margin:0; padding:0; height:100%; background:#fff; }
    #wrap { position:fixed; inset:0; }
    iframe { width:100%; height:100%; border:0; display:block; }
  </style>
</head>
<body>
  <div id="wrap">
    <iframe id="idframe" src="${IDENTITY_SRC}" allow="clipboard-read; clipboard-write"></iframe>
  </div>
  <script>
    (function(){
      var RN = !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);
      function toRN(obj){ try { if (RN) window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(_){} }
      function log(obj){ toRN({ _debug: 'parent', data: obj }); }

      var INIT_MSG = ${JSON.stringify(INIT_MSG)};
      var DERIVE_MSG = ${JSON.stringify(DERIVE_MSG)};

      var frame = document.getElementById('idframe');

      function postToIdentity(msg){
        try { frame.contentWindow.postMessage(msg, '*'); }
        catch(e){ log({ error:'postToIdentity_failed', message: String(e) }); }
      }

      // 1) Kad se iframe učita — pošalji "initialize"
      frame.addEventListener('load', function(){
        log({ event:'iframe_loaded' });
        postToIdentity(INIT_MSG);
        log({ event:'initialize_sent' });
      });

      // 2) Slušaj poruke iz identity iframa
      window.addEventListener('message', function(ev){
        var msg = ev && ev.data ? ev.data : null;
        if (!msg || msg.service !== 'identity') return;

        // forward u RN
        toRN(msg);

        if (msg.method === 'initialize') {
          try { window.postMessage({ id: msg.id, service:'identity', payload:{} }, '*'); } catch(_){}
          postToIdentity(DERIVE_MSG);
          log({ event:'derive_sent' });
        }
      }, false);
    })();
  </script>
</body>
</html>
    `;
  }, [accessLevelRequest, limitObj, testnet]);

  const handle = (evt: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(evt.nativeEvent.data);
      console.log('[Identity iframe]', data);
      onMessage?.(data);
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <WebView
          originWhitelist={['*']}
          source={{
            html,
            // ⚠️ Ključno: da naš parent ima HTTPS origin (ne about:blank)
            baseUrl: 'https://stevonagy.github.io',
          }}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mixedContentMode="always"
          // Android-only: dozvole da inline stranica komunicira s https iframe-om
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          onMessage={handle}
          startInLoadingState
          renderLoading={() => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator />
            </View>
          )}
          // User-Agent koji izgleda kao mobilni browser
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
