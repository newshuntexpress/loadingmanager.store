import {
  TicketRecord,
  TruckStatus,
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
  deleteAuthorizedUserFromFirestore,
  getDefaultPermissionsForRole,
  isStaticNoBackendError,
  ROLE_DISPLAY_NAME_MAP,
  signOutFromFirebase,
  syncAuthorizedUserToFirestore,
  verifyFirebaseUserAuthorized,
} from '../firebase';
import {
  DEFAULT_SETTINGS,
  getCurrentTimeString,
  getTodayDateString,
  mergeSettingsWithDefaults,
  StorageService,
} from './storage';
import {
  deleteExFactoryEntryFromFirestore,
  deleteGateTicketFromFirestore,
  deleteMaterialFromFirestore,
  getGateTicketFromFirestore,
  getPlantSettingsFromFirestore,
  importMaterialsBatchToFirestore,
  listAuditLogsFromFirestore,
  listAuthorizedUsersFromFirestore,
  listExFactoryEntriesFromFirestore,
  listGateTicketsFromFirestore,
  listMaterialsFromFirestore,
  saveExFactoryEntryToFirestore,
  saveGateTicketToFirestore,
  saveMaterialToFirestore,
  savePlantSettingsToFirestore,
  writeAuditLogToFirestore,
} from './firestoreData';

export const CANONICAL_ROLES: RoleOption[] = [
  {
    id: 'role_admin',
    name: 'admin',
    displayName: 'Administrator',
    description: 'Full system authorization, user management, settings, and audit control.',
  },
  {
    id: 'role_user',
    name: 'user',
    displayName: 'User / Operator',
    description: 'Authorized gate queue, loading slip, and operational access.',
  },
  {
    id: 'role_mmd_manager',
    name: 'mmd_manager',
    displayName: 'MMD Manager',
    description:
      'Material Management & Dispatch Manager across Gate Queue, Dispatch Details, Material Register, Material Master, Liquid Store, and Ex-Factory.',
  },
  {
    id: 'role_view_only',
    name: 'view_only',
    displayName: 'View Only',
    description:
      'Read-only monitoring and reporting access across permitted sections without create, edit, or delete rights.',
  },
  {
    id: 'role_forklift_operator',
    name: 'forklift_operator',
    displayName: 'Forklift Operator',
    description: 'Restricted access exclusively to the Forklift Operator Loading section.',
  },
  {
    id: 'role_liquid_store_operator',
    name: 'liquid_store_operator',
    displayName: 'Liquid Store Operator',
    description: 'Restricted access exclusively to the Liquid Material Camp Store section.',
  },
  {
    id: 'role_ex_factory_operator',
    name: 'ex_factory_operator',
    displayName: 'Ex-Factory Operator',
    description: 'Restricted access exclusively to the Ex-Factory Dispatch section.',
  },
  {
    id: 'role_security_guard',
    name: 'security_guard',
    displayName: 'Security Guard (View Only)',
    description:
      'Restricted View Only access exclusively to the Security Guard Gate Truck Allotment screen.',
  },
];

export const CANONICAL_PERMISSIONS: PermissionOption[] = [
  { id: 'perm_tickets_view', key: 'tickets.view', name: 'View Tickets & Live Gate Monitor', category: 'Operations' },
  { id: 'perm_tickets_create', key: 'tickets.create', name: 'Create New Gate Tickets', category: 'Operations' },
  { id: 'perm_tickets_update', key: 'tickets.update', name: 'Update Gate Status & Loading Slips', category: 'Operations' },
  { id: 'perm_forklift_operate', key: 'forklift.operate', name: 'Forklift Operator Loading Checklist & Completion', category: 'Operations' },
  { id: 'perm_tickets_delete', key: 'tickets.delete', name: 'Delete Ticket Records', category: 'Operations' },
  { id: 'perm_guard_view', key: 'guard.view', name: 'View Security Guard Gate Truck Allotment Screen', category: 'Operations' },
  { id: 'perm_slips_print', key: 'slips.print', name: 'Print & Export Loading Slips / Tokens', category: 'Documents' },
  { id: 'perm_drivers_manage', key: 'drivers.manage', name: 'Manage Driver & Vehicle Master Directory', category: 'Operations' },
  { id: 'perm_materials_view', key: 'materials.view', name: 'View Material Master Catalog', category: 'Operations' },
  { id: 'perm_materials_manage', key: 'materials.manage', name: 'Manage Material Master (Add / Edit / Delete / Excel Import)', category: 'Operations' },
  { id: 'perm_reports_view', key: 'reports.view', name: 'View Daily Reports & Export CSV', category: 'Reporting' },
  { id: 'perm_dispatch_view', key: 'dispatch.view', name: 'View Dispatch Details (Material-Wise Summary & Export)', category: 'Reporting' },
  { id: 'perm_material_register_view', key: 'material_register.view', name: 'View Material Register (Loading Slip Line Items)', category: 'Reporting' },
  { id: 'perm_liquid_view', key: 'liquid.view', name: 'View Liquid Material Camp Store (Read-Only)', category: 'Operations' },
  { id: 'perm_liquid_store', key: 'liquid.store', name: 'Manage Liquid Material Camp Store (Inward/Outward & Tanks)', category: 'Operations' },
  { id: 'perm_liquid_materials', key: 'liquid.materials', name: 'Manage Material Master Data (Create / Edit / Delete)', category: 'Operations' },
  { id: 'perm_ex_factory_view', key: 'ex_factory.view', name: 'View Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_create', key: 'ex_factory.create', name: 'Create Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_update', key: 'ex_factory.update', name: 'Update Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_ex_factory_delete', key: 'ex_factory.delete', name: 'Delete Ex-Factory Dispatch Entries', category: 'Operations' },
  { id: 'perm_settings_manage', key: 'settings.manage', name: 'Manage Plant & System Settings', category: 'Administration' },
  { id: 'perm_users_manage', key: 'users.manage', name: 'Manage Users, Roles & Permissions', category: 'Administration' },
  { id: 'perm_audit_view', key: 'audit.view', name: 'View Security Audit Logs', category: 'Administration' },
];

