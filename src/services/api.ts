import {
  TicketRecord,
  TruckLoadingType,
  DriverMasterRecord,
  MaterialMasterRecord,
  CompanySettings,
  PublicBranding,
  AuthUser,
  UserRoleName,
  RoleOption,
  PermissionOption,
  AuditLogEntry,
  ActiveSessionInfo,
  LoadingAlertNotification,
  LiquidStoreState,
  LiquidStoreSettings,
  ExFactoryEntry,
  DriverLiveStatusResponse,
  DriverTokenStatusResponse,
  WhatsAppNotificationLog,
  WhatsAppDispatchOutcome,
  LoadingSlipData,
} from '../types';
import {
  auth,
  buildAuthUserFromFirebase,
  DEFAULT_ADMIN_EMAIL,
  getUserProfile,
  isStaticNoBackendError,
  signOutFromFirebase,
  syncFirebaseUserProfileToFirestore,
} from '../firebase';
import { DEFAULT_SETTINGS, StorageService } from './storage';
import {
  deleteGateTicketFromFirestore,
  deleteMaterialFromFirestore,
  importMaterialsBatchToFirestore,
  saveGateTicketToFirestore,
  saveMaterialToFirestore,
} from './firestoreData';

declare global {
  interface Window {
    __GATEPASS_API_BASE__?: string;
    __GATEPASS_WP_REST_BASE__?: string;
    __GATEPASS_WP_AJAX_BASE__?: string;
  }
}

export function isWordPressAjaxMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.__GATEPASS_WP_AJAX_BASE__ === 'string' &&
    window.__GATEPASS_WP_AJAX_BASE__.trim().length > 0
  );
}

export function isWordPressRestMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.__GATEPASS_WP_REST_BASE__ === 'string' &&
    window.__GATEPASS_WP_REST_BASE__.trim().length > 0
  );
}

function normalizeSameOriginUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || typeof window === 'undefined') return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const currentHost = window.location.hostname.replace(/^www\./i, '').toLowerCase();
    const targetHost = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (currentHost && currentHost === targetHost) {
      return `${parsed.pathname}${parsed.search}`;
    }
    if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Keep trimmed URL as-is
  }
  return trimmed;
}

function buildWordPressAjaxUrl(wpAjaxBase: string, pathname: string, sessionToken: string | null): string {
  const base = normalizeSameOriginUrl(wpAjaxBase);
  const sep = base.includes('?') ? '&' : '?';
  let ajaxUrl = `${base}${sep}action=gatepass_api&gp_endpoint=${encodeURIComponent(pathname)}`;
  if (sessionToken) {
    ajaxUrl += `&_gp_tok=${encodeURIComponent(sessionToken)}`;
  }
  return ajaxUrl;
}

function buildWordPressRestUrl(
  wpRestBase: string,
  pathname: string,
  query: string | undefined,
  sessionToken: string | null
): string {
  const base = normalizeSameOriginUrl(wpRestBase).replace(/\/+$/, '');
  const joined = `${base}/${pathname}`;
  let out = query ? (joined.includes('?') ? `${joined}&${query}` : `${joined}?${query}`) : joined;
  if (sessionToken) {
    out += `${out.includes('?') ? '&' : '?'}_gp_tok=${encodeURIComponent(sessionToken)}`;
  }
  return out;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const cleanPath = path.replace(/^\/+/, '');
  const routePath = cleanPath.startsWith('api/') ? cleanPath.slice(4) : cleanPath;
  const [pathname, query] = routePath.split('?');

  const wpAjaxBase =
    typeof window !== 'undefined' && typeof window.__GATEPASS_WP_AJAX_BASE__ === 'string'
      ? window.__GATEPASS_WP_AJAX_BASE__.trim()
      : '';

  if (wpAjaxBase) {
    const base = normalizeSameOriginUrl(wpAjaxBase);
    const sep = base.includes('?') ? '&' : '?';
    let ajaxUrl = `${base}${sep}action=gatepass_api&gp_endpoint=${encodeURIComponent(pathname)}&gp_method=GET`;
    if (query) {
      ajaxUrl += `&gp_query=${encodeURIComponent(query)}`;
    }
    return ajaxUrl;
  }

  const wpRestBase =
    typeof window !== 'undefined' && typeof window.__GATEPASS_WP_REST_BASE__ === 'string'
      ? window.__GATEPASS_WP_REST_BASE__.trim().replace(/\/+$/, '')
      : '';

  if (wpRestBase) {
    const base = normalizeSameOriginUrl(wpRestBase);
    const joined = `${base}/${pathname}`;
    if (!query) return joined;
    return joined.includes('?') ? `${joined}&${query}` : `${joined}?${query}`;
  }

  const base =
    typeof window !== 'undefined' && typeof window.__GATEPASS_API_BASE__ === 'string'
      ? window.__GATEPASS_API_BASE__.trim().replace(/\/+$/, '')
      : '';
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

const SESSION_TOKEN_STORAGE_KEY = 'gp_tab_session_token';
const CSRF_TOKEN_STORAGE_KEY = 'gp_auth_csrf_token';
const AUTH_STATUS_STORAGE_KEY = 'gp_auth_logged_in';
const AUTH_USER_STORAGE_KEY = 'gp_auth_user';

function readStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    }
  } catch {
    // Ignore localStorage access restrictions
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(key);
    }
  } catch {
    // Ignore sessionStorage access restrictions
  }
  return null;
}

