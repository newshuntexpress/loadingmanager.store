import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { db, getSafeUserById, logAudit, type SafeUser } from './db.ts';

export const SESSION_COOKIE_NAME = 'gp_session';

// Precomputed valid bcrypt hash used for constant-time comparison when username does not exist
export const DUMMY_BCRYPT_HASH = bcrypt.hashSync('Dummy@Invalid#Compare!999', 12);

export interface AuthenticatedContext {
  sessionId: string;
  user: SafeUser;
  csrfToken: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedContext;
    }
  }
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function getIdleTimeoutMs(): number {
  try {
    const row = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.value_json);
      const mins = Number(parsed.sessionIdleMinutes);
      if (Number.isFinite(mins) && mins >= 5 && mins <= 720) {
        return mins * 60 * 1000;
      }
    }
  } catch {
    // Fallback to env/default
  }
  const envMins = Number(process.env.SESSION_IDLE_MINUTES) || 30;
  return Math.max(5, Math.min(720, envMins)) * 60 * 1000;
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return 'Username must be between 3 and 32 characters.';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return 'Username may only contain letters, numbers, dots, underscores, and hyphens.';
  }
  return null;
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (password.length > 128) {
    return 'Password must not exceed 128 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter (A-Z).';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter (a-z).';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number (0-9).';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include at least one special character (e.g. @, #, !, $).';
  }
  return null;
}

// In-memory sliding window IP rate limiter for login & setup endpoints
const ipAttemptMap = new Map<string, number[]>();
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_MAX_ATTEMPTS = 25;

export function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = (ipAttemptMap.get(ip) || []).filter((ts) => now - ts < IP_WINDOW_MS);
  ipAttemptMap.set(ip, attempts);
  return attempts.length < IP_MAX_ATTEMPTS;
}

export function recordIpAttempt(ip: string): void {
  const now = Date.now();
  const attempts = (ipAttemptMap.get(ip) || []).filter((ts) => now - ts < IP_WINDOW_MS);
  attempts.push(now);
  ipAttemptMap.set(ip, attempts);
}

export function clearIpAttempts(ip: string): void {
  ipAttemptMap.delete(ip);
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.toLowerCase().startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.toLowerCase().startsWith('https://')) {
    return true;
  }
  return false;
}

export function extractSessionTokens(req: Request): string[] {
  const candidates: string[] = [];
  const pushValid = (val: unknown) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (/^[a-f0-9]{64}$/i.test(trimmed) && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
  };

  // Prioritize explicit per-tab header tokens over cookies so a stale/partitioned cookie cannot shadow a fresh login
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    pushValid(authHeader.slice(7));
  }
  pushValid(req.headers['x-gatepass-token']);
  pushValid(req.cookies?.[SESSION_COOKIE_NAME]);

  return candidates;
}

