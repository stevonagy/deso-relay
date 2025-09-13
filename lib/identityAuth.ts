// lib/identityAuth.ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

export type SpendingLimitOptions = {
  globalDESOLimit?: number; // DESO (npr. 0.05)
  txLimits?: Partial<{
    SUBMIT_POST: number;
    CREATE_LIKE: number;
    SEND_DIAMONDS: number;
    BASIC_TRANSFER: number;
  }>;
  expirationDays?: number; // default 30
  appName?: string;        // default 'DesoMobile'
};

const IDENTITY = 'https://identity.deso.org';
const RELAY_BASE = 'https://stevonagy.github.io/deso-relay/deso-relay-webview.html';

// Dinamički deep-link (radi i u Expo devu i u produkciji)
const APP_LOGIN_SCHEME = Linking.createURL('login');
const APP_DERIVE_SCHEME = Linking.createURL('derive');
const APP_SIGN_SCHEME  = Linking.createURL('sign'); // koristi se i za /approve

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function hardCloseBrowser() {
  try { WebBrowser.dismissBrowser(); } catch {}
  // @ts-ignore
  if (Platform.OS === 'android' && (WebBrowser as any).coolDownAsync) {
    try { await (WebBrowser as any).coolDownAsync(); } catch {}
  }
  await sleep(60);
}

// ─────────────────────────────────────────────────

function buildSpendingLimitResponse(limits?: SpendingLimitOptions) {
  const txMap: Record<string, number> = {};
  if (limits?.txLimits?.SUBMIT_POST != null) txMap.SUBMIT_POST = limits.txLimits.SUBMIT_POST;
  if (limits?.txLimits?.CREATE_LIKE != null) txMap.CREATE_LIKE = limits.txLimits.CREATE_LIKE;
  if (limits?.txLimits?.SEND_DIAMONDS != null) txMap.SEND_DIAMONDS = limits.txLimits.SEND_DIAMONDS;
  if (limits?.txLimits?.BASIC_TRANSFER != null) txMap.BASIC_TRANSFER = limits.txLimits.BASIC_TRANSFER;

  return {
    AppName: limits?.appName ?? 'MyDeSoMobile',
    DerivedKeyExpirationDays: limits?.expirationDays ?? 30,
    GlobalDESOLimit: Math.round(((limits?.globalDESOLimit ?? 0.05) as number) * 1e9), // nanos
    TransactionCountLimitMap: txMap,
  };
}

// redirect ide u HASH (#redirect=...) da ga Identity/relay ne pregazi
function relayUrlFor(kind: 'login' | 'derive' | 'sign') {
  const target =
    kind === 'login' ? APP_LOGIN_SCHEME :
    kind === 'derive' ? APP_DERIVE_SCHEME :
    APP_SIGN_SCHEME;
  return `${RELAY_BASE}?kind=${kind}#redirect=${encodeURIComponent(target)}`;
}

function buildLoginUrl() {
  const callback = relayUrlFor('login');
  const url = `${IDENTITY}/log-in?callback=${encodeURIComponent(callback)}&webview=true&accessLevelRequest=2`;
  console.log('[LoginWebView] LOGIN URL =', url);
  return url;
}

export function buildDeriveUrl(opts: {
  publicKey: string;
  spending?: SpendingLimitOptions;
  transactionSpendingLimitResponse?: any;
  derivePublicKey?: boolean; // default true
}) {
  const callback = relayUrlFor('derive');
  const transactionSpendingLimitResponse =
    opts.transactionSpendingLimitResponse ?? buildSpendingLimitResponse(opts.spending);

  const params = new URLSearchParams({
    callback,
    publicKey: opts.publicKey,
    accessLevel: '2',
    ...(opts.derivePublicKey === false ? {} : { derive: 'true' }),
    transactionSpendingLimitResponse: JSON.stringify(transactionSpendingLimitResponse),
  });

  const url = `${IDENTITY}/derive?${params.toString()}`;
  console.log('[IdentityAuth] DERIVE URL =', url);
  return url;
}

// Potpisivanje kroz Identity: ispravan endpoint je /approve sa 'tx'
function buildApproveUrl(unsignedTxHex: string) {
  const callback = relayUrlFor('sign');
  const params = new URLSearchParams({
    callback,
    tx: unsignedTxHex,   // <-- VAŽNO: 'tx', ne 'transactionHex'
    webview: 'true',
  });
  const url = `${IDENTITY}/approve?${params.toString()}`;
  console.log('[IdentityAuth] APPROVE URL =', url);
  return url;
}

// ─────────────────────────────────────────────────

