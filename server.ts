import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  initializeApp as initializeFirebaseAdminApp,
  getApps as getFirebaseAdminApps,
  getApp as getFirebaseAdminApp,
} from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';
import {
  db,
  DEFAULT_ADMIN_EMAIL,
  getSafeUserById,
  logAudit,
  revokeAllUserSessions,
  cleanExpiredSessions,
  computeEffectivePermissions,
  parseUserAllowedPlants,
  FORKLIFT_ALLOWED_PERMISSION_KEYS,
  LIQUID_STORE_ALLOWED_PERMISSION_KEYS,
  EX_FACTORY_ALLOWED_PERMISSION_KEYS,
  SECURITY_GUARD_ALLOWED_PERMISSION_KEYS,
  USER_ASSIGNABLE_PERMISSION_KEYS,
  VIEW_ONLY_ALLOWED_PERMISSION_KEYS,
} from './server/db.ts';
import {
  DUMMY_BCRYPT_HASH,
  getClientIp,
  hashSessionToken,
  extractSessionToken,
  extractSessionTokens,
  validateUsername,
  validatePasswordStrength,
  checkIpRateLimit,
  recordIpAttempt,
  clearIpAttempts,
  createSessionForUser,
  clearSessionCookie,
  noCacheHeaders,
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  requirePermission,
  requireAnyPermission,
  userCanAccessPlant,
  resolveAuthorizedPlantForUser,
} from './server/security.ts';
import { liquidRouter } from './server/liquid.ts';
import { exFactoryRouter } from './server/exFactory.ts';
import {
  materialsRouter,
  mapMaterialRow,
  normalizePackType,
  normalizePalletRatio,
  syncMissingMaterialsFromLoadingSlip,
  type DbMaterialMasterRow,
} from './server/materials.ts';
import {
  upperStr,
  normalizeTicketRecord,
  normalizeDriverRecord,
  normalizeSettingsRecord,
  normalizeWhatsAppTemplates,
  normalizePlantId,
  normalizeAllowedPlants,
} from './server/normalize.ts';
import {
  ensureDriverSlipToken,
  getDriverSlipToken,
  markDriverTokenCompleted,
  dispatchLoadingSlipWhatsAppNotification,
  listWhatsAppLogs,
  getLatestWhatsAppLogForTicket,
} from './server/whatsapp.ts';

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);

// Security headers (frameguard & CSP disabled so AI Studio preview iframe works safely)
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Allow cross-origin requests from configured frontends (cookie + Bearer + CSRF)
app.use('/api', (req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-CSRF-Token, X-Background-Poll'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Prevent caching on all API routes
app.use('/api', noCacheHeaders);

// Periodic session cleanup (every 10 minutes)
setInterval(() => {
  try {
    cleanExpiredSessions();
  } catch (err) {
    console.error('Session cleanup failed:', err);
  }
}, 10 * 60 * 1000);

// ==========================================
// 1. AUTHENTICATION ENDPOINTS
// ==========================================

function getPublicBranding(): { companyName?: string; companySubtitle?: string; logoDataUrl?: string } | undefined {
  try {
    const row = (db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() ||
      db.prepare(`SELECT value_json FROM app_settings WHERE key = 'default'`).get()) as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    const parsed = JSON.parse(row.value_json);
    return {
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName.trim() : undefined,
      companySubtitle: typeof parsed.companySubtitle === 'string' ? parsed.companySubtitle.trim() : undefined,
      logoDataUrl: typeof parsed.logoDataUrl === 'string' ? parsed.logoDataUrl : '',
    };
  } catch {
    return undefined;
  }
}

function validateLogoDataUrl(
  val: unknown,
  label = 'Logo'
): { ok: true; value: string } | { ok: false; error: string } {
  if (val === undefined || val === null || val === '') {
    return { ok: true, value: '' };
  }
  if (typeof val !== 'string') {
    return { ok: false, error: `Invalid ${label.toLowerCase()} image format.` };
  }
  const trimmed = val.trim();
  if (!trimmed) return { ok: true, value: '' };
  if (trimmed.length > 2_000_000) {
    return { ok: false, error: `${label} image payload exceeds maximum allowed size.` };
  }
  if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return { ok: false, error: `${label} must be a valid base64 PNG, JPG, WebP, GIF, or SVG image.` };
  }
  return { ok: true, value: trimmed };
}

app.get('/api/auth/status', (req: Request, res: Response) => {
  const branding = getPublicBranding();
  const userCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number };
  const needsSetup = userCountRow.cnt === 0;

  const candidates = extractSessionTokens(req);
  const now = Date.now();

  for (const rawToken of candidates) {
    const sessionId = hashSessionToken(rawToken);
    const session = db
      .prepare(`SELECT id, user_id, csrf_token, expires_at, revoked_at FROM sessions WHERE id = ?`)
      .get(sessionId) as
      | {
          id: string;
          user_id: string;
          csrf_token: string;
          expires_at: number;
          revoked_at: number | null;
        }
      | undefined;

    if (session && session.revoked_at === null && now <= session.expires_at) {
      const user = getSafeUserById(session.user_id);
      if (user && user.isActive) {
        res.json({
          authenticated: true,
          needsSetup: false,
          user,
          csrfToken: session.csrf_token,
          branding,
        });
        return;
      }
    }
  }

  if (candidates.length > 0) {
    clearSessionCookie(req, res);
  }

  res.json({
    authenticated: false,
    needsSetup,
    branding,
    reason: candidates.length > 0 ? 'session_invalid_or_expired' : 'no_token',
  });
});

// ==========================================
// 1B. PUBLIC DRIVER LIVE LOADING STATUS (12-HOUR VALIDITY)
// ==========================================

const DRIVER_STATUS_VALIDITY_MS = 12 * 60 * 60 * 1000;
const DRIVER_LOOKUP_WINDOW_MS = 15 * 60 * 1000;
const DRIVER_LOOKUP_MAX_REQUESTS = 90;
const driverLookupIpMap = new Map<string, number[]>();

function checkAndRecordDriverLookupRateLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (driverLookupIpMap.get(ip) || []).filter((ts) => now - ts < DRIVER_LOOKUP_WINDOW_MS);
  if (recent.length >= DRIVER_LOOKUP_MAX_REQUESTS) {
    driverLookupIpMap.set(ip, recent);
    return false;
  }
  recent.push(now);
  driverLookupIpMap.set(ip, recent);
  return true;
}

function canonicalTruckKey(raw: unknown): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function truckNumbersMatch(inputRaw: string, storedRaw: unknown): boolean {
  const a = canonicalTruckKey(inputRaw);
  const b = canonicalTruckKey(storedRaw);
  if (!a || !b) return false;
  return a === b;
}

function getTicketQueueRank(status: string): number {
  switch (status) {
    case 'under_loading':
      return 0;
    case 'called':
      return 1;
    case 'waiting':
      return 2;
    default:
      return 3;
  }
}

/**
 * Keeps gateSequenceNumber strictly sequential & non-duplicated (1, 2, 3...)
 * across all active vehicles ('under_loading', 'called', 'waiting') for a given date & gate.
 */
function recomputeGateQueueNumbers(dateStr: string, gateNumber: string, plantId = 'RIYADH'): void {
  const normGate = upperStr(gateNumber);
  const normPlant = normalizePlantId(plantId, 'RIYADH');
  if (!dateStr || !normGate) return;

  const sameDayRows = db
    .prepare(`SELECT id, data_json FROM tickets WHERE date = ? ORDER BY sequence_number ASC`)
    .all(dateStr) as Array<{ id: string; data_json: string }>;

  const activeAtGate: Array<{ id: string; parsed: Record<string, any> }> = [];
  for (const r of sameDayRows) {
    try {
      const parsed = normalizeTicketRecord(JSON.parse(r.data_json));
      if (
        normalizePlantId(parsed.plantId, 'RIYADH') === normPlant &&
        upperStr(parsed.gateNumber) === normGate &&
        (parsed.status === 'under_loading' || parsed.status === 'called' || parsed.status === 'waiting')
      ) {
        activeAtGate.push({ id: r.id, parsed });
      }
    } catch {
      continue;
    }
  }

  activeAtGate.sort((a, b) => {
    const rankDiff = getTicketQueueRank(a.parsed.status) - getTicketQueueRank(b.parsed.status);
    if (rankDiff !== 0) return rankDiff;
    return (Number(a.parsed.sequenceNumber) || 0) - (Number(b.parsed.sequenceNumber) || 0);
  });

  const updateStmt = db.prepare(`UPDATE tickets SET data_json = ? WHERE id = ?`);
  activeAtGate.forEach((entry, index) => {
    const nextGateSeq = index + 1;
    if (Number(entry.parsed.gateSequenceNumber) !== nextGateSeq) {
      const updated = { ...entry.parsed, gateSequenceNumber: nextGateSeq };
      updateStmt.run(JSON.stringify(updated), entry.id);
    }
  });
}

function computeLiveGateQueueForTicket(matchedTicket: Record<string, any>) {
  const gateDate = String(matchedTicket.date || '');
  const normGate = upperStr(matchedTicket.gateNumber);
  const normPlant = normalizePlantId(matchedTicket.plantId, 'RIYADH');
  const sameDayRows = db
    .prepare(`SELECT data_json FROM tickets WHERE date = ? ORDER BY sequence_number ASC`)
    .all(gateDate) as Array<{ data_json: string }>;

  const gateTickets = sameDayRows
    .map((r) => {
      try {
        return normalizeTicketRecord(JSON.parse(r.data_json));
      } catch {
        return null;
      }
    })
    .filter((t): t is Record<string, any> =>
      Boolean(t && upperStr(t.gateNumber) === normGate && normalizePlantId(t.plantId, 'RIYADH') === normPlant)
    );

  const underLoadingList = gateTickets
    .filter((t) => t.status === 'under_loading')
    .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
  const calledList = gateTickets
    .filter((t) => t.status === 'called')
    .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
  const waitingList = gateTickets
    .filter((t) => t.status === 'waiting')
    .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));

  const activeQueue = [...underLoadingList, ...calledList, ...waitingList];
  let trucksAhead = 0;
  let queuePosition = 0;

  if (matchedTicket.status === 'under_loading') {
    const idxInLoading = underLoadingList.findIndex((t) => t.id === matchedTicket.id);
    trucksAhead = 0;
    queuePosition = idxInLoading >= 0 ? idxInLoading + 1 : 1;
  } else if (matchedTicket.status === 'called') {
    const idxInCalled = calledList.findIndex((t) => t.id === matchedTicket.id);
    trucksAhead = underLoadingList.length + (idxInCalled >= 0 ? idxInCalled : 0);
    queuePosition = trucksAhead + 1;
  } else if (matchedTicket.status === 'waiting') {
    const idxInWaiting = waitingList.findIndex((t) => t.id === matchedTicket.id);
    trucksAhead = underLoadingList.length + calledList.length + (idxInWaiting >= 0 ? idxInWaiting : 0);
    queuePosition = trucksAhead + 1;
  }

  const queueNumber = queuePosition > 0 ? queuePosition : Number(matchedTicket.gateSequenceNumber) || 1;
  const activeLoadingOther = underLoadingList.find((t) => t.id !== matchedTicket.id);
  const activeCalledOther = calledList.find((t) => t.id !== matchedTicket.id);

  return {
    gateNumber: String(matchedTicket.gateNumber || ''),
    queueNumber,
    trucksAhead,
    queuePosition,
    totalActiveAtGate: activeQueue.length,
    currentlyLoadingTruck: activeLoadingOther ? upperStr(activeLoadingOther.truckNumber) : null,
    nextCalledTruck: activeCalledOther ? upperStr(activeCalledOther.truckNumber) : null,
    waitingCount: waitingList.length,
    calledCount: calledList.length,
    underLoadingCount: underLoadingList.length,
  };
}

