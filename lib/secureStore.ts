// lib/secureStore.ts
import * as SecureStore from 'expo-secure-store';

// Standard: ključevi smiju sadržavati samo [A-Za-z0-9._-].
// U appu koristimo prefiks "deso." (točka umjesto slash).

export async function setItem(key: string, value: any): Promise<void> {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  await SecureStore.setItemAsync(key, str);
}

export async function getItem<T = any>(key: string): Promise<T | string | null> {
  const str = await SecureStore.getItemAsync(key);
  if (str == null) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return str; // nije JSON — vrati raw string
  }
}

export async function removeItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