function writeStorageItem(key: string, value: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
  } catch {
    // Ignore localStorage access restrictions
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (value === null) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
      }
    }
  } catch {
    // Ignore sessionStorage access restrictions
  }
}

let inMemoryCsrfToken: string | null = readStorageItem(CSRF_TOKEN_STORAGE_KEY);
let inMemorySessionToken: string | null = readStorageItem(SESSION_TOKEN_STORAGE_KEY);
let authEpoch = 0;
let verifySessionInFlight: Promise<boolean> | null = null;
let unauthorizedHandler: (() => void) | null = null;
let passwordChangeRequiredHandler: (() => void) | null = null;
let backgroundPollDepth = 0;
let staticFirebaseOnlyMode = false;

export function isStaticFirebaseOnlyMode(): boolean {
  return staticFirebaseOnlyMode;
}

const STATIC_SETTINGS_STORAGE_KEY = 'gp_static_company_settings_v1';
const STATIC_DRIVERS_STORAGE_KEY = 'gp_static_drivers_v1';

function readStaticSettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(STATIC_SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore storage read errors
  }
  return StorageService.getSettings();
}

function writeStaticSettings(next: CompanySettings): CompanySettings {
  const merged = { ...DEFAULT_SETTINGS, ...next };
  StorageService.saveSettings(merged);
  try {
    localStorage.setItem(STATIC_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore storage write errors
  }
  return merged;
}

function readStaticDrivers(): DriverMasterRecord[] {
  try {
    const raw = localStorage.getItem(STATIC_DRIVERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as DriverMasterRecord[];
    }
  } catch {
    // Ignore storage read errors
  }
  return StorageService.getDrivers();
}

function writeStaticDrivers(list: DriverMasterRecord[]): void {
  StorageService.saveDrivers(list);
  try {
    localStorage.setItem(STATIC_DRIVERS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage write errors
  }
}

export function getAuthEpoch(): number {
  return authEpoch;
}

function getActiveSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  const stored = readStorageItem(SESSION_TOKEN_STORAGE_KEY);
  if (stored) {
    inMemorySessionToken = stored;
    return stored;
  }
  return null;
}

function getActiveCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  const stored = readStorageItem(CSRF_TOKEN_STORAGE_KEY);
  if (stored) {
    inMemoryCsrfToken = stored;
    return stored;
  }
  return null;
}

export function withBackgroundPoll<T>(fn: () => T): T {
  backgroundPollDepth += 1;
  try {
    return fn();
  } finally {
    backgroundPollDepth -= 1;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
  writeStorageItem(CSRF_TOKEN_STORAGE_KEY, token);
}

export function setSessionToken(token: string | null): void {
  inMemorySessionToken = token;
  writeStorageItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function getPersistedLoginState(): {
  isLoggedIn: boolean;
  user: AuthUser | null;
  sessionToken: string | null;
  csrfToken: string | null;
} {
  const loggedInFlag = readStorageItem(AUTH_STATUS_STORAGE_KEY) === 'true';
  const sessionToken = readStorageItem(SESSION_TOKEN_STORAGE_KEY);
  const csrfToken = readStorageItem(CSRF_TOKEN_STORAGE_KEY);
  let user: AuthUser | null = null;
  try {
    const rawUser = readStorageItem(AUTH_USER_STORAGE_KEY);
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed && typeof parsed.id === 'string' && typeof parsed.username === 'string') {
        user = parsed as AuthUser;
      }
    }
  } catch {
    user = null;
  }
  return {
    isLoggedIn: Boolean(loggedInFlag && user),
    user,
    sessionToken,
    csrfToken,
  };
}

export function persistLoginState(payload: {
  user: AuthUser;
  csrfToken?: string | null;
  sessionToken?: string | null;
}): void {
  authEpoch += 1;
  if (payload.csrfToken !== undefined) {
    setCsrfToken(payload.csrfToken);
  }
  if (payload.sessionToken !== undefined && payload.sessionToken) {
    setSessionToken(payload.sessionToken);
  }
  writeStorageItem(AUTH_STATUS_STORAGE_KEY, 'true');
  try {
    writeStorageItem(AUTH_USER_STORAGE_KEY, JSON.stringify(payload.user));
  } catch {
    // Ignore serialization errors
  }
}

export function clearPersistedLoginState(): void {
  authEpoch += 1;
  setCsrfToken(null);
  setSessionToken(null);
  writeStorageItem(AUTH_STATUS_STORAGE_KEY, null);
  writeStorageItem(AUTH_USER_STORAGE_KEY, null);
}

export function setAuthErrorHandlers(handlers: {
  onUnauthorized: () => void;
  onPasswordChangeRequired: () => void;
}): void {
  unauthorizedHandler = handlers.onUnauthorized;
  passwordChangeRequiredHandler = handlers.onPasswordChangeRequired;
}

