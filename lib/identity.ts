// lib/identityAuth.ts
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';

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

function buildSpendingLimitResponse(opts: SpendingLimitOptions = {}) {
  const { globalDESOLimit = 0.05, expirationDays = 30, txLimits = {} } = opts;
  return {
    GlobalDESOLimit: Math.round(globalDESOLimit * 1e9),
    TransactionCountLimitMap: {
      SUBMIT_POST: txLimits.SUBMIT_POST ?? 50,
      CREATE_LIKE: txLimits.CREATE_LIKE ?? 200,
      SEND_DIAMONDS: txLimits.SEND_DIAMONDS ?? 100,
      BASIC_TRANSFER: txLimits.BASIC_TRANSFER ?? 10,
      NFT_CREATE: txLimits.NFT_CREATE ?? 0,
      NFT_UPDATE: txLimits.NFT_UPDATE ?? 0,
      NFT_BID: txLimits.NFT_BID ?? 0,
      NFT_TRANSFER: txLimits.NFT_TRANSFER ?? 0
    },
    DerivedKeyExpirationDays: expirationDays,
    AppName: 'DesoMobile'
  };
}

export async function deriveWithCallback({
  accessLevelRequest = 4,
  testnet = false,
  limits
}: {
  accessLevelRequest?: 2 | 3 | 4;
  testnet?: boolean;
  limits?: SpendingLimitOptions;
}) {
  // 1) redirect URI: desomobile://derive
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'desomobile', path: 'derive' });

  // 2) pripremi URL za Identity /derive s callbackom
  const limitJson = JSON.stringify(buildSpendingLimitResponse(limits));
  const params = new URLSearchParams({
    callback: redirectUri,
    accessLevelRequest: String(accessLevelRequest),
    // docs: pass JSON string (URL-encoded)  👇
    TransactionSpendingLimitResponse: encodeURIComponent(limitJson),
    ...(testnet ? { testnet: 'true' } : {})
  });

  const authUrl = `https://identity.deso.org/derive?${params.toString()}`; // Identity otvoren u sistemskom browseru

  // 3) otvori i čekaj povrat na scheme
  const result = await AuthSession.startAsync({
    authUrl,
    returnUrl: redirectUri
  });

  if (result.type !== 'success' || !('url' in result)) {
    throw new Error(result.type === 'dismiss' ? 'Korisnik je odustao' : 'Login nije uspio');
  }

  // 4) Parsiraj payload iz callback URL-a (query parametri)
  const parsed = Linking.parse((result as any).url);
  const q = parsed.queryParams ?? {};

  const derivedPublicKeyBase58Check = String(q.derivedPublicKeyBase58Check || q.derivedPublicKey || '');
  const derivedSeedHex = String(q.derivedSeedHex || '');
  if (!derivedPublicKeyBase58Check || !derivedSeedHex) {
    throw new Error('Nedostaje derived ključ u callbacku');
  }

  return {
    derivedPublicKeyBase58Check,
    derivedSeedHex,
    publicKeyBase58Check: String(q.publicKeyBase58Check || q.publicKey || ''),
    expirationBlock: q.expirationBlock ? Number(q.expirationBlock) : undefined,
    network: String(q.network || 'mainnet'),
    accessSignature: q.accessSignature ? String(q.accessSignature) : undefined,
    jwt: q.jwt ? String(q.jwt) : undefined,
    derivedJwt: q.derivedJwt ? String(q.derivedJwt) : undefined
  };
}