app.post('/api/public/driver-status', (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkAndRecordDriverLookupRateLimit(ip)) {
    res.status(429).json({ error: 'Too many status checks from this network. Please wait a few minutes and retry.' });
    return;
  }

  const rawTruck = typeof req.body?.truckNumber === 'string' ? req.body.truckNumber.trim() : '';
  const cleanTruckKey = canonicalTruckKey(rawTruck);
  if (cleanTruckKey.length < 3) {
    res.status(400).json({ error: 'Please enter a valid Vehicle / Truck Number (e.g. 5275 AXG).' });
    return;
  }

  // Ensure any 30-60 minute automatic waiting->under_loading transitions are up to date
  try {
    processAutoLoadingTransitions();
  } catch (err) {
    console.error('Driver lookup auto-transition error:', err);
  }

  const now = Date.now();
  const branding = getPublicBranding();

  const recentRows = db
    .prepare(
      `SELECT id, ticket_number, sequence_number, date, data_json, created_at
       FROM tickets
       ORDER BY created_at DESC
       LIMIT 600`
    )
    .all() as Array<{
    id: string;
    ticket_number: string;
    sequence_number: number;
    date: string;
    data_json: string;
    created_at: number;
  }>;

  let matchedRow: (typeof recentRows)[number] | null = null;
  let matchedTicket: Record<string, any> | null = null;

  for (const row of recentRows) {
    try {
      const parsed = normalizeTicketRecord(JSON.parse(row.data_json));
      if (truckNumbersMatch(rawTruck, parsed.truckNumber)) {
        matchedRow = row;
        matchedTicket = parsed;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!matchedRow || !matchedTicket) {
    res.json({
      found: false,
      expired: false,
      serverTimeMs: now,
      branding,
      message: 'No loading ticket or slip found for this Vehicle / Truck Number. Please check the truck number registered at gate entry.',
    });
    return;
  }

  const createdMs = Number(matchedTicket.createdAt || matchedRow.created_at || 0);
  const expiresAt = createdMs + DRIVER_STATUS_VALIDITY_MS;
  const isExpired = !createdMs || now > expiresAt;

  if (isExpired) {
    res.json({
      found: true,
      expired: true,
      expiredAt: expiresAt,
      serverTimeMs: now,
      branding,
      message:
        'Your loading status window has expired after 12 hours from slip/ticket generation. Please contact Dispatch or Gate Security if a new slip was issued.',
    });
    return;
  }

  const gateDate = String(matchedTicket.date || '');
  const queue = computeLiveGateQueueForTicket(matchedTicket);
  const hasLoadingSlip = Boolean(
    matchedTicket.loadingSlip &&
      Array.isArray(matchedTicket.loadingSlip.items) &&
      matchedTicket.loadingSlip.items.length > 0
  );

  res.json({
    found: true,
    expired: false,
    serverTimeMs: now,
    expiresAt,
    remainingMs: Math.max(0, expiresAt - now),
    branding,
    ticket: {
      id: matchedTicket.id,
      ticketNumber: upperStr(matchedTicket.ticketNumber),
      delNoteNumber: upperStr(matchedTicket.loadingSlip?.delNoteNumber || matchedTicket.delNoteNumber),
      sequenceNumber: Number(matchedTicket.sequenceNumber) || 0,
      gateNumber: String(matchedTicket.gateNumber || ''),
      gateSequenceNumber: queue.queueNumber,
      date: gateDate,
      timeIn: String(matchedTicket.timeIn || ''),
      timeCalled: matchedTicket.timeCalled ? String(matchedTicket.timeCalled) : undefined,
      timeLoadingStarted: matchedTicket.timeLoadingStarted ? String(matchedTicket.timeLoadingStarted) : undefined,
      timeCompleted: matchedTicket.timeCompleted ? String(matchedTicket.timeCompleted) : undefined,
      truckNumber: upperStr(matchedTicket.truckNumber),
      driverName: upperStr(matchedTicket.driverName),
      driverPhone: String(matchedTicket.driverPhone || ''),
      destinationPlace: upperStr(matchedTicket.loadingSlip?.placeName || matchedTicket.destinationPlace),
      transporterName: upperStr(matchedTicket.transporterName),
      status: matchedTicket.status,
      priority: matchedTicket.priority === 'urgent' ? 'urgent' : 'normal',
      createdAt: createdMs,
      hasLoadingSlip,
      slipLocked: Boolean(matchedTicket.loadingSlip?.isLocked),
    },
    queue,
  });
});

// Public tokenized Driver Live Loading Status endpoint (no login required, no internal DB IDs exposed)
app.get('/api/public/driver-loading-status/:token', noCacheHeaders, (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many invalid requests. Please wait a few minutes and try again.' });
    return;
  }

  const token = String(req.params.token || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    recordIpAttempt(ip);
    res.status(404).json({
      found: false,
      expired: false,
      serverTimeMs: Date.now(),
      branding: getPublicBranding(),
      message: 'Invalid or unrecognized Driver Live Loading Status link.',
    });
    return;
  }

  const tokenRow = db
    .prepare(
      `SELECT t.token, t.ticket_id, t.created_at as token_created_at, t.completed_at as token_completed_at, t.expires_at,
              tk.data_json, tk.updated_at as row_updated_at
       FROM driver_slip_tokens t
       INNER JOIN tickets tk ON tk.id = t.ticket_id
       WHERE t.token = ?`
    )
    .get(token) as
    | {
        token: string;
        ticket_id: string;
        token_created_at: number;
        token_completed_at: number | null;
        expires_at: number;
        data_json: string;
        row_updated_at: number;
      }
    | undefined;

  const now = Date.now();
  const branding = getPublicBranding();

  if (!tokenRow) {
    recordIpAttempt(ip);
    res.status(404).json({
      found: false,
      expired: false,
      serverTimeMs: now,
      branding,
      message: 'This Driver Live Loading Status link is invalid or the loading slip is no longer available.',
    });
    return;
  }

  if (now > Number(tokenRow.expires_at || 0)) {
    res.status(410).json({
      found: true,
      expired: true,
      expiredAt: Number(tokenRow.expires_at),
      serverTimeMs: now,
      branding,
      message:
        'This Driver Live Loading Status link has expired after completion. Please check with Dispatch or Gate Security if you need assistance.',
    });
    return;
  }

  // Ensure any scheduled auto-loading transitions are applied before serving status
  try {
    processAutoLoadingTransitions(now);
  } catch (err) {
    console.error('Token driver status auto-transition error:', err);
  }

  const freshRow = db.prepare(`SELECT data_json, updated_at FROM tickets WHERE id = ?`).get(tokenRow.ticket_id) as
    | { data_json: string; updated_at: number }
    | undefined;
  if (!freshRow) {
    res.status(404).json({
      found: false,
      expired: false,
      serverTimeMs: now,
      branding,
      message: 'Loading slip record is no longer active.',
    });
    return;
  }

  const ticket = normalizeTicketRecord(JSON.parse(freshRow.data_json));
  const queue = computeLiveGateQueueForTicket(ticket);

  const items: any[] = Array.isArray(ticket.loadingSlip?.items) ? ticket.loadingSlip.items : [];
  const activeItems = items.filter(
    (it) => String(it?.description || '').trim() || String(it?.qty || '').trim() || String(it?.pack || '').trim()
  );
  const totalItemsCount = activeItems.length;
  const loadedItemsCount = activeItems.filter((it) => it?.isLoaded === true).length;

  let statusLabel = 'Waiting in Queue';
  let stepIndex = 0;
  let progressPercent = 25;

  if (ticket.status === 'called') {
    statusLabel = 'Called to Gate';
    stepIndex = 1;
    progressPercent = 45;
  } else if (ticket.status === 'under_loading') {
    statusLabel = 'Under Loading';
    stepIndex = 2;
    if (totalItemsCount > 0) {
      progressPercent = Math.min(95, 55 + Math.round((loadedItemsCount / totalItemsCount) * 40));
    } else {
      progressPercent = 70;
    }
  } else if (ticket.status === 'completed') {
    statusLabel = 'Completed / Ready to Exit';
    stepIndex = 3;
    progressPercent = 100;
  } else if (ticket.status === 'cancelled') {
    statusLabel = 'Cancelled';
    stepIndex = 0;
    progressPercent = 0;
  }

  res.json({
    found: true,
    expired: false,
    serverTimeMs: now,
    expiresAt: Number(tokenRow.expires_at),
    remainingMs: Math.max(0, Number(tokenRow.expires_at) - now),
    branding,
    slip: {
      delNoteNumber: upperStr(ticket.loadingSlip?.delNoteNumber || ticket.delNoteNumber) || 'N/A',
      truckNumber: upperStr(ticket.truckNumber) || 'N/A',
      gateNumber: queue.gateNumber || 'Gate 1',
      queueNumber: queue.queueNumber,
      queuePosition: queue.queuePosition,
      trucksAhead: queue.trucksAhead,
      totalActiveAtGate: queue.totalActiveAtGate,
      currentlyLoadingTruck: queue.currentlyLoadingTruck,
      destinationPlace: upperStr(ticket.loadingSlip?.placeName || ticket.destinationPlace) || undefined,
      status: ticket.status,
      statusLabel,
      progressPercent,
      stepIndex,
      totalItemsCount,
      loadedItemsCount,
      timeIn: ticket.timeIn || undefined,
      timeCalled: ticket.timeCalled || undefined,
      timeLoadingStarted: ticket.timeLoadingStarted || undefined,
      timeCompleted: ticket.timeCompleted || undefined,
      lastUpdatedAt: Number(ticket.updatedAt || freshRow.updated_at || now),
    },
  });
});

// One-time Initial Admin Setup (permanently locked once at least 1 user exists)
app.post('/api/auth/setup', (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    return;
  }

  const userCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number };
  if (userCountRow.cnt > 0) {
    res.status(403).json({ error: 'Initial setup is already completed. Please log in with an Admin account.' });
    return;
  }

  const { username, fullName, email, password } = req.body || {};
  const usernameErr = validateUsername(String(username || ''));
  if (usernameErr) {
    res.status(400).json({ error: usernameErr });
    return;
  }
  if (!fullName || String(fullName).trim().length < 2) {
    res.status(400).json({ error: 'Full Name is required (minimum 2 characters).' });
    return;
  }
  const passErr = validatePasswordStrength(String(password || ''));
  if (passErr) {
    res.status(400).json({ error: passErr });
    return;
  }

  const cleanUsername = String(username || '').trim();
  const cleanFullName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim();
  const passwordHash = bcrypt.hashSync(String(password), 12);
  const userId = `usr_${crypto.randomUUID()}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, allowed_plants_json, default_plant_id, last_login_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'role_admin', 1, 0, '["ALL"]', 'RIYADH', ?, 'initial_setup', ?, ?)`
  ).run(userId, cleanUsername, cleanFullName, cleanEmail, passwordHash, now, now, now);

  const { rawToken, csrfToken } = createSessionForUser(req, res, userId);
  const safeUser = getSafeUserById(userId);

  logAudit({
    actorUserId: userId,
    actorUsername: cleanUsername,
    action: 'USER_CREATED',
    targetType: 'user',
    targetId: userId,
    details: `Initial Administrator account "${cleanUsername}" created`,
    ipAddress: ip,
  });

  logAudit({
    actorUserId: userId,
    actorUsername: cleanUsername,
    action: 'LOGIN_SUCCESS',
    targetType: 'session',
    targetId: userId,
    details: 'Initial Admin signed in upon setup',
    ipAddress: ip,
  });

  res.status(201).json({ user: safeUser, csrfToken, sessionToken: rawToken });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkIpRateLimit(ip)) {
    logAudit({
      actorUsername: String(req.body?.username || '').slice(0, 32) || 'unknown',
      action: 'LOGIN_FAILED',
      targetType: 'session',
      details: 'IP rate limit exceeded on login endpoint',
      ipAddress: ip,
    });
    res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
    return;
  }

  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!rawUsername || !rawPassword) {
    res.status(400).json({ error: 'Username (or Email) and password are required.' });
    return;
  }

  const userRow = db
    .prepare(
      `SELECT id, username, password_hash, is_active, failed_login_attempts, locked_until
       FROM users
       WHERE username = ? COLLATE NOCASE OR (email != '' AND LOWER(email) = LOWER(?))
       LIMIT 1`
    )
    .get(rawUsername, rawUsername) as
    | {
        id: string;
        username: string;
        password_hash: string;
        is_active: number;
        failed_login_attempts: number;
        locked_until: number | null;
      }
    | undefined;

  const now = Date.now();

  // Always execute bcrypt compare to prevent timing-based account enumeration
  const hashToCheck = userRow ? userRow.password_hash : DUMMY_BCRYPT_HASH;
  const passwordMatches = await bcrypt.compare(rawPassword, hashToCheck);

  if (!userRow) {
    recordIpAttempt(ip);
    logAudit({
      actorUsername: rawUsername.slice(0, 32),
      action: 'LOGIN_FAILED',
      targetType: 'session',
      details: 'Invalid login credentials',
      ipAddress: ip,
    });
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  // Check brute-force account lockout without revealing username status differently
  if (userRow.locked_until && now < userRow.locked_until) {
    recordIpAttempt(ip);
    logAudit({
      actorUserId: userRow.id,
      actorUsername: userRow.username,
      action: 'LOGIN_FAILED',
      targetType: 'session',
      details: 'Login attempt while account temporarily locked due to failed attempts',
      ipAddress: ip,
    });
    res.status(401).json({ error: 'Invalid username or password. Please try again later.' });
    return;
  }

  // Check active status (anti-enumeration: generic error)
  if (userRow.is_active !== 1 || !passwordMatches) {
    recordIpAttempt(ip);
    const nextAttempts = (userRow.failed_login_attempts || 0) + 1;
    const lockUntil = nextAttempts >= 5 ? now + 15 * 60 * 1000 : null;
    db.prepare(`UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`).run(
      lockUntil ? 0 : nextAttempts,
      lockUntil,
      userRow.id
    );

    logAudit({
      actorUserId: userRow.id,
      actorUsername: userRow.username,
      action: 'LOGIN_FAILED',
      targetType: 'session',
      details: userRow.is_active !== 1 ? 'Attempt on deactivated account' : `Incorrect password (attempt ${nextAttempts})`,
      ipAddress: ip,
    });

    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  // Successful authentication: reset brute-force counters & create fresh session (fixation prevention)
  clearIpAttempts(ip);
  db.prepare(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`).run(
    now,
    userRow.id
  );

  // Revoke previous token if one existed on this browser/tab (session fixation defense)
  const prevRawToken = extractSessionToken(req);
  if (prevRawToken) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(now, hashSessionToken(prevRawToken));
  }

  const { rawToken, csrfToken } = createSessionForUser(req, res, userRow.id);
  const safeUser = getSafeUserById(userRow.id);

  logAudit({
    actorUserId: userRow.id,
    actorUsername: userRow.username,
    action: 'LOGIN_SUCCESS',
    targetType: 'session',
    targetId: userRow.id,
    details: 'User logged in successfully',
    ipAddress: ip,
  });

  res.json({ user: safeUser, csrfToken, sessionToken: rawToken });
});

function getFirebaseProjectId(): string | null {
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const pid = typeof parsed?.projectId === 'string' ? parsed.projectId.trim() : '';
    if (!pid || pid === 'remixed-project-id') return null;
    return pid;
  } catch {
    return null;
  }
}

function getFirebaseAuthVerifier() {
  const projectId = getFirebaseProjectId();
  if (!projectId) return null;
  const fbApp = getFirebaseAdminApps().length
    ? getFirebaseAdminApp()
    : initializeFirebaseAdminApp({ projectId });
  return getFirebaseAdminAuth(fbApp);
}

app.post('/api/auth/firebase-login', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
    return;
  }

  const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
  if (!idToken) {
    res.status(400).json({ error: 'Firebase ID token is required.' });
    return;
  }

  const fbAuth = getFirebaseAuthVerifier();
  if (!fbAuth) {
    res.status(503).json({ error: 'Firebase authentication is not configured on this server.' });
    return;
  }

  let decoded;
  try {
    decoded = await fbAuth.verifyIdToken(idToken);
  } catch (err) {
    recordIpAttempt(ip);
    logAudit({
      actorUsername: 'firebase_unknown',
      action: 'LOGIN_FAILED',
      targetType: 'session',
      details: 'Invalid or expired Firebase ID token',
      ipAddress: ip,
    });
    res.status(401).json({ error: 'Firebase session verification failed. Please sign in again.' });
    return;
  }

  const rawEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!rawEmail || decoded.email_verified !== true) {
    recordIpAttempt(ip);
    res.status(401).json({ error: 'A verified Google email address is required to sign in.' });
    return;
  }

  const now = Date.now();
  let userRow = db
    .prepare(
      `SELECT id, username, is_active
       FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
    )
    .get(rawEmail) as { id: string; username: string; is_active: number } | undefined;

  if (!userRow) {
    if (rawEmail !== DEFAULT_ADMIN_EMAIL) {
      recordIpAttempt(ip);
      logAudit({
        actorUsername: rawEmail.slice(0, 32),
        action: 'LOGIN_FAILED',
        targetType: 'session',
        details: `Unauthorized Firebase Google login rejected for "${rawEmail}" (not authorized by Admin)`,
        ipAddress: ip,
      });
      res.status(403).json({
        error: `Access denied: Your Google account (${rawEmail}) is not authorized. Please ask the Default Administrator (${DEFAULT_ADMIN_EMAIL}) to add and activate your email first.`,
      });
      return;
    }

    const baseUsername = 'newshuntexpress';
    let candidateUsername = baseUsername;
    let suffix = 1;
    while (
      db.prepare(`SELECT 1 FROM users WHERE username = ? COLLATE NOCASE`).get(candidateUsername)
    ) {
      suffix += 1;
      candidateUsername = `${baseUsername}_${suffix}`;
    }

    const displayName =
      typeof decoded.name === 'string' && decoded.name.trim().length >= 2
        ? decoded.name.trim().slice(0, 80)
        : 'Default Administrator';

    const userId = `usr_${crypto.randomUUID()}`;
    const randomPassHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);

    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, allowed_plants_json, default_plant_id, failed_login_attempts, locked_until, last_login_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'role_admin', 1, 0, '["ALL"]', 'RIYADH', 0, NULL, ?, 'system', ?, ?)`
    ).run(userId, candidateUsername, displayName, rawEmail, randomPassHash, now, now, now);

    logAudit({
      actorUserId: userId,
      actorUsername: candidateUsername,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: userId,
      details: `Default Administrator "${candidateUsername}" (${rawEmail}) initialized via Firebase Google Sign-In`,
      ipAddress: ip,
    });

    userRow = { id: userId, username: candidateUsername, is_active: 1 };
  } else {
    if (userRow.is_active !== 1) {
      recordIpAttempt(ip);
      logAudit({
        actorUserId: userRow.id,
        actorUsername: userRow.username,
        action: 'LOGIN_FAILED',
        targetType: 'session',
        details: 'Firebase sign-in attempt on deactivated account',
        ipAddress: ip,
      });
      res.status(403).json({ error: 'Access denied: Your account has been deactivated by the Administrator.' });
      return;
    }

    db.prepare(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`).run(
      now,
      userRow.id
    );
  }

  clearIpAttempts(ip);

  const prevRawToken = extractSessionToken(req);
  if (prevRawToken) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(now, hashSessionToken(prevRawToken));
  }

  const { rawToken, csrfToken } = createSessionForUser(req, res, userRow.id);
  const safeUser = getSafeUserById(userRow.id);

  logAudit({
    actorUserId: userRow.id,
    actorUsername: userRow.username,
    action: 'LOGIN_SUCCESS',
    targetType: 'session',
    targetId: userRow.id,
    details: `User signed in via Firebase Google Authentication (${rawEmail})`,
    ipAddress: ip,
  });

  res.json({ user: safeUser, csrfToken, sessionToken: rawToken });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const candidates = extractSessionTokens(req);
  const revokedAt = Date.now();
  let audited = false;
  for (const rawToken of candidates) {
    const sessionId = hashSessionToken(rawToken);
    const session = db.prepare(`SELECT user_id FROM sessions WHERE id = ?`).get(sessionId) as
      | { user_id: string }
      | undefined;
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(revokedAt, sessionId);
    if (session && !audited) {
      audited = true;
      const user = getSafeUserById(session.user_id);
      logAudit({
        actorUserId: session.user_id,
        actorUsername: user?.username || 'unknown',
        action: 'LOGOUT',
        targetType: 'session',
        targetId: sessionId.slice(0, 12),
        details: 'User logged out securely',
        ipAddress: getClientIp(req),
      });
    }
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({
    user: req.auth!.user,
    csrfToken: req.auth!.csrfToken,
  });
});

