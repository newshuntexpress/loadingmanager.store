import React, { useState, useEffect, useCallback } from 'react';
import { WhatsAppNotificationLog, WhatsAppDispatchOutcome } from '../types';
import { ApiClient } from '../services/api';
import {
  X,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ExternalLink,
  Search,
  Send,
  Edit2,
} from 'lucide-react';

interface WhatsAppLogsModalProps {
  onClose: () => void;
  onRetrySuccess?: (outcome: WhatsAppDispatchOutcome) => void;
  canRetry?: boolean;
  isAdmin?: boolean;
  onOpenTemplates?: () => void;
}

function formatLogTimestamp(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export const WhatsAppLogsModal: React.FC<WhatsAppLogsModalProps> = ({
  onClose,
  onRetrySuccess,
  canRetry = true,
  isAdmin = false,
  onOpenTemplates,
}) => {
  const [logs, setLogs] = useState<WhatsAppNotificationLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [retryingTicketId, setRetryingTicketId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'warning';
    text: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'sent' | 'failed' | 'skipped'>('ALL');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await ApiClient.getWhatsAppLogs();
      setLogs(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to load WhatsApp notification logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleRetry = async (log: WhatsAppNotificationLog) => {
    if (!canRetry || log.deliveryStatus === 'sent') return;
    setRetryingTicketId(log.ticketId);
    setFeedbackBanner(null);
    try {
      const { outcome } = await ApiClient.retryWhatsAppNotification(log.ticketId);
      await loadLogs();
      if (outcome.deliveryStatus === 'sent') {
        setFeedbackBanner({
          type: 'success',
          text: `WhatsApp sent successfully to ${outcome.driverMobile || log.driverMobile} (ID: ${outcome.whatsappMessageId}).`,
        });
        onRetrySuccess?.(outcome);
      } else {
        setFeedbackBanner({
          type: 'warning',
          text: outcome.warning || outcome.errorMessage || 'WhatsApp retry did not succeed.',
        });
      }
    } catch (err: any) {
      setFeedbackBanner({
        type: 'warning',
        text: err?.message || 'Failed to retry WhatsApp notification.',
      });
      await loadLogs();
    } finally {
      setRetryingTicketId(null);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (statusFilter !== 'ALL' && l.deliveryStatus !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.delNoteNumber.toLowerCase().includes(q) ||
      l.truckNumber.toLowerCase().includes(q) ||
      l.driverName.toLowerCase().includes(q) ||
      l.driverMobile.toLowerCase().includes(q) ||
      l.ticketNumber.toLowerCase().includes(q) ||
      l.whatsappMessageId.toLowerCase().includes(q)
    );
  });

  const sentCount = logs.filter((l) => l.deliveryStatus === 'sent').length;
  const failedCount = logs.filter((l) => l.deliveryStatus === 'failed').length;
  const skippedCount = logs.filter((l) => l.deliveryStatus === 'skipped').length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#D1DBE5] w-full max-w-6xl overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-[#354A5F] text-white px-5 py-3.5 flex items-center justify-between gap-3 border-b border-[#223242]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[#107E3E] rounded-xl text-white shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold truncate">
                WhatsApp Notification Logs
              </h2>
              <p className="text-xs text-[#CBD8E6] truncate">
                Automatic dispatch delivery history, duplicate-send protection &amp; retry queue
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#CBD8E6] hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary & Filter Controls */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#F7F9FB] p-3 rounded-xl border border-[#D1DBE5]">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="px-2.5 py-1 rounded-lg bg-white border border-[#D1DBE5] text-[#354A5F] tabular-nums">
                Total: {logs.length}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[#F1FDF6] border border-[#ABE2C2] text-[#107E3E] tabular-nums">
                Sent: {sentCount}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[#FFF0F0] border border-[#F4B8B8] text-[#BB0000] tabular-nums">
                Failed: {failedCount}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[#FFFBEB] border border-[#F3CC60] text-[#92400E] tabular-nums">
                Skipped: {skippedCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#5B738B]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search truck, DN, driver..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#BCC8D4] bg-white focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#BCC8D4] bg-white cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="sent">Sent Only</option>
                <option value="failed">Failed Only</option>
                <option value="skipped">Skipped Only</option>
              </select>

              <button
                type="button"
                onClick={loadLogs}
                disabled={loading}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>

              {isAdmin && onOpenTemplates && (
                <button
                  type="button"
                  onClick={onOpenTemplates}
                  className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white border border-[#24A159]"
                  title="Edit & customize WhatsApp message templates"
                >
                  <Edit2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Edit Templates</span>
                </button>
              )}
            </div>
          </div>

          {feedbackBanner && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                feedbackBanner.type === 'success'
                  ? 'bg-[#F1FDF6] border-[#72C896] text-[#0D4A26]'
                  : 'bg-[#FFFBEB] border-[#F3CC60] text-[#854D0E]'
              }`}
            >
              <span>{feedbackBanner.text}</span>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="p-1 cursor-pointer opacity-75 hover:opacity-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FFF0F0] border border-[#F4B8B8] text-[#BB0000] text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#5B738B] flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#0A6ED1]" />
              <span>Loading notification records...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#5B738B] bg-[#F7F9FB] rounded-xl border border-[#E3EAF2]">
              No WhatsApp notification records match your filter yet. Automatic logs appear as soon as a Loading Slip is generated.
            </div>
          ) : (
            <div className="border border-[#D1DBE5] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#354A5F] text-white text-[11px] uppercase tracking-wider font-bold">
                      <th className="py-2.5 px-3">Slip / Ticket</th>
                      <th className="py-2.5 px-3">Delivery &amp; Truck</th>
                      <th className="py-2.5 px-3">Driver &amp; Mobile</th>
                      <th className="py-2.5 px-3">Gate / Queue</th>
                      <th className="py-2.5 px-3">Status &amp; Time</th>
                      <th className="py-2.5 px-3">Message ID / Error</th>
                      <th className="py-2.5 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3EAF2]">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#F7F9FB]">
                        <td className="py-2.5 px-3 align-top">
                          <span className="font-mono font-bold text-[#0A6ED1] block">
                            {log.ticketNumber || log.ticketId}
                          </span>
                          <span className="text-[10.5px] text-[#5B738B] block mt-0.5">
                            {log.messageType}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 align-top">
                          <span className="font-mono font-bold text-[#1C2833] block">
                            {log.delNoteNumber || '—'}
                          </span>
                          <span className="text-[11px] font-black text-[#354A5F] block mt-0.5">
                            {log.truckNumber || '—'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 align-top">
                          <span className="font-semibold text-[#1C2833] block">
                            {log.driverName || '—'}
                          </span>
                          <span className="text-[11px] font-mono font-bold text-[#107E3E] block mt-0.5">
                            {log.driverMobile || 'No Mobile'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 align-top tabular-nums">
                          <span className="font-bold text-[#354A5F] block">{log.gateNumber || '—'}</span>
                          <span className="text-[11px] font-bold text-[#0A6ED1] block mt-0.5">
                            Queue #{log.queueNumber || '—'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 align-top">
                          {log.deliveryStatus === 'sent' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-[#F1FDF6] text-[#107E3E] border border-[#ABE2C2]">
                              <CheckCircle2 className="w-3 h-3" />
                              Sent
                            </span>
                          ) : log.deliveryStatus === 'skipped' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-[#FFFBEB] text-[#92400E] border border-[#F3CC60]">
                              <AlertTriangle className="w-3 h-3" />
                              Skipped
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-[#FFF0F0] text-[#BB0000] border border-[#F4B8B8]">
                              <XCircle className="w-3 h-3" />
                              Failed
                            </span>
                          )}
                          <span className="block text-[10.5px] font-mono text-[#5B738B] mt-1 tabular-nums">
                            {formatLogTimestamp(log.sentAt || log.updatedAt)}
                          </span>
                          {log.attemptCount > 1 && (
                            <span className="block text-[10px] text-[#5B738B]">
                              Attempts: {log.attemptCount}
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 align-top max-w-[260px]">
                          {log.whatsappMessageId ? (
                            <span className="font-mono text-[10.5px] text-[#107E3E] break-all block">
                              ID: {log.whatsappMessageId}
                            </span>
                          ) : null}
                          {log.errorMessage ? (
                            <span className="text-[11px] text-[#BB0000] font-medium block break-words">
                              {log.errorMessage}
                            </span>
                          ) : !log.whatsappMessageId ? (
                            <span className="text-[11px] text-[#7A8FA3]">—</span>
                          ) : null}
                        </td>

                        <td className="py-2.5 px-3 align-top text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {canRetry && log.deliveryStatus !== 'sent' && (
                              <button
                                type="button"
                                onClick={() => handleRetry(log)}
                                disabled={retryingTicketId === log.ticketId}
                                className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white whitespace-nowrap disabled:opacity-60"
                                title="Retry sending WhatsApp message via official Cloud API"
                              >
                                {retryingTicketId === log.ticketId ? (
                                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                ) : (
                                  <Send className="w-3 h-3 shrink-0" />
                                )}
                                <span>Retry WhatsApp Message</span>
                              </button>
                            )}

                            {log.driverStatusToken && (
                              <a
                                href={`/driver-loading-status/${encodeURIComponent(log.driverStatusToken)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10.5px] font-bold text-[#0A6ED1] hover:underline"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Open Live Link</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
