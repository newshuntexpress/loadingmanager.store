import { ExFactoryEntry, TicketRecord } from '../types';
import { ApiClient, ApiError } from '../services/api';

export const PRINT_FETCH_RETRY_DELAYS_MS = [300, 500, 750, 1000, 1250];
export const PRINT_FETCH_MAX_RETRIES = PRINT_FETCH_RETRY_DELAYS_MS.length;

export function isTicketNotFoundError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 404) {
    return true;
  }
  const msg = String((err as { message?: string } | null)?.message || err || '').toLowerCase();
  return msg.includes('ticket record not found') || msg.includes('ex-factory entry not found');
}

export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof ApiError && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504)) {
    return true;
  }
  const msg = String((err as { message?: string } | null)?.message || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  );
}

function mergeExFactoryEntryIntoTicket(entry: ExFactoryEntry, baseTicket?: TicketRecord): TicketRecord {
  const slipDelNote = entry.loadingSlip?.delNoteNumber || entry.delNoteNumber;
  return {
    ...(baseTicket || {
      id: entry.id,
      plantId: entry.plantId || 'RIYADH',
      ticketNumber: entry.delNoteNumber,
      sequenceNumber: 1,
      date: entry.entryDate,
      timeIn: '',
      gateNumber: 'EX-FACTORY',
      gateSequenceNumber: 1,
      truckNumber: entry.truckNumber,
      driverName: entry.driverName || '—',
      driverPhone: entry.mobileNumber || '',
      iqamaNumber: entry.iqamaNumber || '',
      transporterName: entry.customerName,
      destinationPlace: entry.loadingSlip?.placeName || '',
      loadingType: entry.loadingType || 'local',
      delNoteNumber: slipDelNote,
      status: 'under_loading',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }),
    id: entry.id,
    plantId: entry.plantId || baseTicket?.plantId || 'RIYADH',
    date: entry.entryDate || baseTicket?.date || '',
    truckNumber: entry.truckNumber || baseTicket?.truckNumber || '',
    driverName: entry.driverName || baseTicket?.driverName || '—',
    driverPhone: entry.mobileNumber || baseTicket?.driverPhone || '',
    iqamaNumber: entry.iqamaNumber || baseTicket?.iqamaNumber || '',
    transporterName: entry.customerName || baseTicket?.transporterName || '',
    destinationPlace: entry.loadingSlip?.placeName || baseTicket?.destinationPlace || '',
    loadingType: entry.loadingType || baseTicket?.loadingType || 'local',
    delNoteNumber: slipDelNote || baseTicket?.delNoteNumber,
    loadingSlip: entry.loadingSlip || baseTicket?.loadingSlip,
    updatedAt: entry.updatedAt || baseTicket?.updatedAt || Date.now(),
  };
}

function mergeResolvedTicket(fetched: TicketRecord, fallbackTicket?: TicketRecord): TicketRecord {
  if (!fallbackTicket) return fetched;
  return {
    ...fallbackTicket,
    ...fetched,
    driverPhone: fetched.driverPhone || fallbackTicket.driverPhone || '',
    iqamaNumber: fetched.iqamaNumber || fallbackTicket.iqamaNumber || '',
    driverStatusToken: fetched.driverStatusToken || fallbackTicket.driverStatusToken,
    loadingSlip: fetched.loadingSlip || fallbackTicket.loadingSlip,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export interface FetchTicketForPrintParams {
  ticket?: TicketRecord;
  ticketId?: string;
  isCancelled: () => boolean;
  onRetryAttempt?: (attempt: number, maxRetries: number, reason: string) => void;
}

export async function fetchTicketForPrintWithRetry({
  ticket,
  ticketId,
  isCancelled,
  onRetryAttempt,
}: FetchTicketForPrintParams): Promise<TicketRecord> {
  const targetId = String(ticketId || ticket?.id || '').trim();
  if (!targetId) {
    throw new ApiError('Ticket record not found.', 404);
  }

  const isExFactory = ticket?.gateNumber === 'EX-FACTORY' || targetId.startsWith('exf_');
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= PRINT_FETCH_MAX_RETRIES; attempt += 1) {
    if (isCancelled()) {
      throw new Error('Cancelled');
    }

    try {
      if (isExFactory) {
        const entry = await ApiClient.getExFactoryEntryById(targetId, ticket?.plantId);
        return mergeExFactoryEntryIntoTicket(entry, ticket);
      }

      const fetched = await ApiClient.getTicketById(targetId, {
        allowFirestoreFallback: attempt === PRINT_FETCH_MAX_RETRIES,
      });
      return mergeResolvedTicket(fetched, ticket);
    } catch (err) {
      lastError = err;
      const shouldRetry = isTicketNotFoundError(err) && attempt < PRINT_FETCH_MAX_RETRIES;
      if (shouldRetry) {
        const message =
          err instanceof Error && err.message ? err.message : 'Ticket record not found.';
        onRetryAttempt?.(attempt + 1, PRINT_FETCH_MAX_RETRIES, message);
        await sleep(PRINT_FETCH_RETRY_DELAYS_MS[attempt] || 800);
        continue;
      }

      if (ticket && isTransientNetworkError(err) && !isTicketNotFoundError(err)) {
        return ticket;
      }

      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new ApiError('Ticket record not found.', 404);
}
