import crypto from 'node:crypto';
import type { Request } from 'express';
import { db } from './db.ts';
import { upperStr } from './normalize.ts';

export const DRIVER_SLIP_TOKEN_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours while active
export const DRIVER_SLIP_TOKEN_COMPLETED_GRACE_MS = 4 * 60 * 60 * 1000; // 4 hours after completion so driver sees Loading Completed / Ready to Exit
export const WHATSAPP_MSG_TYPE_LOADING_SLIP = 'LOADING_SLIP_GENERATED';

export interface WhatsAppLogRecord {
  id: string;
  ticketId: string;
  ticketNumber: string;
  driverName: string;
  driverMobile: string;
  delNoteNumber: string;
  truckNumber: string;
  gateNumber: string;
  queueNumber: number;
  messageType: string;
  deliveryStatus: 'sent' | 'failed' | 'skipped';
  whatsappMessageId: string;
  errorMessage: string;
  driverStatusToken: string;
  messageBody: string;
  attemptCount: number;
  createdAt: number;
  sentAt: number | null;
  updatedAt: number;
}

export interface WhatsAppDispatchOutcome {
  triggered: boolean;
  duplicatePrevented: boolean;
  deliveryStatus: 'sent' | 'failed' | 'skipped';
  whatsappMessageId?: string;
  driverMobile?: string;
  liveStatusUrl: string;
  driverStatusToken: string;
  queueNumber: number;
  gateNumber: string;
  warning?: string;
  errorMessage?: string;
  log?: WhatsAppLogRecord;
}

function mapLogRow(row: any): WhatsAppLogRecord {
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    ticketNumber: String(row.ticket_number || ''),
    driverName: String(row.driver_name || ''),
    driverMobile: String(row.driver_mobile || ''),
    delNoteNumber: String(row.del_note_number || ''),
    truckNumber: String(row.truck_number || ''),
    gateNumber: String(row.gate_number || ''),
    queueNumber: Number(row.queue_number) || 0,
    messageType: String(row.message_type || ''),
    deliveryStatus:
      row.delivery_status === 'sent' || row.delivery_status === 'failed' || row.delivery_status === 'skipped'
        ? row.delivery_status
        : 'failed',
    whatsappMessageId: String(row.whatsapp_message_id || ''),
    errorMessage: String(row.error_message || ''),
    driverStatusToken: String(row.driver_status_token || ''),
    messageBody: String(row.message_body || ''),
    attemptCount: Number(row.attempt_count) || 1,
    createdAt: Number(row.created_at) || 0,
    sentAt: row.sent_at !== null && row.sent_at !== undefined ? Number(row.sent_at) : null,
    updatedAt: Number(row.updated_at) || 0,
  };
}

/**
 * Validates and formats a driver's mobile number to E.164 digits (without '+') for WhatsApp Cloud API.
 * Supports Saudi numbers (05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX, 009665XXXXXXXX) and valid E.164 international numbers.
 */
export function validateAndFormatWhatsAppPhone(rawPhone?: string | null): {
  valid: boolean;
  e164Digits: string;
  displayPhone: string;
  error?: string;
} {
  const trimmed = String(rawPhone || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      e164Digits: '',
      displayPhone: '',
      error: 'Driver mobile number is missing on the loading slip.',
    };
  }

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return {
      valid: false,
      e164Digits: '',
      displayPhone: trimmed,
      error: 'Driver mobile number contains no digits.',
    };
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Normalize Saudi mobile patterns
  if (digits.startsWith('05') && digits.length === 10) {
    digits = '966' + digits.slice(1);
  } else if (digits.startsWith('5') && digits.length === 9) {
    digits = '966' + digits;
  } else if (digits.startsWith('96605') && digits.length === 13) {
    digits = '966' + digits.slice(4);
  }

  if (digits.startsWith('966')) {
    if (!/^9665\d{8}$/.test(digits)) {
      return {
        valid: false,
        e164Digits: '',
        displayPhone: trimmed,
        error: `Invalid Saudi mobile number "${trimmed}". Expected 05XXXXXXXX or +9665XXXXXXXX.`,
      };
    }
    return {
      valid: true,
      e164Digits: digits,
      displayPhone: `+${digits}`,
    };
  }

  if (digits.length < 10 || digits.length > 15) {
    return {
      valid: false,
      e164Digits: '',
      displayPhone: trimmed,
      error: `Invalid driver mobile number "${trimmed}". Must be 10–15 digits in E.164 format.`,
    };
  }

  return {
    valid: true,
    e164Digits: digits,
    displayPhone: `+${digits}`,
  };
}