app.post('/api/auth/change-password', requireAuth, requireCsrf, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  const userId = req.auth!.user.id;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }

  const row = db.prepare(`SELECT password_hash, username FROM users WHERE id = ?`).get(userId) as
    | { password_hash: string; username: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  const currentValid = await bcrypt.compare(String(currentPassword), row.password_hash);
  if (!currentValid) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const passErr = validatePasswordStrength(String(newPassword));
  if (passErr) {
    res.status(400).json({ error: passErr });
    return;
  }

  const isSameAsOld = await bcrypt.compare(String(newPassword), row.password_hash);
  if (isSameAsOld) {
    res.status(400).json({ error: 'New password must be different from your current password.' });
    return;
  }

  const newHash = await bcrypt.hash(String(newPassword), 12);
  const now = Date.now();
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).run(
    newHash,
    now,
    userId
  );

  // Revoke all previous sessions & issue a fresh rotated session
  revokeAllUserSessions(userId);
  const { rawToken, csrfToken } = createSessionForUser(req, res, userId);
  const updatedUser = getSafeUserById(userId);

  logAudit({
    actorUserId: userId,
    actorUsername: row.username,
    action: 'PASSWORD_CHANGED',
    targetType: 'user',
    targetId: userId,
    details: 'User changed their own password securely',
    ipAddress: getClientIp(req),
  });

  res.json({ user: updatedUser, csrfToken, sessionToken: rawToken, message: 'Password updated successfully.' });
});

// ==========================================
// 2. ADMIN USER MANAGEMENT & AUDIT LOGS
// ==========================================

app.get('/api/admin/roles', requireAuth, requirePasswordChanged, requireAdmin, (_req: Request, res: Response) => {
  const roles = db.prepare(`SELECT id, name, display_name as displayName, description FROM roles ORDER BY id`).all();
  const permissions = db.prepare(`SELECT id, key, name, category FROM permissions ORDER BY category, id`).all();
  res.json({ roles, permissions });
});

app.get('/api/admin/users', requireAuth, requirePasswordChanged, requireAdmin, (_req: Request, res: Response) => {
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role_id, u.is_active,
              u.must_change_password, u.last_login_at, u.signature_data_url,
              u.allowed_plants_json, u.default_plant_id,
              u.created_by, u.created_at, u.updated_at,
              r.name as role_name, r.display_name as role_display_name,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) as active_sessions
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at ASC`
    )
    .all(now) as Array<{
    id: string;
    username: string;
    full_name: string;
    email: string;
    role_id: string;
    is_active: number;
    must_change_password: number;
    last_login_at: number | null;
    signature_data_url: string | null;
    allowed_plants_json: string | null;
    default_plant_id: string | null;
    created_by: string | null;
    created_at: number;
    updated_at: number;
    role_name: string;
    role_display_name: string;
    active_sessions: number;
  }>;

  const users = rows.map((row) => {
    const allowedPlants = parseUserAllowedPlants(row.allowed_plants_json, row.role_name);
    const rawDef = String(row.default_plant_id || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const defaultPlantId = allowedPlants.includes('ALL')
      ? rawDef || 'RIYADH'
      : rawDef && allowedPlants.includes(rawDef)
      ? rawDef
      : allowedPlants[0] || 'RIYADH';

    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      roleId: row.role_id,
      roleName: row.role_name,
      roleDisplayName: row.role_display_name,
      isActive: row.is_active === 1,
      mustChangePassword: row.must_change_password === 1,
      lastLoginAt: row.last_login_at,
      signatureDataUrl: row.signature_data_url || '',
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeSessionCount: row.active_sessions,
      permissions: computeEffectivePermissions(row.id, row.role_id, row.role_name),
      allowedPlants,
      defaultPlantId,
    };
  });

  res.json({ users });
});

app.post('/api/admin/users', requireAuth, requirePasswordChanged, requireCsrf, requireAdmin, async (req: Request, res: Response) => {
  const {
    username,
    fullName,
    email,
    temporaryPassword,
    requirePasswordChange,
    roleName,
    isActive,
    permissions,
    allowedPlants,
    defaultPlantId,
    signatureDataUrl,
  } = req.body || {};

  const sigCheck = validateLogoDataUrl(signatureDataUrl, 'Signature');
  if (!sigCheck.ok) {
    res.status(400).json({ error: sigCheck.error });
    return;
  }

  const usernameErr = validateUsername(String(username || ''));
  if (usernameErr) {
    res.status(400).json({ error: usernameErr });
    return;
  }
  if (!fullName || String(fullName).trim().length < 2) {
    res.status(400).json({ error: 'Full Name is required (minimum 2 characters).' });
    return;
  }

  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const rawTempPassword = typeof temporaryPassword === 'string' ? temporaryPassword : '';
  if (!cleanEmail && !rawTempPassword) {
    res.status(400).json({ error: 'Either a Google/Work Email (for Firebase login) or a Temporary Password is required.' });
    return;
  }
  if (rawTempPassword) {
    const passErr = validatePasswordStrength(rawTempPassword);
    if (passErr) {
      res.status(400).json({ error: `Temporary Password invalid: ${passErr}` });
      return;
    }
  }

  const cleanUsername = String(username || '').trim();
  const existing = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`).get(cleanUsername);
  if (existing) {
    res.status(409).json({ error: 'Username already exists. Please choose another username.' });
    return;
  }
  if (cleanEmail) {
    const existingEmail = db.prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`).get(cleanEmail);
    if (existingEmail) {
      res.status(409).json({ error: 'This email address is already assigned to another user.' });
      return;
    }
  }

  const targetRoleName =
    roleName === 'admin'
      ? 'admin'
      : roleName === 'mmd_manager'
      ? 'mmd_manager'
      : roleName === 'view_only'
      ? 'view_only'
      : roleName === 'forklift_operator'
      ? 'forklift_operator'
      : roleName === 'liquid_store_operator'
      ? 'liquid_store_operator'
      : roleName === 'ex_factory_operator'
      ? 'ex_factory_operator'
      : roleName === 'security_guard'
      ? 'security_guard'
      : 'user';
  const roleRow = db.prepare(`SELECT id FROM roles WHERE name = ?`).get(targetRoleName) as { id: string } | undefined;
  if (!roleRow) {
    res.status(400).json({ error: 'Invalid role selected.' });
    return;
  }

  const normalizedPlants = normalizeAllowedPlants(allowedPlants, targetRoleName);
  const rawDefaultPlant = normalizePlantId(defaultPlantId, normalizedPlants.includes('ALL') ? 'RIYADH' : normalizedPlants[0] || 'RIYADH');
  const resolvedDefaultPlant =
    normalizedPlants.includes('ALL') || normalizedPlants.includes(rawDefaultPlant)
      ? rawDefaultPlant
      : normalizedPlants[0] || 'RIYADH';

  const userId = `usr_${crypto.randomUUID()}`;
  const hasExplicitPassword = rawTempPassword.length > 0;
  const passwordHash = await bcrypt.hash(
    hasExplicitPassword ? rawTempPassword : crypto.randomBytes(32).toString('hex'),
    12
  );
  const now = Date.now();
  const activeFlag = isActive === false ? 0 : 1;

  const createTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, role_id, is_active, must_change_password, signature_data_url, allowed_plants_json, default_plant_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      cleanUsername,
      String(fullName || '').trim(),
      cleanEmail,
      passwordHash,
      roleRow.id,
      activeFlag,
      hasExplicitPassword && requirePasswordChange !== false ? 1 : 0,
      sigCheck.value,
      JSON.stringify(normalizedPlants),
      resolvedDefaultPlant,
      req.auth!.user.username,
      now,
      now
    );

    if ((targetRoleName === 'user' || targetRoleName === 'mmd_manager') && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validUserPerms = new Set(USER_ASSIGNABLE_PERMISSION_KEYS);
      const cleanPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validUserPerms.has(permKey)
      );
      for (const permKey of cleanPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    } else if (targetRoleName === 'view_only' && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validViewOnlyPerms = new Set(VIEW_ONLY_ALLOWED_PERMISSION_KEYS);
      const cleanViewOnlyPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validViewOnlyPerms.has(permKey)
      );
      for (const permKey of cleanViewOnlyPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanViewOnlyPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    } else if (targetRoleName === 'forklift_operator' && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validForkliftPerms = new Set(FORKLIFT_ALLOWED_PERMISSION_KEYS);
      const cleanForkliftPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validForkliftPerms.has(permKey)
      );
      for (const permKey of cleanForkliftPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanForkliftPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    } else if (targetRoleName === 'liquid_store_operator' && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validLiquidPerms = new Set(LIQUID_STORE_ALLOWED_PERMISSION_KEYS);
      const cleanLiquidPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validLiquidPerms.has(permKey)
      );
      for (const permKey of cleanLiquidPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanLiquidPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    } else if (targetRoleName === 'ex_factory_operator' && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validExFactoryPerms = new Set(EX_FACTORY_ALLOWED_PERMISSION_KEYS);
      const cleanExFactoryPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validExFactoryPerms.has(permKey)
      );
      for (const permKey of cleanExFactoryPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanExFactoryPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    } else if (targetRoleName === 'security_guard' && Array.isArray(permissions)) {
      const insertPerm = db.prepare(
        `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      const validGuardPerms = new Set(SECURITY_GUARD_ALLOWED_PERMISSION_KEYS);
      const cleanGuardPerms = permissions.filter(
        (permKey): permKey is string => typeof permKey === 'string' && validGuardPerms.has(permKey)
      );
      for (const permKey of cleanGuardPerms) {
        insertPerm.run(userId, permKey);
      }
      if (cleanGuardPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          userId
        );
      }
    }
  });

  createTx();
  const createdUser = getSafeUserById(userId);

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'USER_CREATED',
    targetType: 'user',
    targetId: userId,
    details: `Created user "${cleanUsername}" with role "${targetRoleName}" (temporary password assigned)`,
    ipAddress: getClientIp(req),
  });

  res.status(201).json({ user: createdUser });
});

