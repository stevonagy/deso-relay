// lib/deso.ts
let NODE_BASE = 'https://desocialworld.com'; // default per request
export function setNodeBase(url: string) { NODE_BASE = url.replace(/\/$/, ''); }
export function getNodeBase() { return NODE_BASE; }

type FetchOpts = {
  method?: 'GET' | 'POST';
  body?: any;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

async function api<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${NODE_BASE}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    let details = `HTTP ${res.status} on ${path}`;
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        details += ` — ${j?.error ?? text}`;
      } catch {
        details += ` — ${text}`;
      }
    } catch {}
    throw new Error(details);
  }
  try { return (await res.json()) as T; } catch { return {} as T; }
}

// ============ FEED ============
export async function getGlobalFeed(limit = 20) {
  return api('/api/v0/get-posts-stateless', {
    body: {
      ReaderPublicKeyBase58Check: '',
      NumToFetch: limit,
      MediaRequired: false,
      OrderBy: 'new',
    },
  });
}

export function usernameOrPk(post: any): string {
  const u =
    post?.ProfileEntryResponse?.Username ||
    post?.PosterProfileUsername ||
    post?.Profile?.Username;
  if (u) return `@${u}`;
  const pk = post?.PosterPublicKeyBase58Check || post?.PublicKeyBase58Check || '';
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : 'Unknown';
}

export function getProfilePicUrl(publicKey: string) {
  return `${NODE_BASE}/api/v0/get-single-profile-picture/${publicKey}`;
}

// Following helpers (robustno parsiranje svih varijanti koje node vraća)
function collectPksFromFollowsResponse(resp: any): string[] {
  const out = new Set<string>();
  const add = (pk?: string) => { if (pk && typeof pk === 'string') out.add(pk); };

  // najčešća polja
  (resp?.PublicKeysBase58CheckForFollowing ?? []).forEach(add);
  (resp?.PublicKeysBase58Check ?? []).forEach(add);

  // map varijante
  if (resp?.PublicKeyToProfileEntryResponse && typeof resp.PublicKeyToProfileEntryResponse === 'object') {
    Object.keys(resp.PublicKeyToProfileEntryResponse).forEach(add);
    Object.values(resp.PublicKeyToProfileEntryResponse).forEach((v: any) => add(v?.PublicKeyBase58Check));
  }
  if (resp?.UsernameToProfileEntryResponse && typeof resp.UsernameToProfileEntryResponse === 'object') {
    Object.values(resp.UsernameToProfileEntryResponse).forEach((v: any) => add(v?.PublicKeyBase58Check));
  }

  // array objekata
  (resp?.ProfilesFound ?? []).forEach((p: any) => add(p?.PublicKeyBase58Check));
  (resp?.FollowedUsers ?? []).forEach((p: any) => add(p?.PublicKeyBase58Check));
  (resp?.PublicKeysForUsersFollowing ?? []).forEach(add);
  (resp?.FollowedPublicKeys ?? []).forEach(add);
  (resp?.UsersYouFollow ?? []).forEach((p: any) => add(p?.PublicKeyBase58Check));

  return Array.from(out);
}

async function getFollowsStatelessByPk(pk: string) {
  return api('/api/v0/get-follows-stateless', {
    body: {
      PublicKeyBase58Check: pk,
      GetEntriesFollowingUsername: true,
      GetEntriesFollowingPublicKeyBase58Check: true,
      NumToFetch: 1000,
    },
  });
}
async function getFollowsStatelessByUsername(username: string) {
  return api('/api/v0/get-follows-stateless', {
    body: {
      Username: username.replace(/^@/, ''),
      GetEntriesFollowingUsername: true,
      NumToFetch: 1000,
    },
  });
}
// Legacy fallback
async function getFollowsLegacyByPk(pk: string) {
  return api('/api/v0/get-follows', {
    body: {
      PublicKeyBase58Check: pk,
      GetEntriesFollowingUsername: true,
      GetEntriesFollowingPublicKeyBase58Check: true,
      NumToFetch: 1000,
    },
  });
}
async function getFollowsLegacyByUsername(username: string) {
  return api('/api/v0/get-follows', {
    body: {
      Username: username.replace(/^@/, ''),
      GetEntriesFollowingUsername: true,
      NumToFetch: 1000,
    },
  });
}