export function resolvePublicAppBaseUrl(req?: Request): string {
  const envUrl = (process.env.APP_BASE_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl;
  }
  if (req) {
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol || 'https';
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (host) {
      return `${proto}://${host}`;
    }
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function ensureDriverSlipToken(ticketId: string, currentStatus?: string): string {
  const now = Date.now();
  const existing = db
    .prepare(`SELECT token, expires_at FROM driver_slip_tokens WHERE ticket_id = ?`)
    .get(ticketId) as { token: string; expires_at: number } | undefined;

  if (existing && existing.token) {
    return existing.token;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const isDone = currentStatus === 'completed' || currentStatus === 'cancelled';
  const expiresAt = isDone
    ? now + DRIVER_SLIP_TOKEN_COMPLETED_GRACE_MS
    : now + DRIVER_SLIP_TOKEN_ACTIVE_TTL_MS;

  db.prepare(
    `INSERT INTO driver_slip_tokens (token, ticket_id, created_at, completed_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(token, ticketId, now, isDone ? now : null, expiresAt);

  return token;
}

export function getDriverSlipToken(ticketId: string): string | undefined {
  const existing = db
    .prepare(`SELECT token FROM driver_slip_tokens WHERE ticket_id = ?`)
    .get(ticketId) as { token: string } | undefined;
  return existing?.token ? String(existing.token) : undefined;
}

export function markDriverTokenCompleted(ticketId: string): void {
  const now = Date.now();
  const existing = db
    .prepare(`SELECT token, completed_at, expires_at FROM driver_slip_tokens WHERE ticket_id = ?`)
    .get(ticketId) as { token: string; completed_at: number | null; expires_at: number } | undefined;

  if (!existing) return;

  const graceExpiry = now + DRIVER_SLIP_TOKEN_COMPLETED_GRACE_MS;
  const nextExpiresAt = Math.min(existing.expires_at || graceExpiry, graceExpiry);
  db.prepare(
    `UPDATE driver_slip_tokens
     SET completed_at = COALESCE(completed_at, ?),
         expires_at = ?
     WHERE ticket_id = ?`
  ).run(now, nextExpiresAt, ticketId);
}

function getActiveWhatsAppTemplateOverrides(): {
  companyName: string;
  loadingSlipTemplate?: string;
} {
  try {
    const row = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'active'`).get() as
      | { value_json: string }
      | undefined;
    if (!row?.value_json) {
      return { companyName: 'ARABIAN WATERPROOFING CO. AWAZEL' };
    }
    const parsed = JSON.parse(row.value_json);
    const tpl = parsed?.whatsappTemplates?.loading_slip_generated;
    return {
      companyName: String(parsed?.companyName || 'ARABIAN WATERPROOFING CO. AWAZEL').trim(),
      loadingSlipTemplate: typeof tpl === 'string' && tpl.trim().length > 0 ? tpl : undefined,
    };
  } catch {
    return { companyName: 'ARABIAN WATERPROOFING CO. AWAZEL' };
  }
}

export function buildLoadingSlipWhatsAppMessage(params: {
  delNoteNumber: string;
  truckNumber: string;
  gateNumber: string;
  queueNumber: number | string;
  statusLabel?: string;
  liveStatusUrl: string;
  driverName?: string;
  ticketNumber?: string;
  destinationPlace?: string;
}): string {
  const statusText = params.statusLabel || 'Waiting in Queue';
  const overrides = getActiveWhatsAppTemplateOverrides();
  if (overrides.loadingSlipTemplate) {
    const values: Record<string, string> = {
      companyName: overrides.companyName,
      driverName: params.driverName || 'Partner',
      delNoteNumber: params.delNoteNumber || 'N/A',
      truckNumber: params.truckNumber || 'N/A',
      ticketNumber: params.ticketNumber || '—',
      gateNumber: params.gateNumber || 'Gate 1',
      queueNumber: String(params.queueNumber || '-'),
      gateSequenceNumber: String(params.queueNumber || '-'),
      destinationPlace: params.destinationPlace || 'N/A',
      statusLabel: statusText,
      liveStatusUrl: params.liveStatusUrl,
    };
    return overrides.loadingSlipTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    );
  }
  return [
    '🚛 *Loading Status Update*',
    '',
    'Dear Driver,',
    '',
    'Your loading slip has been generated successfully.',
    '',
    `*Delivery Number:* ${params.delNoteNumber || 'N/A'}`,
    `*Truck Number:* ${params.truckNumber || 'N/A'}`,
    `*Gate Number:* ${params.gateNumber || 'Gate 1'}`,
    `*Queue Number:* ${params.queueNumber || '-'}`,
    `*Current Status:* ${statusText}`,
    '',
    'You can check your *Live Loading Status* here:',
    '',
    `🔗 ${params.liveStatusUrl}`,
    '',
    'Please wait for further instructions.',
    '',
    'Thank you.',
  ].join('\n');
}

export function getLatestWhatsAppLogForTicket(
  ticketId: string,
  messageType = WHATSAPP_MSG_TYPE_LOADING_SLIP
): WhatsAppLogRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM whatsapp_notification_logs
       WHERE ticket_id = ? AND message_type = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(ticketId, messageType);
  return row ? mapLogRow(row) : null;
}