declare global {
  interface Window {
    __GATEPASS_API_BASE__?: string;
  }
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
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
let cacheStaticExFactory: ExFactoryEntry[] = [];

function upsertStaticTicketCache(updated: TicketRecord): void {
  const current = StorageService.getTickets();
  const exists = current.some((t) => t.id === updated.id);
  const next = exists
    ? current.map((t) => (t.id === updated.id ? updated : t))
    : [updated, ...current];
  StorageService.saveTickets(next);
}

async function resolveStaticTicketById(id: string): Promise<TicketRecord | null> {
  const cached = StorageService.getTickets().find((t) => t.id === id);
  if (cached) return cached;
  const remote = await getGateTicketFromFirestore(id).catch(() => null);
  if (remote) {
    upsertStaticTicketCache(remote);
    return remote;
  }
  return null;
}

function hasFullTicketPayload(updates: Partial<TicketRecord>): boolean {
  return Boolean(
    typeof updates.ticketNumber === 'string' &&
      updates.ticketNumber.trim() &&
      typeof updates.truckNumber === 'string' &&
      updates.truckNumber.trim() &&
      typeof updates.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(updates.date.trim())
  );
}

function getStaticActorName(): string {
  const persisted = getPersistedLoginState().user;
  return (
    persisted?.fullName ||
    auth.currentUser?.displayName ||
    persisted?.username ||
    auth.currentUser?.email?.split('@')[0] ||
    'Operator'
  );
}

function getStaticActorUsername(): string {
  const persisted = getPersistedLoginState().user;
  return (
    persisted?.username ||
    auth.currentUser?.email?.split('@')[0] ||
    persisted?.fullName ||
    'user'
  );
}

async function autoSaveSlipMaterialsStatic(
  slipItems?: LoadingSlipData['items']
): Promise<MaterialMasterRecord[]> {
  if (!Array.isArray(slipItems) || slipItems.length === 0) return [];
  let existingMaterials = StorageService.getMaterials();
  if (existingMaterials.length === 0) {
    existingMaterials = await listMaterialsFromFirestore().catch(() => existingMaterials);
    if (existingMaterials.length > 0) {
      StorageService.saveMaterials(existingMaterials);
    }
  }
  const existingNames = new Set(
    existingMaterials.map((m) => m.materialName.trim().toUpperCase())
  );
  const now = Date.now();
  const createdList: MaterialMasterRecord[] = [];
  slipItems.forEach((item, idx) => {
    const cleanName = String(item?.description || '').trim().toUpperCase();
    if (!cleanName || existingNames.has(cleanName)) return;
    existingNames.add(cleanName);
    const parsedRatio = Number(item?.palletRatio);
    const palletRatio =
      Number.isFinite(parsedRatio) && parsedRatio > 0 && parsedRatio <= 10000
        ? Math.round(parsedRatio)
        : 23;
    createdList.push({
      id: `mat_${now}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      materialName: cleanName,
      packType: String(item?.pack || '').trim() || 'Rolls',
      palletRatio,
      remarks: String(item?.remarks || '').trim().toUpperCase(),
      createdAt: now,
      updatedAt: now,
    });
  });
  if (createdList.length > 0) {
    StorageService.mergeMaterialsCache(createdList);
    await importMaterialsBatchToFirestore(createdList).catch(() => {});
  }
  return createdList;
}

function readStaticSettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(STATIC_SETTINGS_STORAGE_KEY);
    if (raw) {
      return mergeSettingsWithDefaults(JSON.parse(raw) as Partial<CompanySettings>);
    }
  } catch {
    // Ignore storage read errors
  }
  return StorageService.getSettings();
}

function writeStaticSettings(next: CompanySettings): CompanySettings {
  const merged = mergeSettingsWithDefaults(next);
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
  baseHeaders: Record<string, string>
): Promise<{ res: Response; rawText: string; data: any }> {
  const restHeaders: Record<string, string> = { ...baseHeaders };
  if (options.body && !restHeaders['Content-Type']) {
    restHeaders['Content-Type'] = 'application/json';
  }

  const restRes = await fetch(resolveApiUrl(url), {
    ...options,
    method,
    credentials: 'include',
    headers: restHeaders,
    cache: 'no-store',
  });

  const rawText = await restRes.text().catch(() => '');
  let data: any = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }
  return { res: restRes, rawText, data };
}

async function confirmSessionStillInvalid(requestEpoch: number): Promise<boolean> {
  if (requestEpoch !== authEpoch) {
    return false;
  }
  if (!verifySessionInFlight) {
    verifySessionInFlight = (async () => {
      try {
        const sessionToken = getActiveSessionToken();
        const headers: Record<string, string> = {};
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
        }
        const { res, data } = await sendTransportRequest(
          '/api/auth/status',
          { method: 'GET' },
          'GET',
          headers
        );
        if (requestEpoch !== authEpoch) {
          return false;
        }
        if (res.ok && data && typeof data.authenticated === 'boolean') {
          return data.authenticated === false;
        }
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
  if (sessionToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const { res, data } = await sendTransportRequest(url, options, method, headers);

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

async function withStaticFallback<T>(
  staticFn: () => Promise<T>,
  backendFn: () => Promise<T>
): Promise<T> {
  if (staticFirebaseOnlyMode) {
    return staticFn();
  }
  try {
    return await backendFn();
  } catch (err) {
    if (!isStaticNoBackendError(err)) {
      throw err;
    }
    staticFirebaseOnlyMode = true;
    return staticFn();
  }
}

async function withFirestore404Fallback<T>(
  staticFn: () => Promise<T>,
  backendFn: () => Promise<T>
): Promise<T> {
  return withStaticFallback(staticFn, async () => {
    try {
      return await backendFn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && auth.currentUser?.emailVerified) {
        return await staticFn();
      }
      throw err;
    }
  });
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
      const cloudSettings = await getPlantSettingsFromFirestore().catch(() => null);
      const settings = cloudSettings ? writeStaticSettings(cloudSettings) : readStaticSettings();
      const branding: PublicBranding = {
        companyName: settings.companyName,
        companySubtitle: settings.companySubtitle,
        logoDataUrl: settings.logoDataUrl,
      };
      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified) {
        const authRes = await verifyFirebaseUserAuthorized(fbUser);
        if (!authRes.authorized) {
          clearPersistedLoginState();
          await signOutFromFirebase().catch(() => {});
          return {
            authenticated: false,
            needsSetup: false,
            branding,
            reason: authRes.reason === 'disabled' ? 'account_disabled' : 'not_authorized',
          };
        }
        const user = buildAuthUserFromFirebase(fbUser, authRes.record);
        persistLoginState({
          user,
          csrfToken: 'firebase-static',
        });
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
    try {
      const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
        '/api/auth/setup',
        {
          method: 'POST',
          body: JSON.stringify(payload),
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
      if (isStaticNoBackendError(err)) {
        staticFirebaseOnlyMode = true;
      }
      throw err;
    }
  },

  async login(username: string, password: string): Promise<{ user: AuthUser; csrfToken: string }> {
    try {
      const res = await request<{ user: AuthUser; csrfToken: string; sessionToken?: string }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
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
      if (isStaticNoBackendError(err)) {
        staticFirebaseOnlyMode = true;
      }
      throw err;
    }
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
      const authRes = await verifyFirebaseUserAuthorized(fbUser);
      if (!authRes.authorized) {
        clearPersistedLoginState();
        await signOutFromFirebase().catch(() => {});
        throw new ApiError(
          authRes.message,
          403,
          authRes.reason === 'disabled' ? 'ACCOUNT_DISABLED' : 'NOT_AUTHORIZED'
        );
      }
      const user = buildAuthUserFromFirebase(fbUser, authRes.record);
      persistLoginState({
        user,
        csrfToken: 'firebase-static',
      });
      return { user, csrfToken: 'firebase-static' };
    }
  },

  async logout(): Promise<void> {
    try {
      if (!staticFirebaseOnlyMode) {
        await request('/api/auth/logout', { method: 'POST' }, true);
      }
    } catch (err) {
      if (!isStaticNoBackendError(err)) {
        throw err;
      }
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
    return withStaticFallback(
      async () => ({ roles: CANONICAL_ROLES, permissions: CANONICAL_PERMISSIONS }),
      () => request('/api/admin/roles')
    );
  },

  async getUsers(): Promise<{ users: AuthUser[] }> {
    return withStaticFallback(
      async () => {
        const users = await listAuthorizedUsersFromFirestore();
        return { users };
      },
      () => request('/api/admin/users')
    );
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
    allowedPlants?: string[];
    defaultPlantId?: string;
    signatureDataUrl?: string;
  }): Promise<{ user: AuthUser }> {
    return withStaticFallback(
      async () => {
        if (!auth.currentUser || !auth.currentUser.emailVerified) {
          throw new ApiError(
            'Please sign in with your verified Administrator Google account to create users in Firebase.',
            401
          );
        }
        const cleanUsername = payload.username.trim().toLowerCase();
        if (!/^[a-zA-Z0-9._-]+$/.test(cleanUsername) || cleanUsername.length < 3 || cleanUsername.length > 32) {
          throw new ApiError(
            'Username must be 3–32 characters using only letters, numbers, dots (.), underscores (_), or hyphens (-).',
            400
          );
        }
        const cleanFullName = payload.fullName.trim();
        if (cleanFullName.length < 2) {
          throw new ApiError('Full Name must be at least 2 characters.', 400);
        }
        const cleanEmail = (payload.email || '').trim().toLowerCase();
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new ApiError(
            'A valid Google / Work Email is required in live Firebase mode so the user can sign in.',
            400
          );
        }

        const existingUsers = await listAuthorizedUsersFromFirestore();
        if (existingUsers.some((u) => u.username.toLowerCase() === cleanUsername)) {
          throw new ApiError('Username already exists. Please choose another username.', 409);
        }
        if (existingUsers.some((u) => (u.email || '').toLowerCase() === cleanEmail)) {
          throw new ApiError('This email address is already assigned to another user.', 409);
        }

        const now = Date.now();
        const roleName = payload.roleName || 'user';
        const allowedPlants =
          roleName === 'admin'
            ? ['ALL']
            : Array.isArray(payload.allowedPlants) && payload.allowedPlants.length > 0
            ? payload.allowedPlants
            : ['RIYADH'];
        const defaultPlantId =
          payload.defaultPlantId ||
          (allowedPlants.includes('ALL') ? 'RIYADH' : allowedPlants[0] || 'RIYADH');
        const user: AuthUser = {
          id: `usr_${now}_${Math.random().toString(36).slice(2, 6)}`,
          username: cleanUsername,
          fullName: cleanFullName,
          email: cleanEmail,
          roleId: `role_${roleName}`,
          roleName,
          roleDisplayName: ROLE_DISPLAY_NAME_MAP[roleName] || 'User / Operator',
          isActive: Boolean(payload.isActive),
          mustChangePassword: false,
          lastLoginAt: null,
          signatureDataUrl: payload.signatureDataUrl || '',
          createdBy: auth.currentUser?.email || 'admin',
          createdAt: now,
          updatedAt: now,
          permissions:
            Array.isArray(payload.permissions) && payload.permissions.length > 0
              ? payload.permissions
              : getDefaultPermissionsForRole(roleName),
          allowedPlants,
          defaultPlantId,
        };
        await syncAuthorizedUserToFirestore(user, auth.currentUser?.email || 'admin');
        await writeAuditLogToFirestore({
          action: 'USER_CREATED',
          targetType: 'user',
          targetId: user.id,
          details: `Created user ${user.username} (${user.email || 'no-email'}) [${allowedPlants.join(', ')}]`,
        });
        return { user };
      },
      () =>
        request('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
    );
  },

  async updateUser(
    userId: string,
    payload: {
      fullName?: string;
      email?: string;
      roleName?: UserRoleName;
      isActive?: boolean;
      allowedPlants?: string[];
      defaultPlantId?: string;
      signatureDataUrl?: string;
    }
  ): Promise<{ user: AuthUser }> {
    return withStaticFallback(
      async () => {
        const existingList = await listAuthorizedUsersFromFirestore();
        const existing = existingList.find((u) => u.id === userId);
        if (!existing) {
          throw new ApiError('User not found in Firestore allowlist.', 404);
        }
        const nextRole = payload.roleName ?? existing.roleName;
        const allowedPlants =
          nextRole === 'admin'
            ? ['ALL']
            : payload.allowedPlants ?? existing.allowedPlants ?? ['RIYADH'];
        const defaultPlantId =
          payload.defaultPlantId ??
          existing.defaultPlantId ??
          (allowedPlants.includes('ALL') ? 'RIYADH' : allowedPlants[0] || 'RIYADH');
        const roleChanged = payload.roleName && payload.roleName !== existing.roleName;
        const updated: AuthUser = {
          ...existing,
          fullName: payload.fullName !== undefined ? payload.fullName.trim() : existing.fullName,
          email: payload.email !== undefined ? payload.email.trim().toLowerCase() : existing.email,
          roleId: `role_${nextRole}`,
          roleName: nextRole,
          roleDisplayName: ROLE_DISPLAY_NAME_MAP[nextRole] || existing.roleDisplayName,
          isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : existing.isActive,
          signatureDataUrl:
            payload.signatureDataUrl !== undefined
              ? payload.signatureDataUrl
              : existing.signatureDataUrl,
          allowedPlants,
          defaultPlantId,
          permissions: roleChanged
            ? getDefaultPermissionsForRole(nextRole)
            : existing.permissions,
          updatedAt: Date.now(),
        };
        await syncAuthorizedUserToFirestore(
          updated,
          auth.currentUser?.email || 'admin',
          existing.email
        );
        await writeAuditLogToFirestore({
          action: 'USER_UPDATED',
          targetType: 'user',
          targetId: updated.id,
          details: `Updated user ${updated.username} (active=${updated.isActive}, plants=${allowedPlants.join(', ')})`,
        });
        return { user: updated };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
    );
  },

  async uploadUserSignature(userId: string, signatureDataUrl: string): Promise<{ user: AuthUser }> {
    return withStaticFallback(
      async () => {
        const existingList = await listAuthorizedUsersFromFirestore();
        const existing = existingList.find((u) => u.id === userId);
        if (!existing) throw new ApiError('User not found.', 404);
        const updated: AuthUser = { ...existing, signatureDataUrl, updatedAt: Date.now() };
        await syncAuthorizedUserToFirestore(updated, auth.currentUser?.email || 'admin', existing.email);
        return { user: updated };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}/signature`, {
          method: 'PUT',
          body: JSON.stringify({ signatureDataUrl }),
        })
    );
  },

  async deleteUserSignature(userId: string): Promise<{ user: AuthUser }> {
    return withStaticFallback(
      async () => {
        const existingList = await listAuthorizedUsersFromFirestore();
        const existing = existingList.find((u) => u.id === userId);
        if (!existing) throw new ApiError('User not found.', 404);
        const updated: AuthUser = { ...existing, signatureDataUrl: '', updatedAt: Date.now() };
        await syncAuthorizedUserToFirestore(updated, auth.currentUser?.email || 'admin', existing.email);
        return { user: updated };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}/signature`, {
          method: 'DELETE',
        })
    );
  },

  async updateUserPermissions(userId: string, permissions: string[]): Promise<{ user: AuthUser }> {
    return withStaticFallback(
      async () => {
        const existingList = await listAuthorizedUsersFromFirestore();
        const existing = existingList.find((u) => u.id === userId);
        if (!existing) throw new ApiError('User not found.', 404);
        const updated: AuthUser = { ...existing, permissions, updatedAt: Date.now() };
        await syncAuthorizedUserToFirestore(updated, auth.currentUser?.email || 'admin', existing.email);
        await writeAuditLogToFirestore({
          action: 'PERMISSIONS_UPDATED',
          targetType: 'user',
          targetId: updated.id,
          details: `Updated ${permissions.length} permissions for ${updated.username}`,
        });
        return { user: updated };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
          method: 'PUT',
          body: JSON.stringify({ permissions }),
        })
    );
  },

  async resetUserPassword(userId: string, temporaryPassword: string): Promise<{ ok: boolean; user: AuthUser }> {
    return withStaticFallback(
      async () => {
        throw new ApiError(
          'Local password reset requires the Node.js backend server. In static Firebase hosting, users authenticate with their allowlisted Google account.',
          400
        );
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ temporaryPassword }),
        })
    );
  },

  async revokeUserSessions(userId: string): Promise<{ ok: boolean }> {
    return withStaticFallback(
      async () => {
        await writeAuditLogToFirestore({
          action: 'SESSIONS_REVOKED',
          targetType: 'user',
          targetId: userId,
          details: `Revoked sessions for user ${userId}`,
        });
        return { ok: true };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
          method: 'POST',
        })
    );
  },

  async deleteUser(userId: string): Promise<{ ok: boolean }> {
    return withStaticFallback(
      async () => {
        const existingList = await listAuthorizedUsersFromFirestore();
        const existing = existingList.find((u) => u.id === userId);
        if (existing && (existing.email || '').toLowerCase() === DEFAULT_ADMIN_EMAIL) {
          throw new ApiError('Primary administrator account cannot be deleted.', 400);
        }
        await deleteAuthorizedUserFromFirestore(userId, existing?.email);
        await writeAuditLogToFirestore({
          action: 'USER_DELETED',
          targetType: 'user',
          targetId: userId,
          details: `Deleted user ${existing?.username || userId} (${existing?.email || 'no-email'})`,
        });
        return { ok: true };
      },
      () =>
        request(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
        })
    );
  },

  async getAuditLogs(params?: { action?: string; search?: string; limit?: number }): Promise<{ logs: AuditLogEntry[] }> {
    return withStaticFallback(
      async () => {
        const logs = await listAuditLogsFromFirestore(params);
        return { logs };
      },
      () => {
        const qs = new URLSearchParams();
        if (params?.action) qs.set('action', params.action);
        if (params?.search) qs.set('search', params.search);
        if (params?.limit) qs.set('limit', String(params.limit));
        const query = qs.toString();
        return request(`/api/admin/audit-logs${query ? `?${query}` : ''}`);
      }
    );
  },

  async getActiveSessions(): Promise<{ sessions: ActiveSessionInfo[] }> {
    return withStaticFallback(
      async () => ({ sessions: [] }),
      () => request('/api/admin/sessions')
    );
  },

  // Application Data
  async getTickets(plantId?: string): Promise<TicketRecord[]> {
    return withStaticFallback(
      async () => {
        const cached = StorageService.getTickets();
        const cachedById = new Map(cached.map((t) => [t.id, t]));
        try {
          const remote = await listGateTicketsFromFirestore(plantId);
          const merged = remote.map((t) => {
            const prev = cachedById.get(t.id);
            return {
              ...t,
              driverPhone: t.driverPhone || prev?.driverPhone || '',
              iqamaNumber: t.iqamaNumber || prev?.iqamaNumber || '',
              driverStatusToken: prev?.driverStatusToken,
            };
          });
          if (!plantId || plantId === 'ALL') {
            StorageService.saveTickets(merged);
          } else {
            const remoteById = new Map(merged.map((t) => [t.id, t]));
            const otherPlants = cached.filter((t) => !remoteById.has(t.id));
            StorageService.saveTickets([...merged, ...otherPlants]);
          }
          return merged;
        } catch {
          if (plantId && plantId !== 'ALL') {
            return cached.filter((t) => (t.plantId || 'RIYADH').toUpperCase() === plantId.toUpperCase());
          }
          return cached;
        }
      },
      async () => {
        const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
        const res = await request<{ tickets: TicketRecord[] }>(`/api/tickets${qs}`);
        return Array.isArray(res?.tickets) ? res.tickets : [];
      }
    );
  },

  async createTicket(payload: Omit<TicketRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TicketRecord> {
    return withStaticFallback(
      async () => {
        const now = Date.now();
        const created: TicketRecord = {
          ...payload,
          id: `tk_${now}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        await saveGateTicketToFirestore(created);
        upsertStaticTicketCache(created);
        return created;
      },
      async () => {
        const res = await request<{ ticket: TicketRecord }>('/api/tickets', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return res.ticket;
      }
    );
  },

  async updateTicket(id: string, updates: Partial<TicketRecord>): Promise<TicketRecord> {
    const updateInFirestore = async (): Promise<TicketRecord> => {
      const existing = await resolveStaticTicketById(id);
      if (!existing && !hasFullTicketPayload(updates)) {
        throw new ApiError('Ticket record not found.', 404);
      }
      const now = Date.now();
      const base: TicketRecord = existing || {
        id,
        plantId: updates.plantId || 'RIYADH',
        ticketNumber: String(updates.ticketNumber || id),
        sequenceNumber: Number(updates.sequenceNumber) || 1,
        date: String(updates.date || getTodayDateString()),
        timeIn: String(updates.timeIn || getCurrentTimeString()),
        gateNumber: String(updates.gateNumber || 'Gate 1'),
        gateSequenceNumber: Number(updates.gateSequenceNumber) || 1,
        truckNumber: String(updates.truckNumber || ''),
        driverName: String(updates.driverName || 'DRIVER'),
        driverPhone: String(updates.driverPhone || ''),
        transporterName: String(updates.transporterName || ''),
        destinationPlace: String(updates.destinationPlace || ''),
        status: updates.status || 'waiting',
        createdAt: typeof updates.createdAt === 'number' ? updates.createdAt : now,
        updatedAt: now,
      };
      const updated: TicketRecord = {
        ...base,
        ...updates,
        id: base.id,
        updatedAt: now,
        version: (base.version || 1) + 1,
      };
      await saveGateTicketToFirestore(updated);
      upsertStaticTicketCache(updated);
      return updated;
    };

    return withFirestore404Fallback(updateInFirestore, async () => {
      const res = await request<{ ticket: TicketRecord }>(`/api/tickets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return res.ticket;
    });
  },

  async updateTicketWithNotification(
    id: string,
    updates: Partial<TicketRecord>
  ): Promise<{
    ticket: TicketRecord;
    whatsappNotification?: WhatsAppDispatchOutcome;
    autoSavedMaterials?: MaterialMasterRecord[];
  }> {
    const updateWithNotificationInFirestore = async () => {
      const existing = await resolveStaticTicketById(id);
      if (!existing && !hasFullTicketPayload(updates)) {
        throw new ApiError('Ticket record not found.', 404);
      }
      const now = Date.now();
      const base: TicketRecord = existing || {
        id,
        plantId: updates.plantId || 'RIYADH',
        ticketNumber: String(updates.ticketNumber || id),
        sequenceNumber: Number(updates.sequenceNumber) || 1,
        date: String(updates.date || getTodayDateString()),
        timeIn: String(updates.timeIn || getCurrentTimeString()),
        gateNumber: String(updates.gateNumber || 'Gate 1'),
        gateSequenceNumber: Number(updates.gateSequenceNumber) || 1,
        truckNumber: String(updates.truckNumber || ''),
        driverName: String(updates.driverName || 'DRIVER'),
        driverPhone: String(updates.driverPhone || ''),
        transporterName: String(updates.transporterName || ''),
        destinationPlace: String(updates.destinationPlace || ''),
        status: updates.status || 'waiting',
        createdAt: typeof updates.createdAt === 'number' ? updates.createdAt : now,
        updatedAt: now,
      };
      const ticket: TicketRecord = {
        ...base,
        ...updates,
        id: base.id,
        updatedAt: now,
        version: (base.version || 1) + 1,
      };
      await saveGateTicketToFirestore(ticket);
      upsertStaticTicketCache(ticket);
      const autoSavedMaterials = await autoSaveSlipMaterialsStatic(updates.loadingSlip?.items);
      return {
        ticket,
        ...(autoSavedMaterials.length > 0 ? { autoSavedMaterials } : {}),
      };
    };

    return withFirestore404Fallback(
      updateWithNotificationInFirestore,
      () =>
        request<{
          ticket: TicketRecord;
          whatsappNotification?: WhatsAppDispatchOutcome;
          autoSavedMaterials?: MaterialMasterRecord[];
        }>(`/api/tickets/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        })
    );
  },

  async getWhatsAppLogs(ticketId?: string): Promise<WhatsAppNotificationLog[]> {
    return withStaticFallback(
      async () => [],
      async () => {
        const qs = ticketId ? `?ticketId=${encodeURIComponent(ticketId)}` : '';
        const res = await request<{ logs: WhatsAppNotificationLog[] }>(`/api/whatsapp/logs${qs}`);
        return Array.isArray(res?.logs) ? res.logs : [];
      }
    );
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
    return withStaticFallback(
      async () => {
        await deleteGateTicketFromFirestore(id);
        StorageService.saveTickets(StorageService.getTickets().filter((t) => t.id !== id));
      },
      async () => {
        await request(`/api/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    );
  },

  async restoreTicket(ticket: TicketRecord): Promise<TicketRecord> {
    return withStaticFallback(
      async () => {
        const restored: TicketRecord = { ...ticket, updatedAt: Date.now() };
        await saveGateTicketToFirestore(restored);
        StorageService.saveTickets([restored, ...StorageService.getTickets()]);
        return restored;
      },
      async () => {
        const res = await request<{ ticket: TicketRecord }>('/api/tickets/restore', {
          method: 'POST',
          body: JSON.stringify(ticket),
        });
        return res.ticket;
      }
    );
  },

  // Forklift Operator Loading
  async openTicketForForklift(ticketId: string): Promise<TicketRecord> {
    return withFirestore404Fallback(
      async () => {
        const prev = await resolveStaticTicketById(ticketId);
        if (!prev) {
          throw new ApiError('Ticket record not found.', 404);
        }
        if (
          prev.loadingSlip?.isLocked ||
          prev.status === 'completed' ||
          prev.status === 'cancelled' ||
          prev.status === 'under_loading'
        ) {
          return prev;
        }
        const operatorName = getStaticActorName();
        const nextSlip = prev.loadingSlip
          ? {
              ...prev.loadingSlip,
              checkedBy: prev.loadingSlip.checkedBy || operatorName,
            }
          : undefined;
        const updated: TicketRecord = {
          ...prev,
          ...(nextSlip ? { loadingSlip: nextSlip } : {}),
          status: 'under_loading',
          timeLoadingStarted: prev.timeLoadingStarted || getCurrentTimeString(),
          updatedAt: Date.now(),
          updatedBy: getStaticActorUsername(),
          version: (prev.version || 1) + 1,
        };
        await saveGateTicketToFirestore(updated);
        upsertStaticTicketCache(updated);
        return updated;
      },
      async () => {
        const res = await request<{ ticket: TicketRecord }>(`/api/tickets/${encodeURIComponent(ticketId)}/forklift/open`, {
          method: 'POST',
        });
        return res.ticket;
      }
    );
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
    return withFirestore404Fallback(
      async () => {
        const prev = await resolveStaticTicketById(ticketId);
        if (!prev) {
          throw new ApiError('Ticket record not found.', 404);
        }
        if (prev.loadingSlip?.isLocked || prev.status === 'completed') {
          throw new ApiError('This loading slip is locked because loading has already been completed.', 409);
        }
        if (!prev.loadingSlip || !Array.isArray(prev.loadingSlip.items)) {
          throw new ApiError('No Loading Slip materials have been prepared for this ticket yet.', 400);
        }
        const now = Date.now();
        const operatorName = getStaticActorName();
        const nextItems = prev.loadingSlip.items.map((item) => ({ ...item }));
        for (const upd of payload.itemUpdates || []) {
          const idx = Number(upd?.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= nextItems.length) continue;
          const target = nextItems[idx];
          if (typeof upd.isLoaded === 'boolean') {
            target.isLoaded = upd.isLoaded;
            if (upd.isLoaded) {
              target.loadedAt = now;
              target.loadedByName = operatorName;
              if ((target.loadedQty === undefined || target.loadedQty === '') && target.qty) {
                target.loadedQty = String(target.qty).trim().toUpperCase();
              }
            } else {
              target.loadedAt = undefined;
              target.loadedByName = undefined;
            }
          }
          if (typeof upd.loadedQty === 'string') {
            target.loadedQty = upd.loadedQty.trim().toUpperCase().slice(0, 60);
          }
          if (typeof upd.remarks === 'string') {
            target.remarks = upd.remarks.trim().toUpperCase().slice(0, 120);
          }
        }
        const nextStatus: TruckStatus =
          prev.status === 'waiting' || prev.status === 'called' ? 'under_loading' : prev.status;
        const updated: TicketRecord = {
          ...prev,
          status: nextStatus,
          timeLoadingStarted: prev.timeLoadingStarted || getCurrentTimeString(),
          loadingSlip: {
            ...prev.loadingSlip,
            items: nextItems,
            checkedBy: prev.loadingSlip.checkedBy || operatorName,
            loadedBy: operatorName,
          },
          updatedBy: getStaticActorUsername(),
          updatedAt: now,
          version: (prev.version || 1) + 1,
        };
        await saveGateTicketToFirestore(updated);
        upsertStaticTicketCache(updated);
        return updated;
      },
      async () => {
        const res = await request<{ ticket: TicketRecord }>(
          `/api/tickets/${encodeURIComponent(ticketId)}/forklift/checklist`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }
        );
        return res.ticket;
      }
    );
  },

  async completeForkliftLoading(
    ticketId: string,
    version?: number
  ): Promise<{ ticket: TicketRecord; alert: LoadingAlertNotification }> {
    return withFirestore404Fallback(
      async () => {
        const prev = await resolveStaticTicketById(ticketId);
        if (!prev) {
          throw new ApiError('Ticket record not found.', 404);
        }
        if (prev.loadingSlip?.isLocked || prev.status === 'completed') {
          throw new ApiError('Loading is already completed and locked for this ticket.', 409);
        }
        const items = Array.isArray(prev.loadingSlip?.items) ? prev.loadingSlip!.items : [];
        const activeItems = items.filter(
          (it) =>
            String(it?.description || '').trim() ||
            String(it?.qty || '').trim() ||
            String(it?.pack || '').trim()
        );
        if (activeItems.length === 0) {
          throw new ApiError('Cannot complete loading: no active materials are listed on this Loading Slip.', 400);
        }
        const pendingCount = activeItems.filter((it) => it.isLoaded !== true).length;
        if (pendingCount > 0) {
          throw new ApiError(
            `All materials must be checked/completed before clicking Loading Complete (${pendingCount} pending).`,
            400
          );
        }
        const now = Date.now();
        const operatorName = getStaticActorName();
        const completedTime = getCurrentTimeString();
        const completedDateTime = `${getTodayDateString()} ${completedTime}`;
        const updated: TicketRecord = {
          ...prev,
          status: 'completed',
          timeLoadingStarted: prev.timeLoadingStarted || completedTime,
          timeCompleted: completedTime,
          loadingSlip: {
            ...prev.loadingSlip!,
            checkedBy: operatorName,
            loadedBy: operatorName,
            isLocked: true,
            loadingCompletedAt: now,
            loadingCompletedTime: completedDateTime,
            loadingCompletedBy: operatorName,
          },
          updatedBy: getStaticActorUsername(),
          updatedAt: now,
          version: (prev.version || 1) + 1,
        };
        await saveGateTicketToFirestore(updated);
        upsertStaticTicketCache(updated);
        const alert: LoadingAlertNotification = {
          id: `alert_${now}`,
          plantId: updated.plantId || 'RIYADH',
          ticketId: updated.id,
          ticketNumber: updated.ticketNumber,
          delNoteNumber: updated.loadingSlip?.delNoteNumber || updated.delNoteNumber || '',
          truckNumber: updated.truckNumber,
          gateNumber: updated.gateNumber,
          completedBy: operatorName,
          completedTime: completedDateTime,
          createdAt: now,
        };
        return { ticket: updated, alert };
      },
      () =>
        request<{ ticket: TicketRecord; alert: LoadingAlertNotification }>(
          `/api/tickets/${encodeURIComponent(ticketId)}/forklift/complete`,
          {
            method: 'POST',
            body: JSON.stringify({ version }),
          }
        )
    );
  },

  async getLoadingAlerts(): Promise<LoadingAlertNotification[]> {
    return withStaticFallback(
      async () => [],
      async () => {
        const res = await request<{ alerts: LoadingAlertNotification[] }>('/api/loading-alerts');
        return Array.isArray(res?.alerts) ? res.alerts : [];
      }
    );
  },

  async dismissLoadingAlert(alertId: string): Promise<void> {
    return withStaticFallback(
      async () => undefined,
      async () => {
        await request(`/api/loading-alerts/${encodeURIComponent(alertId)}/dismiss`, {
          method: 'POST',
        });
      }
    );
  },

  async getDrivers(): Promise<DriverMasterRecord[]> {
    return withStaticFallback(
      async () => readStaticDrivers(),
      async () => {
        const res = await request<{ drivers: DriverMasterRecord[] }>('/api/drivers');
        return Array.isArray(res?.drivers) ? res.drivers : [];
      }
    );
  },

  async saveDriver(driver: Partial<DriverMasterRecord>): Promise<DriverMasterRecord> {
    return withStaticFallback(
      async () => {
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
      },
      async () => {
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
      }
    );
  },

  async deleteDriver(id: string): Promise<void> {
    return withStaticFallback(
      async () => {
        writeStaticDrivers(readStaticDrivers().filter((d) => d.id !== id));
      },
      async () => {
        await request(`/api/drivers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    );
  },

  // Material Master
  async getMaterials(): Promise<MaterialMasterRecord[]> {
    return withStaticFallback(
      async () => {
        try {
          const list = await listMaterialsFromFirestore();
          StorageService.saveMaterials(list);
          return list;
        } catch {
          return StorageService.getMaterials();
        }
      },
      async () => {
        const res = await request<{ materials: MaterialMasterRecord[] }>('/api/materials');
        return Array.isArray(res?.materials) ? res.materials : [];
      }
    );
  },

  async createMaterial(payload: {
    materialName: string;
    packType: string;
    palletRatio: number;
    remarks?: string;
  }): Promise<MaterialMasterRecord> {
    return withStaticFallback(
      async () => {
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
      },
      async () => {
        const res = await request<{ material: MaterialMasterRecord }>('/api/materials', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return res.material;
      }
    );
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
    return withStaticFallback(
      async () => {
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
      },
      async () => {
        const res = await request<{ material: MaterialMasterRecord }>(
          `/api/materials/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        return res.material;
      }
    );
  },

  async deleteMaterial(id: string): Promise<void> {
    return withStaticFallback(
      async () => {
        await deleteMaterialFromFirestore(id);
        StorageService.saveMaterials(StorageService.getMaterials().filter((m) => m.id !== id));
      },
      async () => {
        await request(`/api/materials/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    );
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
    return withStaticFallback(
      async () => {
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
      },
      () =>
        request('/api/materials/import', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
    );
  },

  async getSettings(): Promise<{ settings: CompanySettings | null; defaultSettings: CompanySettings | null }> {
    return withStaticFallback(
      async () => {
        const cloud = await getPlantSettingsFromFirestore().catch(() => null);
        const s = cloud ? writeStaticSettings(cloud) : readStaticSettings();
        return { settings: s, defaultSettings: DEFAULT_SETTINGS };
      },
      () => request('/api/settings')
    );
  },

  async saveSettings(settings: CompanySettings): Promise<CompanySettings> {
    return withStaticFallback(
      async () => {
        const saved = writeStaticSettings(settings);
        await savePlantSettingsToFirestore(saved).catch(() => {});
        return saved;
      },
      async () => {
        const res = await request<{ settings: CompanySettings }>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(settings),
        });
        return res.settings;
      }
    );
  },

  async saveAsDefaultSettings(settings: CompanySettings): Promise<CompanySettings> {
    return withStaticFallback(
      async () => {
        const saved = writeStaticSettings(settings);
        await savePlantSettingsToFirestore(saved).catch(() => {});
        return saved;
      },
      async () => {
        const res = await request<{ settings: CompanySettings }>('/api/settings/default', {
          method: 'PUT',
          body: JSON.stringify(settings),
        });
        return res.settings;
      }
    );
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
    if (staticFirebaseOnlyMode) return;
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

  // Liquid Material Camp Store (plant-scoped)
  async getLiquidState(plantId?: string): Promise<LiquidStoreState> {
    const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
    return request<LiquidStoreState>(`/api/liquid/state${qs}`);
  },

  async createLiquidTransaction(payload: {
    plantId?: string;
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
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState; txCode: string }>(`/api/liquid/transactions${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidTransaction(
    id: number,
    payload: {
      plantId?: string;
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
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState; txCode: string }>(`/api/liquid/transactions/${id}${qs}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidTransaction(id: number, plantId?: string): Promise<{ state: LiquidStoreState; txCode: string }> {
    const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
    return request<{ state: LiquidStoreState; txCode: string }>(`/api/liquid/transactions/${id}${qs}`, {
      method: 'DELETE',
    });
  },

  async createLiquidTank(payload: {
    plantId?: string;
    name: string;
    totalCapacityKg: number;
    depthMeters: number;
    location: string;
    notes?: string;
  }): Promise<{ state: LiquidStoreState }> {
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/tanks${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidTank(
    id: number,
    payload: {
      plantId?: string;
      name: string;
      totalCapacityKg: number;
      depthMeters: number;
      location: string;
      notes?: string;
    }
  ): Promise<{ state: LiquidStoreState }> {
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/tanks/${id}${qs}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidTank(id: number, plantId?: string): Promise<{ state: LiquidStoreState }> {
    const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/tanks/${id}${qs}`, {
      method: 'DELETE',
    });
  },

  async createLiquidMaterial(payload: {
    plantId?: string;
    name: string;
    code?: string;
    description?: string;
  }): Promise<{ state: LiquidStoreState }> {
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/materials${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateLiquidMaterial(
    id: number,
    payload: {
      plantId?: string;
      name: string;
      code?: string;
      description?: string;
    }
  ): Promise<{ state: LiquidStoreState }> {
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/materials/${id}${qs}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteLiquidMaterial(id: number, plantId?: string): Promise<{ state: LiquidStoreState }> {
    const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/materials/${id}${qs}`, {
      method: 'DELETE',
    });
  },

  async updateLiquidSettings(payload: Partial<LiquidStoreSettings> & { plantId?: string }): Promise<{ state: LiquidStoreState }> {
    const qs = payload.plantId && payload.plantId !== 'ALL' ? `?plantId=${encodeURIComponent(payload.plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/settings${qs}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async resetLiquidStore(plantId?: string): Promise<{ state: LiquidStoreState }> {
    const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
    return request<{ state: LiquidStoreState }>(`/api/liquid/reset${qs}`, {
      method: 'POST',
    });
  },

  // Ex-Factory Dispatch Entries (plant-scoped)
  async getExFactoryEntries(plantId?: string): Promise<ExFactoryEntry[]> {
    return withStaticFallback(
      async () => {
        const entries = await listExFactoryEntriesFromFirestore(plantId);
        cacheStaticExFactory = entries;
        return entries;
      },
      async () => {
        const qs = plantId && plantId !== 'ALL' ? `?plantId=${encodeURIComponent(plantId)}` : '';
        const res = await request<{ entries: ExFactoryEntry[] }>(`/api/ex-factory${qs}`);
        return res.entries;
      }
    );
  },

  async createExFactoryEntry(payload: {
    plantId?: string;
    entryDate?: string;
    delNoteNumber: string;
    customerName: string;
    loadingType?: TruckLoadingType;
    truckNumber: string;
    driverName?: string;
    mobileNumber?: string;
    iqamaNumber?: string;
  }): Promise<ExFactoryEntry> {
    return withStaticFallback(
      async () => {
        const delNoteNumber = payload.delNoteNumber.trim().toUpperCase();
        const customerName = payload.customerName.trim().toUpperCase();
        const truckNumber = payload.truckNumber.trim().toUpperCase();
        if (!delNoteNumber || !customerName || !truckNumber) {
          throw new ApiError('Del Note No., Customer Name, and Truck No. are required.', 400);
        }
        const now = Date.now();
        const actor = getStaticActorUsername();
        const rawDate = String(payload.entryDate || '').trim();
        const entry: ExFactoryEntry = {
          id: `exf_${now}_${Math.random().toString(36).slice(2, 7)}`,
          plantId: (payload.plantId || 'RIYADH').trim().toUpperCase() || 'RIYADH',
          entryDate: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayDateString(),
          delNoteNumber,
          customerName,
          loadingType: payload.loadingType || 'local',
          truckNumber,
          driverName: (payload.driverName || '').trim().toUpperCase(),
          mobileNumber: (payload.mobileNumber || '').trim().toUpperCase(),
          iqamaNumber: (payload.iqamaNumber || '').trim().toUpperCase(),
          createdBy: actor,
          updatedBy: actor,
          createdAt: now,
          updatedAt: now,
        };
        await saveExFactoryEntryToFirestore(entry);
        cacheStaticExFactory = [entry, ...cacheStaticExFactory.filter((e) => e.id !== entry.id)];
        return entry;
      },
      async () => {
        const res = await request<{ entry: ExFactoryEntry }>('/api/ex-factory', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return res.entry;
      }
    );
  },

  async updateExFactoryEntry(
    id: string,
    payload: {
      plantId?: string;
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
    return withFirestore404Fallback(
      async () => {
        let existing = cacheStaticExFactory.find((e) => e.id === id);
        if (!existing) {
          cacheStaticExFactory = await listExFactoryEntriesFromFirestore().catch(() => cacheStaticExFactory);
          existing = cacheStaticExFactory.find((e) => e.id === id);
        }
        if (!existing) {
          throw new ApiError('Ex-Factory entry not found.', 404);
        }
        const delNoteNumber = payload.delNoteNumber.trim().toUpperCase();
        const customerName = payload.customerName.trim().toUpperCase();
        const truckNumber = payload.truckNumber.trim().toUpperCase();
        if (!delNoteNumber || !customerName || !truckNumber) {
          throw new ApiError('Del Note No., Customer Name, and Truck No. are required.', 400);
        }
        const rawDate = String(payload.entryDate || '').trim();
        const updated: ExFactoryEntry = {
          ...existing,
          entryDate: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : existing.entryDate,
          delNoteNumber,
          customerName,
          loadingType: payload.loadingType || existing.loadingType || 'local',
          truckNumber,
          driverName: (payload.driverName || '').trim().toUpperCase(),
          mobileNumber: (payload.mobileNumber || '').trim().toUpperCase(),
          iqamaNumber: (payload.iqamaNumber || '').trim().toUpperCase(),
          updatedBy: getStaticActorUsername(),
          updatedAt: Date.now(),
        };
        await saveExFactoryEntryToFirestore(updated);
        cacheStaticExFactory = cacheStaticExFactory.map((e) => (e.id === id ? updated : e));
        return updated;
      },
      async () => {
        const res = await request<{ entry: ExFactoryEntry }>(`/api/ex-factory/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        return res.entry;
      }
    );
  },

  async deleteExFactoryEntry(id: string): Promise<void> {
    return withStaticFallback(
      async () => {
        await deleteExFactoryEntryFromFirestore(id);
        cacheStaticExFactory = cacheStaticExFactory.filter((e) => e.id !== id);
      },
      async () => {
        await request(`/api/ex-factory/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      }
    );
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
    return withFirestore404Fallback(
      async () => {
        let existing = cacheStaticExFactory.find((e) => e.id === id);
        if (!existing) {
          cacheStaticExFactory = await listExFactoryEntriesFromFirestore().catch(() => cacheStaticExFactory);
          existing = cacheStaticExFactory.find((e) => e.id === id);
        }
        if (!existing) {
          throw new ApiError('Ex-Factory entry not found.', 404);
        }
        const persistedUser = getPersistedLoginState().user;
        const actorName = getStaticActorName();
        const slipDelNote = (payload.loadingSlip.delNoteNumber || existing.delNoteNumber).trim().toUpperCase();
        const slipPlace = (payload.loadingSlip.placeName || '').trim().toUpperCase();
        if (!slipDelNote || !slipPlace) {
          throw new ApiError('Delivery Note Number and Destination Place are required on loading slip.', 400);
        }
        const updatedSlip: LoadingSlipData = {
          ...payload.loadingSlip,
          delNoteNumber: slipDelNote,
          placeName: slipPlace,
          storeInchargeUserId: payload.loadingSlip.storeInchargeUserId || persistedUser?.id || auth.currentUser?.uid,
          storeInchargeName: payload.loadingSlip.storeInchargeName || actorName,
          storeInchargeSignatureDataUrl:
            payload.loadingSlip.storeInchargeSignatureDataUrl || persistedUser?.signatureDataUrl || '',
        };
        const updated: ExFactoryEntry = {
          ...existing,
          delNoteNumber: slipDelNote,
          truckNumber:
            payload.truckNumber !== undefined
              ? payload.truckNumber.trim().toUpperCase() || existing.truckNumber
              : existing.truckNumber,
          driverName:
            payload.driverName !== undefined
              ? payload.driverName.trim().toUpperCase()
              : existing.driverName,
          mobileNumber:
            payload.mobileNumber !== undefined
              ? payload.mobileNumber.trim().toUpperCase()
              : existing.mobileNumber,
          loadingSlip: updatedSlip,
          updatedBy: getStaticActorUsername(),
          updatedAt: Date.now(),
        };
        await saveExFactoryEntryToFirestore(updated);
        cacheStaticExFactory = cacheStaticExFactory.map((e) => (e.id === id ? updated : e));
        const autoSavedMaterials = await autoSaveSlipMaterialsStatic(updatedSlip.items);
        return {
          entry: updated,
          ...(autoSavedMaterials.length > 0 ? { autoSavedMaterials } : {}),
        };
      },
      () =>
        request<{ entry: ExFactoryEntry; autoSavedMaterials?: MaterialMasterRecord[] }>(
          `/api/ex-factory/${encodeURIComponent(id)}/loading-slip`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        )
    );
  },
};