app.patch('/api/admin/users/:id', requireAuth, requirePasswordChanged, requireCsrf, requireAdmin, (req: Request, res: Response) => {
  const targetId = req.params.id;
  const target = getSafeUserById(targetId);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const { fullName, email, roleName, isActive, signatureDataUrl, allowedPlants, defaultPlantId } = req.body || {};

  let nextSignatureDataUrl = target.signatureDataUrl || '';
  const hasSignatureField = Object.prototype.hasOwnProperty.call(req.body || {}, 'signatureDataUrl');
  if (hasSignatureField) {
    const sigCheck = validateLogoDataUrl(signatureDataUrl, 'Signature');
    if (!sigCheck.ok) {
      res.status(400).json({ error: sigCheck.error });
      return;
    }
    nextSignatureDataUrl = sigCheck.value;
  }

  // Prevent self-lockout / self-demotion
  if (targetId === req.auth!.user.id) {
    if (isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own currently signed-in Admin account.' });
      return;
    }
    if (roleName && roleName !== 'admin') {
      res.status(400).json({ error: 'You cannot demote your own currently signed-in Admin account.' });
      return;
    }
  }

  const nextRoleName =
    roleName === 'admin' ||
    roleName === 'user' ||
    roleName === 'mmd_manager' ||
    roleName === 'view_only' ||
    roleName === 'forklift_operator' ||
    roleName === 'liquid_store_operator' ||
    roleName === 'ex_factory_operator' ||
    roleName === 'security_guard'
      ? roleName
      : target.roleName;
  const roleRow = db.prepare(`SELECT id FROM roles WHERE name = ?`).get(nextRoleName) as { id: string };
  const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : target.isActive ? 1 : 0;
  const nextFullName =
    typeof fullName === 'string' && fullName.trim().length >= 2 ? fullName.trim() : target.fullName;
  const nextEmail = typeof email === 'string' ? email.trim().toLowerCase() : target.email;

  const hasPlantsField = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedPlants');
  const nextAllowedPlants = hasPlantsField
    ? normalizeAllowedPlants(allowedPlants, nextRoleName)
    : normalizeAllowedPlants(target.allowedPlants, nextRoleName);
  const rawNextDefaultPlant =
    defaultPlantId !== undefined
      ? normalizePlantId(defaultPlantId, nextAllowedPlants.includes('ALL') ? 'RIYADH' : nextAllowedPlants[0] || 'RIYADH')
      : target.defaultPlantId || 'RIYADH';
  const nextDefaultPlantId =
    nextAllowedPlants.includes('ALL') || nextAllowedPlants.includes(rawNextDefaultPlant)
      ? rawNextDefaultPlant
      : nextAllowedPlants[0] || 'RIYADH';

  if (target.email.trim().toLowerCase() === DEFAULT_ADMIN_EMAIL) {
    if (isActive === false || nextRoleName !== 'admin' || nextEmail !== DEFAULT_ADMIN_EMAIL) {
      res.status(400).json({ error: `Default Administrator (${DEFAULT_ADMIN_EMAIL}) cannot be deactivated, demoted, or have their email removed.` });
      return;
    }
  }

  if (nextEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    const dupEmail = db
      .prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?`)
      .get(nextEmail, targetId);
    if (dupEmail) {
      res.status(409).json({ error: 'This email address is already assigned to another user.' });
      return;
    }
  }

  // Ensure at least 1 active Admin always remains
  if (target.roleName === 'admin' && (nextRoleName !== 'admin' || nextActive === 0)) {
    const otherActiveAdmins = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'admin' AND u.is_active = 1 AND u.id != ?`
      )
      .get(targetId) as { cnt: number };
    if (otherActiveAdmins.cnt === 0) {
      res.status(400).json({ error: 'At least one active Administrator account must remain in the system.' });
      return;
    }
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE users SET full_name = ?, email = ?, role_id = ?, is_active = ?, signature_data_url = ?, allowed_plants_json = ?, default_plant_id = ?, updated_at = ? WHERE id = ?`
    ).run(
      nextFullName,
      nextEmail,
      roleRow.id,
      nextActive,
      nextSignatureDataUrl,
      JSON.stringify(nextAllowedPlants),
      nextDefaultPlantId,
      Date.now(),
      targetId
    );
    if (nextRoleName !== target.roleName) {
      db.prepare(`DELETE FROM user_permissions WHERE user_id = ?`).run(targetId);
    }
  })();

  const plantsChanged = JSON.stringify(nextAllowedPlants) !== JSON.stringify(target.allowedPlants || []);
  // Immediately terminate active sessions if deactivated, role changed, or plant authorization restricted
  if (nextActive === 0 || nextRoleName !== target.roleName || (plantsChanged && targetId !== req.auth!.user.id)) {
    revokeAllUserSessions(targetId);
  }

  const actionType =
    nextActive === 0 && target.isActive
      ? 'USER_DEACTIVATED'
      : nextActive === 1 && !target.isActive
      ? 'USER_ACTIVATED'
      : 'USER_UPDATED';

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: actionType,
    targetType: 'user',
    targetId,
    details: `Updated user "${target.username}" (role: ${nextRoleName}, active: ${nextActive === 1}, plants: ${nextAllowedPlants.join(',')}${hasSignatureField ? (nextSignatureDataUrl ? ', signature updated' : ', signature removed') : ''})`,
    ipAddress: getClientIp(req),
  });

  res.json({ user: getSafeUserById(targetId) });
});

app.put(
  '/api/admin/users/:id/signature',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const sigCheck = validateLogoDataUrl(req.body?.signatureDataUrl, 'Signature');
    if (!sigCheck.ok) {
      res.status(400).json({ error: sigCheck.error });
      return;
    }
    if (!sigCheck.value) {
      res.status(400).json({ error: 'Signature image is required.' });
      return;
    }

    db.prepare(`UPDATE users SET signature_data_url = ?, updated_at = ? WHERE id = ?`).run(
      sigCheck.value,
      Date.now(),
      targetId
    );

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'USER_SIGNATURE_UPDATED',
      targetType: 'user',
      targetId,
      details: `Admin uploaded/updated digital signature for user "${target.username}"`,
      ipAddress: getClientIp(req),
    });

    res.json({ user: getSafeUserById(targetId) });
  }
);

app.delete(
  '/api/admin/users/:id/signature',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    db.prepare(`UPDATE users SET signature_data_url = '', updated_at = ? WHERE id = ?`).run(Date.now(), targetId);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'USER_SIGNATURE_DELETED',
      targetType: 'user',
      targetId,
      details: `Admin deleted digital signature for user "${target.username}"`,
      ipAddress: getClientIp(req),
    });

    res.json({ user: getSafeUserById(targetId) });
  }
);

app.put(
  '/api/admin/users/:id/permissions',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (target.roleName === 'admin') {
      res.status(400).json({ error: 'Administrators always retain full system permissions.' });
      return;
    }

    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      res.status(400).json({ error: 'Permissions array is required.' });
      return;
    }

    const validAllowedPerms =
      target.roleName === 'forklift_operator'
        ? new Set(FORKLIFT_ALLOWED_PERMISSION_KEYS)
        : target.roleName === 'liquid_store_operator'
        ? new Set(LIQUID_STORE_ALLOWED_PERMISSION_KEYS)
        : target.roleName === 'ex_factory_operator'
        ? new Set(EX_FACTORY_ALLOWED_PERMISSION_KEYS)
        : target.roleName === 'security_guard'
        ? new Set(SECURITY_GUARD_ALLOWED_PERMISSION_KEYS)
        : target.roleName === 'view_only'
        ? new Set(VIEW_ONLY_ALLOWED_PERMISSION_KEYS)
        : new Set(USER_ASSIGNABLE_PERMISSION_KEYS);

    const cleanPerms = permissions.filter((p): p is string => typeof p === 'string' && validAllowedPerms.has(p));

    const updateTx = db.transaction(() => {
      db.prepare(`DELETE FROM user_permissions WHERE user_id = ?`).run(targetId);
      const insertPerm = db.prepare(
        `INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, ?, 1)`
      );
      for (const perm of cleanPerms) {
        insertPerm.run(targetId, perm);
      }
      // Always insert at least a sentinel marker if all revoked so empty overrides don't fall back to defaults
      if (cleanPerms.length === 0) {
        db.prepare(`INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (?, '__none__', 0)`).run(
          targetId
        );
      }
    });

    updateTx();

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'PERMISSIONS_UPDATED',
      targetType: 'user',
      targetId,
      details: `Updated permissions for "${target.username}": ${cleanPerms.length ? cleanPerms.join(', ') : 'none'}`,
      ipAddress: getClientIp(req),
    });

    res.json({ user: getSafeUserById(targetId) });
  }
);

app.post(
  '/api/admin/users/:id/reset-password',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  async (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const { temporaryPassword } = req.body || {};
    const passErr = validatePasswordStrength(String(temporaryPassword || ''));
    if (passErr) {
      res.status(400).json({ error: passErr });
      return;
    }

    const newHash = await bcrypt.hash(String(temporaryPassword), 12);
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).run(
      newHash,
      Date.now(),
      targetId
    );

    // Force immediate re-login with new temporary password
    revokeAllUserSessions(targetId);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'PASSWORD_RESET',
      targetType: 'user',
      targetId,
      details: `Admin reset temporary password for "${target.username}" (password change required on next login)`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, user: getSafeUserById(targetId) });
  }
);

app.post(
  '/api/admin/users/:id/revoke-sessions',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (targetId === req.auth!.user.id) {
      res.status(400).json({ error: 'Use Logout to end your own active session.' });
      return;
    }

    revokeAllUserSessions(targetId);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'SESSION_REVOKED',
      targetType: 'user',
      targetId,
      details: `Admin terminated all active sessions for "${target.username}"`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  }
);

app.delete(
  '/api/admin/users/:id',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const targetId = req.params.id;
    const target = getSafeUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (targetId === req.auth!.user.id) {
      res.status(400).json({ error: 'You cannot delete your own currently signed-in account.' });
      return;
    }

    if (target.email && target.email.trim().toLowerCase() === DEFAULT_ADMIN_EMAIL) {
      res.status(400).json({ error: `Cannot delete the default Administrator account (${DEFAULT_ADMIN_EMAIL}).` });
      return;
    }

    if (target.roleName === 'admin') {
      const otherAdmins = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM users u
           INNER JOIN roles r ON r.id = u.role_id
           WHERE r.name = 'admin' AND u.is_active = 1 AND u.id != ?`
        )
        .get(targetId) as { cnt: number };
      if (otherAdmins.cnt === 0) {
        res.status(400).json({ error: 'Cannot delete the last remaining active Administrator account.' });
        return;
      }
    }

    revokeAllUserSessions(targetId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(targetId);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'USER_DELETED',
      targetType: 'user',
      targetId,
      details: `Deleted user "${target.username}"`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  }
);

app.get('/api/admin/audit-logs', requireAuth, requirePasswordChanged, requireAdmin, (req: Request, res: Response) => {
  const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const searchFilter = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 150));

  let query = `SELECT id, actor_user_id as actorUserId, actor_username as actorUsername, action, target_type as targetType, target_id as targetId, details, ip_address as ipAddress, created_at as createdAt FROM audit_logs WHERE 1=1`;
  const params: Array<string | number> = [];

  if (actionFilter && actionFilter !== 'ALL') {
    query += ` AND action = ?`;
    params.push(actionFilter);
  }
  if (searchFilter) {
    query += ` AND (actor_username LIKE ? OR details LIKE ? OR target_id LIKE ?)`;
    const like = `%${searchFilter}%`;
    params.push(like, like, like);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const logs = db.prepare(query).all(...params);
  res.json({ logs });
});

app.get('/api/admin/sessions', requireAuth, requirePasswordChanged, requireAdmin, (_req: Request, res: Response) => {
  const now = Date.now();
  const sessions = db
    .prepare(
      `SELECT substr(s.id, 1, 12) as sessionRef, s.user_id as userId, u.username, u.full_name as fullName,
              r.name as roleName, s.ip_address as ipAddress, s.user_agent as userAgent,
              s.created_at as createdAt, s.last_activity_at as lastActivityAt, s.expires_at as expiresAt
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       INNER JOIN roles r ON r.id = u.role_id
       WHERE s.revoked_at IS NULL AND s.expires_at > ?
       ORDER BY s.last_activity_at DESC`
    )
    .all(now);

  res.json({ sessions });
});

// ==========================================
// 3. PROTECTED APPLICATION DATA ENDPOINTS
// ==========================================

function upsertDriverMasterInternal(ticketData: {
  truckNumber?: string;
  driverName?: string;
  driverPhone?: string;
  transporterName?: string;
  destinationPlace?: string;
  iqamaNumber?: string;
  date?: string;
}) {
  const cleanTruck = upperStr(ticketData.truckNumber);
  if (!cleanTruck) return;
  const now = Date.now();
  const existing = db
    .prepare(`SELECT id, data_json FROM drivers WHERE truck_number = ? COLLATE NOCASE`)
    .get(cleanTruck) as { id: string; data_json: string } | undefined;

  if (existing) {
    const prev = normalizeDriverRecord(JSON.parse(existing.data_json));
    const updated = normalizeDriverRecord({
      ...prev,
      truckNumber: cleanTruck,
      driverName: upperStr(ticketData.driverName) || prev.driverName,
      driverPhone: upperStr(ticketData.driverPhone) || prev.driverPhone,
      iqamaNumber: upperStr(ticketData.iqamaNumber) || prev.iqamaNumber,
      transporterName: upperStr(ticketData.transporterName) || prev.transporterName,
      defaultDestination: upperStr(ticketData.destinationPlace) || prev.defaultDestination,
      lastVisited: ticketData.date || prev.lastVisited,
      tripCount: (prev.tripCount || 1) + 1,
    });
    db.prepare(`UPDATE drivers SET data_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(updated),
      now,
      existing.id
    );
  } else {
    const id = `drv-${now}-${crypto.randomBytes(3).toString('hex')}`;
    const created = normalizeDriverRecord({
      id,
      truckNumber: cleanTruck,
      driverName: upperStr(ticketData.driverName),
      driverPhone: upperStr(ticketData.driverPhone),
      iqamaNumber: upperStr(ticketData.iqamaNumber),
      transporterName: upperStr(ticketData.transporterName),
      defaultDestination: upperStr(ticketData.destinationPlace),
      lastVisited: ticketData.date || new Date().toISOString().split('T')[0],
      tripCount: 1,
    });
    db.prepare(`INSERT INTO drivers (id, truck_number, data_json, updated_at) VALUES (?, ?, ?, ?)`).run(
      id,
      cleanTruck,
      JSON.stringify(created),
      now
    );
  }
}

const MIN_AUTO_LOADING_MINUTES = 30;
const MAX_AUTO_LOADING_MINUTES = 60;
const DEFAULT_AUTO_LOADING_MINUTES = 30;

function clampAutoLoadingMinutes(raw?: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AUTO_LOADING_MINUTES;
  return Math.min(MAX_AUTO_LOADING_MINUTES, Math.max(MIN_AUTO_LOADING_MINUTES, Math.round(n)));
}

function getConfiguredAutoLoadingMinutes(): number {
  try {
    const row = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.value_json);
      if (parsed && parsed.autoLoadingMinutes !== undefined) {
        return clampAutoLoadingMinutes(parsed.autoLoadingMinutes);
      }
    }
  } catch {
    // Fallback to default
  }
  return DEFAULT_AUTO_LOADING_MINUTES;
}

function formatPlantTime(timestampMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

const PLANT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatPlantDateTime(timestampMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestampMs));
    const day = parts.find((p) => p.type === 'day')?.value || '01';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    const year = parts.find((p) => p.type === 'year')?.value || '2026';
    const monthName = PLANT_MONTHS[parseInt(month, 10) - 1] || month;
    return `${day}-${monthName}-${year} ${formatPlantTime(timestampMs)}`;
  } catch {
    return `${new Date(timestampMs).toISOString().split('T')[0]} ${formatPlantTime(timestampMs)}`;
  }
}

export function processAutoLoadingTransitions(nowMs = Date.now()): number {
  const defaultDelayMin = getConfiguredAutoLoadingMinutes();
  const minElapsedMs = MIN_AUTO_LOADING_MINUTES * 60 * 1000;
  const maxEligibleCreatedAt = nowMs - minElapsedMs;

  const candidateRows = db
    .prepare(
      `SELECT id, ticket_number, data_json, version, created_at
       FROM tickets
       WHERE created_at <= ?`
    )
    .all(maxEligibleCreatedAt) as Array<{
    id: string;
    ticket_number: string;
    data_json: string;
    version: number;
    created_at: number;
  }>;

  if (candidateRows.length === 0) return 0;

  const transitioned: Array<{ ticketNumber: string; createdAt: number; delayMinutes: number }> = [];
  const affectedGates = new Map<string, { plantId: string; date: string; gateNumber: string }>();

  db.transaction(() => {
    const updateStmt = db.prepare(
      `UPDATE tickets SET data_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    );

    for (const row of candidateRows) {
      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(row.data_json);
      } catch {
        continue;
      }

      if (parsed.status !== 'waiting') continue;
      if (parsed.manualStatusOverride === true) continue;
      if (parsed.autoUnderLoadingApplied === true) continue;

      const createdMs = Number(parsed.createdAt || row.created_at || 0);
      if (!createdMs || !Number.isFinite(createdMs)) continue;

      const delayMinutes = clampAutoLoadingMinutes(parsed.autoLoadingMinutes ?? defaultDelayMin);
      const targetAt = Number(parsed.autoUnderLoadingAt) || createdMs + delayMinutes * 60 * 1000;

      if (nowMs < targetAt) continue;

      const updatedRecord = {
        ...parsed,
        createdAt: createdMs,
        status: 'under_loading',
        timeLoadingStarted: parsed.timeLoadingStarted || formatPlantTime(nowMs),
        autoLoadingMinutes: delayMinutes,
        autoUnderLoadingAt: targetAt,
        autoStatusUpdatedAt: nowMs,
        autoUnderLoadingApplied: true,
        updatedAt: nowMs,
      };

      updateStmt.run(
        JSON.stringify(updatedRecord),
        row.version + 1,
        'system-auto',
        nowMs,
        row.id
      );

      if (parsed.date && parsed.gateNumber) {
        const pId = normalizePlantId(parsed.plantId, 'RIYADH');
        affectedGates.set(`${pId}::${parsed.date}::${upperStr(parsed.gateNumber)}`, {
          plantId: pId,
          date: String(parsed.date),
          gateNumber: String(parsed.gateNumber),
        });
      }

      transitioned.push({
        ticketNumber: row.ticket_number,
        createdAt: createdMs,
        delayMinutes,
      });
    }

    for (const g of affectedGates.values() as Iterable<{ plantId: string; date: string; gateNumber: string }>) {
      recomputeGateQueueNumbers(g.date, g.gateNumber, g.plantId);
    }
  })();

  for (const item of transitioned) {
    const elapsedMin = Math.round((nowMs - item.createdAt) / 60000);
    logAudit({
      actorUserId: null,
      actorUsername: 'system-auto',
      action: 'TICKET_AUTO_STATUS',
      targetType: 'ticket',
      targetId: item.ticketNumber,
      details: `Auto-changed status from Waiting in Queue to Under Loading after ${elapsedMin} min from creation (threshold: ${item.delayMinutes} min)`,
    });
  }

  return transitioned.length;
}

