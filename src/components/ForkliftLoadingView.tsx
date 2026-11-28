import React, { useState, useEffect, useMemo } from 'react';
import {
  TicketRecord,
  CompanySettings,
  AuthUser,
  LoadingSlipItem,
  LoadingAlertNotification,
} from '../types';
import { ApiClient } from '../services/api';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import {
  PackageCheck,
  Truck,
  DoorOpen,
  CheckCircle2,
  Clock,
  Lock,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Search,
  AlertCircle,
  CheckSquare,
  Square,
  Save,
  Printer,
  Layers,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface ForkliftLoadingViewProps {
  tickets: TicketRecord[];
  settings: CompanySettings;
  currentUser: AuthUser;
  canPrint?: boolean;
  onTicketsRefresh: () => Promise<void>;
  onLoadingCompleted: (ticket: TicketRecord, alert: LoadingAlertNotification) => void;
  onPrintLoadingSlip: (ticket: TicketRecord) => void;
}

interface ActiveMaterialEntry {
  index: number;
  item: LoadingSlipItem;
}

function getActiveMaterials(ticket: TicketRecord): ActiveMaterialEntry[] {
  const items = ticket.loadingSlip?.items || [];
  const list: ActiveMaterialEntry[] = [];
  items.forEach((item, index) => {
    const hasDesc = Boolean(item.description && item.description.trim());
    const hasQty = Boolean(item.qty && String(item.qty).trim());
    const hasPack = Boolean(item.pack && item.pack.trim());
    if (hasDesc || hasQty || hasPack) {
      list.push({ index, item });
    }
  });
  return list;
}

function getStatusRank(status: TicketRecord['status']): number {
  switch (status) {
    case 'under_loading':
      return 0;
    case 'called':
      return 1;
    case 'waiting':
      return 2;
    case 'completed':
      return 3;
    default:
      return 4;
  }
}

export const ForkliftLoadingView: React.FC<ForkliftLoadingViewProps> = ({
  tickets,
  settings,
  currentUser,
  canPrint = true,
  onTicketsRefresh,
  onLoadingCompleted,
  onPrintLoadingSlip,
}) => {
  // Multi-gate filter: empty array = All Gates selected
  const [selectedGates, setSelectedGates] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'UNDER_LOADING' | 'COMPLETED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Currently opened slip ticket ID
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [savingRowIdx, setSavingRowIdx] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [justCompletedTicketId, setJustCompletedTicketId] = useState<string | null>(null);

  // Local draft buffer for loadedQty and remarks (Production Date) so manual typing is never interrupted
  const [draftQty, setDraftQty] = useState<Record<number, string>>({});
  const [draftRemarks, setDraftRemarks] = useState<Record<number, string>>({});
  const [dirtyRows, setDirtyRows] = useState<Record<number, boolean>>({});

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  // Sync draft fields when switching ticket (without overwriting active dirty edits)
  useEffect(() => {
    if (!selectedTicket) {
      setDraftQty({});
      setDraftRemarks({});
      setDirtyRows({});
      return;
    }
    const items = selectedTicket.loadingSlip?.items || [];
    setDraftQty((prev) => {
      const next: Record<number, string> = {};
      items.forEach((it, idx) => {
        next[idx] = dirtyRows[idx] && prev[idx] !== undefined ? prev[idx] : (it.loadedQty ?? it.qty ?? '');
      });
      return next;
    });
    setDraftRemarks((prev) => {
      const next: Record<number, string> = {};
      items.forEach((it, idx) => {
        next[idx] = dirtyRows[idx] && prev[idx] !== undefined ? prev[idx] : (it.remarks ?? '');
      });
      return next;
    });
  }, [selectedTicket?.id, selectedTicket?.version]);

  const toggleGate = (gate: string) => {
    setSelectedGates((prev) =>
      prev.includes(gate) ? prev.filter((g) => g !== gate) : [...prev, gate]
    );
  };

  const selectAllGates = () => {
    setSelectedGates([]);
  };

  // Apply gate + search filters (excluding cancelled)
  const gateFilteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (t.status === 'cancelled') return false;
      if (
        selectedGates.length > 0 &&
        !selectedGates.some((g) => g.trim().toUpperCase() === (t.gateNumber || '').trim().toUpperCase())
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const dn = (t.loadingSlip?.delNoteNumber || t.delNoteNumber || '').toLowerCase();
        const truck = (t.truckNumber || '').toLowerCase();
        const dest = (t.loadingSlip?.placeName || t.destinationPlace || '').toLowerCase();
        const driver = (t.driverName || '').toLowerCase();
        const tk = (t.ticketNumber || '').toLowerCase();
        if (!dn.includes(q) && !truck.includes(q) && !dest.includes(q) && !driver.includes(q) && !tk.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [tickets, selectedGates, searchQuery]);

  // Separate Pending vs Completed and sort pending so next ticket to load is obvious
  const pendingTickets = useMemo(() => {
    return gateFilteredTickets
      .filter((t) => t.status !== 'completed' && !t.loadingSlip?.isLocked)
      .filter((t) => {
        if (statusFilter === 'UNDER_LOADING') return t.status === 'under_loading';
        if (statusFilter === 'COMPLETED') return false;
        return true;
      })
      .sort((a, b) => {
        const rankDiff = getStatusRank(a.status) - getStatusRank(b.status);
        if (rankDiff !== 0) return rankDiff;
        const gateSeqDiff = (a.gateSequenceNumber || 999) - (b.gateSequenceNumber || 999);
        if (gateSeqDiff !== 0) return gateSeqDiff;
        return (a.sequenceNumber || 999) - (b.sequenceNumber || 999);
      });
  }, [gateFilteredTickets, statusFilter]);

  const completedTickets = useMemo(() => {
    if (statusFilter === 'PENDING' || statusFilter === 'UNDER_LOADING') return [];
    return gateFilteredTickets
      .filter((t) => t.status === 'completed' || t.loadingSlip?.isLocked)
      .sort((a, b) => {
        const aTime = a.loadingSlip?.loadingCompletedAt || a.updatedAt || 0;
        const bTime = b.loadingSlip?.loadingCompletedAt || b.updatedAt || 0;
        return bTime - aTime;
      });
  }, [gateFilteredTickets, statusFilter]);

  // Next loading ticket recommendation (across selected gates, or any gate if current is empty)
  const nextRecommendedTicket = useMemo(() => {
    const waitingOrActive = pendingTickets.find((t) => t.status === 'under_loading') || pendingTickets[0] || null;
    return waitingOrActive;
  }, [pendingTickets]);

  const handleOpenSlip = async (ticket: TicketRecord) => {
    setViewError(null);
    setJustCompletedTicketId(null);
    setDirtyRows({});
    setOpeningId(ticket.id);
    try {
      // Automatically moves Waiting in Queue -> Under Loading on server when opened by Forklift Operator
      await ApiClient.openTicketForForklift(ticket.id);
      await onTicketsRefresh();
      setSelectedTicketId(ticket.id);
    } catch (err: any) {
      setViewError(err?.message || 'Unable to open assigned loading slip.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleToggleMaterial = async (ticket: TicketRecord, rowIdx: number, nextChecked: boolean) => {
    if (ticket.loadingSlip?.isLocked || ticket.status === 'completed') return;
    setViewError(null);
    setSavingRowIdx(rowIdx);
    try {
      const currentItem = ticket.loadingSlip?.items?.[rowIdx];
      const loadedQtyVal =
        draftQty[rowIdx] !== undefined
          ? draftQty[rowIdx]
          : (currentItem?.loadedQty ?? currentItem?.qty ?? '');
      const remarksVal =
        draftRemarks[rowIdx] !== undefined ? draftRemarks[rowIdx] : (currentItem?.remarks ?? '');

      await ApiClient.updateForkliftChecklist(ticket.id, {
        itemUpdates: [
          {
            index: rowIdx,
            isLoaded: nextChecked,
            loadedQty: loadedQtyVal,
            remarks: remarksVal,
          },
        ],
        version: ticket.version,
      });

      setDirtyRows((prev) => ({ ...prev, [rowIdx]: false }));
      await onTicketsRefresh();
    } catch (err: any) {
      setViewError(err?.message || 'Failed to update material checklist.');
      await onTicketsRefresh();
    } finally {
      setSavingRowIdx(null);
    }
  };

  const handleSaveRowFields = async (ticket: TicketRecord, rowIdx: number) => {
    if (ticket.loadingSlip?.isLocked || ticket.status === 'completed') return;
    if (!dirtyRows[rowIdx]) return;
    setViewError(null);
    setSavingRowIdx(rowIdx);
    try {
      await ApiClient.updateForkliftChecklist(ticket.id, {
        itemUpdates: [
          {
            index: rowIdx,
            loadedQty: draftQty[rowIdx] ?? '',
            remarks: draftRemarks[rowIdx] ?? '',
          },
        ],
        version: ticket.version,
      });
      setDirtyRows((prev) => ({ ...prev, [rowIdx]: false }));
      await onTicketsRefresh();
    } catch (err: any) {
      setViewError(err?.message || 'Failed to save row changes.');
      await onTicketsRefresh();
    } finally {
      setSavingRowIdx(null);
    }
  };

  const handleInsertProductionDate = async (ticket: TicketRecord, rowIdx: number, isoDate: string) => {
    if (!isoDate || ticket.loadingSlip?.isLocked || ticket.status === 'completed') return;
    // Format neatly as DD-MM-YYYY and append/set without deleting existing custom batch notes if desired
    const parts = isoDate.split('-');
    const formatted = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : isoDate;
    const existingText = (draftRemarks[rowIdx] ?? '').trim().toUpperCase();
    const nextRemarks = existingText
      ? existingText.includes(formatted)
        ? existingText
        : `${existingText} | PROD: ${formatted}`
      : `PROD DATE: ${formatted}`;

    setDraftRemarks((prev) => ({ ...prev, [rowIdx]: nextRemarks }));
    setDirtyRows((prev) => ({ ...prev, [rowIdx]: true }));

    setSavingRowIdx(rowIdx);
    setViewError(null);
    try {
      await ApiClient.updateForkliftChecklist(ticket.id, {
        itemUpdates: [
          {
            index: rowIdx,
            loadedQty: draftQty[rowIdx] ?? ticket.loadingSlip?.items?.[rowIdx]?.loadedQty ?? ticket.loadingSlip?.items?.[rowIdx]?.qty ?? '',
            remarks: nextRemarks,
          },
        ],
        version: ticket.version,
      });
      setDirtyRows((prev) => ({ ...prev, [rowIdx]: false }));
      await onTicketsRefresh();
    } catch (err: any) {
      setViewError(err?.message || 'Failed to save production date.');
      await onTicketsRefresh();
    } finally {
      setSavingRowIdx(null);
    }
  };

  const handleCompleteLoading = async (ticket: TicketRecord) => {
    setViewError(null);
    setCompleting(true);
    try {
      // Flush any unsaved dirty row inputs before completing
      const dirtyEntries = Object.entries(dirtyRows)
        .filter(([, isDirty]) => isDirty)
        .map(([idxStr]) => Number(idxStr));

      let latestVersion = ticket.version;
      if (dirtyEntries.length > 0) {
        const updated = await ApiClient.updateForkliftChecklist(ticket.id, {
          itemUpdates: dirtyEntries.map((idx) => ({
            index: idx,
            loadedQty: draftQty[idx] ?? '',
            remarks: draftRemarks[idx] ?? '',
          })),
          version: latestVersion,
        });
        latestVersion = updated.version;
        setDirtyRows({});
      }

      const res = await ApiClient.completeForkliftLoading(ticket.id, latestVersion);
      setJustCompletedTicketId(ticket.id);
      await onTicketsRefresh();
      onLoadingCompleted(res.ticket, res.alert);
    } catch (err: any) {
      setViewError(err?.message || 'Unable to complete loading. Please verify all materials are checked.');
      await onTicketsRefresh();
    } finally {
      setCompleting(false);
    }
  };

  const renderTicketStatusBadge = (ticket: TicketRecord) => {
    if (ticket.status === 'completed' || ticket.loadingSlip?.isLocked) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F1FDF6] text-[#107E3E] border border-[#ABE2C2]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#107E3E] shrink-0" />
          Loading Completed
        </span>
      );
    }
    if (ticket.status === 'under_loading') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF7F1] text-[#A64B00] border border-[#F9C99B]">
          <Clock className="w-3.5 h-3.5 text-[#E9730C] shrink-0" />
          Under Loading
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]">
        <Clock className="w-3 h-3 text-[#5B738B] shrink-0" />
        Waiting in Queue
      </span>
    );
  };

  // ========================================================
  // DETAIL SCREEN: ASSIGNED LOADING SLIP & MATERIAL CHECKLIST
  // ========================================================
  if (selectedTicket) {
    const slip = selectedTicket.loadingSlip;
    const isLocked = Boolean(slip?.isLocked || selectedTicket.status === 'completed');
    const activeMaterials = getActiveMaterials(selectedTicket);
    const completedCount = activeMaterials.filter((m) => m.item.isLoaded === true).length;
    const allCompleted = activeMaterials.length > 0 && completedCount === activeMaterials.length;
    const firstUncheckedIdx = activeMaterials.find((m) => !m.item.isLoaded)?.index;

    // Next pending ticket for "Move to Next Loading" after completion
    const nextAfterThis = pendingTickets.find((t) => t.id !== selectedTicket.id) || null;

    return (
      <div className="space-y-4">
        {/* Top Action Bar */}
        <div className="surface-3d p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedTicketId(null);
              setViewError(null);
              setJustCompletedTicketId(null);
            }}
            className="app-btn bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Back to Forklift Queue</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {renderTicketStatusBadge(selectedTicket)}
            {isLocked && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-neutral-900 text-white">
                <Lock className="w-3 h-3 text-emerald-400" />
                Locked
              </span>
            )}
            <button
              type="button"
              onClick={() => onPrintLoadingSlip(selectedTicket)}
              className="app-btn bg-neutral-800 hover:bg-neutral-900 text-white"
            >
              <Printer className="w-4 h-4 text-amber-300 shrink-0" />
              <span>Print Slip</span>
            </button>
          </div>
        </div>

        {viewError && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{viewError}</span>
          </div>
        )}

        {/* Immediate Completion Banner & Move to Next Loading */}
        {(isLocked || justCompletedTicketId === selectedTicket.id) && (
          <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-5 shadow-[0_4px_0_#6EE7B7,0_12px_24px_-8px_rgba(16,126,62,0.2)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 text-xs text-emerald-950">
              <p className="font-black text-base text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>Loading Completed &amp; Locked</span>
              </p>
              <p>
                <strong>Delivery Number:</strong> {slip?.delNoteNumber || selectedTicket.delNoteNumber || '—'} &nbsp;|&nbsp;{' '}
                <strong>Truck Number:</strong> {selectedTicket.truckNumber} &nbsp;|&nbsp;{' '}
                <strong>Gate:</strong> {selectedTicket.gateNumber}
              </p>
              <p className="text-emerald-800">
                <strong>Completed By:</strong> {slip?.loadingCompletedBy || slip?.checkedBy || currentUser.fullName} &nbsp;|&nbsp;{' '}
                <strong>Completed Time:</strong> {slip?.loadingCompletedTime || selectedTicket.timeCompleted || 'Recorded'}
              </p>
            </div>
            {nextAfterThis && (
              <button
                type="button"
                onClick={() => handleOpenSlip(nextAfterThis)}
                disabled={openingId === nextAfterThis.id}
                className="app-btn bg-blue-700 hover:bg-blue-600 text-white shadow-md shrink-0"
              >
                <span>Move to Next Loading ({nextAfterThis.truckNumber})</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Loading Slip Details Card */}
        <div className="surface-3d rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-b from-[#3E556D] via-[#354A5F] to-[#263748] text-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-2 border-[#0A6ED1]">
            <div>
              <span className="text-[10px] tracking-wider font-bold text-[#F0AB00] block">
                Assigned Forklift Loading Slip
              </span>
              <h2 className="text-base sm:text-lg font-black tracking-wide">
                DN: {slip?.delNoteNumber || selectedTicket.delNoteNumber || '—'} • Truck: {selectedTicket.truckNumber}
              </h2>
            </div>
            <div className="text-xs bg-[#243647] border border-[#4A6580] px-3 py-1.5 rounded-lg font-bold text-[#EBF5FF]">
              Operator: {currentUser.fullName}
            </div>
          </div>

          <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-neutral-50 border-b border-neutral-200 text-xs">
            <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">Delivery Number</span>
              <span className="font-black text-blue-900 font-mono text-sm break-all">
                {slip?.delNoteNumber || selectedTicket.delNoteNumber || '—'}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">Truck Number</span>
              <span className="font-black text-neutral-900 font-mono text-sm">
                {selectedTicket.truckNumber}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">Gate Number</span>
              <span className="font-black text-indigo-800 text-sm">
                {selectedTicket.gateNumber}
              </span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">Checklist Progress</span>
              <span className="font-black text-emerald-700 text-sm">
                {completedCount} / {activeMaterials.length} Completed
              </span>
            </div>
            <div className="col-span-2 bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">
                Customer / Delivery Details
              </span>
              <span className="font-bold text-neutral-900 block">
                {slip?.placeName || selectedTicket.destinationPlace || 'Destination Not Specified'}
              </span>
              <span className="text-[11px] text-neutral-600 block mt-0.5">
                Driver: {selectedTicket.driverName} ({formatSaudiPhoneNumber(selectedTicket.driverPhone)}) •{' '}
                {selectedTicket.transporterName || 'Self / Own'}
              </span>
            </div>
            <div className="col-span-2 bg-white p-2.5 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 block">Ticket &amp; Totals</span>
              <span className="font-bold text-neutral-900 block">
                {selectedTicket.ticketNumber} (Seq #{selectedTicket.sequenceNumber})
              </span>
              <span className="text-[11px] text-neutral-600 block mt-0.5">
                {slip?.totalQty || 0} Total Qty • {slip?.totalPallets || 0} Pallets • {slip?.totalLooseRolls || 0} Loose Rolls
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          {activeMaterials.length > 0 && (
            <div className="px-4 py-2.5 bg-white border-b border-neutral-200">
              <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                <span className="text-neutral-700">Material Loading Progress</span>
                <span className={allCompleted ? 'text-emerald-700' : 'text-amber-700'}>
                  {Math.round((completedCount / activeMaterials.length) * 100)}% Loaded
                </span>
              </div>
              <div className="w-full h-2.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    allCompleted ? 'bg-emerald-600' : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.round((completedCount / activeMaterials.length) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Material Checklist */}
          <div className="p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-black tracking-wide text-neutral-800 flex items-center gap-1.5">
                <PackageCheck className="w-4 h-4 text-blue-700" />
                <span>Material Loading Checklist</span>
              </h3>
              <span className="text-[11px] text-neutral-500 font-medium">
                Tick each material once fully loaded &amp; enter Production Date in Remarks / Batch
              </span>
            </div>

            {activeMaterials.length === 0 ? (
              <div className="p-6 text-center bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-semibold">
                No materials have been added to this Loading Slip yet. Ask Dispatch / Store to populate materials in the Loading Slip.
              </div>
            ) : (
              <div className="space-y-3">
                {activeMaterials.map(({ index, item }) => {
                  const isItemCompleted = item.isLoaded === true;
                  const isDirty = Boolean(dirtyRows[index]);
                  const isCurrentlyLoading =
                    !isItemCompleted &&
                    !isLocked &&
                    (isDirty || selectedTicket.status === 'under_loading' && index === firstUncheckedIdx);
                  const isSavingThis = savingRowIdx === index;
                  const currentLoadedQty = draftQty[index] ?? item.loadedQty ?? item.qty ?? '';
                  const currentRemarks = draftRemarks[index] ?? item.remarks ?? '';

                  return (
                    <div
                      key={index}
                      className={`rounded-2xl border p-3 sm:p-4 transition ${
                        isItemCompleted
                          ? 'bg-emerald-50/70 border-emerald-300'
                          : isCurrentlyLoading
                          ? 'bg-amber-50/70 border-amber-300 shadow-xs'
                          : 'bg-white border-neutral-200'
                      }`}
                    >
                      {/* Row Top: Tick Checkbox + Material Name + Status Pill */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <button
                            type="button"
                            disabled={isLocked || isSavingThis}
                            onClick={() => handleToggleMaterial(selectedTicket, index, !isItemCompleted)}
                            className={`mt-0.5 p-1 rounded-xl border transition shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                              isItemCompleted
                                ? 'bg-emerald-600 border-emerald-700 text-white'
                                : 'bg-white border-neutral-400 text-neutral-600 hover:border-blue-600 hover:text-blue-700'
                            }`}
                            aria-label={isItemCompleted ? 'Mark material pending' : 'Mark material loaded'}
                            title={isLocked ? 'Loading Slip Locked' : isItemCompleted ? 'Checked / Completed' : 'Tick when completely loaded'}
                          >
                            {isSavingThis ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : isItemCompleted ? (
                              <CheckSquare className="w-5 h-5" />
                            ) : (
                              <Square className="w-5 h-5" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-black text-neutral-500">#{index + 1}</span>
                              <p className="text-sm font-black text-neutral-900 break-words">
                                {item.description || 'Unnamed Material'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                              <span className="bg-neutral-100 border border-neutral-300 text-neutral-800 px-2 py-0.5 rounded-lg font-bold">
                                Required: {item.qty || '0'} {item.pack || ''}
                              </span>
                              {item.pallets ? (
                                <span className="bg-blue-50 border border-blue-200 text-blue-900 px-2 py-0.5 rounded-lg font-bold">
                                  {item.pallets} Pallets
                                </span>
                              ) : null}
                              {item.looseRolls && Number(item.looseRolls) > 0 ? (
                                <span className="bg-indigo-50 border border-indigo-200 text-indigo-900 px-2 py-0.5 rounded-lg font-bold">
                                  {item.looseRolls} Loose
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Item Status Indicator: Pending / Loading / Completed */}
                        <div className="shrink-0">
                          {isItemCompleted ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-3 h-3" />
                              Completed
                            </span>
                          ) : isCurrentlyLoading ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              <Clock className="w-3 h-3" />
                              Loading
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-neutral-100 text-neutral-600 border border-neutral-300">
                              Pending
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row Inputs: Loaded Quantity + Remarks / Batch (Production Date) */}
                      <div className="mt-3 pt-3 border-t border-neutral-200/80 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                        <div className="sm:col-span-4">
                          <label className="text-[11px] font-bold text-neutral-700 block mb-1">
                            Loaded Quantity
                          </label>
                          <input
                            type="text"
                            disabled={isLocked}
                            value={currentLoadedQty}
                            onChange={(e) => {
                              const upper = e.target.value.toUpperCase();
                              setDraftQty((prev) => ({ ...prev, [index]: upper }));
                              setDirtyRows((prev) => ({ ...prev, [index]: true }));
                            }}
                            onBlur={() => handleSaveRowFields(selectedTicket, index)}
                            placeholder={`Req: ${item.qty || '0'}`}
                            className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-neutral-300 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-600"
                          />
                        </div>

                        <div className="sm:col-span-8">
                          <label className="text-[11px] font-bold text-neutral-700 block mb-1">
                            Remarks / Batch (Production Date)
                          </label>
                          <div className="flex flex-col xs:flex-row sm:flex-row gap-1.5">
                            <input
                              type="text"
                              disabled={isLocked}
                              value={currentRemarks}
                              onChange={(e) => {
                                const upper = e.target.value.toUpperCase();
                                setDraftRemarks((prev) => ({ ...prev, [index]: upper }));
                                setDirtyRows((prev) => ({ ...prev, [index]: true }));
                              }}
                              onBlur={() => handleSaveRowFields(selectedTicket, index)}
                              placeholder="Enter Production Date (e.g. 13-11-2026) / Batch"
                              className="flex-1 min-w-0 px-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-600"
                            />
                            {!isLocked && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <label
                                  className="app-btn-sm bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 cursor-pointer relative overflow-hidden"
                                  title="Pick Production Date"
                                >
                                  <Calendar className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                  <span>Date</span>
                                  <input
                                    type="date"
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleInsertProductionDate(selectedTicket, index, e.target.value);
                                      }
                                    }}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    aria-label="Pick production date"
                                  />
                                </label>
                                {isDirty && (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveRowFields(selectedTicket, index)}
                                    disabled={isSavingThis}
                                    className="app-btn-sm bg-blue-700 hover:bg-blue-600 text-white"
                                  >
                                    <Save className="w-3.5 h-3.5 shrink-0" />
                                    <span>Save</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer: Loading Complete Button (ONLY visible once all active materials are checked) */}
          <div className="p-4 bg-neutral-50 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {isLocked ? (
              <div className="text-xs font-bold text-emerald-800 flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span>This loading slip is completed and locked. No further modifications allowed.</span>
              </div>
            ) : allCompleted ? (
              <>
                <div className="text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>All {activeMaterials.length} materials checked &amp; loaded. Ready to finalize.</span>
                </div>
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => handleCompleteLoading(selectedTicket)}
                  className="app-btn w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white shadow-md"
                >
                  {completing ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>{completing ? 'Completing...' : 'Loading Complete'}</span>
                </button>
              </>
            ) : (
              <div className="text-xs font-semibold text-amber-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {activeMaterials.length === 0
                    ? 'Add materials to the Loading Slip before completing.'
                    : `${activeMaterials.length - completedCount} of ${activeMaterials.length} material(s) still pending. Check all materials to unlock Loading Complete.`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========================================================
  // QUEUE SCREEN: GATE-WISE MULTI-SELECT & PENDING/COMPLETED
  // ========================================================
  return (
    <div className="space-y-4">
      {viewError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{viewError}</span>
        </div>
      )}

      {/* Next Recommended Loading Highlight Card */}
      {nextRecommendedTicket && (
        <div className="bg-gradient-to-b from-[#3E556D] via-[#354A5F] to-[#243647] text-white rounded-2xl p-5 sm:p-6 surface-3d-dark border border-[#4A6580] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-[#F0AB00] text-[#1C2833]">
                <Sparkles className="w-3.5 h-3.5" />
                {nextRecommendedTicket.status === 'under_loading' ? 'Active Loading Now' : 'Next Loading Up'}
              </span>
              <span className="text-sm font-bold text-[#8AC4FF]">
                {nextRecommendedTicket.gateNumber} (Pos #{nextRecommendedTicket.gateSequenceNumber})
              </span>
            </div>
            <p className="text-base sm:text-lg font-black tracking-wide truncate">
              DN: {nextRecommendedTicket.loadingSlip?.delNoteNumber || nextRecommendedTicket.delNoteNumber || '—'} • Truck: {nextRecommendedTicket.truckNumber}
            </p>
            <p className="text-xs sm:text-sm text-[#CBD8E6] truncate">
              {nextRecommendedTicket.loadingSlip?.placeName || nextRecommendedTicket.destinationPlace || 'Destination N/A'} • Driver: {nextRecommendedTicket.driverName}
            </p>
          </div>

          <button
            type="button"
            disabled={openingId === nextRecommendedTicket.id}
            onClick={() => handleOpenSlip(nextRecommendedTicket)}
            className="app-btn w-full sm:w-auto bg-[#107E3E] hover:bg-[#0D6B34] text-white font-black shrink-0 border border-[#24A159]"
          >
            {openingId === nextRecommendedTicket.id ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <PackageCheck className="w-4 h-4 shrink-0" />
            )}
            <span>
              {nextRecommendedTicket.status === 'under_loading' ? 'Continue Loading Slip' : 'Open Loading Slip'}
            </span>
          </button>
        </div>
      )}

      {/* Gate-Wise Multi-Select Filter & Search Controls */}
      <div className="surface-3d p-4 sm:p-5 rounded-2xl space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-black tracking-wide text-[#354A5F] flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#0A6ED1]" />
              <span>Gate-Wise Filter (Select One or Multiple Gates)</span>
            </h2>
            <p className="text-xs text-[#5B738B] mt-0.5">
              {selectedGates.length === 0
                ? 'Showing all gates'
                : `Selected: ${selectedGates.join(', ')}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-[#5B738B] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Delivery No, Truck, Customer..."
                className="w-full h-11 pl-10 pr-3.5 py-2 text-sm rounded-xl border border-[#B9C8D8] bg-[#F4F7FB] text-[#1C2833] inset-3d focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-11 text-sm font-semibold px-3.5 py-2 rounded-xl border border-[#B9C8D8] bg-[#F4F7FB] text-[#1C2833] inset-3d focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending / Queue</option>
              <option value="UNDER_LOADING">Under Loading</option>
              <option value="COMPLETED">Loading Completed</option>
            </select>
          </div>
        </div>

        {/* Multi-Gate Toggle Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAllGates}
            className={`app-btn-sm border ${
              selectedGates.length === 0
                ? 'bg-[#354A5F] text-white border-[#354A5F]'
                : 'bg-[#EFF4F9] hover:bg-[#E3EAF2] text-[#354A5F] border-[#BCC8D4]'
            }`}
          >
            <DoorOpen className="w-3.5 h-3.5 shrink-0" />
            <span>All Gates ({tickets.filter((t) => t.status !== 'cancelled').length})</span>
          </button>

          {settings.gates.map((gate) => {
            const active = selectedGates.includes(gate);
            const normGate = gate.trim().toUpperCase();
            const gatePendingCount = tickets.filter(
              (t) =>
                (t.gateNumber || '').trim().toUpperCase() === normGate &&
                t.status !== 'completed' &&
                t.status !== 'cancelled' &&
                !t.loadingSlip?.isLocked
            ).length;
            return (
              <button
                key={gate}
                type="button"
                onClick={() => toggleGate(gate)}
                className={`app-btn-sm border ${
                  active
                    ? 'bg-[#0A6ED1] text-white border-[#0A6ED1] shadow-xs'
                    : 'bg-white hover:bg-[#EBF5FF] text-[#354A5F] border-[#BCC8D4]'
                }`}
              >
                <span>{gate}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                    active ? 'bg-white/20 text-white' : 'bg-[#EFF4F9] text-[#354A5F]'
                  }`}
                >
                  {gatePendingCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 1: PENDING & UNDER LOADING TICKETS */}
      {statusFilter !== 'COMPLETED' && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs sm:text-sm font-black tracking-wider text-neutral-800 flex items-center gap-2">
              <Truck className="w-4 h-4 text-amber-600" />
              <span>Pending &amp; Active Loadings ({pendingTickets.length})</span>
            </h3>
            <span className="text-[11px] text-neutral-500 font-medium">
              Sorted by active loading &amp; next queue order
            </span>
          </div>

          {pendingTickets.length === 0 ? (
            <div className="surface-3d rounded-2xl p-10 text-center text-sm text-neutral-500">
              No pending loading slips match the selected gate filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pendingTickets.map((ticket, idx) => {
                const activeMaterials = getActiveMaterials(ticket);
                const checkedCount = activeMaterials.filter((m) => m.item.isLoaded === true).length;
                const isNextUp = nextRecommendedTicket?.id === ticket.id;

                return (
                  <div
                    key={ticket.id}
                    className={`surface-3d surface-3d-hover rounded-2xl p-5 flex flex-col justify-between gap-3.5 ${
                      ticket.status === 'under_loading'
                        ? 'border-[#E9730C] ring-1 ring-[#F9C99B]'
                        : isNextUp
                        ? 'border-[#0A6ED1] ring-1 ring-[#B8DCFF]'
                        : ''
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-[#354A5F] text-white shadow-[0_2px_0_#1B2836]">
                            {ticket.gateNumber}
                          </span>
                          <span className="text-xs font-bold text-[#5B738B]">
                            Queue #{idx + 1} • {ticket.ticketNumber}
                          </span>
                        </div>
                        {renderTicketStatusBadge(ticket)}
                      </div>

                      <div>
                        <p className="text-xs font-bold text-[#0A6ED1] font-mono">
                          DN: {ticket.loadingSlip?.delNoteNumber || ticket.delNoteNumber || '—'}
                        </p>
                        <p className="text-lg font-black text-[#1C2833] tracking-wide mt-0.5">
                          {ticket.truckNumber}
                        </p>
                        <p className="text-xs text-[#475E75] font-medium truncate mt-0.5">
                          {ticket.loadingSlip?.placeName || ticket.destinationPlace || 'Destination N/A'} • {ticket.driverName}
                        </p>
                      </div>

                      <div className="bg-[#F4F7FB] border border-[#C8D6E5] rounded-xl p-2.5 text-xs flex items-center justify-between inset-3d">
                        <span className="font-semibold text-[#354A5F]">
                          Materials: <strong>{checkedCount}/{activeMaterials.length}</strong> Loaded
                        </span>
                        <span className="font-bold text-[#5B738B]">
                          {ticket.loadingSlip?.totalQty || 0} Qty • {ticket.loadingSlip?.totalPallets || 0} Pallets
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button
                        type="button"
                        disabled={openingId === ticket.id}
                        onClick={() => handleOpenSlip(ticket)}
                        className={`app-btn w-full ${
                          ticket.status === 'under_loading'
                            ? 'bg-[#E9730C] hover:bg-[#C25900] text-white'
                            : 'bg-[#0A6ED1] hover:bg-[#085CAF] text-white'
                        }`}
                      >
                        {openingId === ticket.id ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                          <PackageCheck className="w-4 h-4 shrink-0" />
                        )}
                        <span>
                          {ticket.status === 'under_loading' ? 'Continue Loading Checklist' : 'Open Loading Slip'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onPrintLoadingSlip(ticket)}
                        className="app-btn bg-[#354A5F] hover:bg-[#243647] text-white px-3"
                        title="Print 2-Copy A4 Loading Slip"
                      >
                        <Printer className="w-4 h-4 text-[#F0AB00] shrink-0" />
                        <span>Print</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: COMPLETED LOADINGS (SEPARATED) */}
      {statusFilter !== 'PENDING' && statusFilter !== 'UNDER_LOADING' && (
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs sm:text-sm font-black tracking-wider text-[#107E3E] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#107E3E]" />
              <span>Completed Loadings ({completedTickets.length})</span>
            </h3>
          </div>

          {completedTickets.length === 0 ? (
            <div className="surface-3d rounded-2xl p-8 text-center text-sm text-[#5B738B]">
              No completed loadings for the selected gates yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {completedTickets.map((ticket) => {
                const activeMaterials = getActiveMaterials(ticket);
                return (
                  <div
                    key={ticket.id}
                    className="bg-gradient-to-b from-[#F1FDF6] to-[#E6FAEE] rounded-2xl border border-[#72C896] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_#A7F3D0,0_12px_24px_-8px_rgba(16,126,62,0.16)] flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-black bg-[#107E3E] text-white">
                          {ticket.gateNumber}
                        </span>
                        {renderTicketStatusBadge(ticket)}
                      </div>

                      <p className="text-xs font-bold text-[#107E3E] font-mono">
                        DN: {ticket.loadingSlip?.delNoteNumber || ticket.delNoteNumber || '—'}
                      </p>
                      <p className="text-sm font-black text-[#1C2833]">{ticket.truckNumber}</p>
                      <p className="text-[11px] text-[#354A5F]">
                        Completed By: <strong>{ticket.loadingSlip?.loadingCompletedBy || ticket.loadingSlip?.checkedBy || 'Operator'}</strong>
                        <br />
                        Time: {ticket.loadingSlip?.loadingCompletedTime || ticket.timeCompleted || 'Recorded'}
                        <br />
                        Materials: {activeMaterials.length} / {activeMaterials.length} Completed
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenSlip(ticket)}
                        className="app-btn-sm w-full bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
                      >
                        <Lock className="w-3.5 h-3.5 text-[#107E3E] shrink-0" />
                        <span>View Locked Slip</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onPrintLoadingSlip(ticket)}
                        className="app-btn-sm w-full bg-[#354A5F] hover:bg-[#243647] text-white"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                        <span>Print Slip</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