export function extractSessionToken(req: Request): string | null {
  const tokens = extractSessionTokens(req);
  return tokens.length > 0 ? tokens[0] : null;
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, maxAgeMs: number): void {
  const secure = isHttpsRequest(req);
  if (secure) {
    const maxAgeSec = Math.floor(maxAgeMs / 1000);
    // Include Partitioned (CHIPS) for embedded HTTPS preview iframes alongside HttpOnly & SameSite=None
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeMs,
    });
  }
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  if (secure) {
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
    );
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`
    );
  } else {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  }
}

const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionForUser(
  req: Request,
  res: Response,
  userId: string
): { rawToken: string; csrfToken: string; expiresAt: number } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionId = hashSessionToken(rawToken);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const user = getSafeUserById(userId);
  const isAdmin = user?.roleName === 'admin';
  const idleMs = getIdleTimeoutMs();
  const expiresAt = isAdmin ? now + ADMIN_SESSION_TTL_MS : now + idleMs;
  const cookieMaxAgeMs = isAdmin ? ADMIN_SESSION_TTL_MS : 12 * 60 * 60 * 1000;

  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, ip_address, user_agent, created_at, last_activity_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(sessionId, userId, csrfToken, getClientIp(req), String(req.headers['user-agent'] || '').slice(0, 250), now, now, expiresAt);

  setSessionCookie(req, res, rawToken, cookieMaxAgeMs);
  return { rawToken, csrfToken, expiresAt };
}

export function noCacheHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const candidates = extractSessionTokens(req);
  if (candidates.length === 0) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.', code: 'NO_TOKEN' });
    return;
  }

  const now = Date.now();
  let inactiveAccount = false;

  for (const rawToken of candidates) {
    const sessionId = hashSessionToken(rawToken);
    const session = db
      .prepare(
        `SELECT id, user_id, csrf_token, last_activity_at, expires_at, revoked_at
         FROM sessions WHERE id = ?`
      )
      .get(sessionId) as
      | {
          id: string;
          user_id: string;
          csrf_token: string;
          last_activity_at: number;
          expires_at: number;
          revoked_at: number | null;
        }
      | undefined;

    if (!session || session.revoked_at !== null || now > session.expires_at) {
      continue;
    }

    const user = getSafeUserById(session.user_id);
    if (!user || !user.isActive) {
      inactiveAccount = true;
      continue;
    }

    const isBackgroundPoll = String(req.headers['x-background-poll'] || '') === '1';
    if (!isBackgroundPoll) {
      const isAdmin = user.roleName === 'admin';
      const nextExpiresAt = isAdmin ? now + ADMIN_SESSION_TTL_MS : now + getIdleTimeoutMs();
      db.prepare(`UPDATE sessions SET last_activity_at = ?, expires_at = ? WHERE id = ?`).run(
        now,
        nextExpiresAt,
        session.id
      );
    }

    req.auth = {
      sessionId: session.id,
      user,
      csrfToken: session.csrf_token,
    };
    next();
    return;
  }

  clearSessionCookie(req, res);
  if (inactiveAccount) {
    res.status(401).json({
      error: 'Account is inactive or unavailable. Please contact an Administrator.',
      code: 'ACCOUNT_INACTIVE',
    });
    return;
  }
  res.status(401).json({ error: 'Session expired or invalid. Please log in again.', code: 'SESSION_INVALID' });
}

export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.auth.user.mustChangePassword) {
    res.status(403).json({
      error: 'You must change your temporary password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const hasBearer = typeof authHeader === 'string' && /^Bearer\s+[a-f0-9]{64}$/i.test(authHeader.trim());
  const csrfHeaderRaw = req.headers['x-csrf-token'];
  const csrfHeader = typeof csrfHeaderRaw === 'string' ? csrfHeaderRaw.trim() : '';

  if (hasBearer && !csrfHeader) {
    next();
    return;
  }

  const expected = Buffer.from(req.auth.csrfToken, 'utf8');
  const provided = Buffer.from(csrfHeader, 'utf8');
  if (!csrfHeader || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    res.status(403).json({ error: 'Invalid or missing CSRF security token. Please refresh and try again.' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.auth.user.roleName !== 'admin') {
    logAudit({
      actorUserId: req.auth.user.id,
      actorUsername: req.auth.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'system',
      targetId: req.originalUrl,
      details: `Non-admin attempted restricted admin endpoint: ${req.method} ${req.originalUrl}`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({ error: 'Forbidden: Administrator authorization required.' });
    return;
  }
  next();
}

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.auth.user.roleName === 'admin' || req.auth.user.permissions.includes(permissionKey)) {
      next();
      return;
    }
    logAudit({
      actorUserId: req.auth.user.id,
      actorUsername: req.auth.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'system',
      targetId: permissionKey,
      details: `Missing required permission "${permissionKey}" for ${req.method} ${req.originalUrl}`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({ error: `Forbidden: Missing permission (${permissionKey}).` });
  };
}

export function requireAnyPermission(permissionKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (
      req.auth.user.roleName === 'admin' ||
      permissionKeys.some((key) => req.auth!.user.permissions.includes(key))
    ) {
      next();
      return;
    }
    logAudit({
      actorUserId: req.auth.user.id,
      actorUsername: req.auth.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'system',
      targetId: permissionKeys.join('|'),
      details: `Missing required permission (${permissionKeys.join(' or ')}) for ${req.method} ${req.originalUrl}`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({ error: `Forbidden: Missing required operational permission.` });
  };
}
