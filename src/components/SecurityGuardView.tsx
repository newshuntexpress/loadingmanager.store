import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TicketRecord, CompanySettings, TruckStatus } from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';
import { formatDisplayDate, getTodayDateString } from '../services/storage';
import {
  ShieldCheck,
  DoorOpen,
  Truck,
  Play,
  Megaphone,
  Clock,
  CheckCircle2,
  Search,
  RefreshCw,
  Maximize2,
  Minimize2,
  MapPin,
  Globe,
  Calendar,
  Phone,
  FileText,
  X,
  Lock,
  ArrowUpDown,
  AlertTriangle,
  ArrowLeftRight,
} from 'lucide-react';

interface SecurityGuardViewProps {
  tickets: TicketRecord[];
  settings: CompanySettings;
  selectedDate: string;
  onDateChange?: (nextDate: string) => void;
  onRefresh: () => void;
  isRestrictedGuard?: boolean;
}

type StatusScopeFilter = 'ACTIVE' | 'ALL' | 'under_loading' | 'called' | 'waiting' | 'completed';
type GuardLanguage = 'en' | 'ar';

const GUARD_LANG_STORAGE_KEY = 'gp_guard_lang';

const GUARD_TEXT = {
  en: {
    title: 'Security Guard — Gate Truck Allotment Monitor',
    liveBadge: 'LIVE (10s)',
    readOnlyBadge: 'Read-Only Checkpost',
    subtitlePrefix: 'Live gate-wise count & truck list allotted for loading',
    selectDateAria: 'Select Guard Monitor Date',
    today: 'Today',
    refresh: 'Refresh',
    refreshTitle: 'Refresh Gate Allotment Now',
    fullscreenOpen: 'Full-Screen Booth',
    fullscreenExit: 'Exit Fullscreen',
    fullscreenOpenTitle: 'Open Full-Screen Gate Booth Display',
    fullscreenExitTitle: 'Exit Full-Screen Gate Display',
    langSwitchAria: 'Security Guard Display Language',
    kpiActiveTitle: 'Active Allotted',
    kpiActiveSub: 'Loading + Called + Waiting',
    kpiLoadingTitle: 'Under Loading',
    kpiLoadingSub: 'Currently Inside Gates',
    kpiCalledTitle: 'Called to Gate',
    kpiCalledSub: 'Entry Clearance Given',
    kpiWaitingTitle: 'Waiting Queue',
    kpiWaitingSub: 'Waiting Outside Gate',
    kpiCompletedTitle: 'Completed Today',
    kpiCompletedSub: 'Total Day Allotted:',
    gateGlanceTitle: 'Gate-Wise Allotment Count (Click a Gate to Focus)',
    showAllGates: 'Show All Gates',
    allottedOne: '1 Truck Allotted',
    allottedMany: (n: number) => `${n} Trucks Allotted`,
    shortLoad: 'Load',
    shortCall: 'Call',
    shortWait: 'Wait',
    shortDone: 'Done',
    urgentLabel: 'Urgent',
    searchPlaceholder: 'Search Truck No., Del Note, Driver, Place...',
    clearSearchTitle: 'Clear search',
    filterGateAria: 'Filter by Gate',
    allGates: 'All Gates',
    filterStatusAria: 'Filter by Allotment Status',
    statusActiveOnly: 'Active Allotted Only (Loading + Called + Waiting)',
    statusAll: 'All Statuses (Incl. Completed)',
    statusUnderLoading: 'Under Loading Only',
    statusCalled: 'Called to Gate Only',
    statusWaiting: 'Waiting in Queue Only',
    statusCompleted: 'Completed Only',
    filterTypeAria: 'Filter by Loading Type',
    typeAll: 'All Types (Local, Export & STO)',
    typeLocal: 'Local Only',
    typeExport: 'Export Only',
    typeSto: 'STO Only',
    autoSortLabel: 'Auto-Sort: Gate Priority (Urgent First) → Arrival Time',
    autoSortTitle:
      'Each gate queue automatically places Urgent Gate Priority trucks first, then orders by earliest Arrival Time',
    gateStateLoading: 'LOADING ACTIVE',
    gateStateCalled: 'TRUCK CALLED',
    gateStateWaiting: 'QUEUE WAITING',
    gateStateClear: 'GATE CLEAR',
    detailLoading: 'Loading',
    detailCalled: 'Called',
    detailWaiting: 'Waiting',
    detailDone: 'Done',
    allottedActive: 'Allotted Active',
    emptyNoTrucks: (gateName: string, dateStr: string) =>
      `No trucks allotted to ${gateName} on ${dateStr}.`,
    emptyFiltered: (gateName: string) =>
      `No trucks match the active filter for ${gateName}.`,
    completedCountNote: (n: number) =>
      `${n} truck${n === 1 ? '' : 's'} already completed loading today.`,
    queuePosTitle: 'Gate Queue Position',
    priorityUrgent: 'URGENT PRIORITY',
    priorityNormal: 'NORMAL PRIORITY',
    exportType: 'EXPORT',
    localType: 'LOCAL',
    stoType: 'STO',
    delNoteLabel: 'Del Note:',
    placeLabel: 'Place:',
    driverLabel: 'Driver:',
    arrivalTimeLabel: 'Arrival Time:',
    calledTimeLabel: 'Called:',
    loadingStartedLabel: 'Loading Started:',
    completedTimeLabel: 'Completed:',
    statusLabels: {
      under_loading: 'UNDER LOADING',
      called: 'CALLED TO GATE',
      waiting: 'WAITING IN QUEUE',
      completed: 'COMPLETED',
      cancelled: 'CANCELLED',
    } as Record<TruckStatus, string>,
  },
  ar: {
    title: 'حارس الأمن — مراقبة تخصيص الشاحنات للبوابات',
    liveBadge: 'مباشر (10 ث)',
    readOnlyBadge: 'نقطة تفتيش (للقراءة فقط)',
    subtitlePrefix: 'العدد المباشر وقائمة الشاحنات المخصصة للتحميل حسب البوابة',
    selectDateAria: 'اختر تاريخ المراقبة',
    today: 'اليوم',
    refresh: 'تحديث',
    refreshTitle: 'تحديث قائمة البوابات الآن',
    fullscreenOpen: 'شاشة الكابينة الكاملة',
    fullscreenExit: 'إغلاق ملء الشاشة',
    fullscreenOpenTitle: 'فتح عرض كابينة البوابة بملء الشاشة',
    fullscreenExitTitle: 'إغلاق عرض الشاشة الكاملة',
    langSwitchAria: 'لغة عرض شاشة حارس الأمن',
    kpiActiveTitle: 'المخصصة النشطة',
    kpiActiveSub: 'تحميل + استدعاء + انتظار',
    kpiLoadingTitle: 'قيد التحميل',
    kpiLoadingSub: 'داخل البوابات حالياً',
    kpiCalledTitle: 'تم الاستدعاء للبوابة',
    kpiCalledSub: 'تم منح تصريح الدخول',
    kpiWaitingTitle: 'طابور الانتظار',
    kpiWaitingSub: 'بانتظار الدخول خارج البوابة',
    kpiCompletedTitle: 'المكتملة اليوم',
    kpiCompletedSub: 'إجمالي مخصص اليوم:',
    gateGlanceTitle: 'عدد الشاحنات المخصصة لكل بوابة (اضغط على البوابة للتركيز)',
    showAllGates: 'عرض جميع البوابات',
    allottedOne: 'شاحنة واحدة مخصصة',
    allottedMany: (n: number) => `${n} شاحنات مخصصة`,
    shortLoad: 'تحميل',
    shortCall: 'استدعاء',
    shortWait: 'انتظار',
    shortDone: 'مكتمل',
    urgentLabel: 'عاجل',
    searchPlaceholder: 'ابحث برقم الشاحنة، إشعار التسليم، السائق، الوجهة...',
    clearSearchTitle: 'مسح البحث',
    filterGateAria: 'تصفية حسب البوابة',
    allGates: 'جميع البوابات',
    filterStatusAria: 'تصفية حسب حالة التخصيص',
    statusActiveOnly: 'المخصصة النشطة فقط (تحميل + استدعاء + انتظار)',
    statusAll: 'جميع الحالات (شاملة المكتملة)',
    statusUnderLoading: 'قيد التحميل فقط',
    statusCalled: 'تم الاستدعاء للبوابة فقط',
    statusWaiting: 'في طابور الانتظار فقط',
    statusCompleted: 'المكتملة فقط',
    filterTypeAria: 'تصفية حسب نوع التحميل',
    typeAll: 'جميع الأنواع (محلي وتصدير وتحويل مخزني STO)',
    typeLocal: 'محلي فقط',
    typeExport: 'تصدير فقط',
    typeSto: 'تحويل مخزني (STO) فقط',
    autoSortLabel: 'ترتيب تلقائي: الأولوية (العاجل أولاً) ← وقت الوصول',
    autoSortTitle:
      'يتم ترتيب كل بوابة تلقائياً بوضع شاحنات الأولوية العاجلة أولاً ثم حسب أقدم وقت وصول',
    gateStateLoading: 'التحميل نشط',
    gateStateCalled: 'تم استدعاء شاحنة',
    gateStateWaiting: 'طابور انتظار',
    gateStateClear: 'البوابة شاغرة',
    detailLoading: 'تحميل',
    detailCalled: 'استدعاء',
    detailWaiting: 'انتظار',
    detailDone: 'مكتمل',
    allottedActive: 'النشطة المخصصة',
    emptyNoTrucks: (gateName: string, dateStr: string) =>
      `لا توجد شاحنات مخصصة لبوابة ${gateName} بتاريخ ${dateStr}.`,
    emptyFiltered: (gateName: string) =>
      `لا توجد شاحنات مطابقة للفلتر المحدد لبوابة ${gateName}.`,
    completedCountNote: (n: number) =>
      `تم إكمال تحميل ${n} ${n === 1 ? 'شاحنة' : 'شاحنات'} اليوم.`,
    queuePosTitle: 'الترتيب في طابور البوابة',
    priorityUrgent: 'أولوية عاجلة',
    priorityNormal: 'أولوية عادية',
    exportType: 'تصدير',
    localType: 'محلي',
    stoType: 'تحويل مخزني (STO)',
    delNoteLabel: 'رقم التسليم:',
    placeLabel: 'الوجهة:',
    driverLabel: 'السائق:',
    arrivalTimeLabel: 'وقت الوصول:',
    calledTimeLabel: 'وقت الاستدعاء:',
    loadingStartedLabel: 'بدء التحميل:',
    completedTimeLabel: 'وقت الإكمال:',
    statusLabels: {
      under_loading: 'قيد التحميل',
      called: 'تم الاستدعاء للبوابة',
      waiting: 'في طابور الانتظار',
      completed: 'مكتمل',
      cancelled: 'ملغى',
    } as Record<TruckStatus, string>,
  },
} as const;