async function sendTransportRequest(
  url: string,
  options: RequestInit,
  method: string,
  baseHeaders: Record<string, string>,
  sessionToken: string | null,
  csrfToken: string | null
): Promise<{ res: Response; rawText: string; data: any }> {
  const cleanPath = url.replace(/^\/+/, '');
  const routePath = cleanPath.startsWith('api/') ? cleanPath.slice(4) : cleanPath;
  const [pathname, query] = routePath.split('?');

  const parseBody = async (response: Response) => {
    const rawText = await response.text().catch(() => '');
    let data: any = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }
    return { res: response, rawText, data };
  };

  if (isWordPressAjaxMode()) {
    const wpAjaxBase = window.__GATEPASS_WP_AJAX_BASE__!.trim();
    const form = new URLSearchParams();
    form.set('action', 'gatepass_api');
    form.set('gp_endpoint', pathname);
    form.set('gp_method', method);
    if (query) form.set('gp_query', query);
    if (sessionToken) form.set('gp_token', sessionToken);
    if (csrfToken) form.set('gp_csrf', csrfToken);
    if (typeof options.body === 'string' && options.body.length > 0) {
      form.set('gp_body', options.body);
    }

    const ajaxHeaders: Record<string, string> = {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };
    const ajaxUrl = buildWordPressAjaxUrl(wpAjaxBase, pathname, sessionToken);
    try {
      const ajaxRes = await fetch(ajaxUrl, {
        ...options,
        method: 'POST',
        credentials: 'include',
        headers: ajaxHeaders,
        body: form.toString(),
        cache: 'no-store',
      });
      const parsed = await parseBody(ajaxRes);
      // If admin-ajax.php was blocked/redirected by a WP plugin (non-JSON HTML/0/403/404), fall back cleanly to WP REST API
      if (parsed.data !== null || !isWordPressRestMode()) {
        return parsed;
      }
    } catch (ajaxErr) {
      if (!isWordPressRestMode()) {
        throw ajaxErr;
      }
    }
  }

  const restHeaders: Record<string, string> = { ...baseHeaders };
  if (options.body && !restHeaders['Content-Type']) {
    restHeaders['Content-Type'] = 'application/json';
  }

  let effectiveMethod = method;
  if (isWordPressRestMode() && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    restHeaders['X-HTTP-Method-Override'] = method;
    effectiveMethod = 'POST';
  }

  const resolvedUrl = isWordPressRestMode()
    ? buildWordPressRestUrl(window.__GATEPASS_WP_REST_BASE__!.trim(), pathname, query, sessionToken)
    : resolveApiUrl(url);

  const restRes = await fetch(resolvedUrl, {
    ...options,
    method: effectiveMethod,
    credentials: 'include',
    headers: restHeaders,
    cache: 'no-store',
  });
  return parseBody(restRes);
}

async function confirmSessionStillInvalid(requestEpoch: number): Promise<boolean> {
  if (requestEpoch !== authEpoch) {
    return false;
  }
  if (!verifySessionInFlight) {
    verifySessionInFlight = (async () => {
      try {
        const sessionToken = getActiveSessionToken();
        const csrfToken = getActiveCsrfToken();
        const headers: Record<string, string> = {};
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
          if (isWordPressAjaxMode() || isWordPressRestMode()) {
            headers['X-GatePass-Token'] = sessionToken;
          }
        }
        const { res, data } = await sendTransportRequest(
          '/api/auth/status',
          { method: 'GET' },
          'GET',
          headers,
          sessionToken,
          csrfToken
        );
        if (requestEpoch !== authEpoch) {
          return false;
        }
        if (res.ok && data && typeof data.authenticated === 'boolean') {
          return data.authenticated === false;
        }
        // Do not force logout on transient 5xx/network HTML responses
        return false;
      } catch {
        return false;
      } finally {
        verifySessionInFlight = null;
      }
    })();
  }
  return verifySessionInFlight;
}

async function request<T>(url: string, options: RequestInit = {}, skipAuthHooks = false): Promise<T> {
  const requestEpoch = authEpoch;
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (backgroundPollDepth > 0 && !headers['X-Background-Poll']) {
    headers['X-Background-Poll'] = '1';
  }

  const sessionToken = getActiveSessionToken();
  const csrfToken = getActiveCsrfToken();
  const wpMode = isWordPressAjaxMode() || isWordPressRestMode();
  if (sessionToken) {
    if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    if (wpMode && !headers['X-GatePass-Token']) {
      headers['X-GatePass-Token'] = sessionToken;
    }
  }

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const { res, data } = await sendTransportRequest(url, options, method, headers, sessionToken, csrfToken);

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    const code = data?.code;

    if (!skipAuthHooks && requestEpoch === authEpoch) {
      if (res.status === 401 && unauthorizedHandler) {
        const confirmedInvalid = await confirmSessionStillInvalid(requestEpoch);
        if (confirmedInvalid && requestEpoch === authEpoch) {
          clearPersistedLoginState();
          unauthorizedHandler();
        }
      } else if (res.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED' && passwordChangeRequiredHandler) {
        passwordChangeRequiredHandler();
      }
    }

    throw new ApiError(message, res.status, code);
  }

  if (data === null) {
    throw new ApiError('Server returned an unexpected empty or non-JSON response.', res.status || 500);
  }

  return data as T;
}