export async function getFollowingPublicKeysByPK(publicKey: string) {
  const results: string[][] = [];
  const tryCall = async (fn: () => Promise<any>) => {
    try { results.push(collectPksFromFollowsResponse(await fn())); } catch {}
  };

  await tryCall(() => getFollowsStatelessByPk(publicKey));
  await tryCall(() => getFollowsLegacyByPk(publicKey));

  // pokušaj preko username-a
  try {
    const me: any = await getSingleProfile({ publicKeyOrUsername: publicKey });
    const uname = me?.Profile?.Username;
    if (uname) {
      await tryCall(() => getFollowsStatelessByUsername(uname));
      await tryCall(() => getFollowsLegacyByUsername(uname));
    }
  } catch {}

  const merged = new Set<string>();
  results.flat().forEach((pk) => merged.add(pk));
  return Array.from(merged);
}

export async function getFollowingPublicKeysByUsername(username: string) {
  const results: string[][] = [];
  const tryCall = async (fn: () => Promise<any>) => {
    try { results.push(collectPksFromFollowsResponse(await fn())); } catch {}
  };
  await tryCall(() => getFollowsStatelessByUsername(username));
  await tryCall(() => getFollowsLegacyByUsername(username));
  const merged = new Set<string>();
  results.flat().forEach((pk) => merged.add(pk));
  return Array.from(merged);
}

export async function getPostsForPublicKey(publicKey: string, limit = 10) {
  const resp: any = await api('/api/v0/get-posts-for-public-key', {
    body: {
      PublicKeyBase58Check: publicKey,
      Username: '',
      NumToFetch: limit,
      MediaRequired: false,
      ReaderPublicKeyBase58Check: '',
    },
  });
  return (resp?.Posts || []) as any[];
}

// ============ PROFILES / RESOLUTION ============
export async function getSingleProfile(opts: { publicKeyOrUsername: string }) {
  const isPk = /^t?BC1[0-9A-Za-z]+$/.test(opts.publicKeyOrUsername);
  return api('/api/v0/get-single-profile', {
    body: isPk
      ? { PublicKeyBase58Check: opts.publicKeyOrUsername }
      : { Username: opts.publicKeyOrUsername.replace(/^@/, '') },
  });
}

export async function resolvePublicKey(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Recipient is empty');
  if (/^t?BC1[0-9A-Za-z]+$/.test(trimmed)) return trimmed;
  const prof = await getSingleProfile({ publicKeyOrUsername: trimmed });
  const pk = (prof as any)?.Profile?.PublicKeyBase58Check;
  if (!pk) throw new Error('Username ne postoji ili nema profil');
  return pk;
}

// ============ POSTS ============
export async function submitPostUnsigned(opts: {
  updaterPublicKey: string;
  body: string;
  imageUrls?: string[];
  parentPostHashHex?: string | null;
}) {
  return api('/api/v0/submit-post', {
    body: {
      UpdaterPublicKeyBase58Check: opts.updaterPublicKey,
      PostHashHexToModify: '',
      ParentStakeID: opts.parentPostHashHex ?? '',
      Title: '',
      BodyObj: {
        Body: opts.body,
        ImageURLs: opts.imageUrls ?? [],
        VideoURLs: [],
      },
      RecloutedPostHashHex: '',
      Sub: '',
      IsHidden: false,
      MinFeeRateNanosPerKB: 1000,
    },
  });
}

export async function replyUnsigned(opts: {
  updaterPublicKey: string;
  parentPostHashHex: string;
  body: string;
  imageUrls?: string[];
}) {
  return submitPostUnsigned({
    updaterPublicKey: opts.updaterPublicKey,
    parentPostHashHex: opts.parentPostHashHex,
    body: opts.body,
    imageUrls: opts.imageUrls ?? [],
  });
}

export async function likeUnsigned(opts: {
  readerPublicKey: string;
  likedPostHashHex: string;
  isUnlike?: boolean;
}) {
  return api('/api/v0/create-like-stateless', {
    body: {
      ReaderPublicKeyBase58Check: opts.readerPublicKey,
      LikedPostHashHex: opts.likedPostHashHex,
      IsUnlike: !!opts.isUnlike,
      MinFeeRateNanosPerKB: 1000,
    },
  });
}

export async function sendDiamondsUnsigned(opts: {
  senderPublicKey: string;
  receiverPublicKeyOrUsername: string;
  diamondLevel: number; // 1-6
  diamondPostHashHex: string;
}) {
  const receiver = /^t?BC1[0-9A-Za-z]+$/.test(opts.receiverPublicKeyOrUsername)
    ? { ReceiverPublicKeyBase58Check: opts.receiverPublicKeyOrUsername }
    : { ReceiverUsername: opts.receiverPublicKeyOrUsername.replace(/^@/, '') };

  return api('/api/v0/send-diamonds', {
    body: {
      SenderPublicKeyBase58Check: opts.senderPublicKey,
      DiamondPostHashHex: opts.diamondPostHashHex,
      DiamondLevel: opts.diamondLevel,
      MinFeeRateNanosPerKB: 1000,
      ...receiver,
    },
  });
}