app.get(
  '/api/tickets',
  requireAuth,
  requirePasswordChanged,
  requireAnyPermission(['tickets.view', 'forklift.operate', 'dispatch.view', 'material_register.view', 'guard.view']),
  (req: Request, res: Response) => {
    processAutoLoadingTransitions();

    const reqPlantRaw = typeof req.query.plantId === 'string' ? req.query.plantId.trim().toUpperCase() : '';
    if (reqPlantRaw && reqPlantRaw !== 'ALL' && !userCanAccessPlant(req.auth!.user, reqPlantRaw)) {
      res.status(403).json({ error: `Access denied: You are not authorized to access ${reqPlantRaw} plant tickets.` });
      return;
    }

    const rows = db
      .prepare(
        `SELECT t.id, t.plant_id, t.data_json, t.version, t.created_by, t.updated_by, d.token as driver_status_token
         FROM tickets t
         LEFT JOIN driver_slip_tokens d ON d.ticket_id = t.id
         ORDER BY t.date DESC, t.sequence_number ASC`
      )
      .all() as Array<{
      id: string;
      plant_id: string | null;
      data_json: string;
      version: number;
      created_by: string | null;
      updated_by: string | null;
      driver_status_token: string | null;
    }>;

    const tickets = rows
      .map((r) => {
        const parsed = JSON.parse(r.data_json);
        const plantId = normalizePlantId(parsed.plantId || r.plant_id, 'RIYADH');
        let driverStatusToken = r.driver_status_token || undefined;
        if (!driverStatusToken && parsed.loadingSlip) {
          driverStatusToken = ensureDriverSlipToken(r.id, parsed.status);
        }
        return normalizeTicketRecord({
          ...parsed,
          id: r.id,
          plantId,
          version: r.version,
          createdBy: r.created_by || undefined,
          updatedBy: r.updated_by || undefined,
          ...(driverStatusToken ? { driverStatusToken } : {}),
        });
      })
      .filter((t) => {
        const pId = normalizePlantId(t.plantId, 'RIYADH');
        if (!userCanAccessPlant(req.auth!.user, pId)) return false;
        if (reqPlantRaw && reqPlantRaw !== 'ALL' && pId !== reqPlantRaw) return false;
        return true;
      });

    res.json({ tickets });
  }
);

app.post(
  '/api/tickets',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.create'),
  (req: Request, res: Response) => {
    const payload = req.body || {};
    const targetPlantId = resolveAuthorizedPlantForUser(req.auth!.user, payload.plantId);
    if (!targetPlantId) {
      res.status(403).json({ error: 'Access denied: You are not authorized to create tickets for this plant.' });
      return;
    }

    if (!payload.delNoteNumber || !String(payload.delNoteNumber).trim()) {
      res.status(400).json({ error: 'Delivery Note Number (Del Note No.) is required.' });
      return;
    }
    if (!payload.truckNumber || !String(payload.truckNumber).trim()) {
      res.status(400).json({ error: 'Vehicle / Truck Number is required.' });
      return;
    }
    if (!payload.driverName || !String(payload.driverName).trim()) {
      res.status(400).json({ error: 'Driver Name is required.' });
      return;
    }

    const createTx = db.transaction(() => {
      const dateStr = String(payload.date || new Date().toISOString().split('T')[0]);
      const dayRows = db
        .prepare(`SELECT sequence_number, plant_id, data_json FROM tickets WHERE date = ?`)
        .all(dateStr) as Array<{ sequence_number: number; plant_id: string | null; data_json: string }>;

      const plantDayRows = dayRows.filter((r) => {
        try {
          const p = JSON.parse(r.data_json);
          return normalizePlantId(p.plantId || r.plant_id, 'RIYADH') === targetPlantId;
        } catch {
          return normalizePlantId(r.plant_id, 'RIYADH') === targetPlantId;
        }
      });

      const maxSeq = plantDayRows.reduce((acc, r) => Math.max(acc, r.sequence_number || 0), 0);
      const nextSeq = maxSeq + 1;

      const settingsRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
        | { value_json: string }
        | undefined;
      const settingsObj = settingsRow ? normalizeSettingsRecord(JSON.parse(settingsRow.value_json)) : {};
      const prefix = upperStr(settingsObj.ticketPrefix) || 'TK';
      const plantObj = Array.isArray(settingsObj.plants)
        ? settingsObj.plants.find((pl: any) => String(pl.id || '').toUpperCase() === targetPlantId)
        : undefined;
      const plantCode = upperStr(
        plantObj?.code || (targetPlantId === 'JEDDAH' ? 'JED' : targetPlantId.slice(0, 3))
      );
      const overridePrefix = upperStr(settingsObj.plantSettingsMap?.[targetPlantId]?.ticketPrefix);
      const effectivePrefix =
        targetPlantId === 'RIYADH'
          ? overridePrefix || prefix
          : overridePrefix ||
            (() => {
              const base = prefix === 'AWZR' ? 'AWZ' : prefix;
              return base.endsWith(`-${plantCode}`) ? base : `${base}-${plantCode}`;
            })();
      const ticketNumber = `${effectivePrefix}-${dateStr.replace(/-/g, '')}-${String(nextSeq).padStart(3, '0')}`;

      const gateNumber = String(payload.gateNumber || 'Gate 1').trim();
      const normGate = upperStr(gateNumber);
      const activeAtGate = plantDayRows.filter((r) => {
        const parsed = JSON.parse(r.data_json);
        return (
          upperStr(parsed.gateNumber) === normGate &&
          (parsed.status === 'under_loading' || parsed.status === 'called' || parsed.status === 'waiting')
        );
      });
      const gateSeq = activeAtGate.length + 1;

      const now = Date.now();
      const autoLoadingMinutes = getConfiguredAutoLoadingMinutes();
      const autoUnderLoadingAt = now + autoLoadingMinutes * 60 * 1000;
      const id = `tkt-${now}-${crypto.randomBytes(3).toString('hex')}`;
      const record = normalizeTicketRecord({
        ...payload,
        plantId: targetPlantId,
        id,
        ticketNumber,
        sequenceNumber: nextSeq,
        gateNumber,
        gateSequenceNumber: gateSeq,
        date: dateStr,
        status: 'waiting',
        createdAt: now,
        updatedAt: now,
        autoLoadingMinutes,
        autoUnderLoadingAt,
        autoUnderLoadingApplied: false,
        manualStatusOverride: false,
      });

      db.prepare(
        `INSERT INTO tickets (id, plant_id, ticket_number, sequence_number, date, data_json, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        id,
        targetPlantId,
        ticketNumber,
        nextSeq,
        dateStr,
        JSON.stringify(record),
        req.auth!.user.username,
        req.auth!.user.username,
        now,
        now
      );

      recomputeGateQueueNumbers(dateStr, gateNumber, targetPlantId);
      const savedRow = db.prepare(`SELECT data_json FROM tickets WHERE id = ?`).get(id) as { data_json: string };
      const finalRecord = normalizeTicketRecord(JSON.parse(savedRow.data_json));

      upsertDriverMasterInternal(finalRecord);
      return normalizeTicketRecord({
        ...finalRecord,
        plantId: targetPlantId,
        version: 1,
        createdBy: req.auth!.user.username,
        updatedBy: req.auth!.user.username,
      });
    });

    const created = createTx();

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'TICKET_CREATED',
      targetType: 'ticket',
      targetId: created.ticketNumber,
      details: `[${created.plantId}] Created ticket ${created.ticketNumber} (${created.truckNumber}) at ${created.gateNumber}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ ticket: created });
  }
);

app.patch(
  '/api/tickets/:id',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.update'),
  async (req: Request, res: Response) => {
    const ticketId = req.params.id;
    const updates = req.body || {};

    const result = db.transaction(() => {
      const existing = db
        .prepare(`SELECT data_json, version, created_by FROM tickets WHERE id = ?`)
        .get(ticketId) as { data_json: string; version: number; created_by: string | null } | undefined;

      if (!existing) {
        return { errorStatus: 404 as const, error: 'Ticket record not found.' };
      }

      if (typeof updates.version === 'number' && updates.version !== existing.version) {
        return {
          errorStatus: 409 as const,
          error: 'This ticket was updated by another user. Data has been refreshed—please retry your change.',
        };
      }

      const prev = normalizeTicketRecord(JSON.parse(existing.data_json));
      const prevPlant = normalizePlantId(prev.plantId, 'RIYADH');
      if (!userCanAccessPlant(req.auth!.user, prevPlant)) {
        return { errorStatus: 403 as const, error: `Access denied: Ticket belongs to ${prevPlant} plant.` };
      }

      const {
        version: _ignoreVer,
        createdBy: _ignoreCb,
        updatedBy: _ignoreUb,
        createdAt: _ignoreCa,
        driverStatusToken: _ignoreDst,
        plantId: _ignorePlantChange,
        ...cleanUpdates
      } = updates;

      if (prev.loadingSlip?.isLocked && cleanUpdates.loadingSlip) {
        const prevItemsJson = JSON.stringify(prev.loadingSlip.items || []);
        const nextItemsJson = JSON.stringify(cleanUpdates.loadingSlip.items || []);
        if (
          prevItemsJson !== nextItemsJson ||
          cleanUpdates.loadingSlip.delNoteNumber !== prev.loadingSlip.delNoteNumber ||
          cleanUpdates.loadingSlip.placeName !== prev.loadingSlip.placeName
        ) {
          return {
            errorStatus: 409 as const,
            error: 'This loading slip is locked because loading has been completed.',
          };
        }
      }

      const now = Date.now();
      const hadSlipBefore = Boolean(
        prev.loadingSlip &&
          (String(prev.loadingSlip.delNoteNumber || '').trim() ||
            (Array.isArray(prev.loadingSlip.items) &&
              prev.loadingSlip.items.some(
                (it: any) =>
                  String(it?.description || '').trim() ||
                  String(it?.qty || '').trim() ||
                  String(it?.pack || '').trim()
              )))
      );
      const isNewLoadingSlip = Boolean(cleanUpdates.loadingSlip) && !hadSlipBefore;

      // Authoritatively attach authenticated user's full name & Admin-managed digital signature when loading slip is saved
      const cleanUpdatesWithUserSig = { ...cleanUpdates };
      if (cleanUpdatesWithUserSig.loadingSlip && !prev.loadingSlip?.isLocked) {
        cleanUpdatesWithUserSig.loadingSlip = {
          ...cleanUpdatesWithUserSig.loadingSlip,
          storeInchargeUserId: req.auth!.user.id,
          storeInchargeName: req.auth!.user.fullName,
          storeInchargeSignatureDataUrl: req.auth!.user.signatureDataUrl || '',
        };
      }

      // Editing or saving a Loading Slip sets status to 'waiting' (Waiting in Queue) and schedules 30-min auto Under Loading
      const requestedStatus = typeof cleanUpdatesWithUserSig.status === 'string' ? cleanUpdatesWithUserSig.status : undefined;
      const isSlipQueueReset = Boolean(
        cleanUpdatesWithUserSig.loadingSlip &&
          !prev.loadingSlip?.isLocked &&
          requestedStatus === 'waiting' &&
          cleanUpdatesWithUserSig.manualStatusOverride === false
      );
      const hasManualStatusChange = !isSlipQueueReset && Boolean(requestedStatus && requestedStatus !== prev.status);
      const configuredDelayMin = getConfiguredAutoLoadingMinutes();
      const slipDelayMin = isSlipQueueReset
        ? clampAutoLoadingMinutes(cleanUpdatesWithUserSig.autoLoadingMinutes ?? prev.autoLoadingMinutes ?? configuredDelayMin)
        : undefined;

      const merged = normalizeTicketRecord({
        ...prev,
        ...cleanUpdatesWithUserSig,
        plantId: prevPlant,
        id: prev.id,
        ticketNumber: prev.ticketNumber,
        sequenceNumber: prev.sequenceNumber,
        createdAt: prev.createdAt || now,
        ...(isSlipQueueReset
          ? {
              status: 'waiting',
              manualStatusOverride: false,
              autoUnderLoadingApplied: false,
              autoLoadingMinutes: slipDelayMin,
              autoUnderLoadingAt: now + slipDelayMin! * 60 * 1000,
              autoStatusUpdatedAt: undefined,
              timeLoadingStarted: '',
              timeCompleted: '',
            }
          : {
              manualStatusOverride: hasManualStatusChange ? true : Boolean(prev.manualStatusOverride),
            }),
        updatedAt: now,
      });
      const nextVersion = existing.version + 1;

      db.prepare(
        `UPDATE tickets SET plant_id = ?, date = ?, data_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`
      ).run(prevPlant, merged.date, JSON.stringify(merged), nextVersion, req.auth!.user.username, now, ticketId);

      // Recompute non-duplicated active queue positions for current (and prior if gate/date changed)
      recomputeGateQueueNumbers(merged.date, merged.gateNumber, prevPlant);
      if (upperStr(prev.gateNumber) !== upperStr(merged.gateNumber) || prev.date !== merged.date) {
        recomputeGateQueueNumbers(prev.date, prev.gateNumber, prevPlant);
      }

      // Ensure unique secure driver live status token when loading slip is present
      if (merged.loadingSlip) {
        ensureDriverSlipToken(ticketId, merged.status);
      }
      if (merged.status === 'completed' || merged.status === 'cancelled') {
        markDriverTokenCompleted(ticketId);
      }

      if (cleanUpdates.truckNumber || cleanUpdates.driverName || cleanUpdates.driverPhone) {
        upsertDriverMasterInternal(merged);
      }

      const autoSavedMaterials =
        cleanUpdates.loadingSlip && !prev.loadingSlip?.isLocked
          ? syncMissingMaterialsFromLoadingSlip(merged.loadingSlip?.items, req.auth!.user.username)
          : [];

      const refreshedRow = db.prepare(`SELECT data_json FROM tickets WHERE id = ?`).get(ticketId) as { data_json: string };
      const driverStatusToken = getDriverSlipToken(ticketId);
      const finalTicket = normalizeTicketRecord({
        ...JSON.parse(refreshedRow.data_json),
        version: nextVersion,
        createdBy: existing.created_by || undefined,
        updatedBy: req.auth!.user.username,
        ...(driverStatusToken ? { driverStatusToken } : {}),
      });

      return {
        ticket: finalTicket,
        slipSaved: Boolean(cleanUpdates.loadingSlip),
        isNewLoadingSlip,
        autoSavedMaterials,
      };
    })();

    if ('errorStatus' in result && result.errorStatus) {
      res.status(result.errorStatus).json({ error: result.error });
      return;
    }

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: result.slipSaved ? 'SLIP_SAVED' : 'TICKET_UPDATED',
      targetType: 'ticket',
      targetId: result.ticket.ticketNumber,
      details: `${result.slipSaved ? 'Saved loading slip for' : 'Updated'} ${result.ticket.ticketNumber} (${result.ticket.status})`,
      ipAddress: getClientIp(req),
    });

    // Trigger Automatic WhatsApp notification when a Loading Slip is newly generated
    let whatsappNotification: Awaited<ReturnType<typeof dispatchLoadingSlipWhatsAppNotification>> | undefined;
    if (result.isNewLoadingSlip) {
      const liveQueue = computeLiveGateQueueForTicket(result.ticket);
      try {
        whatsappNotification = await dispatchLoadingSlipWhatsAppNotification({
          ticket: result.ticket,
          queueNumber: liveQueue.queueNumber,
          req,
          isRetry: false,
        });

        if (whatsappNotification.triggered) {
          logAudit({
            actorUserId: req.auth!.user.id,
            actorUsername: req.auth!.user.username,
            action:
              whatsappNotification.deliveryStatus === 'sent'
                ? 'WHATSAPP_AUTO_SENT'
                : whatsappNotification.deliveryStatus === 'skipped'
                ? 'WHATSAPP_AUTO_SKIPPED'
                : 'WHATSAPP_AUTO_FAILED',
            targetType: 'ticket',
            targetId: result.ticket.ticketNumber,
            details:
              whatsappNotification.deliveryStatus === 'sent'
                ? `Auto-sent WhatsApp update to ${whatsappNotification.driverMobile} (Queue #${whatsappNotification.queueNumber}, Gate ${whatsappNotification.gateNumber})`
                : `Auto WhatsApp ${whatsappNotification.deliveryStatus}: ${whatsappNotification.errorMessage || 'Unknown error'}`,
            ipAddress: getClientIp(req),
          });
        }
      } catch (err: any) {
        console.error('WhatsApp auto-dispatch unexpected error:', err);
      }
    }

    res.json({
      ticket: result.ticket,
      ...(whatsappNotification ? { whatsappNotification } : {}),
      ...(result.autoSavedMaterials && result.autoSavedMaterials.length > 0
        ? { autoSavedMaterials: result.autoSavedMaterials }
        : {}),
    });
  }
);

