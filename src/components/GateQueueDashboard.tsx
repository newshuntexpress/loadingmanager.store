import React, { useState } from 'react';
import { TicketRecord, CompanySettings } from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';
import {
  DoorOpen,
  Truck,
  Clock,
  Play,
  CheckCircle2,
  Megaphone,
  MessageSquare,
  FileText,
  Printer,
  ArrowRight,
  Timer,
  Activity,
  XCircle,
  X,
  MapPin,
  Globe,
  ArrowLeftRight,
} from 'lucide-react';

interface GateQueueDashboardProps {
  tickets: TicketRecord[];
  settings: CompanySettings;
  date: string;
  onCallTruck: (ticket: TicketRecord) => void;
  onStartLoading: (ticket: TicketRecord) => void;
  onCompleteLoading: (ticket: TicketRecord) => void;
  onOpenLoadingSlip: (ticket: TicketRecord) => void;
  onPrintLoadingSlip?: (ticket: TicketRecord) => void;
  onPrintTicket?: (ticket: TicketRecord) => void;
  onOpenWhatsApp: (ticket: TicketRecord, templateId?: string) => void;
  canUpdate?: boolean;
  canPrint?: boolean;
}

function extractNum(val?: string | number | null): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const match = String(val).match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function formatAfterPalletsSummary(slip: NonNullable<TicketRecord['loadingSlip']>): string {
  const items = slip.items || [];
  let looseRolls = 0;
  let cans = 0;
  let drums = 0;
  let boards = 0;
  let otherLoose = 0;

  for (const row of items) {
    const pack = (row.pack || '').trim().toLowerCase();
    const qty = extractNum(row.qty);
    const loose = extractNum(row.looseRolls);

    if (pack === 'can' || pack === 'cans') {
      cans += loose > 0 ? loose : qty;
    } else if (pack === 'drum' || pack === 'drums') {
      drums += loose > 0 ? loose : qty;
    } else if (pack === 'board' || pack === 'boards') {
      boards += loose > 0 ? loose : qty;
    } else if (pack === 'rolls' || pack === 'roll' || pack === '') {
      looseRolls += loose;
    } else {
      otherLoose += loose;
    }
  }

  const parts: string[] = [];
  const hasPackSpecific = cans > 0 || drums > 0 || boards > 0;
  const combinedLooseRolls = looseRolls + otherLoose;

  if (combinedLooseRolls > 0 || !hasPackSpecific) {
    const lr = hasPackSpecific ? combinedLooseRolls : (slip.totalLooseRolls ?? combinedLooseRolls);
    parts.push(`${lr} Loose Rolls`);
  }
  if (cans > 0) parts.push(`${cans} ${cans === 1 ? 'Can' : 'Cans'}`);
  if (drums > 0) parts.push(`${drums} ${drums === 1 ? 'Drum' : 'Drums'}`);
  if (boards > 0) parts.push(`${boards} ${boards === 1 ? 'Board' : 'Boards'}`);

  return parts.join(' | ');
}

function parseClockTimeMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toLowerCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59 || seconds > 59) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'am' && hours === 12) hours = 0;
    else if (meridiem === 'pm' && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + minutes + seconds / 60;
}

function formatDurationMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  if (totalMinutes < 1) {
    const secs = Math.max(1, Math.round(totalMinutes * 60));
    return secs < 60 ? `${secs}s` : '1m';
  }
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) return `${rounded}m`;
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

const GATE_HEADER_GRADIENTS = [
  'from-[#354A5F] to-[#243647]',
  'from-[#0A6ED1] to-[#0854A0]',
  'from-[#244B73] to-[#1A3654]',
  'from-[#1E5968] to-[#143D48]',
  'from-[#2C3E50] to-[#1B2836]',
];