export const ApiClient = {
  // Auth
  async getAuthStatus(): Promise<{
    authenticated: boolean;
    needsSetup: boolean;
    user?: AuthUser;
    csrfToken?: string;
    branding?: PublicBranding;
    reason?: string;
  }> {
    const startEpoch = authEpoch;
    try {
      const res = await request<{
        authenticated: boolean;
        needsSetup: boolean;
        user?: AuthUser;
        csrfToken?: string;
        branding?: PublicBranding;
        reason?: string;
      }>('/api/auth/status', {}, true);

      staticFirebaseOnlyMode = false;

      // Ignore stale in-flight status checks if user logged in or out while request was running
      if (startEpoch !== authEpoch) {
        return res;
      }

      if (res.csrfToken) setCsrfToken(res.csrfToken);
      if (res.authenticated && res.user) {
        persistLoginState({
          user: res.user,
          csrfToken: res.csrfToken,
          sessionToken: getActiveSessionToken(),
        });
      } else {
        clearPersistedLoginState();
      }
      return res;
    } catch (err) {
      if (!isStaticNoBackendError(err)) {
        throw err;
      }
      staticFirebaseOnlyMode = true;
      const settings = readStaticSettings();
      const branding: PublicBranding = {
        companyName: settings.companyName,
        companySubtitle: settings.companySubtitle,
        logoDataUrl: settings.logoDataUrl,
      };
      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified) {
        const profile = await getUserProfile(fbUser.uid).catch(() => null);
        const user = buildAuthUserFromFirebase(fbUser, profile);
        return {
          authenticated: true,
          needsSetup: false,
          user,
          branding,
        };
      }
      return {
        authenticated: false,
        needsSetup: false,
        branding,
        reason: 'static_firebase_mode',
      };
    }
  },

  async lookupDriverStatus(truckNumber: string): Promise<DriverLiveStatusResponse> {
    return request<DriverLiveStatusResponse>(
      '/api/public/driver-status',
      {
        method: 'POST',
        body: JSON.stringify({ truckNumber }),
      },
      true
    );
  },

  async getTokenDriverLoadingStatus(token: string): Promise<DriverTokenStatusResponse> {
    const res = await fetch(
      resolveApiUrl(`/api/public/driver-loading-status/${encodeURIComponent(token)}`),
      {
        method: 'GET',
        cache: 'no-store',
      }
    );
    const data = await res.json().catch(() => null);
    if (!data) {
      throw new ApiError('Unable to reach server to check live loading status.', res.status);
    }
    if (res.status === 429) {
      throw new ApiError(data?.error || 'Too many requests. Please wait a moment.', 429);
    }
    return data as DriverTokenStatusResponse;
  },

  async setupInitialAdmin(payload: {
    username: string;
    fullName: string;
    email?: string;
    password: string;
  }): Promise<{ user: AuthUser; csrfToken: string }> {
    const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
      '/api/auth/setup',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      true
    );
    persistLoginState({
      user: res.user,
      csrfToken: res.csrfToken,
      sessionToken: res.sessionToken ?? getActiveSessionToken(),
    });
    return res;
  },

  async login(username: string, password: string): Promise<{ user: AuthUser; csrfToken: string }> {
    const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      true
    );
    persistLoginState({
      user: res.user,
      csrfToken: res.csrfToken,
      sessionToken: res.sessionToken ?? getActiveSessionToken(),
    });
    return res;
  },

  async loginWithFirebase(idToken: string): Promise<{ user: AuthUser; csrfToken: string }> {
    try {
      const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
        '/api/auth/firebase-login',
        {
          method: 'POST',
          body: JSON.stringify({ idToken }),
        },
        true
      );
      staticFirebaseOnlyMode = false;
      persistLoginState({
        user: res.user,
        csrfToken: res.csrfToken,
        sessionToken: res.sessionToken ?? getActiveSessionToken(),
      });
      return res;
    } catch (err) {
      if (!isStaticNoBackendError(err) || !auth.currentUser) {
        throw err;
      }
      staticFirebaseOnlyMode = true;
      const fbUser = auth.currentUser;
      const isDefaultAdmin = (fbUser.email || '').toLowerCase() === DEFAULT_ADMIN_EMAIL;
      await syncFirebaseUserProfileToFirestore(fbUser, isDefaultAdmin ? 'admin' : 'user').catch(() => {});
      const profile = await getUserProfile(fbUser.uid).catch(() => null);
      const user = buildAuthUserFromFirebase(fbUser, profile);
      persistLoginState({
        user,
        csrfToken: 'firebase-static',
      });
      return { user, csrfToken: 'firebase-static' };
    }
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' }, true);
    } finally {
      clearPersistedLoginState();
      await signOutFromFirebase().catch(() => {});
    }
  },

  async getMe(): Promise<{ user: AuthUser; csrfToken: string }> {
    const startEpoch = authEpoch;
    const res = await request<{ user: AuthUser; csrfToken: string }>('/api/auth/me');
    if (startEpoch !== authEpoch) {
      return res;
    }
    if (res.user) {
      persistLoginState({
        user: res.user,
        csrfToken: res.csrfToken,
        sessionToken: getActiveSessionToken(),
      });
    } else if (res.csrfToken) {
      setCsrfToken(res.csrfToken);
    }
    return res;
  },

  async changeOwnPassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ user: AuthUser; csrfToken: string; message: string }> {
    const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string; message: string }>(
      '/api/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }
    );
    persistLoginState({
      user: res.user,
      csrfToken: res.csrfToken,
      sessionToken: res.sessionToken ?? getActiveSessionToken(),
    });
    return res;
  },

  // Admin User Management & Audit
  async getRolesAndPermissions(): Promise<{ roles: RoleOption[]; permissions: PermissionOption[] }> {
    return request('/api/admin/roles');
  },

  async getUsers(): Promise<{ users: AuthUser[] }> {
    return request('/api/admin/users');
  },

  async createUser(payload: {
    username: string;
    fullName: string;
    email?: string;
    temporaryPassword?: string;
    requirePasswordChange?: boolean;
    roleName: UserRoleName;
    isActive: boolean;
    permissions?: string[];
    signatureDataUrl?: string;
  }): Promise<{ user: AuthUser }> {
    return request('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateUser(
    userId: string,
    payload: {
      fullName?: string;
      email?: string;
      roleName?: UserRoleName;
      isActive?: boolean;
      signatureDataUrl?: string;
    }
  ): Promise<{ user: AuthUser }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async uploadUserSignature(userId: string, signatureDataUrl: string): Promise<{ user: AuthUser }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/signature`, {
      method: 'PUT',
      body: JSON.stringify({ signatureDataUrl }),
    });
  },

  async deleteUserSignature(userId: string): Promise<{ user: AuthUser }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/signature`, {
      method: 'DELETE',
    });
  },

  async updateUserPermissions(userId: string, permissions: string[]): Promise<{ user: AuthUser }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
  },

  async resetUserPassword(userId: string, temporaryPassword: string): Promise<{ ok: boolean; user: AuthUser }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ temporaryPassword }),
    });
  },

  async revokeUserSessions(userId: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: 'POST',
    });
  },

  async deleteUser(userId: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  async getAuditLogs(params?: { action?: string; search?: string; limit?: number }): Promise<{ logs: AuditLogEntry[] }> {
    const qs = new URLSearchParams();
    if (params?.action) qs.set('action', params.action);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request(`/api/admin/audit-logs${query ? `?${query}` : ''}`);
  },

  async getActiveSessions(): Promise<{ sessions: ActiveSessionInfo[] }> {
    return request('/api/admin/sessions');
  },

  // Application Data
  async getTickets(): Promise<TicketRecord[]> {
    if (staticFirebaseOnlyMode) {
      return StorageService.getTickets();
    }
    const res = await request<{ tickets: TicketRecord[] }>('/api/tickets');
    return Array.isArray(res?.tickets) ? res.tickets : [];
  },

  async createTicket(payload: Omit<TicketRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TicketRecord> {
    if (staticFirebaseOnlyMode) {
      const now = Date.now();
      const created: TicketRecord = {
        ...payload,
        id: `tk_${now}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await saveGateTicketToFirestore(created);
      StorageService.saveTickets([created, ...StorageService.getTickets()]);
      return created;
    }
    const res = await request<{ ticket: TicketRecord }>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.ticket;
  },

  async updateTicket(id: string, updates: Partial<TicketRecord>): Promise<TicketRecord> {
    if (staticFirebaseOnlyMode) {
      const current = StorageService.getTickets();
      const existing = current.find((t) => t.id === id);
      if (!existing) {
        throw new ApiError('Ticket record not found.', 404);
      }
      const updated: TicketRecord = {
        ...existing,
        ...updates,
        id: existing.id,
        updatedAt: Date.now(),
        version: (existing.version || 1) + 1,
      };
      await saveGateTicketToFirestore(updated);
      StorageService.saveTickets(current.map((t) => (t.id === id ? updated : t)));
      return updated;
    }
    const res = await request<{ ticket: TicketRecord }>(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return res.ticket;
  },

  async updateTicketWithNotification(
    id: string,
    updates: Partial<TicketRecord>
  ): Promise<{
    ticket: TicketRecord;
    whatsappNotification?: WhatsAppDispatchOutcome;
    autoSavedMaterials?: MaterialMasterRecord[];
  }> {
    if (staticFirebaseOnlyMode) {
      const ticket = await ApiClient.updateTicket(id, updates);
      return { ticket };
    }
    return request<{
      ticket: TicketRecord;
      whatsappNotification?: WhatsAppDispatchOutcome;
      autoSavedMaterials?: MaterialMasterRecord[];
    }>(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async getWhatsAppLogs(ticketId?: string): Promise<WhatsAppNotificationLog[]> {
    if (staticFirebaseOnlyMode) {
      return [];
    }
    const qs = ticketId ? `?ticketId=${encodeURIComponent(ticketId)}` : '';
    const res = await request<{ logs: WhatsAppNotificationLog[] }>(`/api/whatsapp/logs${qs}`);
    return Array.isArray(res?.logs) ? res.logs : [];
  },

  async retryWhatsAppNotification(
    ticketId: string
  ): Promise<{ outcome: WhatsAppDispatchOutcome; ticket: TicketRecord }> {
    return request<{ outcome: WhatsAppDispatchOutcome; ticket: TicketRecord }>(
      `/api/whatsapp/retry/${encodeURIComponent(ticketId)}`,
      { method: 'POST' }
    );
  },

  async deleteTicket(id: string): Promise<void> {
    if (staticFirebaseOnlyMode) {
      await deleteGateTicketFromFirestore(id);
      StorageService.saveTickets(StorageService.getTickets().filter((t) => t.id !== id));
      return;
    }
    await request(`/api/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async restoreTicket(ticket: TicketRecord): Promise<TicketRecord> {
    if (staticFirebaseOnlyMode) {
      const restored: TicketRecord = { ...ticket, updatedAt: Date.now() };
      await saveGateTicketToFirestore(restored);
      StorageService.saveTickets([restored, ...StorageService.getTickets()]);
      return restored;
    }
    const res = await request<{ ticket: TicketRecord }>('/api/tickets/restore', {
      method: 'POST',
      body: JSON.stringify(ticket),
    });
    return res.ticket;
  },

  // Forklift Operator Loading
  async openTicketForForklift(ticketId: string): Promise<TicketRecord> {
    const res = await request<{ ticket: TicketRecord }>(`/api/tickets/${encodeURIComponent(ticketId)}/forklift/open`, {
      method: 'POST',
    });
    return res.ticket;
  },

  async updateForkliftChecklist(
    ticketId: string,
    payload: {
      itemUpdates: Array<{
        index: number;
        isLoaded?: boolean;
        loadedQty?: string;
        remarks?: string;
      }>;
      version?: number;
    }
  ): Promise<TicketRecord> {
    const res = await request<{ ticket: TicketRecord }>(
      `/api/tickets/${encodeURIComponent(ticketId)}/forklift/checklist`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    return res.ticket;
  },

  async completeForkliftLoading(
    ticketId: string,
    version?: number
  ): Promise<{ ticket: TicketRecord; alert: LoadingAlertNotification }> {
    return request<{ ticket: TicketRecord; alert: LoadingAlertNotification }>(
      `/api/tickets/${encodeURIComponent(ticketId)}/forklift/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ version }),
      }
    );
  },

  async getLoadingAlerts(): Promise<LoadingAlertNotification[]> {
    if (staticFirebaseOnlyMode) return [];
    const res = await request<{ alerts: LoadingAlertNotification[] }>('/api/loading-alerts');
    return Array.isArray(res?.alerts) ? res.alerts : [];
  },

  async dismissLoadingAlert(alertId: string): Promise<void> {
    if (staticFirebaseOnlyMode) return;
    await request(`/api/loading-alerts/${encodeURIComponent(alertId)}/dismiss`, {
      method: 'POST',
    });
  },

  async getDrivers(): Promise<DriverMasterRecord[]> {
    if (staticFirebaseOnlyMode) return readStaticDrivers();
    const res = await request<{ drivers: DriverMasterRecord[] }>('/api/drivers');
    return Array.isArray(res?.drivers) ? res.drivers : [];
  },

  async saveDriver(driver: Partial<DriverMasterRecord>): Promise<DriverMasterRecord> {
    if (staticFirebaseOnlyMode) {
      const list = readStaticDrivers();
      const now = Date.now();
      const existing = driver.id ? list.find((d) => d.id === driver.id) : undefined;
      const saved: DriverMasterRecord = {
        id: driver.id || `drv_${now}`,
        truckNumber: String(driver.truckNumber || '').toUpperCase(),
        driverName: String(driver.driverName || '').toUpperCase(),
        driverPhone: String(driver.driverPhone || ''),
        iqamaNumber: String(driver.iqamaNumber || ''),
        transporterName: String(driver.transporterName || '').toUpperCase(),
        defaultDestination: String(driver.defaultDestination || existing?.defaultDestination || '').toUpperCase(),
        lastVisited: driver.lastVisited || existing?.lastVisited || new Date().toISOString().slice(0, 10),
        tripCount: typeof driver.tripCount === 'number' ? driver.tripCount : (existing?.tripCount ?? 1),
      };
      const next = driver.id
        ? list.map((d) => (d.id === driver.id ? saved : d))
        : [saved, ...list];
      writeStaticDrivers(next);
      return saved;
    }
    if (driver.id) {
      const res = await request<{ driver: DriverMasterRecord }>(`/api/drivers/${encodeURIComponent(driver.id)}`, {
        method: 'PUT',
        body: JSON.stringify(driver),
      });
      return res.driver;
    }
    const res = await request<{ driver: DriverMasterRecord }>('/api/drivers', {
      method: 'POST',
      body: JSON.stringify(driver),
    });
    return res.driver;
  },

  async deleteDriver(id: string): Promise<void> {
    if (staticFirebaseOnlyMode) {
      writeStaticDrivers(readStaticDrivers().filter((d) => d.id !== id));
      return;
    }
    await request(`/api/drivers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // Material Master
  async getMaterials(): Promise<MaterialMasterRecord[]> {
    if (staticFirebaseOnlyMode) return StorageService.getMaterials();
    const res = await request<{ materials: MaterialMasterRecord[] }>('/api/materials');
    return Array.isArray(res?.materials) ? res.materials : [];
  },

  async createMaterial(payload: {
    materialName: string;
    packType: string;
    palletRatio: number;
    remarks?: string;
  }): Promise<MaterialMasterRecord> {
    if (staticFirebaseOnlyMode) {
      const now = Date.now();
      const created: MaterialMasterRecord = {
        id: `mat_${now}_${Math.random().toString(36).slice(2, 6)}`,
        materialName: payload.materialName.trim().toUpperCase(),
        packType: payload.packType.trim() || 'Rolls',
        palletRatio: payload.palletRatio > 0 ? payload.palletRatio : 1,
        remarks: payload.remarks?.trim() || '',
        createdAt: now,
        updatedAt: now,
      };
      await saveMaterialToFirestore(created);
      StorageService.mergeMaterialsCache([created]);
      return created;
    }
    const res = await request<{ material: MaterialMasterRecord }>('/api/materials', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.material;
  },

  async updateMaterial(
    id: string,
    payload: {
      materialName: string;
      packType: string;
      palletRatio: number;
      remarks?: string;
    }
  ): Promise<MaterialMasterRecord> {
    if (staticFirebaseOnlyMode) {
      const current = StorageService.getMaterials();
      const existing = current.find((m) => m.id === id);
      const updated: MaterialMasterRecord = {
        id,
        materialName: payload.materialName.trim().toUpperCase(),
        packType: payload.packType.trim() || 'Rolls',
        palletRatio: payload.palletRatio > 0 ? payload.palletRatio : 1,
        remarks: payload.remarks?.trim() || '',
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      await saveMaterialToFirestore(updated);
      StorageService.saveMaterials(current.map((m) => (m.id === id ? updated : m)));
      return updated;
    }
    const res = await request<{ material: MaterialMasterRecord }>(
      `/api/materials/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
    return res.material;
  },

  async deleteMaterial(id: string): Promise<void> {
    if (staticFirebaseOnlyMode) {
      await deleteMaterialFromFirestore(id);
      StorageService.saveMaterials(StorageService.getMaterials().filter((m) => m.id !== id));
      return;
    }
    await request(`/api/materials/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async importMaterials(payload: {
    mode: 'skip_existing' | 'upsert';
    items: Array<{
      materialName: string;
      packType: string;
      palletRatio: number;
      remarks?: string;
    }>;
  }): Promise<{
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    duplicateNames: string[];
    errors: string[];
    materials: MaterialMasterRecord[];
  }> {
    if (staticFirebaseOnlyMode) {
      const now = Date.now();
      const existing = StorageService.getMaterials();
      const byName = new Map(existing.map((m) => [m.materialName.toUpperCase(), m]));
      const toWrite: MaterialMasterRecord[] = [];
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const duplicateNames: string[] = [];

      payload.items.forEach((item, idx) => {
        const cleanName = item.materialName.trim().toUpperCase();
        if (!cleanName) return;
        const found = byName.get(cleanName);
        if (found) {
          duplicateNames.push(cleanName);
          if (payload.mode === 'skip_existing') {
            skippedCount += 1;
            return;
          }
          const upd: MaterialMasterRecord = {
            ...found,
            packType: item.packType.trim() || found.packType,
            palletRatio: item.palletRatio > 0 ? item.palletRatio : found.palletRatio,
            remarks: item.remarks ?? found.remarks,
            updatedAt: now,
          };
          byName.set(cleanName, upd);
          toWrite.push(upd);
          updatedCount += 1;
        } else {
          const created: MaterialMasterRecord = {
            id: `mat_${now}_${idx}`,
            materialName: cleanName,
            packType: item.packType.trim() || 'Rolls',
            palletRatio: item.palletRatio > 0 ? item.palletRatio : 1,
            remarks: item.remarks?.trim() || '',
            createdAt: now,
            updatedAt: now,
          };
          byName.set(cleanName, created);
          toWrite.push(created);
          createdCount += 1;
        }
      });

      if (toWrite.length > 0) {
        await importMaterialsBatchToFirestore(toWrite);
      }
      const all = Array.from(byName.values());
      StorageService.saveMaterials(all);
      return {
        createdCount,
        updatedCount,
        skippedCount,
        duplicateNames,
        errors: [],
        materials: all,
      };
    }
    return request('/api/materials/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getSettings(): Promise<{ settings: CompanySettings | null; defaultSettings: CompanySettings | null }> {
    if (staticFirebaseOnlyMode) {
      const s = readStaticSettings();
      return { settings: s, defaultSettings: DEFAULT_SETTINGS };
    }
    return request('/api/settings');
  },

  async saveSettings(settings: CompanySettings): Promise<CompanySettings> {
    if (staticFirebaseOnlyMode) {
      return writeStaticSettings(settings);
    }
    const res = await request<{ settings: CompanySettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return res.settings;
  },

  async saveAsDefaultSettings(settings: CompanySettings): Promise<CompanySettings> {
    if (staticFirebaseOnlyMode) {
      return writeStaticSettings(settings);
    }
    const res = await request<{ settings: CompanySettings }>('/api/settings/default', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return res.settings;
  },

  async updateWhatsAppTemplates(
    templates: Record<string, string>
  ): Promise<{ settings: CompanySettings; whatsappTemplates: Record<string, string> }> {
    return request<{ settings: CompanySettings; whatsappTemplates: Record<string, string> }>(
      '/api/admin/whatsapp-templates',
      {
        method: 'PUT',
        body: JSON.stringify({ templates }),
      }
    );
  },

  async exportBackup(): Promise<Record<string, unknown>> {
    return request('/api/backup/export');
  },

  async restoreBackup(payload: Record<string, unknown>): Promise<void> {
    await request('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async migrateLegacyLocalStorageIfNeeded(): Promise<void> {
    try {
      const ticketsRaw = localStorage.getItem('mat_loading_tickets_v1');
      const driversRaw = localStorage.getItem('mat_loading_drivers_v1');
      const settingsRaw = localStorage.getItem('mat_loading_settings_v1');
      const defaultSettingsRaw = localStorage.getItem('mat_loading_default_settings_v1');
      if (!ticketsRaw && !driversRaw && !settingsRaw && !defaultSettingsRaw) return;

      await request('/api/bootstrap/migrate', {
        method: 'POST',
        body: JSON.stringify({
          tickets: ticketsRaw ? JSON.parse(ticketsRaw) : [],
          drivers: driversRaw ? JSON.parse(driversRaw) : [],
          settings: settingsRaw ? JSON.parse(settingsRaw) : undefined,
          defaultSettings: defaultSettingsRaw ? JSON.parse(defaultSettingsRaw) : undefined,
        }),
      });
    } catch {
      // Migration is best-effort for legacy local data
    }
  },

  // Liquid Material Camp Store
  async getLiquidState(): Promise<LiquidStoreState> {
    return request<LiquidStoreState>('/api/liquid/state');
  },

  async createLiquidTransaction(payload: {
    type: 'INWARD' | 'OUTWARD';
    txDate: string;
    tankId: number;
    materialName: string;
    quantityKg: number;
    referenceNumber: string;
    documentNumber?: string;
    partyName: string;
    vehicleNumber?: string;
    driverName?: string;
    remarks?: string;
  }): Promise<{ state: LiquidStoreState; txCode: string }> {
    return request<{ state: LiquidStoreState; txCode: string }>('/api/liquid/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidTransaction(
    id: number,
    payload: {
      type: 'INWARD' | 'OUTWARD';
      txDate: string;
      tankId: number;
      materialName: string;
      quantityKg: number;
      referenceNumber: string;
      documentNumber?: string;
      partyName: string;
      vehicleNumber?: string;
      driverName?: string;
      remarks?: string;
    }
  ): Promise<{ state: LiquidStoreState; txCode: string }> {
    return request<{ state: LiquidStoreState; txCode: string }>(`/api/liquid/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidTransaction(id: number): Promise<{ state: LiquidStoreState; txCode: string }> {
    return request<{ state: LiquidStoreState; txCode: string }>(`/api/liquid/transactions/${id}`, {
      method: 'DELETE',
    });
  },

  async createLiquidTank(payload: {
    name: string;
    totalCapacityKg: number;
    depthMeters: number;
    location: string;
    notes?: string;
  }): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>('/api/liquid/tanks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidTank(
    id: number,
    payload: {
      name: string;
      totalCapacityKg: number;
      depthMeters: number;
      location: string;
      notes?: string;
    }
  ): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>(`/api/liquid/tanks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidTank(id: number): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>(`/api/liquid/tanks/${id}`, {
      method: 'DELETE',
    });
  },

  async createLiquidMaterial(payload: {
    name: string;
    code?: string;
    description?: string;
  }): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>('/api/liquid/materials', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidMaterial(
    id: number,
    payload: {
      name: string;
      code?: string;
      description?: string;
    }
  ): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>(`/api/liquid/materials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidMaterial(id: number): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>(`/api/liquid/materials/${id}`, {
      method: 'DELETE',
    });
  },

  async updateLiquidSettings(payload: Partial<LiquidStoreSettings>): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>('/api/liquid/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async resetLiquidStore(): Promise<{ state: LiquidStoreState }> {
    return request<{ state: LiquidStoreState }>('/api/liquid/reset', {
      method: 'POST',
    });
  },

  // Ex-Factory Dispatch Entries
  async getExFactoryEntries(): Promise<ExFactoryEntry[]> {
    const res = await request<{ entries: ExFactoryEntry[] }>('/api/ex-factory');
    return res.entries;
  },

  async createExFactoryEntry(payload: {
    entryDate?: string;
    delNoteNumber: string;
    customerName: string;
    loadingType?: TruckLoadingType;
    truckNumber: string;
    driverName?: string;
    mobileNumber?: string;
    iqamaNumber?: string;
  }): Promise<ExFactoryEntry> {
    const res = await request<{ entry: ExFactoryEntry }>('/api/ex-factory', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.entry;
  },

  async updateExFactoryEntry(
    id: string,
    payload: {
      entryDate?: string;
      delNoteNumber: string;
      customerName: string;
      loadingType?: TruckLoadingType;
      truckNumber: string;
      driverName?: string;
      mobileNumber?: string;
      iqamaNumber?: string;
    }
  ): Promise<ExFactoryEntry> {
    const res = await request<{ entry: ExFactoryEntry }>(`/api/ex-factory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.entry;
  },

  async deleteExFactoryEntry(id: string): Promise<void> {
    await request(`/api/ex-factory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async saveExFactoryLoadingSlip(
    id: string,
    payload: {
      loadingSlip: LoadingSlipData;
      truckNumber?: string;
      driverName?: string;
      mobileNumber?: string;
    }
  ): Promise<ExFactoryEntry> {
    const res = await this.saveExFactoryLoadingSlipWithResult(id, payload);
    return res.entry;
  },

  async saveExFactoryLoadingSlipWithResult(
    id: string,
    payload: {
      loadingSlip: LoadingSlipData;
      truckNumber?: string;
      driverName?: string;
      mobileNumber?: string;
    }
  ): Promise<{ entry: ExFactoryEntry; autoSavedMaterials?: MaterialMasterRecord[] }> {
    return request<{ entry: ExFactoryEntry; autoSavedMaterials?: MaterialMasterRecord[] }>(
      `/api/ex-factory/${encodeURIComponent(id)}/loading-slip`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  },

  async downloadWordPressFullHtml(): Promise<void> {
    const token = getActiveSessionToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (isWordPressAjaxMode() || isWordPressRestMode()) {
        headers['X-GatePass-Token'] = token;
      }
    }
    const res = await fetch(resolveApiUrl('/api/admin/wordpress-full-html'), {
      method: 'GET',
      credentials: 'include',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(data?.error || `Failed to download WordPress HTML (${res.status})`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gatepass-full-app.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async downloadWordPressPluginZip(): Promise<void> {
    const token = getActiveSessionToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (isWordPressAjaxMode() || isWordPressRestMode()) {
        headers['X-GatePass-Token'] = token;
      }
    }
    const res = await fetch(resolveApiUrl('/api/admin/wordpress-plugin'), {
      method: 'GET',
      credentials: 'include',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(data?.error || `Failed to download WordPress Plugin (${res.status})`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gatepass-loading-slip-manager.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