// Forklift Operator Loading Endpoints
app.post(
  '/api/tickets/:id/forklift/open',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAnyPermission(['forklift.operate', 'tickets.update']),
  (req: Request, res: Response) => {
    const ticketId = req.params.id;
    const now = Date.now();

    const result = db.transaction(() => {
      const existing = db
        .prepare(`SELECT data_json, version, created_by FROM tickets WHERE id = ?`)
        .get(ticketId) as { data_json: string; version: number; created_by: string | null } | undefined;

      if (!existing) {
        return { errorStatus: 404 as const, error: 'Ticket record not found.' };
      }

      const prev = normalizeTicketRecord(JSON.parse(existing.data_json));
      const prevPlant = normalizePlantId(prev.plantId, 'RIYADH');
      if (!userCanAccessPlant(req.auth!.user, prevPlant)) {
        return { errorStatus: 403 as const, error: `Access denied: Ticket belongs to ${prevPlant} plant.` };
      }

      // Do not modify locked or completed slips
      if (prev.loadingSlip?.isLocked || prev.status === 'completed' || prev.status === 'cancelled') {
        return {
          ticket: normalizeTicketRecord({
            ...prev,
            version: existing.version,
            createdBy: existing.created_by || undefined,
          }),
          changed: false,
        };
      }

      if (prev.status === 'under_loading') {
        return {
          ticket: normalizeTicketRecord({
            ...prev,
            version: existing.version,
            createdBy: existing.created_by || undefined,
          }),
          changed: false,
        };
      }

      // Transition Waiting in Queue (or Called) -> Under Loading when Forklift Operator opens slip
      const nextSlip = prev.loadingSlip
        ? {
            ...prev.loadingSlip,
            checkedBy: prev.loadingSlip.checkedBy || req.auth!.user.fullName,
          }
        : undefined;

      const updated = normalizeTicketRecord({
        ...prev,
        ...(nextSlip ? { loadingSlip: nextSlip } : {}),
        status: 'under_loading',
        timeLoadingStarted: prev.timeLoadingStarted || formatPlantTime(now),
        manualStatusOverride: true,
        updatedAt: now,
      });
      const nextVersion = existing.version + 1;

      db.prepare(`UPDATE tickets SET data_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(updated),
        nextVersion,
        req.auth!.user.username,
        now,
        ticketId
      );

      recomputeGateQueueNumbers(updated.date, updated.gateNumber, prevPlant);
      const refreshedRow = db.prepare(`SELECT data_json FROM tickets WHERE id = ?`).get(ticketId) as { data_json: string };
      const driverStatusToken = getDriverSlipToken(ticketId);

      return {
        ticket: normalizeTicketRecord({
          ...JSON.parse(refreshedRow.data_json),
          version: nextVersion,
          createdBy: existing.created_by || undefined,
          updatedBy: req.auth!.user.username,
          ...(driverStatusToken ? { driverStatusToken } : {}),
        }),
        changed: true,
      };
    })();

    if ('errorStatus' in result && result.errorStatus) {
      res.status(result.errorStatus).json({ error: result.error });
      return;
    }

    if (result.changed) {
      logAudit({
        actorUserId: req.auth!.user.id,
        actorUsername: req.auth!.user.username,
        action: 'TICKET_UPDATED',
        targetType: 'ticket',
        targetId: result.ticket.ticketNumber,
        details: `Forklift operator "${req.auth!.user.fullName}" opened Loading Slip (Under Loading)`,
        ipAddress: getClientIp(req),
      });
    }

    res.json({ ticket: result.ticket });
  }
);

app.patch(
  '/api/tickets/:id/forklift/checklist',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAnyPermission(['forklift.operate', 'tickets.update']),
  (req: Request, res: Response) => {
    const ticketId = req.params.id;
    const { itemUpdates, version } = req.body || {};

    if (!Array.isArray(itemUpdates) || itemUpdates.length === 0) {
      res.status(400).json({ error: 'Checklist updates are required.' });
      return;
    }

    const now = Date.now();
    const operatorName = req.auth!.user.fullName;

    const result = db.transaction(() => {
      const existing = db
        .prepare(`SELECT data_json, version, created_by FROM tickets WHERE id = ?`)
        .get(ticketId) as { data_json: string; version: number; created_by: string | null } | undefined;

      if (!existing) {
        return { errorStatus: 404 as const, error: 'Ticket record not found.' };
      }

      if (typeof version === 'number' && version !== existing.version) {
        return {
          errorStatus: 409 as const,
          error: 'This loading slip was updated by another user. Please refresh and retry.',
        };
      }

      const prev = normalizeTicketRecord(JSON.parse(existing.data_json));
      const prevPlant = normalizePlantId(prev.plantId, 'RIYADH');
      if (!userCanAccessPlant(req.auth!.user, prevPlant)) {
        return { errorStatus: 403 as const, error: `Access denied: Ticket belongs to ${prevPlant} plant.` };
      }
      if (prev.loadingSlip?.isLocked || prev.status === 'completed') {
        return {
          errorStatus: 409 as const,
          error: 'This loading slip is locked because loading has already been completed.',
        };
      }

      if (!prev.loadingSlip || !Array.isArray(prev.loadingSlip.items)) {
        return {
          errorStatus: 400 as const,
          error: 'No Loading Slip materials have been prepared for this ticket yet.',
        };
      }

      const nextItems = prev.loadingSlip.items.map((item: any) => ({ ...item }));
      for (const upd of itemUpdates) {
        const idx = Number(upd?.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= nextItems.length) continue;
        const target = nextItems[idx];

        if (typeof upd.isLoaded === 'boolean') {
          target.isLoaded = upd.isLoaded;
          if (upd.isLoaded) {
            target.loadedAt = now;
            target.loadedByName = operatorName;
            if ((target.loadedQty === undefined || target.loadedQty === '') && target.qty) {
              target.loadedQty = upperStr(target.qty);
            }
          } else {
            target.loadedAt = undefined;
            target.loadedByName = undefined;
          }
        }
        if (typeof upd.loadedQty === 'string') {
          target.loadedQty = upperStr(upd.loadedQty).slice(0, 60);
        }
        // Only update remarks if explicitly supplied; preserve manual Production Date
        if (typeof upd.remarks === 'string') {
          target.remarks = upperStr(upd.remarks).slice(0, 120);
        }
      }

      const nextSlip = {
        ...prev.loadingSlip,
        items: nextItems,
        checkedBy: prev.loadingSlip.checkedBy || operatorName,
        loadedBy: operatorName,
      };

      const nextStatus = prev.status === 'waiting' || prev.status === 'called' ? 'under_loading' : prev.status;
      const updated = normalizeTicketRecord({
        ...prev,
        status: nextStatus,
        timeLoadingStarted: prev.timeLoadingStarted || formatPlantTime(now),
        manualStatusOverride: true,
        loadingSlip: nextSlip,
        updatedAt: now,
      });

      const nextVersion = existing.version + 1;
      db.prepare(`UPDATE tickets SET data_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(updated),
        nextVersion,
        req.auth!.user.username,
        now,
        ticketId
      );

      const driverStatusToken = getDriverSlipToken(ticketId);
      return {
        ticket: normalizeTicketRecord({
          ...updated,
          version: nextVersion,
          createdBy: existing.created_by || undefined,
          updatedBy: req.auth!.user.username,
          ...(driverStatusToken ? { driverStatusToken } : {}),
        }),
      };
    })();

    if ('errorStatus' in result && result.errorStatus) {
      res.status(result.errorStatus).json({ error: result.error });
      return;
    }

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'FORKLIFT_CHECKLIST_UPDATED',
      targetType: 'ticket',
      targetId: result.ticket.ticketNumber,
      details: `Forklift operator "${operatorName}" updated loading checklist for ${result.ticket.ticketNumber}`,
      ipAddress: getClientIp(req),
    });

    res.json({ ticket: result.ticket });
  }
);

