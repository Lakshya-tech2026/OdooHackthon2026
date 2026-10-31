import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  Customer,
  DatabaseState,
  DiscountRule,
  Invoice,
  Payment,
  Plan,
  Product,
  ProductVariant,
  Quotation,
  QuotationTemplate,
  Staff,
  Subscription,
  TaxRule,
  User,
  UserRole,
} from '../types/domain';
import { createInitialSeedData } from '../lib/seedData';
import {
  auth,
  deleteDocFromFirestore,
  OperationType,
  syncDocToFirestore,
  testFirestoreConnection,
} from '../lib/firebase';

interface AppContextValue {
  currentUser: User | null;
  authToken: string | null;
  dbState: DatabaseState;
  loading: boolean;
  firestoreConnected: boolean;
  refreshState: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  registerCustomer: (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    company?: string;
    gstin?: string;
    billingAddress?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (
    email: string
  ) => Promise<{ ok: boolean; message?: string; resetTokenPreview?: string; error?: string }>;
  completePasswordReset: (
    resetToken: string,
    newPassword: string
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  updateUserProfile: (payload: {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  switchDemoRole: (role: UserRole, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  apiRequest: <T = any>(
    path: string,
    options?: RequestInit
  ) => Promise<{ ok: boolean; data?: T; error?: string; status: number }>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const STORAGE_USER_KEY = 'brightloop_active_user_v3';
const STORAGE_TOKEN_KEY = 'brightloop_auth_token_v3';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_USER_KEY);
      if (saved !== null) {
        return JSON.parse(saved) as User | null;
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        return createInitialSeedData().users[0];
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const tokenRef = useRef<string | null>(authToken);
  tokenRef.current = authToken;

  const [dbState, setDbState] = useState<DatabaseState>(() => createInitialSeedData());
  const [loading, setLoading] = useState<boolean>(false);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);

  useEffect(() => {
    testFirestoreConnection().then((ok) => setFirestoreConnected(ok));
  }, []);

  const saveSession = useCallback((user: User | null, token: string | null) => {
    setCurrentUser(user);
    setAuthToken(token);
    tokenRef.current = token;
    try {
      if (user && token) {
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
        localStorage.setItem(STORAGE_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(STORAGE_USER_KEY);
        localStorage.removeItem(STORAGE_TOKEN_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const apiRequest = useCallback(
    async <T = any>(
      path: string,
      options: RequestInit = {}
    ): Promise<{ ok: boolean; data?: T; error?: string; status: number }> => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        };
        let activeToken = tokenRef.current;
        if (!activeToken && auth.currentUser) {
          try {
            activeToken = await auth.currentUser.getIdToken();
          } catch {
            // ignore
          }
        }
        if (activeToken && !headers['Authorization']) {
          headers['Authorization'] = `Bearer ${activeToken}`;
        }
        const res = await fetch(path, {
          ...options,
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            error: json.error || `Request failed with status ${res.status}`,
            status: res.status,
          };
        }
        return { ok: true, data: json as T, status: res.status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Network error',
          status: 500,
        };
      }
    },
    []
  );

  const refreshState = useCallback(async () => {
    if (!currentUser || !tokenRef.current) return;
    setLoading(true);
    const res = await apiRequest<DatabaseState>('/api/state');
    if (res.ok && res.data) {
      setDbState(res.data);
    }
    setLoading(false);
  }, [currentUser, apiRequest]);

  // Bootstrap signed session token if autostart=1 or legacy session without token
  useEffect(() => {
    let mounted = true;
    async function ensureSignedToken() {
      if (currentUser && !tokenRef.current) {
        const res = await fetch('/api/auth/demo-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: currentUser.role }),
        });
        const data = await res.json().catch(() => ({}));
        if (mounted && res.ok && data.user && data.token) {
          saveSession(data.user, data.token);
          const stateRes = await fetch('/api/state', {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (stateRes.ok) {
            const stateJson = (await stateRes.json()) as DatabaseState;
            if (mounted) setDbState(stateJson);
          }
        }
      } else if (currentUser && tokenRef.current) {
        refreshState();
      }
    }
    ensureSignedToken();
    return () => {
      mounted = false;
    };
  }, [currentUser, authToken, refreshState, saveSession]);

  const loginWithEmail = async (email: string, password: string) => {
    const res = await apiRequest<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok || !res.data?.user || !res.data?.token) {
      return { ok: false, error: res.error || 'Invalid credentials.' };
    }

    saveSession(res.data.user, res.data.token);
    if (auth.currentUser) {
      await syncDocToFirestore('users', res.data.user, OperationType.WRITE);
    }
    toast.success(`Signed in as ${res.data.user.name} (${res.data.user.role})`);
    return { ok: true };
  };

  const registerCustomer = async (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    company?: string;
    gstin?: string;
    billingAddress?: string;
  }) => {
    const res = await apiRequest<{ user: User; customer: Customer; token: string }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok || !res.data?.user || !res.data?.token) {
      return { ok: false, error: res.error || 'Registration failed.' };
    }

    saveSession(res.data.user, res.data.token);
    if (auth.currentUser) {
      await syncDocToFirestore('users', res.data.user, OperationType.CREATE);
      if (res.data.customer) {
        await syncDocToFirestore('customers', res.data.customer, OperationType.CREATE);
      }
    }
    toast.success(`Welcome to Brightloop, ${res.data.user.name}!`);
    return { ok: true };
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const idToken = await cred.user.getIdToken();

      const res = await apiRequest<{ user: User; token: string }>('/api/auth/firebase-exchange', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ idToken }),
      });

      if (res.ok && res.data?.user && res.data?.token) {
        saveSession(res.data.user, res.data.token);
        await syncDocToFirestore('users', res.data.user, OperationType.WRITE);
        toast.success(`Signed in with Google as ${res.data.user.name}`);
        return { ok: true };
      }
      return { ok: false, error: res.error || 'Could not verify Firebase ID token.' };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.',
      };
    }
  };