const STATUS_PRIORITY: Record<TruckStatus, number> = {
  under_loading: 0,
  called: 1,
  waiting: 2,
  completed: 3,
  cancelled: 4,
};

function getQueueBucket(status: TruckStatus): number {
  if (status === 'under_loading' || status === 'called' || status === 'waiting') return 0;
  if (status === 'completed') return 1;
  return 2;
}

export function parseArrivalTimeSeconds(timeStr?: string): number | null {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toUpperCase();

  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'AM') {
      hours = hours === 12 ? 0 : hours;
    } else if (meridiem === 'PM') {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function compareGateTrucks(a: TicketRecord, b: TicketRecord): number {
  // 1. Keep active queue entries ahead of completed / cancelled history
  const bucketDiff = getQueueBucket(a.status) - getQueueBucket(b.status);
  if (bucketDiff !== 0) return bucketDiff;

  // 2. Gate Priority: Urgent trucks always come at the top of each gate's queue
  const gatePrioA = a.priority === 'urgent' ? 0 : 1;
  const gatePrioB = b.priority === 'urgent' ? 0 : 1;
  if (gatePrioA !== gatePrioB) return gatePrioA - gatePrioB;

  // 3. Arrival Time: Earliest Arrival Time (timeIn) first, fallback to createdAt
  const arrivalA = parseArrivalTimeSeconds(a.timeIn);
  const arrivalB = parseArrivalTimeSeconds(b.timeIn);
  if (arrivalA !== null && arrivalB !== null) {
    if (arrivalA !== arrivalB) return arrivalA - arrivalB;
  } else if (arrivalA !== null || arrivalB !== null) {
    const createdDiff = (a.createdAt || 0) - (b.createdAt || 0);
    if (createdDiff !== 0) return createdDiff;
    return arrivalA !== null ? -1 : 1;
  }

  const createdDiff = (a.createdAt || 0) - (b.createdAt || 0);
  if (createdDiff !== 0) return createdDiff;

  // 4. Operational status & sequence tie-breakers
  const statusDiff = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9);
  if (statusDiff !== 0) return statusDiff;
  const gSeqDiff = (a.gateSequenceNumber || 9999) - (b.gateSequenceNumber || 9999);
  if (gSeqDiff !== 0) return gSeqDiff;
  return (a.sequenceNumber || 9999) - (b.sequenceNumber || 9999);
}

