import React, { useState, useEffect } from 'react';
import { TicketRecord, TruckStatus } from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';
import {
  FileText,
  Printer,
  MessageSquare,
  CheckCircle2,
  Clock,
  Megaphone,
  Trash2,
  Edit2,
} from 'lucide-react';

interface TicketTableProps {
  tickets: TicketRecord[];
  gates: string[];
  onOpenLoadingSlip: (ticket: TicketRecord) => void;
  onPrintLoadingSlip: (ticket: TicketRecord) => void;
  onPrintTicket: (ticket: TicketRecord) => void;
  onOpenWhatsApp: (ticket: TicketRecord) => void;
  onStatusChange: (ticket: TicketRecord, newStatus: TruckStatus) => void;
  onGateChange: (ticket: TicketRecord, newGate: string) => void;
  onEditTicket: (ticket: TicketRecord) => void;
  onDeleteTicket: (ticketId: string) => void;
  canUpdate?: boolean;
  canDelete?: boolean;
  canPrint?: boolean;
}

export const TicketTable: React.FC<TicketTableProps> = ({
  tickets,
  gates,
  onOpenLoadingSlip,
  onPrintLoadingSlip,
  onPrintTicket,
  onOpenWhatsApp,
  onStatusChange,
  onGateChange,
  onEditTicket,
  onDeleteTicket,
  canUpdate = true,
  canDelete = true,
  canPrint = true,
}) => {
  // Sequence Number Sorting: Ascending (1, 2, 3...) by default
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const sortedTickets = [...tickets].sort((a, b) => {
    const seqA = a.sequenceNumber || 0;
    const seqB = b.sequenceNumber || 0;
    return sortAsc ? seqA - seqB : seqB - seqA;
  });

  const getStatusBadge = (status: TruckStatus) => {
    switch (status) {
      case 'waiting':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]">
            <Clock className="w-3 h-3 text-[#5B738B]" />
            Waiting in Queue
          </span>
        );
      case 'called':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#EBF5FF] text-[#0854A0] border border-[#B8DCFF]">
            <Megaphone className="w-3 h-3 text-[#0A6ED1]" />
            Called to Gate
          </span>
        );
      case 'under_loading':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF7F1] text-[#A64B00] border border-[#F9C99B]">
            <Clock className="w-3 h-3 text-[#E9730C]" />
            Under Loading
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F1FDF6] text-[#107E3E] border border-[#ABE2C2]">
            <CheckCircle2 className="w-3 h-3 text-[#107E3E]" />
            Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FFF0F0] text-[#BB0000] border border-[#F4B8B8]">
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  if (tickets.length === 0) {
    return (
      <div className="surface-3d rounded-2xl p-14 text-center text-[#5B738B]">
        <p className="text-lg font-black text-[#263748] mb-1.5">No vehicle loading records found for this date</p>
        <p className="text-sm text-[#5B738B]">
          Click "+ New Gate Ticket" to register a new loading vehicle.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-3d rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-gradient-to-b from-[#3E556D] via-[#354A5F] to-[#263748] text-white text-[11.5px] uppercase tracking-wider font-extrabold border-b-2 border-[#0A6ED1]">
              <th
                onClick={() => setSortAsc(!sortAsc)}
                className="py-4 px-3.5 text-center w-20 cursor-pointer hover:bg-[#2B3E50] transition select-none"
                title="Click to toggle Ascending (1, 2, 3...) or Descending"
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Seq</span>
                  <span className="text-[10.5px] text-[#F0AB00] font-mono font-bold">
                    {sortAsc ? '▲ #1' : '▼ #9'}
                  </span>
                </div>
              </th>
              <th className="py-4 px-3.5">Ticket Number</th>
              <th className="py-4 px-3.5">Gate & Pos</th>
              <th className="py-4 px-3.5">Vehicle & Driver</th>
              <th className="py-4 px-3.5">Destination</th>
              <th className="py-4 px-3.5 text-center">Status</th>
              <th className="py-4 px-3.5">Loading Slip Summary</th>
              <th className="py-4 px-3.5">Timestamps</th>
              <th className="py-4 px-3.5 text-center min-w-[290px]">Quick Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3EAF2] font-sans">
            {sortedTickets.map((t) => {
              const slip = t.loadingSlip;
              return (
                <tr
                  key={t.id}
                  className={`hover:bg-[#EBF5FF]/55 transition ${
                    t.status === 'under_loading'
                      ? 'bg-[#FEF7F1]/60'
                      : t.status === 'called'
                      ? 'bg-[#EBF5FF]/40'
                      : ''
                  }`}
                >
                  {/* Daily Sequence*/ }
                  <td className="py-3.5 px-3.5 text-center font-black text-base text-[#263748] tabular-nums">
                    <span className="inline-flex items-center justify-center min-w-[2.25rem] h-8 px-2 rounded-lg bg-[#EFF4F9] border border-[#C8D6E5] inset-3d">
                      #{t.sequenceNumber}
                    </span>
                  </td>

                  {/* Ticket Number*/ }
                  <td className="py-3.5 px-3.5">
                    <span className="font-extrabold text-[#0A6ED1] block font-mono text-[13px]">{t.ticketNumber}</span>
                    <button
                      type="button"
                      onClick={() => onPrintTicket(t)}
                      className="text-[11px] text-[#5B738B] hover:text-[#0A6ED1] font-semibold inline-flex items-center gap-1 cursor-pointer mt-1"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Token</span>
                    </button>
                  </td>

                  {/* Gate Number & Gate Sequence Number*/ }
                  <td className="py-3.5 px-3.5">
                    {canUpdate ? (
                      <select
                        value={t.gateNumber}
                        onChange={(e) => {
                          const nextGate = e.target.value;
                          if (nextGate && nextGate !== t.gateNumber) {
                            onGateChange(t, nextGate);
                          }
                        }}
                        title="Change Loading Gate"
                        aria-label={`Change Gate for ${t.ticketNumber}`}
                        className="bg-gradient-to-b from-white to-[#EFF4F9] border border-[#C5D3E2] px-2 py-1 rounded-lg text-[#263748] font-black text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] cursor-pointer"
                      >
                        {(gates.includes(t.gateNumber) ? gates : [t.gateNumber, ...gates]).filter(Boolean).map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="inline-block bg-gradient-to-b from-white to-[#EFF4F9] border border-[#C5D3E2] px-2.5 py-1 rounded-lg text-[#263748] font-black text-xs shadow-xs">
                        {t.gateNumber}
                      </div>
                    )}
                    <p className="text-[11.5px] font-bold text-[#0A6ED1] mt-1">
                      {t.status === 'under_loading'
                        ? 'In Progress'
                        : `Gate Pos: ${t.gateSequenceNumber}`}
                    </p>
                  </td>

                  {/* Truck & Driver */ }
                  <td className="py-3.5 px-3.5">
                    <p className="font-black text-[#1C2833] tracking-wide text-sm">{t.truckNumber}</p>
                    <p className="text-xs text-[#354A5F] font-semibold mt-0.5">{t.driverName}</p>
                    <p className="text-[11.5px] text-[#107E3E] font-mono font-bold flex items-center gap-1 mt-0.5">
                      <span>{formatSaudiPhoneNumber(t.driverPhone)}</span>
                    </p>
                  </td>

                  {/* Destination & Loading Type */}
                  <td className="py-3.5 px-3.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-[#1C2833] text-xs">
                        {t.destinationPlace || 'N/A'}
                      </span>
                      {(() => {
                        const lType = resolveLoadingType(t);
                        return (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wide border ${
                              lType === 'export'
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : lType === 'sto'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            {lType === 'export' ? 'Export' : lType === 'sto' ? 'STO' : 'Local'}
                          </span>
                        );
                      })()}
                    </div>
                    <span className="text-[11px] text-[#5B738B] truncate max-w-[140px] block mt-0.5">
                      {t.transporterName || 'Self Transport'}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-3 px-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {getStatusBadge(t.status)}
                      {/* Quick Status Toggle Dropdown */}
                      {canUpdate && (
                        <select
                          value={t.status}
                          onChange={(e) => onStatusChange(t, e.target.value as TruckStatus)}
                          className="text-[10px] py-0.5 px-1.5 rounded border border-[#BCC8D4] bg-white font-medium text-[#1C2833] focus:outline-none focus:ring-1 focus:ring-[#0A6ED1] cursor-pointer"
                        >
                          <option value="waiting">Waiting</option>
                          <option value="called">Called</option>
                          <option value="under_loading">Under Loading</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      )}
                    </div>
                  </td>

                  {/* Loading Slip details */}
                  <td className="py-3 px-3">
                    {slip || t.delNoteNumber ? (
                      <div className="space-y-0.5">
                        <span className="font-bold text-[#1C2833] text-[11px] block font-mono">
                          {slip?.delNoteNumber || t.delNoteNumber}
                        </span>
                        {slip && (slip.totalQty > 0 || slip.totalPallets > 0) ? (
                          <div className="text-[10px] flex gap-1.5 font-medium tabular-nums">
                            <span className="bg-[#EBF5FF] text-[#0854A0] border border-[#B8DCFF] px-1.5 rounded font-bold">
                              {slip.totalQty} Qty
                            </span>
                            <span className="bg-[#FEF7F1] text-[#A64B00] border border-[#F9C99B] px-1.5 rounded font-bold">
                              {slip.totalPallets} Pallets
                            </span>
                            <span className="bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4] px-1.5 rounded font-bold">
                              {slip.totalLooseRolls} Loose
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[#0A6ED1] font-semibold block">DN Assigned</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#7A8FA3] italic">No slip created</span>
                    )}
                  </td>

                  {/* Time */}
                  <td className="py-3 px-3 text-[11px] tabular-nums">
                    <div className="text-[#475E75]">
                      <span className="font-semibold text-[#1C2833]">In:</span> {t.timeIn}
                    </div>
                    {t.status === 'waiting' && t.createdAt && !t.manualStatusOverride && !t.autoUnderLoadingApplied && (() => {
                      const targetAt = t.autoUnderLoadingAt || (t.createdAt + (t.autoLoadingMinutes || 30) * 60 * 1000);
                      const remainingMin = Math.max(0, Math.ceil((targetAt - nowMs) / 60000));
                      return (
                        <div className="text-[10px] text-[#C25900] font-semibold mt-0.5">
                          {remainingMin > 0 ? `Auto Loading in ${remainingMin}m` : 'Auto Loading soon...'}
                        </div>
                      );
                    })()}
                    {t.timeLoadingStarted && (
                      <div className="text-[#C25900] font-semibold mt-0.5">
                        <span>Load:</span> {t.timeLoadingStarted}
                        {t.autoUnderLoadingApplied && !t.manualStatusOverride && (
                          <span className="ml-1 text-[9.5px] bg-[#FEF7F1] text-[#A64B00] border border-[#F9C99B] px-1 rounded font-bold">
                            Auto
                          </span>
                        )}
                      </div>
                    )}
                    {t.timeCompleted && (
                      <div className="text-[#107E3E] font-bold mt-0.5">
                        <span>Done:</span> {t.timeCompleted}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-3 text-center">
                    <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-center gap-1.5 sm:flex-wrap">
                      {/* WhatsApp Button */}
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(t)}
                        className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white shadow-xs"
                        title="Send WhatsApp Alert to Driver"
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                        <span>WhatsApp</span>
                      </button>

                      {/* Loading Slip Button */}
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => onOpenLoadingSlip(t)}
                          className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow-xs"
                          title="Generate or edit 8-row loading slip"
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span>{slip ? 'Edit Slip' : 'Create Slip'}</span>
                        </button>
                      )}

                      {/* Print 2-Copy A4 Slip */}
                      <button
                        type="button"
                        onClick={() => onPrintLoadingSlip(t)}
                        className="app-btn-sm bg-[#354A5F] hover:bg-[#243647] text-white shadow-xs"
                        title="Print 2-Copy A4 Single Sheet Preview"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                        <span>Print Slip</span>
                      </button>

                      {/* Edit Ticket & Change Gate */}
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => onEditTicket(t)}
                          className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4] shadow-xs"
                          title="Edit Ticket Details & Gate Number"
                        >
                          <Edit2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Edit</span>
                        </button>
                      )}

                      {/* Delete */}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTicket(t.id);
                          }}
                          className="app-btn-sm bg-[#FFF0F0] hover:bg-[#BB0000] text-[#BB0000] hover:text-white border border-[#F4B8B8] hover:border-[#BB0000] shadow-xs"
                          title={`Delete Ticket #${t.sequenceNumber} (${t.truckNumber})`}
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