  const requestPasswordReset = async (email: string) => {
    // Also invoke Firebase Auth password reset flow when applicable without blocking
    sendPasswordResetEmail(auth, email.trim()).catch(() => {});

    const res = await apiRequest<{ message: string; resetTokenPreview: string }>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    );
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    return {
      ok: true,
      message: res.data?.message,
      resetTokenPreview: res.data?.resetTokenPreview,
    };
  };

  const completePasswordReset = async (resetToken: string, newPassword: string) => {
    const res = await apiRequest<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword }),
    });
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    return { ok: true, message: res.data?.message };
  };

  const updateUserProfile = async (payload: {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => {
    const res = await apiRequest<{ user: User }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.data?.user) {
      return { ok: false, error: res.error || 'Could not update profile.' };
    }
    saveSession(res.data.user, tokenRef.current);
    await refreshState();
    return { ok: true };
  };

  const switchDemoRole = async (role: UserRole, _email?: string) => {
    const res = await apiRequest<{ user: User; token: string }>('/api/auth/demo-session', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    if (res.ok && res.data?.user && res.data?.token) {
      saveSession(res.data.user, res.data.token);
      toast.success(`Switched active session to ${res.data.user.name} (${res.data.user.role})`);
    } else if (res.error) {
      toast.error(res.error);
    }
  };

  const logout = async () => {
    try {
      await firebaseSignOut(auth);
    } catch {
      // ignore
    }
    saveSession(null, null);
    toast.info('Signed out of Brightloop.');
  };

  // Expose Firestore sync helpers when collections mutate
  useEffect(() => {
    if (auth.currentUser && dbState.products.length > 0) {
      dbState.products.slice(0, 3).forEach((p: Product) => {
        syncDocToFirestore('products', p, OperationType.WRITE).catch(() => {});
      });
      dbState.plans.slice(0, 3).forEach((pl: Plan) => {
        syncDocToFirestore('plans', pl, OperationType.WRITE).catch(() => {});
      });
    }
  }, [dbState.products, dbState.plans]);

  // Keep unused imports referenced for strict TS
  void deleteDocFromFirestore;
  void (null as unknown as ProductVariant | QuotationTemplate | Quotation | Subscription | Invoice | TaxRule | DiscountRule | Payment | Staff);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        authToken,
        dbState,
        loading,
        firestoreConnected,
        refreshState,
        loginWithEmail,
        registerCustomer,
        loginWithGoogle,
        requestPasswordReset,
        completePasswordReset,
        updateUserProfile,
        switchDemoRole,
        logout,
        apiRequest,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
