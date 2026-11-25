import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type PopupRedirectResolver,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import rawFirebaseConfig from '../firebase-applet-config.json';
import type { AuthUser } from './types';

export const DEFAULT_ADMIN_EMAIL = 'newshuntexpress@gmail.com';

const viteEnv =
  typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ? (import.meta as unknown as { env: Record<string, string | undefined> }).env
    : {};

export const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || rawFirebaseConfig.apiKey,
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || rawFirebaseConfig.authDomain,
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || rawFirebaseConfig.projectId,
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || rawFirebaseConfig.storageBucket,
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || rawFirebaseConfig.messagingSenderId,
  appId: viteEnv.VITE_FIREBASE_APP_ID || rawFirebaseConfig.appId,
  firestoreDatabaseId: viteEnv.VITE_FIREBASE_DATABASE_ID || rawFirebaseConfig.firestoreDatabaseId,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = (() => {
  try {
    return initializeFirestore(
      app,
      typeof window !== 'undefined' ? { experimentalForceLongPolling: true } : {},
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export interface FirestoreUserProfile {
  uid: string;
  displayName: string;
  roleName: string;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const VALID_ROLES = new Set([
  'admin',
  'user',
  'mmd_manager',
  'view_only',
  'forklift_operator',
  'liquid_store_operator',
  'ex_factory_operator',
  'security_guard',
]);

function clampStr(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export async function createUserProfile(
  userId: string,
  displayName: string,
  roleName = 'user'
): Promise<void> {
  const uid = clampStr(userId, 128);
  const safeName = clampStr(displayName || 'Portal User', 120);
  const safeRole = VALID_ROLES.has(roleName) ? roleName : 'user';
  if (!/^[a-zA-Z0-9_-]+$/.test(uid) || safeName.length < 1) {
    return;
  }

  const userDocRef = doc(db, 'users', uid);
  try {
    await setDoc(userDocRef, {
      uid,
      displayName: safeName,
      roleName: safeRole,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${uid}`);
  }
}

export async function getUserProfile(userId: string): Promise<FirestoreUserProfile | null> {
  const uid = clampStr(userId, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) {
    return null;
  }

  const userDocRef = doc(db, 'users', uid);
  try {
    const docSnap = await getDoc(userDocRef);
    if (!docSnap.exists()) {
      return null;
    }
    return docSnap.data() as FirestoreUserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }
}

export async function syncFirebaseUserProfileToFirestore(
  firebaseUser: User,
  assignedRoleName = 'user'
): Promise<void> {
  if (!firebaseUser.uid || !firebaseUser.email || !firebaseUser.emailVerified) {
    return;
  }

  const uid = clampStr(firebaseUser.uid, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) return;

  const displayName = clampStr(
    firebaseUser.displayName || firebaseUser.email.split('@')[0] || 'Portal User',
    120
  );
  const email = clampStr(firebaseUser.email.toLowerCase(), 254);
  const photoURL = clampStr(firebaseUser.photoURL || '', 512);
  const providerId = clampStr(
    firebaseUser.providerData?.[0]?.providerId || 'google.com',
    64
  );
  const safeRole = VALID_ROLES.has(assignedRoleName) ? assignedRoleName : 'user';
  const isDefaultAdmin = email === DEFAULT_ADMIN_EMAIL;

  const userDocRef = doc(db, 'users', uid);
  const privateDocRef = doc(db, 'users', uid, 'private', 'info');
  const adminDocRef = doc(db, 'admins', uid);

  let isFirestoreAdmin = isDefaultAdmin;
  if (isDefaultAdmin) {
    try {
      const adminSnap = await getDoc(adminDocRef);
      if (!adminSnap.exists()) {
        await setDoc(adminDocRef, {
          uid,
          role: 'admin',
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `admins/${uid}`);
    }
  } else {
    try {
      const adminSnap = await getDoc(adminDocRef);
      isFirestoreAdmin = adminSnap.exists();
    } catch {
      isFirestoreAdmin = false;
    }
  }

  let userSnap;
  try {
    userSnap = await getDoc(userDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }

  if (!userSnap.exists()) {
    // Firestore rules restrict user creation strictly to Admins
    if (!isFirestoreAdmin) {
      return;
    }
    const initialRole = isDefaultAdmin ? 'admin' : safeRole;
    try {
      const batch = writeBatch(db);
      batch.set(userDocRef, {
        uid,
        displayName,
        roleName: initialRole,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateDocRef, {
        uid,
        email,
        ...(photoURL ? { photoURL } : {}),
        providerId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${uid}`);
    }
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.update(userDocRef, {
      displayName,
      updatedAt: serverTimestamp(),
    });
    const privateSnap = await getDoc(privateDocRef);
    if (privateSnap.exists()) {
      batch.update(privateDocRef, {
        email,
        ...(photoURL ? { photoURL } : {}),
        providerId,
        updatedAt: serverTimestamp(),
      });
    } else if (isFirestoreAdmin) {
      batch.set(privateDocRef, {
        uid,
        email,
        ...(photoURL ? { photoURL } : {}),
        providerId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function syncAuthorizedUserToFirestore(
  userRecord: {
    id: string;
    username: string;
    fullName: string;
    email?: string | null;
    roleName: string;
    isActive: boolean;
  },
  actorLabel: string
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  const id = clampStr(userRecord.id, 128);
  const username = clampStr(userRecord.username, 32);
  const displayName = clampStr(userRecord.fullName || username, 120);
  const email = clampStr((userRecord.email || '').toLowerCase(), 254);
  const safeRole = VALID_ROLES.has(userRecord.roleName) ? userRecord.roleName : 'user';
  const authorizedBy = clampStr(actorLabel || auth.currentUser.email || 'admin', 120);

  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^[a-zA-Z0-9._-]+$/.test(username) || username.length < 3 || displayName.length < 2) {
    return;
  }

  const ref = doc(db, 'authorized_users', id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id,
        username,
        displayName,
        ...(email ? { email } : {}),
        roleName: safeRole,
        isActive: Boolean(userRecord.isActive),
        authorizedBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        username,
        displayName,
        ...(email ? { email } : {}),
        roleName: safeRole,
        isActive: Boolean(userRecord.isActive),
        authorizedBy,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `authorized_users/${id}`);
  }
}

export async function deleteAuthorizedUserFromFirestore(userId: string): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  const id = clampStr(userId, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
  try {
    await deleteDoc(doc(db, 'authorized_users', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `authorized_users/${id}`);
  }
}

interface AuthorizedDomainsCache {
  domains: string[];
  fetchedAt: number;
}

let authorizedDomainsCache: AuthorizedDomainsCache | null = null;
let authorizedDomainsInFlight: Promise<string[] | null> | null = null;
let activeGooglePopupPromise: Promise<{ user: User; idToken: string }> | null = null;

function matchFirebaseAuthorizedDomain(expected: string, currentUrlStr: string): boolean {
  try {
    const { protocol, hostname } = new URL(currentUrlStr);
    if (expected.startsWith('chrome-extension://')) {
      const ceUrl = new URL(expected);
      if (ceUrl.hostname === '' && hostname === '') {
        return (
          protocol === 'chrome-extension:' &&
          expected.replace('chrome-extension://', '') ===
            currentUrlStr.replace('chrome-extension://', '')
        );
      }
      return protocol === 'chrome-extension:' && ceUrl.hostname === hostname;
    }
    if (!/^https?/.test(protocol)) {
      return false;
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(expected)) {
      return hostname === expected;
    }
    const escaped = expected.replace(/\./g, '\\.');
    const re = new RegExp(`^(.+\\.${escaped}|${escaped})$`, 'i');
    return re.test(hostname);
  } catch {
    return false;
  }
}

async function fetchFirebaseAuthorizedDomains(forceRefresh = false): Promise<string[] | null> {
  if (typeof window === 'undefined' || !firebaseConfig.apiKey) {
    return null;
  }
  const now = Date.now();
  if (!forceRefresh && authorizedDomainsCache && now - authorizedDomainsCache.fetchedAt < 10_000) {
    return authorizedDomainsCache.domains;
  }
  if (authorizedDomainsInFlight) {
    return authorizedDomainsInFlight;
  }
  authorizedDomainsInFlight = (async () => {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(firebaseConfig.apiKey)}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { authorizedDomains?: unknown };
      if (!Array.isArray(data?.authorizedDomains)) return null;
      const domains = data.authorizedDomains.filter((d): d is string => typeof d === 'string');
      authorizedDomainsCache = { domains, fetchedAt: Date.now() };
      return domains;
    } catch {
      return null;
    } finally {
      authorizedDomainsInFlight = null;
    }
  })();
  return authorizedDomainsInFlight;
}

export async function prewarmFirebaseAuthOriginCheck(): Promise<void> {
  await fetchFirebaseAuthorizedDomains(false);
}

function createUnauthorizedDomainError(): Error & { code: string } {
  const err = new Error('Firebase: Error (auth/unauthorized-domain).') as Error & { code: string };
  err.name = 'FirebaseError';
  err.code = 'auth/unauthorized-domain';
  return err;
}

interface InternalResolverBase {
  iframes?: Record<string, { send?: (...args: unknown[]) => void }>;
  _openPopup(
    authObj: unknown,
    provider: unknown,
    authType: unknown,
    eventId: string
  ): Promise<unknown>;
  _originValidation(authObj: unknown): Promise<void>;
  _isIframeWebStorageSupported(authObj: unknown, cb: (supported: boolean) => void): void;
}

const safePopupResolver: PopupRedirectResolver | undefined = (() => {
  if (typeof browserPopupRedirectResolver !== 'function') {
    return browserPopupRedirectResolver;
  }
  const BaseResolver = browserPopupRedirectResolver as unknown as new () => InternalResolverBase;
  class SafePopupRedirectResolver extends BaseResolver {
    async _originValidation(authObj: unknown): Promise<void> {
      if (typeof window !== 'undefined' && authorizedDomainsCache) {
        const currentUrl = window.location.href;
        if (
          authorizedDomainsCache.domains.some((d) => matchFirebaseAuthorizedDomain(d, currentUrl))
        ) {
          return;
        }
      }
      return super._originValidation(authObj);
    }

    async _openPopup(
      authObj: unknown,
      provider: unknown,
      authType: unknown,
      eventId: string
    ): Promise<unknown> {
      // Await origin validation BEFORE opening popup so PopupOperation never races
      // _originValidation().catch(this.reject) against popup/web-storage rejection.
      await this._originValidation(authObj);
      return super._openPopup(authObj, provider, authType, eventId);
    }

    _isIframeWebStorageSupported(
      authObj: { _key?: () => string },
      cb: (supported: boolean) => void
    ): void {
      try {
        const key = typeof authObj?._key === 'function' ? authObj._key() : '';
        const iframe = key ? this.iframes?.[key] : undefined;
        const gapiFilter = (
          window as unknown as {
            gapi?: { iframes?: { CROSS_ORIGIN_IFRAMES_FILTER?: unknown } };
          }
        )?.gapi?.iframes?.CROSS_ORIGIN_IFRAMES_FILTER;
        if (iframe && typeof iframe.send === 'function' && gapiFilter) {
          let settled = false;
          iframe.send(
            'webStorageSupport',
            { type: 'webStorageSupport' },
            (result: Array<Record<string, unknown>> | undefined) => {
              if (settled) return;
              settled = true;
              const isSupported = result?.[0]?.webStorageSupport;
              cb(isSupported !== undefined ? Boolean(isSupported) : false);
            },
            gapiFilter
          );
          return;
        }
      } catch {
        // Ignore iframe postMessage probe errors cleanly
      }
      cb(true);
    }
  }
  return SafePopupRedirectResolver as unknown as PopupRedirectResolver;
})();

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  if (activeGooglePopupPromise) {
    return activeGooglePopupPromise;
  }

  activeGooglePopupPromise = (async () => {
    if (typeof window !== 'undefined' && !auth.emulatorConfig) {
      const currentUrl = window.location.href;
      let domains = await fetchFirebaseAuthorizedDomains(false);
      if (domains && !domains.some((d) => matchFirebaseAuthorizedDomain(d, currentUrl))) {
        // Re-check live once in case user recently authorized the domain in Firebase Console
        domains = await fetchFirebaseAuthorizedDomains(true);
        if (domains && !domains.some((d) => matchFirebaseAuthorizedDomain(d, currentUrl))) {
          throw createUnauthorizedDomainError();
        }
      }
    }

    const credential = safePopupResolver
      ? await signInWithPopup(auth, googleProvider, safePopupResolver)
      : await signInWithPopup(auth, googleProvider);
    const idToken = await credential.user.getIdToken();
    return { user: credential.user, idToken };
  })();

  try {
    return await activeGooglePopupPromise;
  } finally {
    activeGooglePopupPromise = null;
  }
}

export async function signOutFromFirebase(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export function isStaticNoBackendError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: unknown }).status;
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  if (status === 404 || status === 405) return true;
  if (
    status === 500 &&
    (msg.includes('non-json') || msg.includes('unexpected empty'))
  ) {
    return true;
  }
  return false;
}

const ALL_PLANT_PERMISSIONS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'tickets.delete',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'dispatch.view',
  'material_register.view',
  'guard.view',
  'forklift.operate',
  'liquid_store.access',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
  'ex_factory.delete',
  'reports.export',
  'settings.manage',
  'whatsapp.view',
  'users.manage',
];

const STANDARD_USER_PERMISSIONS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'dispatch.view',
  'material_register.view',
  'guard.view',
  'reports.export',
];

export function buildAuthUserFromFirebase(
  fbUser: User,
  profile?: FirestoreUserProfile | null
): AuthUser {
  const email = (fbUser.email || '').toLowerCase();
  const isDefaultAdmin = email === DEFAULT_ADMIN_EMAIL;
  const resolvedRole = isDefaultAdmin ? 'admin' : profile?.roleName || 'user';
  const isAdminRole = resolvedRole === 'admin';
  const now = Date.now();
  const usernameBase = email ? email.split('@')[0] : fbUser.uid.slice(0, 12);

  return {
    id: fbUser.uid,
    username: usernameBase,
    fullName: fbUser.displayName || profile?.displayName || usernameBase || 'Firebase User',
    email,
    roleId: isAdminRole ? 'role_admin' : `role_${resolvedRole}`,
    roleName: resolvedRole,
    roleDisplayName: isAdminRole ? 'Administrator' : 'Plant Operator',
    isActive: profile?.isActive !== false,
    mustChangePassword: false,
    lastLoginAt: now,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    permissions: isAdminRole ? ALL_PLANT_PERMISSIONS : STANDARD_USER_PERMISSIONS,
  };
}