export function listWhatsAppLogs(options?: { ticketId?: string; limit?: number }): WhatsAppLogRecord[] {
  const limit = Math.min(500, Math.max(10, Number(options?.limit) || 150));
  if (options?.ticketId) {
    const rows = db
      .prepare(
        `SELECT * FROM whatsapp_notification_logs
         WHERE ticket_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(options.ticketId, limit);
    return rows.map(mapLogRow);
  }
  const rows = db
    .prepare(
      `SELECT * FROM whatsapp_notification_logs
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  return rows.map(mapLogRow);
}

async function sendViaWhatsAppCloudApi(params: {
  toE164Digits: string;
  bodyText: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; errorMessage: string }> {
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const apiVersion = (process.env.WHATSAPP_API_VERSION || 'v21.0').trim() || 'v21.0';

  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      errorMessage:
        'WhatsApp Cloud API credentials are not configured (set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server).',
    };
  }

  const endpoint = `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(
    phoneNumberId
  )}/messages`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.toE164Digits,
        type: 'text',
        text: {
          preview_url: true,
          body: params.bodyText,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data: any = await response.json().catch(() => null);
    if (!response.ok) {
      const apiErr =
        data?.error?.error_user_msg ||
        data?.error?.message ||
        `WhatsApp API responded with HTTP ${response.status}`;
      return { ok: false, errorMessage: String(apiErr) };
    }

    const messageId = String(data?.messages?.[0]?.id || '');
    if (!messageId) {
      return {
        ok: false,
        errorMessage: 'WhatsApp API accepted the request but did not return a message ID.',
      };
    }

    return { ok: true, messageId };
  } catch (err: any) {
    const msg =
      err?.name === 'TimeoutError'
        ? 'WhatsApp Cloud API request timed out after 8 seconds.'
        : err?.message || 'Network error while contacting WhatsApp Cloud API.';
    return { ok: false, errorMessage: msg };
  }
}

function getStatusLabelForMessage(status?: string): string {
  switch (status) {
    case 'under_loading':
      return 'Under Loading';
    case 'called':
      return 'Called to Gate';
    case 'completed':
      return 'Loading Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'waiting':
    default:
      return 'Waiting in Queue';
  }
}

export async function dispatchLoadingSlipWhatsAppNotification(params: {
  ticket: Record<string, any>;
  queueNumber: number;
  req?: Request;
  isRetry?: boolean;
}): Promise<WhatsAppDispatchOutcome> {
  const { ticket, queueNumber, req, isRetry = false } = params;
  const ticketId = String(ticket.id);
  const token = ensureDriverSlipToken(ticketId, ticket.status);
  const baseUrl = resolvePublicAppBaseUrl(req);
  const liveStatusUrl = `${baseUrl}/driver-loading-status/${token}`;

  const gateNumber = String(ticket.gateNumber || 'Gate 1').trim() || 'Gate 1';
  const effectiveQueueNum = queueNumber > 0 ? queueNumber : Number(ticket.gateSequenceNumber) || 1;

  // Duplicate prevention: if message was ALREADY sent for this loading slip, never resend!
  const existingLog = getLatestWhatsAppLogForTicket(ticketId, WHATSAPP_MSG_TYPE_LOADING_SLIP);
  if (existingLog && existingLog.deliveryStatus === 'sent') {
    return {
      triggered: false,
      duplicatePrevented: true,
      deliveryStatus: 'sent',
      whatsappMessageId: existingLog.whatsappMessageId,
      driverMobile: existingLog.driverMobile,
      liveStatusUrl,
      driverStatusToken: token,
      queueNumber: existingLog.queueNumber || effectiveQueueNum,
      gateNumber: existingLog.gateNumber || gateNumber,
      log: existingLog,
    };
  }

  // Also on non-retry automatic triggers, if a log row already exists for this slip, do not duplicate
  if (!isRetry && existingLog) {
    return {
      triggered: false,
      duplicatePrevented: true,
      deliveryStatus: existingLog.deliveryStatus,
      whatsappMessageId: existingLog.whatsappMessageId || undefined,
      driverMobile: existingLog.driverMobile || undefined,
      liveStatusUrl,
      driverStatusToken: token,
      queueNumber: existingLog.queueNumber || effectiveQueueNum,
      gateNumber: existingLog.gateNumber || gateNumber,
      warning: existingLog.errorMessage || undefined,
      errorMessage: existingLog.errorMessage || undefined,
      log: existingLog,
    };
  }

  const delNoteNumber = upperStr(ticket.loadingSlip?.delNoteNumber || ticket.delNoteNumber) || '—';
  const truckNumber = upperStr(ticket.truckNumber) || '—';
  const driverName = upperStr(ticket.driverName) || '';
  const ticketNumber = upperStr(ticket.ticketNumber) || '';
  const destinationPlace = upperStr(ticket.destinationPlace || ticket.loadingSlip?.placeName) || '';
  const statusLabel = getStatusLabelForMessage(ticket.status);

  const phoneCheck = validateAndFormatWhatsAppPhone(ticket.driverPhone);
  const messageBody = buildLoadingSlipWhatsAppMessage({
    delNoteNumber,
    truckNumber,
    gateNumber,
    queueNumber: effectiveQueueNum,
    statusLabel,
    liveStatusUrl,
    driverName,
    ticketNumber,
    destinationPlace,
  });

  const now = Date.now();

  const upsertLog = (fields: {
    deliveryStatus: 'sent' | 'failed' | 'skipped';
    whatsappMessageId?: string;
    errorMessage?: string;
    driverMobile: string;
    sentAt: number | null;
  }): WhatsAppLogRecord => {
    if (existingLog) {
      const nextAttempt = (existingLog.attemptCount || 1) + 1;
      db.prepare(
        `UPDATE whatsapp_notification_logs
         SET ticket_number = ?,
             driver_name = ?,
             driver_mobile = ?,
             del_note_number = ?,
             truck_number = ?,
             gate_number = ?,
             queue_number = ?,
             delivery_status = ?,
             whatsapp_message_id = ?,
             error_message = ?,
             driver_status_token = ?,
             message_body = ?,
             attempt_count = ?,
             sent_at = COALESCE(?, sent_at),
             updated_at = ?
         WHERE id = ?`
      ).run(
        ticketNumber,
        driverName,
        fields.driverMobile,
        delNoteNumber,
        truckNumber,
        gateNumber,
        effectiveQueueNum,
        fields.deliveryStatus,
        fields.whatsappMessageId || '',
        fields.errorMessage || '',
        token,
        messageBody,
        nextAttempt,
        fields.sentAt,
        now,
        existingLog.id
      );
      return getLatestWhatsAppLogForTicket(ticketId, WHATSAPP_MSG_TYPE_LOADING_SLIP)!;
    }

    const logId = `wa-${now}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(
      `INSERT INTO whatsapp_notification_logs (
        id, ticket_id, ticket_number, driver_name, driver_mobile, del_note_number, truck_number,
        gate_number, queue_number, message_type, delivery_status, whatsapp_message_id,
        error_message, driver_status_token, message_body, attempt_count, created_at, sent_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      logId,
      ticketId,
      ticketNumber,
      driverName,
      fields.driverMobile,
      delNoteNumber,
      truckNumber,
      gateNumber,
      effectiveQueueNum,
      WHATSAPP_MSG_TYPE_LOADING_SLIP,
      fields.deliveryStatus,
      fields.whatsappMessageId || '',
      fields.errorMessage || '',
      token,
      messageBody,
      now,
      fields.sentAt,
      now
    );
    return getLatestWhatsAppLogForTicket(ticketId, WHATSAPP_MSG_TYPE_LOADING_SLIP)!;
  };

  if (!phoneCheck.valid) {
    const warnMsg = phoneCheck.error || 'Driver mobile number is missing or invalid.';
    const savedLog = upsertLog({
      deliveryStatus: 'skipped',
      errorMessage: warnMsg,
      driverMobile: phoneCheck.displayPhone,
      sentAt: null,
    });
    return {
      triggered: true,
      duplicatePrevented: false,
      deliveryStatus: 'skipped',
      driverMobile: phoneCheck.displayPhone,
      liveStatusUrl,
      driverStatusToken: token,
      queueNumber: effectiveQueueNum,
      gateNumber,
      warning: warnMsg,
      errorMessage: warnMsg,
      log: savedLog,
    };
  }

  const sendResult = await sendViaWhatsAppCloudApi({
    toE164Digits: phoneCheck.e164Digits,
    bodyText: messageBody,
  });

  if (sendResult.ok) {
    const savedLog = upsertLog({
      deliveryStatus: 'sent',
      whatsappMessageId: sendResult.messageId,
      errorMessage: '',
      driverMobile: phoneCheck.displayPhone,
      sentAt: now,
    });
    return {
      triggered: true,
      duplicatePrevented: false,
      deliveryStatus: 'sent',
      whatsappMessageId: sendResult.messageId,
      driverMobile: phoneCheck.displayPhone,
      liveStatusUrl,
      driverStatusToken: token,
      queueNumber: effectiveQueueNum,
      gateNumber,
      log: savedLog,
    };
  }

  const savedLog = upsertLog({
    deliveryStatus: 'failed',
    errorMessage: sendResult.errorMessage,
    driverMobile: phoneCheck.displayPhone,
    sentAt: null,
  });

  return {
    triggered: true,
    duplicatePrevented: false,
    deliveryStatus: 'failed',
    driverMobile: phoneCheck.displayPhone,
    liveStatusUrl,
    driverStatusToken: token,
    queueNumber: effectiveQueueNum,
    gateNumber,
    warning: `Loading slip saved, but automatic WhatsApp delivery failed: ${sendResult.errorMessage}`,
    errorMessage: sendResult.errorMessage,
    log: savedLog,
  };
}