app.post(
  '/api/tickets/:id/forklift/complete',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAnyPermission(['forklift.operate', 'tickets.update']),
  (req: Request, res: Response) => {
    const ticketId = req.params.id;
    const { version } = req.body || {};
    const now = Date.now();
    const operatorName = req.auth!.user.fullName;
    const completedTime = formatPlantTime(now);
    const completedDateTime = formatPlantDateTime(now);

    const result = db.transaction(() => {
      const existing = db
        .prepare(`SELECT data_json, version, created_by FROM tickets WHERE id = ?`)
        .get(ticketId) as { data_json: string; version: number; created_by: string | null } | undefined;

      if (!existing) {
        return { errorStatus: 404 as const, error: 'Ticket record not found.' };
      }

      if (typeof version === 'number' && version !== existing.version) {
        return {
          errorStatus: 409 as const,
          error: 'This loading slip was modified by another user. Data refreshed—please retry.',
        };
      }

      const prev = normalizeTicketRecord(JSON.parse(existing.data_json));
      const prevPlant = normalizePlantId(prev.plantId, 'RIYADH');
      if (!userCanAccessPlant(req.auth!.user, prevPlant)) {
        return { errorStatus: 403 as const, error: `Access denied: Ticket belongs to ${prevPlant} plant.` };
      }
      if (prev.loadingSlip?.isLocked || prev.status === 'completed') {
        return {
          errorStatus: 409 as const,
          error: 'Loading is already completed and locked for this ticket.',
        };
      }

      const items: any[] = Array.isArray(prev.loadingSlip?.items) ? prev.loadingSlip.items : [];
      const activeItems = items.filter(
        (it) => String(it?.description || '').trim() || String(it?.qty || '').trim() || String(it?.pack || '').trim()
      );

      if (activeItems.length === 0) {
        return {
          errorStatus: 400 as const,
          error: 'Cannot complete loading: no active materials are listed on this Loading Slip.',
        };
      }

      const pendingCount = activeItems.filter((it) => it.isLoaded !== true).length;
      if (pendingCount > 0) {
        return {
          errorStatus: 400 as const,
          error: `All materials must be checked/completed before clicking Loading Complete (${pendingCount} pending).`,
        };
      }

      const lockedSlip = {
        ...prev.loadingSlip,
        checkedBy: operatorName,
        loadedBy: operatorName,
        isLocked: true,
        loadingCompletedAt: now,
        loadingCompletedTime: completedDateTime,
        loadingCompletedBy: operatorName,
      };

      const updated = normalizeTicketRecord({
        ...prev,
        plantId: prevPlant,
        status: 'completed',
        timeLoadingStarted: prev.timeLoadingStarted || completedTime,
        timeCompleted: completedTime,
        manualStatusOverride: true,
        loadingSlip: lockedSlip,
        updatedAt: now,
      });

      const nextVersion = existing.version + 1;
      db.prepare(`UPDATE tickets SET data_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(updated),
        nextVersion,
        req.auth!.user.username,
        now,
        ticketId
      );

      recomputeGateQueueNumbers(updated.date, updated.gateNumber, prevPlant);
      markDriverTokenCompleted(ticketId);

      const alertId = `alt-${now}-${crypto.randomBytes(3).toString('hex')}`;
      const delNoteNumber = upperStr(lockedSlip.delNoteNumber || prev.delNoteNumber) || '—';
      const truckNumber = upperStr(prev.truckNumber) || '—';
      const gateNumber = String(prev.gateNumber || '').trim() || '—';

      db.prepare(
        `INSERT INTO loading_alerts (id, plant_id, ticket_id, ticket_number, del_note_number, truck_number, gate_number, completed_by, completed_time, created_at, dismissed_by_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`
      ).run(alertId, prevPlant, ticketId, upperStr(prev.ticketNumber), delNoteNumber, truckNumber, gateNumber, operatorName, completedDateTime, now);

      const alert = {
        id: alertId,
        plantId: prevPlant,
        ticketId,
        ticketNumber: upperStr(prev.ticketNumber),
        delNoteNumber,
        truckNumber,
        gateNumber,
        completedBy: operatorName,
        completedTime: completedDateTime,
        createdAt: now,
      };

      const driverStatusToken = getDriverSlipToken(ticketId);
      return {
        ticket: normalizeTicketRecord({
          ...updated,
          version: nextVersion,
          createdBy: existing.created_by || undefined,
          updatedBy: req.auth!.user.username,
          ...(driverStatusToken ? { driverStatusToken } : {}),
        }),
        alert,
      };
    })();

    if ('errorStatus' in result && result.errorStatus) {
      res.status(result.errorStatus).json({ error: result.error });
      return;
    }

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'FORKLIFT_LOADING_COMPLETED',
      targetType: 'ticket',
      targetId: result.ticket.ticketNumber,
      details: `Forklift operator "${operatorName}" completed & locked loading for ${result.ticket.ticketNumber} (DN: ${result.alert.delNoteNumber}, Truck: ${result.alert.truckNumber}, Gate: ${result.alert.gateNumber})`,
      ipAddress: getClientIp(req),
    });

    res.json({ ticket: result.ticket, alert: result.alert });
  }
);

app.get(
  '/api/loading-alerts',
  requireAuth,
  requirePasswordChanged,
  requirePermission('tickets.view'),
  (req: Request, res: Response) => {
    if (req.auth!.user.roleName === 'forklift_operator') {
      logAudit({
        actorUserId: req.auth!.user.id,
        actorUsername: req.auth!.user.username,
        action: 'UNAUTHORIZED_ACCESS',
        targetType: 'route',
        targetId: 'GET /api/loading-alerts',
        details: 'Forklift Operator denied access to main dashboard alerts',
        ipAddress: getClientIp(req),
      });
      res.status(403).json({ error: 'Access denied: Forklift Operators are restricted to the Forklift Operator Section.' });
      return;
    }
    const reqPlantRaw = typeof req.query.plantId === 'string' ? req.query.plantId.trim().toUpperCase() : '';
    if (reqPlantRaw && reqPlantRaw !== 'ALL' && !userCanAccessPlant(req.auth!.user, reqPlantRaw)) {
      res.status(403).json({ error: `Access denied: You are not authorized to access ${reqPlantRaw} plant alerts.` });
      return;
    }

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const rows = db
      .prepare(
        `SELECT id, plant_id, ticket_id, ticket_number, del_note_number, truck_number, gate_number, completed_by, completed_time, created_at, dismissed_by_json
         FROM loading_alerts
         WHERE created_at >= ?
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all(cutoff) as Array<{
      id: string;
      plant_id: string | null;
      ticket_id: string;
      ticket_number: string;
      del_note_number: string;
      truck_number: string;
      gate_number: string;
      completed_by: string;
      completed_time: string;
      created_at: number;
      dismissed_by_json: string;
    }>;

    const userId = req.auth!.user.id;
    const alerts = rows
      .filter((r) => {
        const pId = normalizePlantId(r.plant_id, 'RIYADH');
        if (!userCanAccessPlant(req.auth!.user, pId)) return false;
        if (reqPlantRaw && reqPlantRaw !== 'ALL' && pId !== reqPlantRaw) return false;
        try {
          const dismissed: string[] = JSON.parse(r.dismissed_by_json || '[]');
          return !dismissed.includes(userId);
        } catch {
          return true;
        }
      })
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        plantId: normalizePlantId(r.plant_id, 'RIYADH'),
        ticketId: r.ticket_id,
        ticketNumber: upperStr(r.ticket_number),
        delNoteNumber: upperStr(r.del_note_number),
        truckNumber: upperStr(r.truck_number),
        gateNumber: r.gate_number,
        completedBy: r.completed_by,
        completedTime: r.completed_time,
        createdAt: r.created_at,
      }));

    res.json({ alerts });
  }
);

app.post(
  '/api/loading-alerts/:id/dismiss',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.view'),
  (req: Request, res: Response) => {
    if (req.auth!.user.roleName === 'forklift_operator') {
      res.status(403).json({ error: 'Access denied: Forklift Operators are restricted to the Forklift Operator Section.' });
      return;
    }
    const alertId = req.params.id;
    const row = db.prepare(`SELECT dismissed_by_json FROM loading_alerts WHERE id = ?`).get(alertId) as
      | { dismissed_by_json: string }
      | undefined;

    if (!row) {
      res.json({ ok: true });
      return;
    }

    let list: string[] = [];
    try {
      list = JSON.parse(row.dismissed_by_json || '[]');
    } catch {
      list = [];
    }
    if (!list.includes(req.auth!.user.id)) {
      list.push(req.auth!.user.id);
      db.prepare(`UPDATE loading_alerts SET dismissed_by_json = ? WHERE id = ?`).run(JSON.stringify(list), alertId);
    }

    res.json({ ok: true });
  }
);

app.delete(
  '/api/tickets/:id',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.delete'),
  (req: Request, res: Response) => {
    const ticketId = req.params.id;
    const existing = db.prepare(`SELECT ticket_number, plant_id, data_json FROM tickets WHERE id = ?`).get(ticketId) as
      | { ticket_number: string; plant_id: string | null; data_json: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Ticket record not found.' });
      return;
    }

    const parsed = normalizeTicketRecord(JSON.parse(existing.data_json));
    const ticketPlant = normalizePlantId(parsed.plantId || existing.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, ticketPlant)) {
      res.status(403).json({ error: `Access denied: Ticket belongs to ${ticketPlant} plant.` });
      return;
    }

    db.prepare(`DELETE FROM tickets WHERE id = ?`).run(ticketId);
    if (parsed.date && parsed.gateNumber) {
      recomputeGateQueueNumbers(parsed.date, parsed.gateNumber, ticketPlant);
    }

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'TICKET_DELETED',
      targetType: 'ticket',
      targetId: existing.ticket_number,
      details: `[${ticketPlant}] Deleted ticket ${existing.ticket_number} (${parsed.truckNumber || ''})`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  }
);

// WhatsApp Notification Logs & Retry Endpoints
app.get(
  '/api/whatsapp/logs',
  requireAuth,
  requirePasswordChanged,
  requireAnyPermission(['tickets.view', 'tickets.update']),
  (req: Request, res: Response) => {
    const roleName = req.auth!.user.roleName;
    if (
      roleName === 'forklift_operator' ||
      roleName === 'liquid_store_operator' ||
      roleName === 'ex_factory_operator' ||
      roleName === 'security_guard'
    ) {
      res.status(403).json({ error: 'Access denied for restricted operator accounts.' });
      return;
    }
    const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId.trim() : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const logs = listWhatsAppLogs({ ticketId, limit });
    res.json({ logs });
  }
);

app.post(
  '/api/whatsapp/retry/:ticketId',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.update'),
  async (req: Request, res: Response) => {
    const ticketId = String(req.params.ticketId || '').trim();
    const row = db.prepare(`SELECT data_json, version, created_by, updated_by FROM tickets WHERE id = ?`).get(ticketId) as
      | { data_json: string; version: number; created_by: string | null; updated_by: string | null }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Ticket record not found.' });
      return;
    }

    const ticket = normalizeTicketRecord({
      ...JSON.parse(row.data_json),
      version: row.version,
      createdBy: row.created_by || undefined,
      updatedBy: row.updated_by || undefined,
    });

    if (!userCanAccessPlant(req.auth!.user, ticket.plantId)) {
      res.status(403).json({ error: 'Access denied: Ticket belongs to another plant.' });
      return;
    }

    if (!ticket.loadingSlip) {
      res.status(400).json({ error: 'Generate a Loading Slip first before sending the WhatsApp notification.' });
      return;
    }

    const existingLog = getLatestWhatsAppLogForTicket(ticketId);
    if (existingLog && existingLog.deliveryStatus === 'sent') {
      res.status(409).json({
        error: 'WhatsApp message was already successfully delivered for this loading slip. Duplicate sending is disabled.',
        outcome: {
          triggered: false,
          duplicatePrevented: true,
          deliveryStatus: 'sent',
          whatsappMessageId: existingLog.whatsappMessageId,
          driverMobile: existingLog.driverMobile,
          driverStatusToken: existingLog.driverStatusToken,
          queueNumber: existingLog.queueNumber,
          gateNumber: existingLog.gateNumber,
          log: existingLog,
        },
      });
      return;
    }

    const liveQueue = computeLiveGateQueueForTicket(ticket);
    const outcome = await dispatchLoadingSlipWhatsAppNotification({
      ticket,
      queueNumber: liveQueue.queueNumber,
      req,
      isRetry: true,
    });

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action:
        outcome.deliveryStatus === 'sent'
          ? 'WHATSAPP_RETRY_SENT'
          : outcome.deliveryStatus === 'skipped'
          ? 'WHATSAPP_RETRY_SKIPPED'
          : 'WHATSAPP_RETRY_FAILED',
      targetType: 'ticket',
      targetId: ticket.ticketNumber,
      details:
        outcome.deliveryStatus === 'sent'
          ? `Retry succeeded: sent WhatsApp to ${outcome.driverMobile} (ID: ${outcome.whatsappMessageId})`
          : `Retry ${outcome.deliveryStatus}: ${outcome.errorMessage || 'Unknown error'}`,
      ipAddress: getClientIp(req),
    });

    res.json({ outcome, ticket });
  }
);

app.post(
  '/api/tickets/restore',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('tickets.delete'),
  (req: Request, res: Response) => {
    const payload = req.body || {};
    if (!payload.id || !payload.ticketNumber || !payload.date) {
      res.status(400).json({ error: 'Invalid ticket payload to restore.' });
      return;
    }

    const restorePlant = resolveAuthorizedPlantForUser(req.auth!.user, payload.plantId);
    if (!restorePlant) {
      res.status(403).json({ error: 'Access denied: You are not authorized to restore tickets for this plant.' });
      return;
    }

    const now = Date.now();
    const record = normalizeTicketRecord({
      ...payload,
      plantId: restorePlant,
      updatedAt: now,
    });

    db.prepare(
      `INSERT OR REPLACE INTO tickets (id, plant_id, ticket_number, sequence_number, date, data_json, version, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(
      record.id,
      restorePlant,
      record.ticketNumber,
      Number(record.sequenceNumber) || 1,
      record.date,
      JSON.stringify(record),
      record.createdBy || req.auth!.user.username,
      req.auth!.user.username,
      record.createdAt || now,
      now
    );

    recomputeGateQueueNumbers(record.date, record.gateNumber, restorePlant);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'TICKET_RESTORED',
      targetType: 'ticket',
      targetId: record.ticketNumber,
      details: `[${restorePlant}] Restored deleted ticket ${record.ticketNumber} (${record.truckNumber || ''})`,
      ipAddress: getClientIp(req),
    });

    res.json({ ticket: normalizeTicketRecord({ ...record, version: 1, updatedBy: req.auth!.user.username }) });
  }
);

// Driver Master Endpoints
app.get(
  '/api/drivers',
  requireAuth,
  requirePasswordChanged,
  requireAnyPermission([
    'tickets.view',
    'drivers.manage',
    'ex_factory.view',
    'ex_factory.create',
    'ex_factory.update',
  ]),
  (req: Request, res: Response) => {
    const roleName = req.auth!.user.roleName;
    if (roleName === 'forklift_operator' || roleName === 'liquid_store_operator' || roleName === 'security_guard') {
      logAudit({
        actorUserId: req.auth!.user.id,
        actorUsername: req.auth!.user.username,
        action: 'UNAUTHORIZED_ACCESS',
        targetType: 'route',
        targetId: 'GET /api/drivers',
        details: `Restricted operator (${roleName}) denied access to Driver Master directory`,
        ipAddress: getClientIp(req),
      });
      res.status(403).json({
        error: 'Access denied: Your account is restricted from accessing the Driver Master directory.',
      });
      return;
    }
    const rows = db.prepare(`SELECT data_json FROM drivers ORDER BY updated_at DESC`).all() as Array<{
      data_json: string;
    }>;
    res.json({ drivers: rows.map((r) => normalizeDriverRecord(JSON.parse(r.data_json))) });
  }
);

app.post(
  '/api/drivers',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('drivers.manage'),
  (req: Request, res: Response) => {
    const body = req.body || {};
    const cleanTruck = upperStr(body.truckNumber);
    if (!cleanTruck || !upperStr(body.driverName) || !upperStr(body.driverPhone)) {
      res.status(400).json({ error: 'Vehicle Number, Driver Name, and Mobile Number are required.' });
      return;
    }

    const now = Date.now();
    const id = body.id || `drv-${now}-${crypto.randomBytes(3).toString('hex')}`;
    const record = normalizeDriverRecord({
      id,
      truckNumber: cleanTruck,
      driverName: upperStr(body.driverName),
      driverPhone: upperStr(body.driverPhone),
      iqamaNumber: upperStr(body.iqamaNumber),
      transporterName: upperStr(body.transporterName),
      defaultDestination: upperStr(body.defaultDestination),
      lastVisited: body.lastVisited || new Date().toISOString().split('T')[0],
      tripCount: Number(body.tripCount) || 1,
    });

    const existing = db.prepare(`SELECT id FROM drivers WHERE truck_number = ? COLLATE NOCASE`).get(cleanTruck) as
      | { id: string }
      | undefined;

    if (existing) {
      db.prepare(`UPDATE drivers SET data_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify({ ...record, id: existing.id }),
        now,
        existing.id
      );
      res.json({ driver: { ...record, id: existing.id } });
      return;
    }

    db.prepare(`INSERT INTO drivers (id, truck_number, data_json, updated_at) VALUES (?, ?, ?, ?)`).run(
      id,
      cleanTruck,
      JSON.stringify(record),
      now
    );

    res.status(201).json({ driver: record });
  }
);

app.put(
  '/api/drivers/:id',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('drivers.manage'),
  (req: Request, res: Response) => {
    const id = req.params.id;
    const existing = db.prepare(`SELECT data_json FROM drivers WHERE id = ?`).get(id) as
      | { data_json: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Driver record not found.' });
      return;
    }
    const prev = JSON.parse(existing.data_json);
    const body = req.body || {};
    const cleanTruck = upperStr(body.truckNumber || prev.truckNumber);
    const updated = normalizeDriverRecord({
      ...prev,
      ...body,
      id,
      truckNumber: cleanTruck,
    });
    db.prepare(`UPDATE drivers SET truck_number = ?, data_json = ?, updated_at = ? WHERE id = ?`).run(
      cleanTruck,
      JSON.stringify(updated),
      Date.now(),
      id
    );
    res.json({ driver: updated });
  }
);

app.delete(
  '/api/drivers/:id',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('drivers.manage'),
  (req: Request, res: Response) => {
    db.prepare(`DELETE FROM drivers WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  }
);

// Settings Endpoints
app.get('/api/settings', requireAuth, requirePasswordChanged, (_req: Request, res: Response) => {
  const activeRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
    | { value_json: string }
    | undefined;
  const defaultRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'default'`).get() as
    | { value_json: string }
    | undefined;

  res.json({
    settings: activeRow ? normalizeSettingsRecord(JSON.parse(activeRow.value_json)) : null,
    defaultSettings: defaultRow ? normalizeSettingsRecord(JSON.parse(defaultRow.value_json)) : null,
  });
});

