// context/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { loginThenDeriveSingleTab, SpendingLimitOptions } from '../lib/identityAuth';
import { setItem, getItem, removeItem } from '../lib/secureStore';

type AuthContextType = {
  publicKey: string | null;
  derivedPublicKeyBase58Check: string | null;
  authing: boolean;
  login: (opts?: { limits?: SpendingLimitOptions }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as any);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [derivedPublicKeyBase58Check, setDerivedPk] = useState<string | null>(null);
  const [authing, setAuthing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const pk = (await getItem<string>('deso.pk')) as string | null;
        const dpk = (await getItem<string>('deso.derivedPk')) as string | null;
        setPublicKey(pk ?? null);
        setDerivedPk(dpk ?? null);
      } catch {}
    })();
  }, []);

  const login = useCallback(async (opts?: { limits?: SpendingLimitOptions }) => {
    setAuthing(true);
    try {
      await Promise.all([
        removeItem('deso.pk'),
        removeItem('deso.derivedPk'),
        removeItem('deso.accessSignature'),
        removeItem('deso.tslHex'),
        removeItem('deso.jwt'),
        removeItem('deso.derivedJwt'),
        removeItem('deso.users'),
        removeItem('deso.session'),
        removeItem('deso.lastPublicKey'),
        removeItem('deso.signedUp'),
      ]);

      const derived = await loginThenDeriveSingleTab({
        spending: {
          appName: 'DesoMobile',
          expirationDays: 30,
          globalDESOLimit: 0.1,
          txLimits: {
            SUBMIT_POST: 50,
            BASIC_TRANSFER: 50,
            CREATE_LIKE: 200,
            SEND_DIAMONDS: 50,
          },
          ...(opts?.limits ?? {}),
        },
        onLogin: async (payload) => {
          if (payload?.users) await setItem('deso.users', payload.users);
          if (payload?.publicKeyAdded) await setItem('deso.lastPublicKey', payload.publicKeyAdded);
          if (payload?.signedUp != null) await setItem('deso.signedUp', String(payload.signedUp));
        },
        onDerive: async () => {},
      });

      await setItem('deso.pk', derived.publicKey);
      if (derived.derivedPublicKeyBase58Check) await setItem('deso.derivedPk', derived.derivedPublicKeyBase58Check);
      if (derived.accessSignature) await setItem('deso.accessSignature', derived.accessSignature);
      if (derived.transactionSpendingLimitHex) await setItem('deso.tslHex', derived.transactionSpendingLimitHex);
      if (derived.jwt) await setItem('deso.jwt', derived.jwt);
      if (derived.derivedJwt) await setItem('deso.derivedJwt', derived.derivedJwt);

      setPublicKey(derived.publicKey);
      setDerivedPk(derived.derivedPublicKeyBase58Check ?? null);
    } catch (e: any) {
      console.warn('[Auth] login error:', e);
      Alert.alert('Auth error', e?.message ?? String(e));
      setPublicKey(null);
      setDerivedPk(null);
    } finally {
      setAuthing(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setPublicKey(null);
    setDerivedPk(null);
    try {
      await Promise.all([
        removeItem('deso.pk'),
        removeItem('deso.derivedPk'),
        removeItem('deso.accessSignature'),
        removeItem('deso.tslHex'),
        removeItem('deso.jwt'),
        removeItem('deso.derivedJwt'),
        removeItem('deso.users'),
        removeItem('deso.session'),
        removeItem('deso.lastPublicKey'),
        removeItem('deso.signedUp'),
      ]);
    } catch {}
  }, []);

  const value = useMemo(() => ({
    publicKey,
    derivedPublicKeyBase58Check,
    authing,
    login,
    logout,
  }), [publicKey, derivedPublicKeyBase58Check, authing, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
