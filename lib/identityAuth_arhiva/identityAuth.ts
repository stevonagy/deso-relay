// lib/identityAuth.ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as QueryString from 'query-string';

const SCHEME = 'desomobile';

// Tvoj relay može biti direktorij ili .html; ovo će pogoditi .../index.html
const RELAY_BASE = 'https://stevonagy.github.io/deso-relay/deso-relay.html';

const ANDROID_PACKAGE = 'com.yourname.desomobile';

// ---------- helpers ----------

function getRelayUrl(): string {
  const base = RELAY_BASE.trim();
  if (!base) throw new Error('RELAY_BASE is empty');
  if (/\.(html?|xhtml)$/i.test(base)) return base;
  return base.endsWith('/') ? `${base}index.html` : `${base}/index.html`;
}

function normalizeLevel(input?: unknown, fallback = 2): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim() && !Number.isNaN(Number(input))) return Number(input);
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const cand =
      (typeof o.accessLevel === 'number' && o.accessLevel) ||
      (typeof o.accessLevelRequest === 'number' && o.accessLevelRequest) ||
      (typeof o.level === 'number' && o.level);
    if (typeof cand === 'number' && Number.isFinite(cand)) return cand;
  }
  return fallback;
}

function isReturnUrl(url: string, returnUrl: string) {
  if (!url) return false;
  return url.startsWith(returnUrl) || url.startsWith(`${SCHEME}://login`) || url.startsWith(`${SCHEME}://derive`);
}

function parseParamsFromUrl(url: string): Record<string, string> {
  const parsed = QueryString.parseUrl(url);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.query)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}

async function ensureBrowserClosed() {
  try { await WebBrowser.dismissBrowser(); } catch {}
  await new Promise((r) => setTimeout(r, 180));
}

async function openAuthAndWait(authUrl: string, returnUrl: string): Promise<string> {
  await ensureBrowserClosed();

  return await new Promise<string>((resolve, reject) => {
    let settled = false;

    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isReturnUrl(url, returnUrl) && !settled) {
        settled = true;
        try { sub.remove(); } catch {}
        setTimeout(() => { try { WebBrowser.dismissBrowser(); } catch {} }, 0);
        resolve(url);
      }
    });

    WebBrowser.openAuthSessionAsync(authUrl, returnUrl)
      .then(({ type, url }) => {
        if (type === 'success' && url && isReturnUrl(url, returnUrl) && !settled) {
          settled = true;
          try { sub.remove(); } catch {}
          resolve(url);
          return;
        }
        if (type === 'cancel' && !settled) {
          try { sub.remove(); } catch {}
          reject(new Error('User cancelled'));
          return;
        }
        setTimeout(() => {
          if (!settled) {
            try { sub.remove(); } catch {}
            reject(new Error('No redirect captured'));
          }
        }, 20000);
      })
      .catch((e) => {
        try { sub.remove(); } catch {}
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// ---------- URL gradnja ----------

function buildLoginUrl(accessLevelRequest = 2) {
  const relay = getRelayUrl();
  const redirect = encodeURIComponent(`${SCHEME}://login`);
  const callback = encodeURIComponent(`${relay}?redirect=${redirect}&pkg=${ANDROID_PACKAGE}`);
  // webview=true -> Identity posluži mobilni UI s pickerom računa (gdje si ga ranije i vidio)
  return (
    `https://identity.deso.org/log-in` +
    `?callback=${callback}` +
    `&accessLevelRequest=${accessLevelRequest}` +
    `&webview=true`
  );
}

function buildDeriveUrl(params: { accessLevel?: number }) {
  const relay = getRelayUrl();
  const redirect = encodeURIComponent(`${SCHEME}://derive`);
  const callback = encodeURIComponent(`${relay}?redirect=${redirect}&pkg=${ANDROID_PACKAGE}`);
  const accessLevel = params.accessLevel ?? 2;
  return (
    `https://identity.deso.org/derive` +
    `?callback=${callback}` +
    `&accessLevel=${accessLevel}` +
    `&webview=true`
  );
}

// ---------- public API ----------

export async function loginWithDeSo(level?: unknown) {
  try {
    const accessLevelRequest = normalizeLevel(level, 2); // prvo testiraj s 2; po potrebi 4
    const returnUrl = `${SCHEME}://login`;
    const authUrl = buildLoginUrl(accessLevelRequest);

    console.log('[DeSo] LOGIN URL =', authUrl);
    console.log('[DeSo] redirectUri(app) =', returnUrl);
    console.log('[DeSo] authUrl =', authUrl);

    const url = await openAuthAndWait(authUrl, returnUrl);
    await ensureBrowserClosed();

    console.log('[DeSo] RETURN URL (login) =', url);
    const params = parseParamsFromUrl(url);
    console.log('[DeSo] PARAMS (login) =', params);

    if (!params.publicKeyAdded && !params.publicKey) {
      throw new Error('Login failed: missing public key');
    }
    return params;
  } catch (e: any) {
    console.error('[Auth] Login/Derive error:', e?.message ?? e);
    throw e;
  }
}

export async function deriveKeys(level?: unknown) {
  try {
    const accessLevel = normalizeLevel(level, 2);
    const returnUrl = `${SCHEME}://derive`;
    const authUrl = buildDeriveUrl({ accessLevel });

    console.log('[DeSo] DERIVE URL =', authUrl);
    console.log('[DeSo] redirectUri(app) =', returnUrl);

    const url = await openAuthAndWait(authUrl, returnUrl);
    await ensureBrowserClosed();

    console.log('[DeSo] RETURN URL (derive) =', url);
    const params = parseParamsFromUrl(url);
    console.log('[DeSo] PARAMS (derive) =', params);

    if (!params.publicKey) {
      throw new Error('Derive failed: missing public key');
    }
    return params;
  } catch (e: any) {
    console.error('[Auth] Login/Derive error:', e?.message ?? e);
    throw e;
  }
}

export async function loginThenDeriveViaBrowser(level?: unknown) {
  const normalized = normalizeLevel(level, 2);
  const loginParams = await loginWithDeSo(normalized);
  await ensureBrowserClosed();
  const deriveParams = await deriveKeys(normalized);
  return { ...loginParams, ...deriveParams };
}

const identityAuth = {
  loginWithDeSo,
  deriveKeys,
  loginThenDeriveViaBrowser,
};

export default identityAuth;