function getStatusBadgeInfo(
  status: TruckStatus,
  lang: GuardLanguage
): {
  label: string;
  badgeClass: string;
  rowAccentClass: string;
  dotClass: string;
} {
  const label = GUARD_TEXT[lang].statusLabels[status] || GUARD_TEXT[lang].statusLabels.cancelled;
  switch (status) {
    case 'under_loading':
      return {
        label,
        badgeClass: 'bg-[#FFF3E8] text-[#B45309] border-[#F5B076]',
        rowAccentClass: 'border-s-4 border-s-[#E9730C] bg-[#FFFDF9]',
        dotClass: 'bg-[#E9730C] animate-pulse',
      };
    case 'called':
      return {
        label,
        badgeClass: 'bg-[#EBF5FF] text-[#085CAF] border-[#93C5FD]',
        rowAccentClass: 'border-s-4 border-s-[#0A6ED1] bg-[#F8FBFF]',
        dotClass: 'bg-[#0A6ED1] animate-pulse',
      };
    case 'waiting':
      return {
        label,
        badgeClass: 'bg-[#FEF9E7] text-[#854D0E] border-[#F3CC60]',
        rowAccentClass: 'border-s-4 border-s-[#F0AB00] bg-white',
        dotClass: 'bg-[#F0AB00]',
      };
    case 'completed':
      return {
        label,
        badgeClass: 'bg-[#EBFBF2] text-[#0D6B34] border-[#8AD8AA]',
        rowAccentClass: 'border-s-4 border-s-[#107E3E] bg-[#F7FDF9]',
        dotClass: 'bg-[#107E3E]',
      };
    default:
      return {
        label,
        badgeClass: 'bg-[#FFF0F0] text-[#BB0000] border-[#F4B8B8]',
        rowAccentClass: 'border-s-4 border-s-[#BB0000] bg-[#FFF9F9] opacity-75',
        dotClass: 'bg-[#BB0000]',
      };
  }
}

