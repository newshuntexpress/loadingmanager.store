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
  allowedPlants?: string[];
  defaultPlantId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuthorizedUserFirestoreRecord {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  roleName: string;
  isActive: boolean;
  permissions?: string[];
  allowedPlants?: string[];
  defaultPlantId?: string;
  signatureDataUrl?: string;
  authorizedBy: string;
  ownerUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuthorizedEmailFirestoreRecord {
  emailKey: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  roleName: string;
  isActive: boolean;
  permissions: string[];
  allowedPlants: string[];
  defaultPlantId: string;
  signatureDataUrl?: string;
  authorizedBy: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type FirebaseAuthorizationResult =
  | {
      authorized: true;
      record: AuthorizedEmailFirestoreRecord;
    }
  | {
      authorized: false;
      reason: 'unverified' | 'not_listed' | 'disabled' | 'error';
      email: string;
      message: string;
    };

export function emailToAllowlistKey(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 128);
}

function normalizePlantList(raw: unknown, roleName: string): string[] {
  if (roleName === 'admin') return ['ALL'];
  if (!Array.isArray(raw)) return ['RIYADH'];
  const cleaned = Array.from(
    new Set(
      raw
        .map((p) => String(p || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
        .filter(Boolean)
    )
  ).slice(0, 20);
  if (cleaned.includes('ALL')) return ['ALL'];
  return cleaned.length > 0 ? cleaned : ['RIYADH'];
}

function normalizeDefaultPlant(raw: unknown, allowedPlants: string[]): string {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  if (allowedPlants.includes('ALL')) return clean || 'RIYADH';
  if (clean && allowedPlants.includes(clean)) return clean;
  return allowedPlants[0] || 'RIYADH';
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
  const emailKey = emailToAllowlistKey(email);
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

  let isFirestoreAdmin = isDefaultAdmin || safeRole === 'admin';
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
      // Ensure default admin has an active allowlist doc
      if (emailKey) {
        const emailDocRef = doc(db, 'authorized_emails', emailKey);
        const emailSnap = await getDoc(emailDocRef);
        if (!emailSnap.exists()) {
          await setDoc(emailDocRef, {
            emailKey,
            userId: uid,
            username: 'newshuntexpress',
            displayName,
            email,
            roleName: 'admin',
            isActive: true,
            permissions: ALL_PLANT_PERMISSIONS,
            allowedPlants: ['ALL'],
            defaultPlantId: 'RIYADH',
            authorizedBy: email,
            ownerUid: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `admins/${uid}`);
    }
  } else {
    try {
      const adminSnap = await getDoc(adminDocRef);
      isFirestoreAdmin = adminSnap.exists() || safeRole === 'admin';
    } catch {
      isFirestoreAdmin = safeRole === 'admin';
    }
  }

  let userSnap;
  try {
    userSnap = await getDoc(userDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }

  if (!userSnap.exists()) {
    // Only Admins or allowlisted active users may create their own profile doc
    if (!isFirestoreAdmin && safeRole !== 'admin') {
      try {
        const allowSnap = emailKey ? await getDoc(doc(db, 'authorized_emails', emailKey)) : null;
        if (!allowSnap || !allowSnap.exists() || allowSnap.data()?.isActive !== true) {
          return;
        }
      } catch {
        return;
      }
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

export async function verifyFirebaseUserAuthorized(
  fbUser: User | null | undefined
): Promise<FirebaseAuthorizationResult> {
  if (!fbUser || !fbUser.email || !fbUser.emailVerified) {
    return {
      authorized: false,
      reason: 'unverified',
      email: fbUser?.email || '',
      message: 'A verified Google email address is required to sign in.',
    };
  }

  const email = fbUser.email.trim().toLowerCase();
  const emailKey = emailToAllowlistKey(email);

  if (email === DEFAULT_ADMIN_EMAIL) {
    await syncFirebaseUserProfileToFirestore(fbUser, 'admin').catch(() => {});
    return {
      authorized: true,
      record: {
        emailKey,
        userId: fbUser.uid,
        username: 'newshuntexpress',
        displayName: clampStr(fbUser.displayName || 'Default Administrator', 120),
        email,
        roleName: 'admin',
        isActive: true,
        permissions: [...ALL_PLANT_PERMISSIONS],
        allowedPlants: ['ALL'],
        defaultPlantId: 'RIYADH',
        authorizedBy: email,
        ownerUid: fbUser.uid,
      },
    };
  }

  if (!emailKey || !/^[a-zA-Z0-9_-]+$/.test(emailKey)) {
    return {
      authorized: false,
      reason: 'not_listed',
      email,
      message: `Access denied: Your Google account (${email}) is not authorized. Please ask the Administrator (${DEFAULT_ADMIN_EMAIL}) to create and activate your email first.`,
    };
  }

  try {
    const emailRef = doc(db, 'authorized_emails', emailKey);
    let snap;
    try {
      snap = await getDocFromServer(emailRef);
    } catch {
      snap = await getDoc(emailRef);
    }

    if (!snap.exists()) {
      return {
        authorized: false,
        reason: 'not_listed',
        email,
        message: `Access denied: Your Google account (${email}) is not authorized by the Administrator. Only Admin-created active users may sign in.`,
      };
    }

    const data = snap.data() as Partial<AuthorizedEmailFirestoreRecord>;
    if (data.isActive !== true) {
      return {
        authorized: false,
        reason: 'disabled',
        email,
        message: `Access denied: Your account (${email}) has been deactivated by the Administrator.`,
      };
    }

    const roleName = typeof data.roleName === 'string' && VALID_ROLES.has(data.roleName) ? data.roleName : 'user';
    const allowedPlants = normalizePlantList(data.allowedPlants, roleName);
    const defaultPlantId = normalizeDefaultPlant(data.defaultPlantId, allowedPlants);
    const permissions = Array.isArray(data.permissions) && data.permissions.length > 0
      ? data.permissions.map(String).slice(0, 50)
      : roleName === 'admin'
      ? [...ALL_PLANT_PERMISSIONS]
      : [...getDefaultPermissionsForRole(roleName)];

    return {
      authorized: true,
      record: {
        emailKey,
        userId: clampStr(String(data.userId || fbUser.uid), 128),
        username: clampStr(String(data.username || email.split('@')[0] || 'user'), 32),
        displayName: clampStr(String(data.displayName || fbUser.displayName || email.split('@')[0]), 120),
        email,
        roleName,
        isActive: true,
        permissions,
        allowedPlants,
        defaultPlantId,
        signatureDataUrl: typeof data.signatureDataUrl === 'string' ? data.signatureDataUrl : undefined,
        authorizedBy: clampStr(String(data.authorizedBy || DEFAULT_ADMIN_EMAIL), 120),
        ownerUid: clampStr(String(data.ownerUid || fbUser.uid), 128),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      authorized: false,
      reason: 'error',
      email,
      message: msg.toLowerCase().includes('permission')
        ? `Access denied: Your Google account (${email}) is not in the Administrator allowlist.`
        : `Unable to verify account authorization (${msg}).`,
    };
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
    permissions?: string[];
    allowedPlants?: string[];
    defaultPlantId?: string;
    signatureDataUrl?: string;
  },
  actorLabel: string,
  previousEmail?: string | null
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  const id = clampStr(userRecord.id, 128);
  const username = clampStr(userRecord.username, 32);
  const displayName = clampStr(userRecord.fullName || username, 120);
  const email = clampStr((userRecord.email || '').toLowerCase(), 254);
  const prevEmailClean = clampStr((previousEmail || '').toLowerCase(), 254);
  const safeRole = VALID_ROLES.has(userRecord.roleName) ? userRecord.roleName : 'user';
  const authorizedBy = clampStr(actorLabel || auth.currentUser.email || 'admin', 120);
  const ownerUid = clampStr(auth.currentUser.uid, 128);
  const allowedPlants = normalizePlantList(userRecord.allowedPlants, safeRole);
  const defaultPlantId = normalizeDefaultPlant(userRecord.defaultPlantId, allowedPlants);
  const permissions = (
    Array.isArray(userRecord.permissions) && userRecord.permissions.length > 0
      ? userRecord.permissions
      : safeRole === 'admin'
      ? ALL_PLANT_PERMISSIONS
      : getDefaultPermissionsForRole(safeRole)
  )
    .map((p) => clampStr(String(p), 64))
    .filter(Boolean)
    .slice(0, 50);
  const signatureDataUrl =
    typeof userRecord.signatureDataUrl === 'string' &&
    userRecord.signatureDataUrl.length > 0 &&
    userRecord.signatureDataUrl.length <= 300_000
      ? userRecord.signatureDataUrl
      : '';

  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    !/^[a-zA-Z0-9._-]+$/.test(username) ||
    username.length < 3 ||
    displayName.length < 2
  ) {
    return;
  }

  const ref = doc(db, 'authorized_users', id);
  try {
    const snap = await getDoc(ref);
    const payload: Record<string, unknown> = {
      id,
      username,
      displayName,
      ...(email ? { email } : {}),
      roleName: safeRole,
      isActive: Boolean(userRecord.isActive),
      permissions,
      allowedPlants,
      defaultPlantId,
      ...(signatureDataUrl ? { signatureDataUrl } : {}),
      authorizedBy,
      ownerUid,
      updatedAt: serverTimestamp(),
    };
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        ref,
        {
          ...payload,
          createdAt: snap.data()?.createdAt || serverTimestamp(),
        }
      );
    }

    // Keep email-keyed allowlist strictly synchronized for login checks & Firestore rules
    if (prevEmailClean && prevEmailClean !== email) {
      const prevKey = emailToAllowlistKey(prevEmailClean);
      if (prevKey) {
        await deleteDoc(doc(db, 'authorized_emails', prevKey)).catch(() => {});
      }
    }

    if (email) {
      const emailKey = emailToAllowlistKey(email);
      if (emailKey && /^[a-zA-Z0-9_-]+$/.test(emailKey)) {
        const emailRef = doc(db, 'authorized_emails', emailKey);
        const emailSnap = await getDoc(emailRef);
        await setDoc(emailRef, {
          emailKey,
          userId: id,
          username,
          displayName,
          email,
          roleName: safeRole,
          isActive: Boolean(userRecord.isActive),
          permissions,
          allowedPlants,
          defaultPlantId,
          ...(signatureDataUrl ? { signatureDataUrl } : {}),
          authorizedBy,
          ownerUid,
          createdAt: emailSnap.exists() ? emailSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `authorized_users/${id}`);
  }
}

export async function deleteAuthorizedUserFromFirestore(
  userId: string,
  email?: string | null
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    return;
  }
  const id = clampStr(userId, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
  try {
    await deleteDoc(doc(db, 'authorized_users', id));
    const cleanEmail = clampStr((email || '').toLowerCase(), 254);
    if (cleanEmail) {
      const emailKey = emailToAllowlistKey(cleanEmail);
      if (emailKey && /^[a-zA-Z0-9_-]+$/.test(emailKey)) {
        await deleteDoc(doc(db, 'authorized_emails', emailKey)).catch(() => {});
      }
    }
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
  if (status === 404 || status === 405 || status === 501) return true;
  if (msg.includes('non-json') || msg.includes('unexpected empty')) {
    return true;
  }
  return false;
}

export const ALL_PLANT_PERMISSIONS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'tickets.delete',
  'forklift.operate',
  'guard.view',
  'slips.print',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'reports.view',
  'dispatch.view',
  'material_register.view',
  'liquid.view',
  'liquid.store',
  'liquid.materials',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
  'ex_factory.delete',
  'settings.manage',
  'users.manage',
  'audit.view',
];

const STANDARD_USER_PERMISSIONS = [
  'tickets.view',
  'tickets.create',
  'tickets.update',
  'forklift.operate',
  'guard.view',
  'slips.print',
  'drivers.manage',
  'materials.view',
  'materials.manage',
  'reports.view',
  'dispatch.view',
  'material_register.view',
  'liquid.view',
  'liquid.store',
  'liquid.materials',
  'ex_factory.view',
  'ex_factory.create',
  'ex_factory.update',
];

export const ROLE_DISPLAY_NAME_MAP: Record<string, string> = {
  admin: 'Administrator',
  user: 'User / Operator',
  mmd_manager: 'MMD Manager',
  view_only: 'View Only',
  forklift_operator: 'Forklift Operator',
  liquid_store_operator: 'Liquid Store Operator',
  ex_factory_operator: 'Ex-Factory Operator',
  security_guard: 'Security Guard',
};

export function getDefaultPermissionsForRole(roleName: string): string[] {
  switch (roleName) {
    case 'admin':
      return ALL_PLANT_PERMISSIONS;
    case 'forklift_operator':
      return ['tickets.view', 'forklift.operate'];
    case 'liquid_store_operator':
      return ['liquid.view', 'liquid.store', 'liquid.materials'];
    case 'ex_factory_operator':
      return ['ex_factory.view', 'ex_factory.create', 'ex_factory.update'];
    case 'security_guard':
      return ['guard.view'];
    case 'view_only':
      return [
        'tickets.view',
        'guard.view',
        'materials.view',
        'dispatch.view',
        'material_register.view',
        'reports.view',
        'liquid.view',
        'ex_factory.view',
      ];
    case 'mmd_manager':
    case 'user':
    default:
      return STANDARD_USER_PERMISSIONS;
  }
}

export function buildAuthUserFromFirebase(
  fbUser: User,
  authorizedOrProfile?: Partial<AuthorizedEmailFirestoreRecord & FirestoreUserProfile> | null
): AuthUser {
  const email = (fbUser.email || '').toLowerCase();
  const isDefaultAdmin = email === DEFAULT_ADMIN_EMAIL;
  const resolvedRole = isDefaultAdmin ? 'admin' : authorizedOrProfile?.roleName || 'user';
  const isAdminRole = resolvedRole === 'admin';
  const now = Date.now();
  const usernameBase = email ? email.split('@')[0] : fbUser.uid.slice(0, 12);
  const allowedPlants = normalizePlantList(authorizedOrProfile?.allowedPlants, resolvedRole);
  const defaultPlantId = normalizeDefaultPlant(authorizedOrProfile?.defaultPlantId, allowedPlants);
  const resolvedPermissions = isAdminRole
    ? [...ALL_PLANT_PERMISSIONS]
    : Array.isArray(authorizedOrProfile?.permissions) && authorizedOrProfile.permissions.length > 0
    ? authorizedOrProfile.permissions
    : [...getDefaultPermissionsForRole(resolvedRole)];

  return {
    id: authorizedOrProfile?.userId || fbUser.uid,
    username: authorizedOrProfile?.username || usernameBase,
    fullName:
      authorizedOrProfile?.displayName || fbUser.displayName || usernameBase || 'Authorized User',
    email,
    roleId: isAdminRole ? 'role_admin' : `role_${resolvedRole}`,
    roleName: resolvedRole,
    roleDisplayName: ROLE_DISPLAY_NAME_MAP[resolvedRole] || 'User / Operator',
    isActive: isDefaultAdmin ? true : authorizedOrProfile?.isActive === true,
    mustChangePassword: false,
    lastLoginAt: now,
    signatureDataUrl: authorizedOrProfile?.signatureDataUrl || '',
    createdBy: authorizedOrProfile?.authorizedBy || null,
    createdAt: now,
    updatedAt: now,
    permissions: resolvedPermissions,
    allowedPlants,
    defaultPlantId,
  };
}