function parseQueryAndHash(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const push = (segment: string) => {
    if (!segment) return;
    const qs = segment.replace(/^[?#]/, '');
    const parts = qs.split('&');
    for (const part of parts) {
      if (!part) continue;
      const [k, v] = part.split('=');
      if (!k) continue;
      out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  };
  const qIndex = url.indexOf('?');
  const hIndex = url.indexOf('#');
  if (qIndex >= 0) { const end = hIndex >= 0 ? hIndex : url.length; push(url.slice(qIndex, end)); }
  if (hIndex >= 0) { push(url.slice(hIndex)); }
  return out;
}

async function waitForRedirect(prefix: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    let timeout: any;
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url && url.startsWith(prefix)) {
        clearTimeout(timeout);
        sub.remove();
        resolve(url);
      }
    });
    timeout = setTimeout(() => {
      sub.remove();
      reject(new Error('Redirect timeout'));
    }, timeoutMs);
  });
}

// ─────────────────────────────────────────────────
// Public API

export async function loginThenDeriveViaBrowser(options: {
  onLogin?: (payload: { publicKeyAdded?: string; users?: any; signedUp?: string }) => void;
  onDerive?: (payload: {
    derivedPublicKeyBase58Check: string;
    transactionSpendingLimitHex: string;
    accessSignature: string;
    jwt?: string;
    derivedJwt?: string;
  }) => void;
  spending?: SpendingLimitOptions;
  publicKeyForDerive?: string;
}) {
  // 1) LOGIN
  const startUrl = buildLoginUrl();
  await hardCloseBrowser();
  const loginRes = await WebBrowser.openAuthSessionAsync(startUrl, APP_LOGIN_SCHEME);
  if (loginRes.type === 'cancel' || loginRes.type === 'dismiss') throw new Error('Login cancelled');
  const loginReturnUrl = loginRes.url || (await waitForRedirect(APP_LOGIN_SCHEME));
  const loginParams = parseQueryAndHash(loginReturnUrl);

  options.onLogin?.({
    publicKeyAdded: loginParams.publicKeyAdded || loginParams.PublicKeyAdded,
    users: loginParams.users ? JSON.parse(loginParams.users) : undefined,
    signedUp: loginParams.signedUp || loginParams.SignedUp,
  });

  const users = loginParams.users ? JSON.parse(loginParams.users) : undefined;
  const myPublicKey =
    options.publicKeyForDerive ??
    (users ? Object.keys(users)[0] : undefined) ??
    loginParams.publicKeyAdded ??
    loginParams.PublicKeyAdded;

  if (!myPublicKey) throw new Error('Login succeeded, but no user/public key found');

  // 2) DERIVE
  const deriveUrl = buildDeriveUrl({
    publicKey: myPublicKey,
    spending: options.spending,
  });

  await hardCloseBrowser();
  const deriveRes = await WebBrowser.openAuthSessionAsync(deriveUrl, APP_DERIVE_SCHEME);
  if (deriveRes.type === 'cancel' || deriveRes.type === 'dismiss') throw new Error('Derive cancelled');
  const deriveReturnUrl = deriveRes.url || (await waitForRedirect(APP_DERIVE_SCHEME));
  const deriveParams = parseQueryAndHash(deriveReturnUrl);

  const payload = {
    publicKey: myPublicKey,
    derivedPublicKeyBase58Check:
      deriveParams.derivedPublicKeyBase58Check || deriveParams.DerivedPublicKeyBase58Check,
    transactionSpendingLimitHex:
      deriveParams.transactionSpendingLimitHex || deriveParams.TransactionSpendingLimitHex,
    accessSignature:
      deriveParams.accessSignature || deriveParams.AccessSignature,
    jwt: deriveParams.jwt || deriveParams.JWT,
    derivedJwt: deriveParams.derivedJwt || deriveParams.DerivedJWT,
  };

  if (!payload.derivedPublicKeyBase58Check || !payload.accessSignature) {
    throw new Error('Derive failed: missing derived key or access signature');
  }
  options.onDerive?.(payload);
  return payload;
}

export const loginThenDeriveSingleTab = loginThenDeriveViaBrowser;

// Potpisivanje TX-a kroz Identity (/approve)
export async function signTransactionHexViaIdentity(unsignedTxHex: string): Promise<{ signedTransactionHex: string }> {
  const url = buildApproveUrl(unsignedTxHex);

  await hardCloseBrowser();
  const res = await WebBrowser.openAuthSessionAsync(url, APP_SIGN_SCHEME);
  if (res.type === 'cancel' || res.type === 'dismiss') throw new Error('Signing cancelled');

  const returnUrl = res.url || (await waitForRedirect(APP_SIGN_SCHEME));
  const params = parseQueryAndHash(returnUrl);

  // Identity vraća 'signedTransactionHex'
  const signed =
    params.signedTransactionHex ||
    params.SignedTransactionHex ||
    params.transactionHex ||
    params.TransactionHex ||
    params.txHex ||
    params.TxHex ||
    '';

  if (!signed) throw new Error('Signing failed: missing signedTransactionHex');
  return { signedTransactionHex: signed };
}