export const SecurityGuardView: React.FC<SecurityGuardViewProps> = ({
  tickets,
  settings,
  selectedDate,
  onDateChange,
  onRefresh,
  isRestrictedGuard = false,
}) => {
  const [lang, setLang] = useState<GuardLanguage>(() => {
    try {
      const saved = localStorage.getItem(GUARD_LANG_STORAGE_KEY);
      return saved === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const [selectedGate, setSelectedGate] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusScopeFilter>('ACTIVE');
  const [loadingTypeFilter, setLoadingTypeFilter] = useState<'ALL' | 'local' | 'export' | 'sto'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreenBooth, setIsFullscreenBooth] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveClock, setLiveClock] = useState<string>(() =>
    new Date().toLocaleTimeString('en-GB', { hour12: false })
  );
  const t = GUARD_TEXT[lang];
  const isAr = lang === 'ar';

  const handleLanguageChange = (nextLang: GuardLanguage) => {
    setLang(nextLang);
    try {
      localStorage.setItem(GUARD_LANG_STORAGE_KEY, nextLang);
    } catch {
      // Ignore storage write errors
    }
  };

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tick = setInterval(() => {
      setLiveClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreenBooth) {
        // Keep booth mode controllable by button even if native fullscreen exited via ESC
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [isFullscreenBooth]);

  const toggleBoothFullscreen = async () => {
    const next = !isFullscreenBooth;
    setIsFullscreenBooth(next);
    try {
      if (next && containerRef.current && document.fullscreenEnabled && !document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback CSS fixed full-screen mode remains active cleanly
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // All tickets for the active dispatch date (excluding cancelled from allotment totals)
  const dayTickets = useMemo(() => {
    return tickets
      .filter((t) => t.date === selectedDate && t.status !== 'cancelled')
      .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
  }, [tickets, selectedDate]);

  // All gate names: configured gates first, followed by any gate appearing on day tickets
  const allGates = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const g of settings.gates || []) {
      const clean = g.trim();
      if (clean && !seen.has(clean.toUpperCase())) {
        seen.add(clean.toUpperCase());
        ordered.push(clean);
      }
    }
    for (const t of dayTickets) {
      const clean = (t.gateNumber || '').trim();
      if (clean && !seen.has(clean.toUpperCase())) {
        seen.add(clean.toUpperCase());
        ordered.push(clean);
      }
    }
    return ordered;
  }, [settings.gates, dayTickets]);

  // Overall KPI metrics for the day
  const kpi = useMemo(() => {
    let underLoading = 0;
    let called = 0;
    let waiting = 0;
    let completed = 0;
    for (const t of dayTickets) {
      if (t.status === 'under_loading') underLoading++;
      else if (t.status === 'called') called++;
      else if (t.status === 'waiting') waiting++;
      else if (t.status === 'completed') completed++;
    }
    const activeAllotted = underLoading + called + waiting;
    return {
      activeAllotted,
      underLoading,
      called,
      waiting,
      completed,
      totalAllottedToday: activeAllotted + completed,
    };
  }, [dayTickets]);

  // Gate-by-gate allotment stats + filtered display rows
  const gateSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allGates.map((gateName) => {
      const gateKey = gateName.trim().toUpperCase();
      const gateTickets = dayTickets.filter((t) => (t.gateNumber || '').trim().toUpperCase() === gateKey);

      const underLoadingCount = gateTickets.filter((t) => t.status === 'under_loading').length;
      const calledCount = gateTickets.filter((t) => t.status === 'called').length;
      const waitingCount = gateTickets.filter((t) => t.status === 'waiting').length;
      const completedCount = gateTickets.filter((t) => t.status === 'completed').length;
      const urgentActiveCount = gateTickets.filter(
        (t) =>
          t.priority === 'urgent' &&
          (t.status === 'under_loading' || t.status === 'called' || t.status === 'waiting')
      ).length;
      const activeAllottedCount = underLoadingCount + calledCount + waitingCount;
      const totalDayCount = gateTickets.length;

      const filteredRows = gateTickets
        .filter((t) => {
          if (statusFilter === 'ACTIVE') {
            if (t.status !== 'under_loading' && t.status !== 'called' && t.status !== 'waiting') {
              return false;
            }
          } else if (statusFilter !== 'ALL' && t.status !== statusFilter) {
            return false;
          }

          if (loadingTypeFilter !== 'ALL' && resolveLoadingType(t) !== loadingTypeFilter) {
            return false;
          }

          if (q) {
            const matchTruck = (t.truckNumber || '').toLowerCase().includes(q);
            const matchDriver = (t.driverName || '').toLowerCase().includes(q);
            const matchPhone = (t.driverPhone || '').toLowerCase().includes(q);
            const matchTicket = (t.ticketNumber || '').toLowerCase().includes(q);
            const matchDelNote = (t.delNoteNumber || t.loadingSlip?.delNoteNumber || '').toLowerCase().includes(q);
            const matchDest = (t.destinationPlace || '').toLowerCase().includes(q);
            if (!matchTruck && !matchDriver && !matchPhone && !matchTicket && !matchDelNote && !matchDest) {
              return false;
            }
          }
          return true;
        })
        .sort(compareGateTrucks);

      return {
        gateName,
        underLoadingCount,
        calledCount,
        waitingCount,
        completedCount,
        urgentActiveCount,
        activeAllottedCount,
        totalDayCount,
        filteredRows,
      };
    });
  }, [allGates, dayTickets, statusFilter, loadingTypeFilter, searchQuery]);

  const visibleGates = useMemo(() => {
    if (selectedGate === 'ALL') return gateSummaries;
    return gateSummaries.filter((g) => g.gateName.toUpperCase() === selectedGate.toUpperCase());
  }, [gateSummaries, selectedGate]);

  return (
    <div
      ref={containerRef}
      dir={isAr ? 'rtl' : 'ltr'}
      lang={lang}
      className={
        isFullscreenBooth
          ? 'fixed inset-0 z-50 bg-[#EEF3F8] overflow-y-auto p-4 sm:p-6 space-y-4'
          : 'space-y-4'
      }
    >
      {/* Top Security Guard Command Banner */}
      <div className="surface-3d rounded-2xl overflow-hidden border border-[#C6D4E3]">
        <div className="bg-gradient-to-r from-[#1E2E3E] via-[#263748] to-[#1A4369] text-white px-4 sm:px-5 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F0AB00] to-[#C88800] text-[#1C2833] flex items-center justify-center shrink-0 shadow-[0_2px_0_#785000]">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-wide text-white">
                  {t.title}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#107E3E]/30 text-[#86EFAC] border border-[#24A159]/60 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
                  <span>{t.liveBadge}</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/10 text-[#E2E8F0] border border-white/20 whitespace-nowrap">
                  <Lock className="w-3 h-3 text-[#F0AB00]" />
                  <span>{t.readOnlyBadge}</span>
                </span>
              </div>
              <p className="text-xs text-[#CBD8E6] mt-0.5">
                {t.subtitlePrefix} • {settings.companyName}
              </p>
            </div>
          </div>

          {/* Right Controls: Language Switch, Live Clock, Date Switcher, Refresh, Fullscreen */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Arabic / English Switch */}
            <div
              role="group"
              aria-label={t.langSwitchAria}
              className="inline-flex items-center h-9 p-0.5 bg-[#152230] border border-[#3E5873] rounded-lg shrink-0"
            >
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                aria-pressed={lang === 'en'}
                className={`h-full px-2.5 rounded-md text-xs font-extrabold transition cursor-pointer whitespace-nowrap ${
                  lang === 'en'
                    ? 'bg-[#F0AB00] text-[#1C2833] shadow-xs'
                    : 'text-[#CBD8E6] hover:text-white'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('ar')}
                aria-pressed={lang === 'ar'}
                className={`h-full px-2.5 rounded-md text-xs font-extrabold transition cursor-pointer whitespace-nowrap ${
                  lang === 'ar'
                    ? 'bg-[#F0AB00] text-[#1C2833] shadow-xs'
                    : 'text-[#CBD8E6] hover:text-white'
                }`}
              >
                العربية
              </button>
            </div>

            <div
              dir="ltr"
              className="flex items-center gap-1.5 bg-[#152230] border border-[#3E5873] rounded-lg px-2.5 h-9 text-xs font-mono font-black text-[#F0AB00] tabular-nums"
            >
              <Clock className="w-3.5 h-3.5 text-[#68AEFF]" />
              <span>{liveClock}</span>
            </div>

            {(isRestrictedGuard || isFullscreenBooth) && onDateChange ? (
              <div className="relative inline-flex items-center h-9 bg-[#2B3E50] hover:bg-[#3A526A] rounded-lg border border-[#4F6B88] px-2.5 gap-1.5 transition">
                <Calendar className="w-3.5 h-3.5 text-[#F0AB00] pointer-events-none shrink-0" />
                <span dir="ltr" className="text-xs font-black text-white font-mono pointer-events-none tabular-nums">
                  {formatDisplayDate(selectedDate)}
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) onDateChange(e.target.value);
                  }}
                  aria-label={t.selectDateAria}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                {selectedDate !== getTodayDateString() && (
                  <button
                    type="button"
                    onClick={() => onDateChange(getTodayDateString())}
                    className="relative z-10 px-1.5 py-0.5 text-[10px] bg-[#0A6ED1] hover:bg-[#085CAF] text-white rounded font-bold cursor-pointer whitespace-nowrap"
                  >
                    {t.today}
                  </button>
                )}
              </div>
            ) : (
              <div className="inline-flex items-center h-9 bg-[#1B2A38] border border-[#45607A] rounded-lg px-2.5 gap-1.5 text-xs font-bold text-[#E2E8F0]">
                <Calendar className="w-3.5 h-3.5 text-[#F0AB00]" />
                <span dir="ltr" className="tabular-nums">{formatDisplayDate(selectedDate)}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleManualRefresh}
              className="app-btn-sm !h-9 bg-[#2B3E50] hover:bg-[#3A526A] text-white border border-[#4F6B88] whitespace-nowrap shrink-0"
              title={t.refreshTitle}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#F0AB00] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{t.refresh}</span>
            </button>

            <button
              type="button"
              onClick={toggleBoothFullscreen}
              className={`app-btn-sm !h-9 border font-bold whitespace-nowrap shrink-0 ${
                isFullscreenBooth
                  ? 'bg-[#BB0000] hover:bg-[#9E0000] text-white border-[#E04F4F]'
                  : 'bg-[#0A6ED1] hover:bg-[#085CAF] text-white border-[#3B93EE]'
              }`}
              title={isFullscreenBooth ? t.fullscreenExitTitle : t.fullscreenOpenTitle}
            >
              {isFullscreenBooth ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>{t.fullscreenExit}</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>{t.fullscreenOpen}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="p-3 sm:p-4 bg-[#F7FAFD] border-b border-[#D8E2EC] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="surface-3d bg-white rounded-xl p-3 border border-[#B8DCFF]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wide text-[#085CAF]">
                {t.kpiActiveTitle}
              </span>
              <Truck className="w-4 h-4 text-[#0A6ED1]" />
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#085CAF] tabular-nums mt-1">
              {kpi.activeAllotted}
            </p>
            <p className="text-[10.5px] font-semibold text-[#5B738B]">
              {t.kpiActiveSub}
            </p>
          </div>

          <div className="surface-3d bg-white rounded-xl p-3 border border-[#F5B076]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wide text-[#B45309]">
                {t.kpiLoadingTitle}
              </span>
              <Play className="w-4 h-4 text-[#E9730C]" />
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#B45309] tabular-nums mt-1">
              {kpi.underLoading}
            </p>
            <p className="text-[10.5px] font-semibold text-[#5B738B]">
              {t.kpiLoadingSub}
            </p>
          </div>

          <div className="surface-3d bg-white rounded-xl p-3 border border-[#93C5FD]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wide text-[#0A6ED1]">
                {t.kpiCalledTitle}
              </span>
              <Megaphone className="w-4 h-4 text-[#0A6ED1]" />
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#0A6ED1] tabular-nums mt-1">
              {kpi.called}
            </p>
            <p className="text-[10.5px] font-semibold text-[#5B738B]">
              {t.kpiCalledSub}
            </p>
          </div>

          <div className="surface-3d bg-white rounded-xl p-3 border border-[#F3CC60]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wide text-[#854D0E]">
                {t.kpiWaitingTitle}
              </span>
              <Clock className="w-4 h-4 text-[#D97706]" />
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#854D0E] tabular-nums mt-1">
              {kpi.waiting}
            </p>
            <p className="text-[10.5px] font-semibold text-[#5B738B]">
              {t.kpiWaitingSub}
            </p>
          </div>

          <div className="surface-3d bg-white rounded-xl p-3 border border-[#8AD8AA] col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wide text-[#107E3E]">
                {t.kpiCompletedTitle}
              </span>
              <CheckCircle2 className="w-4 h-4 text-[#107E3E]" />
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#107E3E] tabular-nums mt-1">
              {kpi.completed}
            </p>
            <p className="text-[10.5px] font-semibold text-[#5B738B] tabular-nums">
              {t.kpiCompletedSub} {kpi.totalAllottedToday}
            </p>
          </div>
        </div>

        {/* Gate-by-Gate Allotment Quick Glance Bar */}
        <div className="p-3 sm:p-4 bg-white border-b border-[#D8E2EC] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black tracking-wider text-[#354A5F] flex items-center gap-1.5">
              <DoorOpen className="w-4 h-4 text-[#0A6ED1]" />
              <span>{t.gateGlanceTitle}</span>
            </p>
            {selectedGate !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedGate('ALL')}
                className="text-xs font-bold text-[#0A6ED1] hover:underline cursor-pointer"
              >
                {t.showAllGates} ({allGates.length})
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
            {gateSummaries.map((g) => {
              const isSelected = selectedGate.toUpperCase() === g.gateName.toUpperCase();
              const hasActive = g.activeAllottedCount > 0;
              return (
                <button
                  key={g.gateName}
                  type="button"
                  onClick={() => setSelectedGate(isSelected ? 'ALL' : g.gateName)}
                  className={`text-start rounded-xl p-3 border transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#0A6ED1] text-white border-[#004C97] shadow-md ring-2 ring-[#68AEFF]'
                      : hasActive
                      ? 'bg-[#F4F8FC] hover:bg-[#EBF3FB] text-[#1C2833] border-[#B8D0E8]'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-[#4A6075] border-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-black tracking-wide truncate">
                      {g.gateName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs font-black tabular-nums ${
                        isSelected
                          ? 'bg-white text-[#0A6ED1]'
                          : hasActive
                          ? 'bg-[#0A6ED1] text-white'
                          : 'bg-neutral-200 text-neutral-600'
                      }`}
                    >
                      {g.activeAllottedCount}
                    </span>
                  </div>
                  <p
                    className={`text-[11px] font-bold mt-1 ${
                      isSelected ? 'text-[#DCEEFF]' : 'text-[#354A5F]'
                    }`}
                  >
                    {g.activeAllottedCount === 1
                      ? t.allottedOne
                      : t.allottedMany(g.activeAllottedCount)}
                  </p>
                  <div
                    className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold mt-1.5 tabular-nums ${
                      isSelected ? 'text-white/90' : 'text-[#5B738B]'
                    }`}
                  >
                    <span>{t.shortLoad}: {g.underLoadingCount}</span>
                    <span>•</span>
                    <span>{t.shortCall}: {g.calledCount}</span>
                    <span>•</span>
                    <span>{t.shortWait}: {g.waitingCount}</span>
                    <span>•</span>
                    <span>{t.shortDone}: {g.completedCount}</span>
                    {g.urgentActiveCount > 0 && (
                      <span
                        className={`ms-auto px-1.5 py-0.5 rounded text-[9px] font-black ${
                          isSelected
                            ? 'bg-[#BB0000] text-white'
                            : 'bg-[#FEE2E2] text-[#991B1B] border border-[#FCA5A5]'
                        }`}
                      >
                        {t.urgentLabel}: {g.urgentActiveCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="p-3 sm:px-4 bg-[#F0F4F8] flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] sm:max-w-xs">
            <Search className="w-3.5 h-3.5 absolute start-3 top-2.5 text-[#5B738B] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="inset-3d w-full h-9 ps-8.5 pe-8 text-xs rounded-lg border border-[#C2D0DF] bg-white text-[#1C2833] font-medium focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute end-2 top-2 text-[#5B738B] hover:text-[#1C2833] cursor-pointer"
                title={t.clearSearchTitle}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={selectedGate}
            onChange={(e) => setSelectedGate(e.target.value)}
            aria-label={t.filterGateAria}
            className="inset-3d h-9 px-2.5 rounded-lg border border-[#C2D0DF] bg-white text-xs font-bold text-[#1C2833] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
          >
            <option value="ALL">
              {t.allGates} ({allGates.length})
            </option>
            {allGates.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusScopeFilter)}
            aria-label={t.filterStatusAria}
            className="inset-3d h-9 px-2.5 rounded-lg border border-[#C2D0DF] bg-white text-xs font-bold text-[#1C2833] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
          >
            <option value="ACTIVE">{t.statusActiveOnly}</option>
            <option value="ALL">{t.statusAll}</option>
            <option value="under_loading">{t.statusUnderLoading}</option>
            <option value="called">{t.statusCalled}</option>
            <option value="waiting">{t.statusWaiting}</option>
            <option value="completed">{t.statusCompleted}</option>
          </select>

          <select
            value={loadingTypeFilter}
            onChange={(e) => setLoadingTypeFilter(e.target.value as 'ALL' | 'local' | 'export' | 'sto')}
            aria-label={t.filterTypeAria}
            className="inset-3d h-9 px-2.5 rounded-lg border border-[#C2D0DF] bg-white text-xs font-bold text-[#1C2833] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
          >
            <option value="ALL">{t.typeAll}</option>
            <option value="local">{t.typeLocal}</option>
            <option value="export">{t.typeExport}</option>
            <option value="sto">{t.typeSto}</option>
          </select>

          <div
            className="ms-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#E6EFF8] border border-[#B8D0E8] text-[11px] font-extrabold text-[#1E3A5F]"
            title={t.autoSortTitle}
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
            <span>{t.autoSortLabel}</span>
          </div>
        </div>
      </div>

      {/* Gate-by-Gate Allotment Detail Cards */}
      <div
        className={`grid gap-4 ${
          selectedGate !== 'ALL'
            ? 'grid-cols-1'
            : 'grid-cols-1 lg:grid-cols-2'
        }`}
      >
        {visibleGates.map((gate) => {
          const isGateActive = gate.activeAllottedCount > 0;
          return (
            <section
              key={gate.gateName}
              className="surface-3d rounded-2xl overflow-hidden border border-[#C6D4E3] bg-white flex flex-col"
            >
              {/* Gate Card Header */}
              <div className="bg-gradient-to-r from-[#263748] to-[#354A5F] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#1A2836]">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[#0A6ED1] text-white flex items-center justify-center font-black shadow-sm border border-[#68AEFF]/50">
                    <DoorOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black tracking-wide text-white">
                        {gate.gateName}
                      </h3>
                      {gate.underLoadingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#E9730C] text-white whitespace-nowrap">
                          {t.gateStateLoading}
                        </span>
                      ) : gate.calledCount > 0 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#0A6ED1] text-white border border-[#68AEFF] whitespace-nowrap">
                          {t.gateStateCalled}
                        </span>
                      ) : gate.waitingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#F0AB00] text-[#1C2833] whitespace-nowrap">
                          {t.gateStateWaiting}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/15 text-[#CBD8E6] whitespace-nowrap">
                          {t.gateStateClear}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#CBD8E6] tabular-nums">
                      {t.detailLoading}: <strong className="text-white">{gate.underLoadingCount}</strong> •{' '}
                      {t.detailCalled}: <strong className="text-white">{gate.calledCount}</strong> •{' '}
                      {t.detailWaiting}: <strong className="text-white">{gate.waitingCount}</strong> •{' '}
                      {t.detailDone}: <strong className="text-white">{gate.completedCount}</strong>
                    </p>
                  </div>
                </div>

                {/* Big Allotted Counter Badge */}
                <div className="flex items-center gap-2">
                  <div
                    className={`px-3 py-1.5 rounded-xl border text-center min-w-[106px] ${
                      isGateActive
                        ? 'bg-[#F0AB00] text-[#1C2833] border-[#FFD154]'
                        : 'bg-[#1F3040] text-[#CBD8E6] border-[#4F6B88]'
                    }`}
                  >
                    <p className="text-lg font-black leading-none tabular-nums">
                      {gate.activeAllottedCount}
                    </p>
                    <p className="text-[10px] font-extrabold tracking-wider mt-0.5">
                      {t.allottedActive}
                    </p>
                  </div>
                </div>
              </div>

              {/* Truck List for this Gate */}
              <div className="p-3 space-y-2.5 flex-1 bg-[#F9FBFD]">
                {gate.filteredRows.length === 0 ? (
                  <div className="py-8 px-4 text-center rounded-xl border border-dashed border-[#CBD5E1] bg-white">
                    <Truck className="w-7 h-7 text-[#94A3B8] mx-auto mb-1.5" />
                    <p className="text-xs font-bold text-[#475569]">
                      {gate.totalDayCount === 0
                        ? t.emptyNoTrucks(gate.gateName, formatDisplayDate(selectedDate))
                        : t.emptyFiltered(gate.gateName)}
                    </p>
                    {gate.completedCount > 0 && statusFilter === 'ACTIVE' && (
                      <p className="text-[11px] text-[#107E3E] font-semibold mt-1">
                        {t.completedCountNote(gate.completedCount)}
                      </p>
                    )}
                  </div>
                ) : (
                  gate.filteredRows.map((ticket, idx) => {
                    const statusUi = getStatusBadgeInfo(ticket.status, lang);
                    const loadingType = resolveLoadingType(ticket);
                    const delNote = ticket.delNoteNumber || ticket.loadingSlip?.delNoteNumber || '';
                    const queueNum = ticket.gateSequenceNumber || idx + 1;
                    const isUrgentActive =
                      ticket.priority === 'urgent' &&
                      ticket.status !== 'completed' &&
                      ticket.status !== 'cancelled';

                    return (
                      <div
                        key={ticket.id}
                        className={`rounded-xl border p-3 shadow-2xs transition ${statusUi.rowAccentClass} ${
                          isUrgentActive
                            ? 'border-[#FCA5A5] ring-1 ring-[#FCA5A5] !bg-[#FFF7F7]'
                            : 'border-[#D4DFEA]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          {/* Left: Queue # + Truck Number + Tags */}
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span
                              dir="ltr"
                              className="inline-flex items-center justify-center min-w-[32px] h-7 px-2 rounded-lg bg-[#263748] text-white text-xs font-black tabular-nums"
                              title={t.queuePosTitle}
                            >
                              #{queueNum}
                            </span>

                            <span
                              dir="ltr"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1C2833] text-white font-mono text-sm font-black tracking-wide shadow-2xs"
                            >
                              <Truck className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                              <span>{ticket.truckNumber}</span>
                            </span>

                            {ticket.priority === 'urgent' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-[#BB0000] text-white shadow-2xs whitespace-nowrap">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{t.priorityUrgent}</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F1F5F9] text-[#475569] border border-[#CBD5E1] whitespace-nowrap">
                                {t.priorityNormal}
                              </span>
                            )}

                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold border whitespace-nowrap ${
                                loadingType === 'export'
                                  ? 'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]'
                                  : loadingType === 'sto'
                                  ? 'bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]'
                                  : 'bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]'
                              }`}
                            >
                              {loadingType === 'export' && <Globe className="w-2.5 h-2.5" />}
                              {loadingType === 'sto' && <ArrowLeftRight className="w-2.5 h-2.5" />}
                              <span>
                                {loadingType === 'export'
                                  ? t.exportType
                                  : loadingType === 'sto'
                                  ? t.stoType
                                  : t.localType}
                              </span>
                            </span>
                          </div>

                          {/* Right: Status Badge */}
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black border shrink-0 whitespace-nowrap ${statusUi.badgeClass}`}
                          >
                            <span className={`w-2 h-2 rounded-full ${statusUi.dotClass}`} />
                            <span>{statusUi.label}</span>
                          </span>
                        </div>

                        {/* Middle Details Grid */}
                        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#334155]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
                            <span className="truncate">
                              <strong>{t.delNoteLabel}</strong>{' '}
                              <span dir="ltr" className="font-mono font-bold text-[#1C2833]">
                                {delNote || '—'}
                              </span>{' '}
                              <span dir="ltr" className="text-[11px] text-[#64748B]">({ticket.ticketNumber})</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 min-w-0">
                            <MapPin className="w-3.5 h-3.5 text-[#E9730C] shrink-0" />
                            <span className="truncate">
                              <strong>{t.placeLabel}</strong>{' '}
                              <span className="font-bold text-[#1C2833]">
                                {ticket.destinationPlace || ticket.loadingSlip?.placeName || '—'}
                              </span>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-[#475569]">{t.driverLabel}</span>
                            <span className="font-bold text-[#1C2833] truncate">
                              {ticket.driverName || '—'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 min-w-0">
                            <Phone className="w-3.5 h-3.5 text-[#107E3E] shrink-0" />
                            <span dir="ltr" className="font-mono font-bold text-[#1C2833] tabular-nums">
                              {ticket.driverPhone ? formatSaudiPhoneNumber(ticket.driverPhone) : '—'}
                            </span>
                          </div>
                        </div>

                        {/* Bottom Timestamps */}
                        <div className="mt-2 pt-2 border-t border-[#E2E8F0] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#475569] font-medium">
                          <span>
                            <strong>{t.arrivalTimeLabel}</strong>{' '}
                            <span dir="ltr" className="font-mono font-bold text-[#1C2833] tabular-nums">
                              {ticket.timeIn || '—'}
                            </span>
                          </span>
                          {ticket.timeCalled && (
                            <span>
                              <strong>{t.calledTimeLabel}</strong>{' '}
                              <span dir="ltr" className="font-mono text-[#085CAF] font-bold tabular-nums">
                                {ticket.timeCalled}
                              </span>
                            </span>
                          )}
                          {ticket.timeLoadingStarted && (
                            <span>
                              <strong>{t.loadingStartedLabel}</strong>{' '}
                              <span dir="ltr" className="font-mono text-[#B45309] font-bold tabular-nums">
                                {ticket.timeLoadingStarted}
                              </span>
                            </span>
                          )}
                          {ticket.timeCompleted && (
                            <span>
                              <strong>{t.completedTimeLabel}</strong>{' '}
                              <span dir="ltr" className="font-mono text-[#107E3E] font-bold tabular-nums">
                                {ticket.timeCompleted}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