export async function createFollowUnsigned(opts: {
  followerPublicKey: string;
  followedPublicKey: string;
  isUnfollow?: boolean;
}) {
  return api('/api/v0/create-follow-txn-stateless', {
    body: {
      FollowerPublicKeyBase58Check: opts.followerPublicKey,
      FollowedPublicKeyBase58Check: opts.followedPublicKey,
      IsUnfollow: !!opts.isUnfollow,
      MinFeeRateNanosPerKB: 1000,
    },
  });
}


export async function getNotificationsOnNode(baseUrl: string, opts: {
  publicKey: string;
  limit?: number;
  startIndex?: number;
}) {
  const body: any = {
    PublicKeyBase58Check: opts.publicKey,
    NumToFetch: opts.limit ?? 25,
  };
  if (typeof opts.startIndex === 'number') {
    body.FetchStartIndex = opts.startIndex;
    body.StartIndex = opts.startIndex;
  }
  const url = baseUrl.replace(/\/$/, '') + '/api/v0/get-notifications';
  return api(url, { body });
}
// ============ NOTIFICATIONS ============
export async function getNotifications(opts: {
  publicKey: string;
  limit?: number;
  startIndex?: number;
}) {
  const body: any = {
    PublicKeyBase58Check: opts.publicKey,
    NumToFetch: opts.limit ?? 25,
  };
  if (typeof opts.startIndex === 'number') {
    body.FetchStartIndex = opts.startIndex;
    body.StartIndex = opts.startIndex;
  }
  return api('/api/v0/get-notifications', { body });
}

// ============ TRANSACTIONS ============
export async function submitTransactionHex(signedHex: string) {
  return api('/api/v0/submit-transaction', {
    body: { TransactionHex: signedHex },
  });
}

// ============ WALLET ============
export async function getProfile(publicKey: string) {
  return api('/api/v0/get-single-profile', {
    body: { PublicKeyBase58Check: publicKey },
  });
}
export async function getRealBalanceNanos(publicKey: string): Promise<number> {
  const resp: any = await getProfile(publicKey);
  const nanos = Number(resp?.Profile?.DESOBalanceNanos ?? 0);
  return Number.isFinite(nanos) ? nanos : 0;
}

export async function sendDesoUnsigned(opts: {
  senderPublicKey: string;
  recipient: string;
  amountNanos: number;
}) {
  const recipient = /^t?BC1[0-9A-Za-z]+$/.test(opts.recipient)
    ? opts.recipient
    : opts.recipient.replace(/^@/, '');

  return api('/api/v0/send-deso', {
    body: {
      SenderPublicKeyBase58Check: opts.senderPublicKey,
      RecipientPublicKeyOrUsername: recipient,
      AmountNanos: opts.amountNanos,
      MinFeeRateNanosPerKB: 1000,
    },
  });
}

// ============ MEDIA ============
export async function uploadImageFromDevice(opts: {
  jwt: string;
  userPublicKey: string;
  fileUri: string;
  mimeType?: string;
  fileName?: string;
}) {
  const form = new FormData();
  form.append('UserPublicKeyBase58Check', opts.userPublicKey);
  form.append('JWT', opts.jwt);
  form.append('file', {
    // @ts-ignore RN form-data shape
    uri: opts.fileUri,
    type: opts.mimeType ?? 'image/jpeg',
    name: opts.fileName ?? 'image.jpg',
  } as any);

  const res = await fetch(`${NODE_BASE}/api/v0/upload-image`, {
    method: 'POST',
    headers: {},
    body: form as any,
  });

  if (!res.ok) {
    let details = `HTTP ${res.status} on /api/v0/upload-image`;
    try {
      const t = await res.text();
      try {
        const j = JSON.parse(t);
        details += ` — ${j?.error ?? t}`;
      } catch {
        details += ` — ${t}`;
      }
    } catch {}
    throw new Error(details);
  }

  const data = await res.json();
  const url: string | undefined = data?.ImageURL || data?.ImageURLMapped || data?.imageURL;
  if (!url) throw new Error('Upload ok, ali server nije vratio ImageURL');
  return url;
}

// Helperi
export function nanosToDeso(n: number) { return n / 1e9; }
export function desoToNanos(d: number) { return Math.round(d * 1e9); }