export const GateQueueDashboard: React.FC<GateQueueDashboardProps> = ({
  tickets,
  settings,
  date,
  onCallTruck,
  onStartLoading,
  onCompleteLoading,
  onOpenLoadingSlip,
  onPrintLoadingSlip,
  onPrintTicket,
  onOpenWhatsApp,
  canUpdate = true,
}) => {
  const [showCancelledModal, setShowCancelledModal] = useState(false);
  const [truckBreakdownFilter, setTruckBreakdownFilter] = useState<'all' | 'local' | 'export' | 'sto' | null>(null);

  const dayTickets = tickets.filter((t) => t.date === date);

  const underLoadingCount = dayTickets.filter((t) => t.status === 'under_loading').length;
  const calledCount = dayTickets.filter((t) => t.status === 'called').length;
  const waitingCount = dayTickets.filter((t) => t.status === 'waiting').length;
  const cancelledTickets = dayTickets.filter((t) => t.status === 'cancelled');
  const cancelledCount = cancelledTickets.length;
  const totalActiveTrucks = underLoadingCount + calledCount + waitingCount;

  const loadingScopeTickets = dayTickets.filter((t) => t.status !== 'cancelled');
  const localLoadingTickets = loadingScopeTickets.filter((t) => resolveLoadingType(t) === 'local');
  const exportLoadingTickets = loadingScopeTickets.filter((t) => resolveLoadingType(t) === 'export');
  const stoLoadingTickets = loadingScopeTickets.filter((t) => resolveLoadingType(t) === 'sto');
  const localCompletedCount = localLoadingTickets.filter((t) => t.status === 'completed').length;
  const exportCompletedCount = exportLoadingTickets.filter((t) => t.status === 'completed').length;
  const stoCompletedCount = stoLoadingTickets.filter((t) => t.status === 'completed').length;
  const localActiveCount = localLoadingTickets.length - localCompletedCount;
  const exportActiveCount = exportLoadingTickets.length - exportCompletedCount;
  const stoActiveCount = stoLoadingTickets.length - stoCompletedCount;
  const modalBreakdownTickets =
    truckBreakdownFilter === 'local'
      ? localLoadingTickets
      : truckBreakdownFilter === 'export'
      ? exportLoadingTickets
      : truckBreakdownFilter === 'sto'
      ? stoLoadingTickets
      : loadingScopeTickets;

  const processedTickets = dayTickets.filter((t) => t.status === 'completed');
  const totalProcessedToday = processedTickets.length;
  const completionRate =
    dayTickets.length > 0 ? Math.round((totalProcessedToday / dayTickets.length) * 100) : 0;

  const loadingDurationsMin: number[] = [];
  for (const ticket of processedTickets) {
    const endMin = parseClockTimeMinutes(ticket.timeCompleted);
    if (endMin === null) continue;
    const startMin = parseClockTimeMinutes(ticket.timeLoadingStarted);
    if (startMin !== null && endMin >= startMin) {
      loadingDurationsMin.push(endMin - startMin);
      continue;
    }
    const inMin = parseClockTimeMinutes(ticket.timeIn);
    if (startMin === null && inMin !== null && endMin >= inMin) {
      loadingDurationsMin.push(endMin - inMin);
    }
  }

  const avgLoadingTimeLabel =
    loadingDurationsMin.length > 0
      ? formatDurationMinutes(
          loadingDurationsMin.reduce((sum, d) => sum + d, 0) / loadingDurationsMin.length
        )
      : '—';

  return (
    <div className="space-y-6">
      {/* Live Monitor 3D Summary Panel */}
      <div className="surface-3d rounded-2xl overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-[#0A6ED1] via-[#354A5F] to-[#F0AB00]" />
        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#D9E3EE] gap-4 md:gap-0">
          <div className="flex items-center justify-between md:pr-6 py-1 md:py-0">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-gradient-to-b from-[#FFF3E6] to-[#FDE4C8] text-[#C25900] border border-[#F5B982] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_3px_0_#E3A972]">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#354A5F] uppercase tracking-wide block">
                  Total Active Trucks
                </span>
                <span className="text-xs text-[#5B738B]">
                  {underLoadingCount} loading · {calledCount} called · {waitingCount} waiting
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#C25900] tabular-nums">
              {totalActiveTrucks}
            </span>
          </div>

          <div className="flex items-center justify-between md:px-6 py-1 md:py-0">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-gradient-to-b from-[#EBF5FF] to-[#D4EAFF] text-[#0A6ED1] border border-[#96C8FA] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#85B8EC]">
                <Timer className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#354A5F] uppercase tracking-wide block">
                  Average Loading Time
                </span>
                <span className="text-xs text-[#5B738B]">
                  {loadingDurationsMin.length > 0
                    ? `Across ${loadingDurationsMin.length} timed dispatch${loadingDurationsMin.length === 1 ? '' : 'es'}`
                    : 'No completed timings yet'}
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#0A6ED1] tabular-nums">
              {avgLoadingTimeLabel}
            </span>
          </div>

          <div className="flex items-center justify-between md:pl-6 py-1 md:py-0">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-gradient-to-b from-[#EDFCF3] to-[#D4F6E2] text-[#107E3E] border border-[#8AD9AA] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#76C596]">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#354A5F] uppercase tracking-wide block">
                  Total Trucks Processed Today
                </span>
                <span className="text-xs text-[#5B738B]">
                  {totalProcessedToday} of {dayTickets.length} inward ({completionRate}%)
                  {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#107E3E] tabular-nums">
              {totalProcessedToday}
            </span>
          </div>
        </div>
      </div>

      {/* Spacious 3D KPI Stat Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <div className="surface-3d surface-3d-hover p-5 rounded-2xl flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-extrabold text-[#5B738B] uppercase tracking-wide">
              Total Vehicles Inward
            </span>
            <p className="text-3xl sm:text-4xl font-black text-[#1C2833] tabular-nums mt-1">{dayTickets.length}</p>
          </div>
          <div className="p-3.5 bg-gradient-to-b from-[#435C75] to-[#293B4D] text-[#F0AB00] rounded-xl border border-[#223242] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_0_#1A2632]">
            <Truck className="w-6 h-6" />
          </div>
        </div>

        <div className="surface-3d surface-3d-hover p-5 rounded-2xl !border-[#F5BA83] flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-extrabold text-[#A64B00] uppercase tracking-wide">
              Under Loading
            </span>
            <p className="text-3xl sm:text-4xl font-black text-[#E9730C] tabular-nums mt-1">
              {underLoadingCount}
            </p>
          </div>
          <div className="p-3.5 bg-gradient-to-b from-[#FF9933] to-[#D96300] text-white rounded-xl border border-[#C05400] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_0_#9E4300]">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCancelledModal(true)}
          className="surface-3d surface-3d-hover p-5 rounded-2xl !border-[#F5A8A8] flex items-center justify-between gap-3 text-left w-full cursor-pointer"
          title="View cancelled trucks details"
        >
          <div className="min-w-0">
            <span className="text-xs font-extrabold text-[#9E1C1C] uppercase tracking-wide block">
              Cancelled Trucks
            </span>
            <p className="text-3xl sm:text-4xl font-black text-[#CC1F1F] tabular-nums mt-1">
              {cancelledCount}
            </p>
            <span className="text-[11px] font-semibold text-[#9E1C1C]/80 mt-0.5 block">
              {cancelledCount > 0 ? 'Click to view list →' : 'No cancellations'}
            </span>
          </div>
          <div className="p-3.5 bg-gradient-to-b from-[#EF4444] to-[#B91C1C] text-white rounded-xl border border-[#991B1B] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_0_#7F1D1D] shrink-0">
            <XCircle className="w-6 h-6" />
          </div>
        </button>

        <div className="surface-3d surface-3d-hover p-5 rounded-2xl !border-[#8CD9AB] flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-extrabold text-[#0D6B34] uppercase tracking-wide">
              Completed &amp; Dispatched
            </span>
            <p className="text-3xl sm:text-4xl font-black text-[#107E3E] tabular-nums mt-1">
              {totalProcessedToday}
            </p>
          </div>
          <div className="p-3.5 bg-gradient-to-b from-[#169A4D] to-[#0D6B34] text-white rounded-xl border border-[#0A572A] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_0_#084521]">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Total Number of Truck Loading — Local, Export & STO Summary Panel */}
      <div className="surface-3d rounded-2xl overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-[#107E3E] via-[#4338CA] to-[#D97706]" />
        <div className="px-5 py-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#D9E3EE] gap-3 lg:gap-0">
          <button
            type="button"
            onClick={() => setTruckBreakdownFilter('all')}
            className="flex items-center justify-between lg:pr-5 py-1 lg:py-0 text-left hover:bg-[#F4F8FC] rounded-xl px-2 -mx-2 transition cursor-pointer"
            title="Click to view all loading trucks"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-b from-[#EFF4F9] to-[#DCE6F2] text-[#354A5F] border border-[#BDCAD7] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#A6B8CC]">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#354A5F] uppercase tracking-wide block">
                  Total Truck Loading
                </span>
                <span className="text-xs text-[#5B738B]">
                  {totalActiveTrucks} active · {totalProcessedToday} done
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#1C2833] tabular-nums">
              {loadingScopeTickets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTruckBreakdownFilter('local')}
            className="flex items-center justify-between lg:px-5 py-1 lg:py-0 text-left hover:bg-[#F1FDF6] rounded-xl px-2 -mx-2 lg:mx-0 transition cursor-pointer"
            title="Click to view Local loading trucks"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-b from-[#EDFCF3] to-[#D4F6E2] text-[#107E3E] border border-[#8AD9AA] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#76C596]">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#0D6B34] uppercase tracking-wide block">
                  Local Truck Loading
                </span>
                <span className="text-xs text-[#5B738B]">
                  {localActiveCount} active · {localCompletedCount} done
                  {loadingScopeTickets.length > 0
                    ? ` (${Math.round((localLoadingTickets.length / loadingScopeTickets.length) * 100)}%)`
                    : ''}
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#107E3E] tabular-nums">
              {localLoadingTickets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTruckBreakdownFilter('export')}
            className="flex items-center justify-between lg:px-5 py-1 lg:py-0 text-left hover:bg-[#EEF2FF] rounded-xl px-2 -mx-2 lg:mx-0 transition cursor-pointer"
            title="Click to view Export loading trucks"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-b from-[#EEF2FF] to-[#DDE4FF] text-[#4338CA] border border-[#A5B4FC] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#818CF8]">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#3730A3] uppercase tracking-wide block">
                  Export Truck Loading
                </span>
                <span className="text-xs text-[#5B738B]">
                  {exportActiveCount} active · {exportCompletedCount} done
                  {loadingScopeTickets.length > 0
                    ? ` (${Math.round((exportLoadingTickets.length / loadingScopeTickets.length) * 100)}%)`
                    : ''}
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#4338CA] tabular-nums">
              {exportLoadingTickets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTruckBreakdownFilter('sto')}
            className="flex items-center justify-between lg:pl-5 py-1 lg:py-0 text-left hover:bg-[#FFFBEB] rounded-xl px-2 -mx-2 lg:mx-0 transition cursor-pointer"
            title="Click to view STO loading trucks"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-b from-[#FFFBEB] to-[#FDE68A] text-[#B45309] border border-[#FCD34D] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#F59E0B]">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-[#92400E] uppercase tracking-wide block">
                  STO Truck Loading
                </span>
                <span className="text-xs text-[#5B738B]">
                  {stoActiveCount} active · {stoCompletedCount} done
                  {loadingScopeTickets.length > 0
                    ? ` (${Math.round((stoLoadingTickets.length / loadingScopeTickets.length) * 100)}%)`
                    : ''}
                </span>
              </div>
            </div>
            <span className="text-3xl font-black text-[#B45309] tabular-nums">
              {stoLoadingTickets.length}
            </span>
          </button>
        </div>
      </div>

      {/* Spacious 3D Gate Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {settings.gates.map((gateName, gateIndex) => {
          const normGate = gateName.trim().toUpperCase();
          const gateTickets = dayTickets.filter((t) => (t.gateNumber || '').trim().toUpperCase() === normGate);
          const currentLoading = gateTickets.find((t) => t.status === 'under_loading');
          const calledTruck = gateTickets.find((t) => t.status === 'called');
          const waitingTrucks = gateTickets
            .filter((t) => t.status === 'waiting')
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
          const completedCount = gateTickets.filter((t) => t.status === 'completed').length;
          const gateHeaderGradient = GATE_HEADER_GRADIENTS[gateIndex % GATE_HEADER_GRADIENTS.length];

          return (
            <div
              key={gateName}
              className="surface-3d surface-3d-hover rounded-2xl overflow-hidden flex flex-col justify-between"
            >
              {/* 3D Metallic Gate Header */}
              <div className={`bg-gradient-to-b ${gateHeaderGradient} text-white p-4 flex items-center justify-between border-b-2 border-[#1A2633] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]`}>
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-white/15 rounded-xl border border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_0_rgba(0,0,0,0.28)]">
                    <DoorOpen className="w-5 h-5 text-[#F0AB00]" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg tracking-wide leading-tight">{gateName}</h3>
                    <p className="text-xs text-[#DCE7F2]">
                      {currentLoading ? 'Active (Loading)' : 'Empty (Available)'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#B8CAE0] block">Today Done</span>
                  <span className="text-sm font-black text-[#7EE2A8] tabular-nums">{completedCount} Dispatched</span>
                </div>
              </div>

              {/* Body */}
              <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
                {/* 1. CURRENT UNDER LOADING TRUCK */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase text-[#C25900] tracking-wider flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-[#E9730C]" />
                      Under Loading
                    </span>
                    {currentLoading && (
                      <span className="text-[11px] font-semibold text-[#5B738B] tabular-nums">
                        Started: {currentLoading.timeLoadingStarted || currentLoading.timeIn}
                      </span>
                    )}
                  </div>

                  {currentLoading ? (
                    <div className="bg-gradient-to-b from-[#FFF9F3] to-[#FEF2E6] border border-[#F3B780] rounded-xl p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_0_#E5AA74,0_6px_14px_-4px_rgba(233,115,12,0.16)]">
                      <div className="flex justify-between items-start mb-1.5 gap-2">
                        <div>
                          <p className="text-lg font-black text-[#1C2833] tracking-wide">
                            {currentLoading.truckNumber}
                          </p>
                          <p className="text-xs font-semibold text-[#354A5F]">
                            {currentLoading.driverName} ({formatSaudiPhoneNumber(currentLoading.driverPhone)})
                          </p>
                        </div>
                        <span className="text-[11px] font-black bg-[#F0AB00]/25 text-[#7A3800] border border-[#F0AB00]/55 px-2 py-0.5 rounded-md tabular-nums shrink-0">
                          {currentLoading.ticketNumber}
                        </span>
                      </div>

                      <div className="text-xs text-[#475E75] mb-3">
                        <span className="font-semibold text-[#1C2833]">Destination:</span> {currentLoading.destinationPlace || 'N/A'}
                        {currentLoading.loadingSlip ? (
                          <span className="text-[#107E3E] font-bold block mt-1">
                            ✓ Slip Prepared ({currentLoading.loadingSlip.totalQty} Qty | {currentLoading.loadingSlip.totalPallets} Pallets | {formatAfterPalletsSummary(currentLoading.loadingSlip)})
                          </span>
                        ) : (
                          <span className="text-[#BB0000] font-semibold block mt-1">! Slip pending</span>
                        )}
                      </div>

                      {/* Action buttons */}
                      {(canUpdate || Boolean(onPrintLoadingSlip) || Boolean(onPrintTicket)) && (
                        <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-[#F3B780]/70">
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => onOpenLoadingSlip(currentLoading)}
                              className="app-btn-sm w-full bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
                            >
                              <FileText className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
                              <span>Edit Slip</span>
                            </button>
                          )}
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => onCompleteLoading(currentLoading)}
                              className="app-btn-sm w-full bg-[#107E3E] hover:bg-[#0D6B34] text-white border border-[#0A572A]"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Complete</span>
                            </button>
                          )}
                          {onPrintLoadingSlip && (
                            <button
                              type="button"
                              onClick={() => onPrintLoadingSlip(currentLoading)}
                              className={`app-btn-sm ${onPrintTicket ? 'w-full' : 'col-span-2 w-full'} bg-[#354A5F] hover:bg-[#243647] text-white`}
                            >
                              <Printer className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                              <span>Print Slip</span>
                            </button>
                          )}
                          {onPrintTicket && (
                            <button
                              type="button"
                              onClick={() => onPrintTicket(currentLoading)}
                              className={`app-btn-sm ${onPrintLoadingSlip ? 'w-full' : 'col-span-2 w-full'} bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]`}
                              title="Print Gate Token"
                            >
                              <Printer className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
                              <span>Print Token</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="inset-3d bg-[#F2F6FA] border border-dashed border-[#BDCAD7] rounded-xl p-4 text-center text-xs font-medium text-[#5B738B]">
                      No vehicle currently under loading at this gate.
                    </div>
                  )}
                </div>

                {/* 2. CALLED TO GATE (NEXT IN QUEUE) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase text-[#0A6ED1] tracking-wider flex items-center gap-1.5">
                      <Megaphone className="w-4 h-4" />
                      Next In Queue (Called)
                    </span>
                  </div>

                  {calledTruck ? (
                    <div className="bg-gradient-to-b from-[#F4F9FF] to-[#E5F1FF] border border-[#96C7FA] rounded-xl p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_0_#88B9EC]">
                      <div className="flex justify-between items-start mb-1.5 gap-2">
                        <div>
                          <p className="text-base font-black text-[#1C2833]">{calledTruck.truckNumber}</p>
                          <p className="text-xs text-[#354A5F] font-medium">
                            {calledTruck.driverName} ({formatSaudiPhoneNumber(calledTruck.driverPhone)})
                          </p>
                        </div>
                        <span className="text-[11px] font-extrabold bg-[#0A6ED1] text-white px-2 py-0.5 rounded-md shadow-[0_2px_0_#064B8F]">
                          At Gate
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        {canUpdate && (
                          <button
                            type="button"
                            onClick={() => onStartLoading(calledTruck)}
                            className="app-btn-sm flex-1 bg-[#0A6ED1] hover:bg-[#085CAF] text-white border border-[#064B8F]"
                          >
                            <Play className="w-3.5 h-3.5 shrink-0" />
                            <span>Start Loading</span>
                          </button>
                        )}
                        {onPrintTicket && (
                          <button
                            type="button"
                            onClick={() => onPrintTicket(calledTruck)}
                            className="app-btn-sm !px-2.5 bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
                            title="Print Gate Token"
                          >
                            <Printer className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
                          </button>
                        )}
                        {onPrintLoadingSlip && (
                          <button
                            type="button"
                            onClick={() => onPrintLoadingSlip(calledTruck)}
                            className="app-btn-sm !px-2.5 bg-[#354A5F] hover:bg-[#243647] text-white"
                            title="Print Loading Slip"
                          >
                            <Printer className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenWhatsApp(calledTruck, 'gate_call')}
                          className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white border border-[#0A572A]"
                          title="WhatsApp Reminder"
                        >
                          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                          <span>Alert</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="inset-3d bg-[#F2F6FA] border border-[#DCE5EE] rounded-xl p-3 text-center text-xs text-[#7A8FA3]">
                      No vehicle called to this gate
                    </div>
                  )}
                </div>

                {/* 3. WAITING QUEUE */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-extrabold uppercase text-[#5B738B]">
                      Waiting Queue ({waitingTrucks.length} Trucks)
                    </span>
                  </div>

                  {waitingTrucks.length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {waitingTrucks.map((truck, idx) => (
                        <div
                          key={truck.id}
                          className="bg-gradient-to-b from-white to-[#F3F7FB] hover:from-[#F7FAFF] hover:to-[#EBF3FC] border border-[#CBD8E6] rounded-xl p-2.5 flex items-center justify-between text-xs transition shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_0_#C2D0DF]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-gradient-to-b from-[#455E77] to-[#28394A] text-white font-black text-[11px] flex items-center justify-center tabular-nums shrink-0 shadow-[0_2px_0_#192531]">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="font-black text-[#1C2833] text-xs">{truck.truckNumber}</p>
                              <p className="text-[11px] text-[#5B738B] truncate max-w-[110px]">{truck.driverName}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {onPrintTicket && (
                              <button
                                type="button"
                                onClick={() => onPrintTicket(truck)}
                                className="app-btn-sm !px-2 bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#CBD8E6]"
                                title="Print Gate Token"
                              >
                                <Printer className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenWhatsApp(truck, 'gate_call')}
                              className="app-btn-sm !px-2 bg-[#F1FDF6] hover:bg-[#E0F9EA] text-[#107E3E] border border-[#ABE2C2]"
                              title="Send WhatsApp Alert"
                            >
                              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                            </button>
                            {canUpdate && (
                              <button
                                type="button"
                                onClick={() => onCallTruck(truck)}
                                className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white border border-[#064B8F]"
                              >
                                <span>Call</span>
                                <ArrowRight className="w-3 h-3 shrink-0" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#7A8FA3] italic text-center py-1.5">Queue is empty</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancelled Trucks Detail Modal */}
      {showCancelledModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="surface-3d bg-white rounded-2xl w-full max-w-2xl overflow-hidden border border-[#E5B8B8]">
            <div className="bg-gradient-to-b from-[#991B1B] to-[#7F1D1D] text-white px-5 py-4 flex items-center justify-between border-b border-[#5C1212]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/15 rounded-xl border border-white/25">
                  <XCircle className="w-5 h-5 text-red-100" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-wide">
                    Cancelled Trucks ({cancelledCount})
                  </h3>
                  <p className="text-xs text-red-100/90">
                    Vehicles marked as Cancelled on {date}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelledModal(false)}
                className="p-1.5 rounded-lg text-red-100 hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Close cancelled trucks list"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 max-h-[65vh] overflow-y-auto space-y-2.5 bg-[#F8FAFC]">
              {cancelledTickets.length === 0 ? (
                <div className="inset-3d bg-white border border-dashed border-[#CBD8E6] rounded-xl p-8 text-center">
                  <XCircle className="w-8 h-8 text-[#9DB0C3] mx-auto mb-2" />
                  <p className="text-sm font-bold text-[#354A5F]">No Cancelled Trucks</p>
                  <p className="text-xs text-[#5B738B] mt-0.5">
                    0 trucks have been cancelled for {date}.
                  </p>
                </div>
              ) : (
                cancelledTickets.map((t, idx) => (
                  <div
                    key={t.id}
                    className="bg-white border border-[#F2C6C6] rounded-xl p-3.5 shadow-[0_2px_0_#E8D0D0] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-red-100 text-[#9E1C1C] font-black text-[11px] tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="text-base font-black text-[#1C2833] tracking-wide">
                          {t.truckNumber}
                        </span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#EFF4F9] text-[#354A5F] border border-[#CBD8E6]">
                          {t.ticketNumber}
                        </span>
                        {t.delNoteNumber && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                            Del: {t.delNoteNumber}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#475E75] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>
                          <strong className="text-[#1C2833]">Driver:</strong> {t.driverName || '—'} ({formatSaudiPhoneNumber(t.driverPhone) || '—'})
                        </span>
                        <span>
                          <strong className="text-[#1C2833]">Gate:</strong> {t.gateNumber}
                        </span>
                        <span>
                          <strong className="text-[#1C2833]">Place:</strong> {t.destinationPlace || '—'}
                        </span>
                      </div>
                      {t.remarks && (
                        <p className="text-[11px] text-[#9E1C1C] font-medium">
                          Remarks: {t.remarks}
                        </p>
                      )}
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FFF0F0] text-[#BB0000] border border-[#F4B8B8]">
                        Cancelled
                      </span>
                      <p className="text-[11px] text-[#5B738B] mt-1 tabular-nums">
                        In: {t.timeIn || '—'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 bg-white border-t border-[#DCE5EE] flex justify-end">
              <button
                type="button"
                onClick={() => setShowCancelledModal(false)}
                className="app-btn bg-[#354A5F] hover:bg-[#243647] text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local / Export / STO / Total Truck Loading Drilldown Modal */}
      {truckBreakdownFilter && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="surface-3d bg-white rounded-2xl w-full max-w-3xl overflow-hidden border border-[#C6D4E3]">
            <div className="bg-gradient-to-b from-[#354A5F] to-[#243647] text-white px-5 py-4 flex items-center justify-between border-b border-[#1A2633]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/15 rounded-xl border border-white/25">
                  {truckBreakdownFilter === 'export' ? (
                    <Globe className="w-5 h-5 text-[#A5B4FC]" />
                  ) : truckBreakdownFilter === 'sto' ? (
                    <ArrowLeftRight className="w-5 h-5 text-[#FCD34D]" />
                  ) : truckBreakdownFilter === 'local' ? (
                    <MapPin className="w-5 h-5 text-[#68D391]" />
                  ) : (
                    <Truck className="w-5 h-5 text-[#F0AB00]" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black tracking-wide">
                    {truckBreakdownFilter === 'local'
                      ? `Local Truck Loading (${localLoadingTickets.length})`
                      : truckBreakdownFilter === 'export'
                      ? `Export Truck Loading (${exportLoadingTickets.length})`
                      : truckBreakdownFilter === 'sto'
                      ? `STO Truck Loading (${stoLoadingTickets.length})`
                      : `Total Truck Loading (${loadingScopeTickets.length})`}
                  </h3>
                  <p className="text-xs text-[#DCE7F2]">
                    {date} · Local: {localLoadingTickets.length} | Export: {exportLoadingTickets.length} | STO: {stoLoadingTickets.length}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter(null)}
                className="p-1.5 rounded-lg text-[#DCE7F2] hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Close truck loading breakdown"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 pt-3 pb-2 bg-[#EFF4F9] border-b border-[#DCE5EE] flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter('all')}
                className={`app-btn-sm ${
                  truckBreakdownFilter === 'all'
                    ? 'bg-[#354A5F] text-white'
                    : 'bg-white text-[#354A5F] border border-[#BCC8D4]'
                }`}
              >
                All ({loadingScopeTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter('local')}
                className={`app-btn-sm ${
                  truckBreakdownFilter === 'local'
                    ? 'bg-[#107E3E] text-white'
                    : 'bg-white text-[#107E3E] border border-[#ABE2C2]'
                }`}
              >
                Local ({localLoadingTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter('export')}
                className={`app-btn-sm ${
                  truckBreakdownFilter === 'export'
                    ? 'bg-[#4338CA] text-white'
                    : 'bg-white text-[#4338CA] border border-[#C7D2FE]'
                }`}
              >
                Export ({exportLoadingTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter('sto')}
                className={`app-btn-sm ${
                  truckBreakdownFilter === 'sto'
                    ? 'bg-[#D97706] text-white'
                    : 'bg-white text-[#B45309] border border-[#FCD34D]'
                }`}
              >
                STO ({stoLoadingTickets.length})
              </button>
            </div>

            <div className="p-4 sm:p-5 max-h-[62vh] overflow-y-auto space-y-2.5 bg-[#F8FAFC]">
              {modalBreakdownTickets.length === 0 ? (
                <div className="inset-3d bg-white border border-dashed border-[#CBD8E6] rounded-xl p-8 text-center">
                  <Truck className="w-8 h-8 text-[#9DB0C3] mx-auto mb-2" />
                  <p className="text-sm font-bold text-[#354A5F]">No Trucks Found</p>
                  <p className="text-xs text-[#5B738B] mt-0.5">
                    0 {truckBreakdownFilter === 'all' ? '' : `${truckBreakdownFilter} `}trucks recorded for {date}.
                  </p>
                </div>
              ) : (
                modalBreakdownTickets.map((t, idx) => {
                  const lType = resolveLoadingType(t);
                  return (
                    <div
                      key={t.id}
                      className="bg-white border border-[#DCE5EE] rounded-xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-[#EFF4F9] text-[#354A5F] font-black text-[11px] tabular-nums">
                            #{idx + 1}
                          </span>
                          <span className="text-sm font-black text-[#1C2833] tracking-wide">
                            {t.truckNumber}
                          </span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#EBF5FF] text-[#0854A0] border border-[#B8DCFF] font-mono">
                            {t.ticketNumber}
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                              lType === 'export'
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : lType === 'sto'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            {lType === 'export' ? 'Export' : lType === 'sto' ? 'STO' : 'Local'}
                          </span>
                          {t.delNoteNumber && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-mono">
                              DN: {t.delNoteNumber}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#475E75] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>
                            <strong className="text-[#1C2833]">Gate:</strong> {t.gateNumber}
                          </span>
                          <span>
                            <strong className="text-[#1C2833]">Destination:</strong> {t.destinationPlace || '—'}
                          </span>
                          <span>
                            <strong className="text-[#1C2833]">Driver:</strong> {t.driverName || '—'}
                          </span>
                        </div>
                      </div>
                      <div className="text-left sm:text-right shrink-0">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                            t.status === 'completed'
                              ? 'bg-[#F1FDF6] text-[#107E3E] border-[#ABE2C2]'
                              : t.status === 'under_loading'
                              ? 'bg-[#FEF7F1] text-[#A64B00] border-[#F9C99B]'
                              : 'bg-[#EBF5FF] text-[#0854A0] border-[#B8DCFF]'
                          }`}
                        >
                          {t.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                        <p className="text-[11px] text-[#5B738B] mt-1 tabular-nums">
                          {t.timeIn || '—'}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3 bg-white border-t border-[#DCE5EE] flex justify-end">
              <button
                type="button"
                onClick={() => setTruckBreakdownFilter(null)}
                className="app-btn bg-[#354A5F] hover:bg-[#243647] text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