app.put(
  '/api/settings',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('settings.manage'),
  (req: Request, res: Response) => {
    const existingRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    const existingSettings = existingRow ? normalizeSettingsRecord(JSON.parse(existingRow.value_json)) : {};
    const newSettings = normalizeSettingsRecord({ ...(req.body || {}) });
    // Preserve custom WhatsApp templates unless modified by an Administrator
    if (req.auth!.user.roleName !== 'admin') {
      if (existingSettings.whatsappTemplates) {
        newSettings.whatsappTemplates = existingSettings.whatsappTemplates;
      } else {
        delete newSettings.whatsappTemplates;
      }
    } else if (req.body?.whatsappTemplates === undefined && existingSettings.whatsappTemplates) {
      newSettings.whatsappTemplates = existingSettings.whatsappTemplates;
    }

    const logoCheck = validateLogoDataUrl(newSettings.logoDataUrl, 'Logo');
    if (!logoCheck.ok) {
      res.status(400).json({ error: logoCheck.error });
      return;
    }
    newSettings.logoDataUrl = logoCheck.value;

    const signatureCheck = validateLogoDataUrl(newSettings.storeInchargeSignatureDataUrl, 'Signature');
    if (!signatureCheck.ok) {
      res.status(400).json({ error: signatureCheck.error });
      return;
    }
    newSettings.storeInchargeSignatureDataUrl = signatureCheck.value;

    const now = Date.now();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`).run(
      JSON.stringify(newSettings),
      req.auth!.user.username,
      now
    );

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: 'active',
      details: `Updated Plant & System Settings (${newSettings.companyName || ''})`,
      ipAddress: getClientIp(req),
    });

    res.json({ settings: newSettings });
  }
);

app.put(
  '/api/settings/default',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requirePermission('settings.manage'),
  (req: Request, res: Response) => {
    const existingRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    const existingSettings = existingRow ? normalizeSettingsRecord(JSON.parse(existingRow.value_json)) : {};
    const newSettings = normalizeSettingsRecord({ ...(req.body || {}) });
    if (req.auth!.user.roleName !== 'admin') {
      if (existingSettings.whatsappTemplates) {
        newSettings.whatsappTemplates = existingSettings.whatsappTemplates;
      } else {
        delete newSettings.whatsappTemplates;
      }
    } else if (req.body?.whatsappTemplates === undefined && existingSettings.whatsappTemplates) {
      newSettings.whatsappTemplates = existingSettings.whatsappTemplates;
    }

    const logoCheck = validateLogoDataUrl(newSettings.logoDataUrl, 'Logo');
    if (!logoCheck.ok) {
      res.status(400).json({ error: logoCheck.error });
      return;
    }
    newSettings.logoDataUrl = logoCheck.value;

    const signatureCheck = validateLogoDataUrl(newSettings.storeInchargeSignatureDataUrl, 'Signature');
    if (!signatureCheck.ok) {
      res.status(400).json({ error: signatureCheck.error });
      return;
    }
    newSettings.storeInchargeSignatureDataUrl = signatureCheck.value;

    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default', ?, ?, ?)`
      ).run(JSON.stringify(newSettings), req.auth!.user.username, now);
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`
      ).run(JSON.stringify(newSettings), req.auth!.user.username, now);
    })();

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: 'default',
      details: `Saved current Plant & System Settings as system Default (${newSettings.companyName || ''})`,
      ipAddress: getClientIp(req),
    });

    res.json({ settings: newSettings, defaultSettings: newSettings });
  }
);

app.put(
  '/api/admin/whatsapp-templates',
  requireAuth,
  requirePasswordChanged,
  requireCsrf,
  requireAdmin,
  (req: Request, res: Response) => {
    const rawTemplates = req.body?.templates;
    if (!rawTemplates || typeof rawTemplates !== 'object' || Array.isArray(rawTemplates)) {
      res.status(400).json({ error: 'Invalid templates payload.' });
      return;
    }

    const activeRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    const baseSettings = activeRow ? normalizeSettingsRecord(JSON.parse(activeRow.value_json)) : {};
    const normalizedTemplates = normalizeWhatsAppTemplates(rawTemplates);

    const updatedSettings = normalizeSettingsRecord({
      ...baseSettings,
      whatsappTemplates: normalizedTemplates || {},
    });
    if (!normalizedTemplates) {
      delete updatedSettings.whatsappTemplates;
    }

    const now = Date.now();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`).run(
      JSON.stringify(updatedSettings),
      req.auth!.user.username,
      now
    );

    const customKeys = normalizedTemplates ? Object.keys(normalizedTemplates) : [];
    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'WHATSAPP_TEMPLATES_UPDATED',
      targetType: 'settings',
      targetId: 'whatsappTemplates',
      details:
        customKeys.length > 0
          ? `Updated custom WhatsApp templates (${customKeys.join(', ')})`
          : 'Reset all WhatsApp message templates to defaults',
      ipAddress: getClientIp(req),
    });

    res.json({
      settings: updatedSettings,
      whatsappTemplates: updatedSettings.whatsappTemplates || {},
    });
  }
);

// One-time safe migration from legacy browser localStorage into empty SQLite DB
app.post('/api/bootstrap/migrate', requireAuth, requirePasswordChanged, requireCsrf, (req: Request, res: Response) => {
  if (
    req.auth!.user.roleName === 'forklift_operator' ||
    req.auth!.user.roleName === 'liquid_store_operator' ||
    req.auth!.user.roleName === 'security_guard'
  ) {
    res.status(403).json({ error: 'Access denied for restricted operator accounts.' });
    return;
  }
  const ticketCount = (db.prepare(`SELECT COUNT(*) as cnt FROM tickets`).get() as { cnt: number }).cnt;
  if (ticketCount > 0) {
    res.json({ migrated: false, reason: 'Database already populated.' });
    return;
  }

  const { tickets, drivers, settings, defaultSettings } = req.body || {};
  const now = Date.now();

  db.transaction(() => {
    if (Array.isArray(tickets)) {
      const insertTicket = db.prepare(
        `INSERT OR IGNORE INTO tickets (id, ticket_number, sequence_number, date, data_json, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      );
      for (const t of tickets) {
        if (t && t.id && t.ticketNumber && t.date) {
          const normT = normalizeTicketRecord(t);
          insertTicket.run(
            normT.id,
            normT.ticketNumber,
            Number(normT.sequenceNumber) || 1,
            normT.date,
            JSON.stringify(normT),
            req.auth!.user.username,
            req.auth!.user.username,
            normT.createdAt || now,
            normT.updatedAt || now
          );
        }
      }
    }

    if (Array.isArray(drivers)) {
      const insertDriver = db.prepare(
        `INSERT OR IGNORE INTO drivers (id, truck_number, data_json, updated_at) VALUES (?, ?, ?, ?)`
      );
      for (const d of drivers) {
        if (d && d.id && d.truckNumber) {
          const normD = normalizeDriverRecord(d);
          insertDriver.run(normD.id, normD.truckNumber, JSON.stringify(normD), now);
        }
      }
    }

    if (req.auth!.user.roleName === 'admin') {
      if (settings && typeof settings === 'object') {
        db.prepare(
          `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`
        ).run(JSON.stringify(normalizeSettingsRecord(settings)), req.auth!.user.username, now);
      }
      if (defaultSettings && typeof defaultSettings === 'object') {
        db.prepare(
          `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default', ?, ?, ?)`
        ).run(JSON.stringify(normalizeSettingsRecord(defaultSettings)), req.auth!.user.username, now);
      }
    }
  })();

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'BACKUP_RESTORED',
    targetType: 'system',
    details: `Migrated ${Array.isArray(tickets) ? tickets.length : 0} existing records into shared server database`,
    ipAddress: getClientIp(req),
  });

  res.json({ migrated: true });
});

app.get(
  '/api/backup/export',
  requireAuth,
  requirePasswordChanged,
  requirePermission('reports.view'),
  (req: Request, res: Response) => {
    const tickets = (db.prepare(`SELECT data_json FROM tickets ORDER BY date DESC, sequence_number ASC`).all() as Array<{
      data_json: string;
    }>)
      .map((r) => normalizeTicketRecord(JSON.parse(r.data_json)))
      .filter((t) => userCanAccessPlant(req.auth!.user, t.plantId));
    const drivers = (db.prepare(`SELECT data_json FROM drivers`).all() as Array<{ data_json: string }>).map((r) =>
      normalizeDriverRecord(JSON.parse(r.data_json))
    );
    const activeRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    const defaultRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'default'`).get() as
      | { value_json: string }
      | undefined;
    const materialMaster = (
      db.prepare(`SELECT * FROM material_master ORDER BY material_name COLLATE NOCASE ASC`).all() as DbMaterialMasterRow[]
    ).map(mapMaterialRow);

    res.json({
      tickets,
      drivers,
      materialMaster,
      settings: activeRow ? normalizeSettingsRecord(JSON.parse(activeRow.value_json)) : undefined,
      defaultSettings: defaultRow ? normalizeSettingsRecord(JSON.parse(defaultRow.value_json)) : undefined,
      exportedAt: new Date().toISOString(),
    });
  }
);

app.post('/api/backup/restore', requireAuth, requirePasswordChanged, requireCsrf, requireAdmin, (req: Request, res: Response) => {
  const { tickets, drivers, materialMaster, settings, defaultSettings } = req.body || {};
  const now = Date.now();

  db.transaction(() => {
    if (Array.isArray(tickets)) {
      db.prepare(`DELETE FROM tickets`).run();
      const insertTicket = db.prepare(
        `INSERT INTO tickets (id, plant_id, ticket_number, sequence_number, date, data_json, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      );
      for (const t of tickets) {
        if (t && t.id && t.ticketNumber && t.date) {
          const normT = normalizeTicketRecord(t);
          insertTicket.run(
            normT.id,
            normalizePlantId(normT.plantId, 'RIYADH'),
            normT.ticketNumber,
            Number(normT.sequenceNumber) || 1,
            normT.date,
            JSON.stringify(normT),
            req.auth!.user.username,
            req.auth!.user.username,
            normT.createdAt || now,
            normT.updatedAt || now
          );
        }
      }
    }
    if (Array.isArray(drivers)) {
      db.prepare(`DELETE FROM drivers`).run();
      const insertDriver = db.prepare(
        `INSERT OR REPLACE INTO drivers (id, truck_number, data_json, updated_at) VALUES (?, ?, ?, ?)`
      );
      for (const d of drivers) {
        if (d && d.id && d.truckNumber) {
          const normD = normalizeDriverRecord(d);
          insertDriver.run(normD.id, normD.truckNumber, JSON.stringify(normD), now);
        }
      }
    }
    if (Array.isArray(materialMaster)) {
      db.prepare(`DELETE FROM material_master`).run();
      const insertMaterial = db.prepare(
        `INSERT OR IGNORE INTO material_master (
          id, material_name, pack_type, pallet_ratio, remarks, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < materialMaster.length; i += 1) {
        const m = materialMaster[i];
        if (m && m.materialName) {
          const name = upperStr(m.materialName);
          if (!name) continue;
          const pack = normalizePackType(m.packType) || 'Rolls';
          const ratio = normalizePalletRatio(m.palletRatio) ?? 23;
          const remarks = upperStr(m.remarks);
          const id = String(m.id || `mat-restore-${now}-${i}`).trim();
          insertMaterial.run(
            id,
            name,
            pack,
            ratio,
            remarks,
            req.auth!.user.username,
            req.auth!.user.username,
            Number(m.createdAt) || now,
            Number(m.updatedAt) || now
          );
        }
      }
    }
    if (settings && typeof settings === 'object') {
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('active', ?, ?, ?)`
      ).run(JSON.stringify(normalizeSettingsRecord(settings)), req.auth!.user.username, now);
    }
    if (defaultSettings && typeof defaultSettings === 'object') {
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('default', ?, ?, ?)`
      ).run(JSON.stringify(normalizeSettingsRecord(defaultSettings)), req.auth!.user.username, now);
    }
  })();

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'BACKUP_RESTORED',
    targetType: 'system',
    details: 'Admin restored database backup',
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true });
});

app.use('/api/liquid', liquidRouter);
app.use('/api/ex-factory', exFactoryRouter);
app.use('/api/materials', materialsRouter);

const SERVER_BOOT_AT = Date.now();
let cachedBuildInfo: { buildId: string; version: string; computedAt: number } | null = null;

function computeDirectorySignature(dirPath: string, hash: crypto.Hash, baseDir: string): void {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      computeDirectorySignature(fullPath, hash, baseDir);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      const rel = path.relative(baseDir, fullPath);
      hash.update(`${rel}:${Math.floor(stat.mtimeMs)}:${stat.size};`);
    }
  }
}

function getAppBuildInfo(): { buildId: string; version: string; serverBootAt: number } {
  const now = Date.now();
  if (cachedBuildInfo && now - cachedBuildInfo.computedAt < (isProduction ? 5000 : 2000)) {
    return {
      buildId: cachedBuildInfo.buildId,
      version: cachedBuildInfo.version,
      serverBootAt: SERVER_BOOT_AT,
    };
  }

  let pkgVersion = '1.0.0';
  const rootDir = process.cwd();
  try {
    const pkgRaw = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      pkgVersion = pkg.version.trim();
    }
  } catch {
    // Ignore
  }

  const hash = crypto.createHash('sha256');
  hash.update(`v:${pkgVersion}|`);

  const serverEntry = path.join(rootDir, 'server.ts');
  if (fs.existsSync(serverEntry)) {
    const st = fs.statSync(serverEntry);
    hash.update(`server.ts:${Math.floor(st.mtimeMs)}:${st.size};`);
  }
  computeDirectorySignature(path.join(rootDir, 'server'), hash, rootDir);

  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (isProduction && fs.existsSync(distIndex)) {
    hash.update(fs.readFileSync(distIndex));
  } else {
    const indexFile = path.join(rootDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      const st = fs.statSync(indexFile);
      hash.update(`index.html:${Math.floor(st.mtimeMs)}:${st.size};`);
    }
    computeDirectorySignature(path.join(rootDir, 'src'), hash, rootDir);
  }

  const buildId = hash.digest('hex').slice(0, 16);
  cachedBuildInfo = { buildId, version: pkgVersion, computedAt: now };
  return { buildId, version: pkgVersion, serverBootAt: SERVER_BOOT_AT };
}

// Public build/version check for automatic live client updates
app.get('/api/app-version', (_req: Request, res: Response) => {
  res.json({ ok: true, ...getAppBuildInfo() });
});

// Health check endpoint for Hostinger / load balancers
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// Reject any unknown /api route cleanly with JSON 404
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// ==========================================
// 4. VITE DEV MIDDLEWARE / STATIC DIST SERVER
// ==========================================

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(
        express.static(distDir, {
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            }
          },
        })
      );
      app.get('*', (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    try {
      processAutoLoadingTransitions();
    } catch (err) {
      console.error('Auto-loading transition check error:', err);
    }
    setInterval(() => {
      try {
        processAutoLoadingTransitions();
      } catch (err) {
        console.error('Auto-loading transition interval error:', err);
      }
    }, 30000);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      try {
        db.close();
      } catch (err) {
        console.error('Error closing SQLite database:', err);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
