import React, { useState, useEffect, useCallback } from 'react';
import { DriverTokenStatusResponse, PublicBranding, TruckStatus } from '../types';
import { ApiClient } from '../services/api';
import {
  Building2,
  DoorOpen,
  Truck,
  CheckCircle2,
  Clock,
  Megaphone,
  PackageCheck,
  RefreshCw,
  AlertCircle,
  TimerOff,
  Loader2,
  FileText,
  MapPin,
} from 'lucide-react';
import { LiveStatusQrCard } from './LiveStatusQrCard';

interface DriverTokenStatusPageProps {
  token: string;
  initialBranding?: PublicBranding | null;
}

function formatDateTimeShort(ts?: number): string {
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

function getStatusBannerStyle(status: TruckStatus) {
  switch (status) {
    case 'under_loading':
      return {
        bg: 'bg-[#FEF7F1]',
        border: 'border-[#F5B982]',
        badgeBg: 'bg-[#C25900]',
        badgeText: 'text-white',
        titleColor: 'text-[#8F3F00]',
        headline: 'UNDER LOADING',
        instruction: 'Your vehicle is currently loading at the assigned gate. Please follow plant safety rules until completion.',
      };
    case 'called':
      return {
        bg: 'bg-[#EBF5FF]',
        border: 'border-[#84BEF8]',
        badgeBg: 'bg-[#0A6ED1]',
        badgeText: 'text-white',
        titleColor: 'text-[#084B8A]',
        headline: 'CALLED TO GATE',
        instruction: 'Please proceed to your assigned gate bay immediately and report to the Forklift Operator.',
      };
    case 'completed':
      return {
        bg: 'bg-[#F1FDF6]',
        border: 'border-[#72C896]',
        badgeBg: 'bg-[#107E3E]',
        badgeText: 'text-white',
        titleColor: 'text-[#0D4A26]',
        headline: 'LOADING COMPLETED / READY TO EXIT',
        instruction: 'All materials have been loaded. Please collect your signed Delivery Note from the Dispatch Office before exiting.',
      };
    case 'cancelled':
      return {
        bg: 'bg-[#FFF0F0]',
        border: 'border-[#F4B8B8]',
        badgeBg: 'bg-[#BB0000]',
        badgeText: 'text-white',
        titleColor: 'text-[#8C0000]',
        headline: 'CANCELLED',
        instruction: 'This loading slip has been cancelled. Please contact Gate Security or Dispatch Office.',
      };
    case 'waiting':
    default:
      return {
        bg: 'bg-[#FFFBEB]',
        border: 'border-[#F3CC60]',
        badgeBg: 'bg-[#B45309]',
        badgeText: 'text-white',
        titleColor: 'text-[#78350F]',
        headline: 'WAITING IN QUEUE',
        instruction: 'Please wait in the truck parking zone. This screen updates automatically when your status changes.',
      };
  }
}

const PROGRESS_STEPS = [
  { label: 'Waiting in Queue', icon: Clock },
  { label: 'Called to Gate', icon: Megaphone },
  { label: 'Under Loading', icon: PackageCheck },
  { label: 'Completed', icon: CheckCircle2 },
];

export const DriverTokenStatusPage: React.FC<DriverTokenStatusPageProps> = ({
  token,
  initialBranding,
}) => {
  const [data, setData] = useState<DriverTokenStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const res = await ApiClient.getTokenDriverLoadingStatus(token);
        setData(res);
        setErrorMsg(null);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to load live loading status right now.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  // Initial fetch + automatic 10-second live synchronization
  useEffect(() => {
    fetchStatus(false);

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStatus]);

  const branding = data?.branding || initialBranding;
  const companyName = branding?.companyName || 'Plant Material Dispatch';
  const slip = data?.slip;

  return (
    <div className="min-h-screen text-[#1C2833] font-sans flex flex-col">
      {/* 3D Beveled Mobile-First Header */}
      <header className="bg-gradient-to-b from-[#3E556D] via-[#354A5F] to-[#263748] text-white border-b-2 border-[#1B2836] shadow-[0_8px_22px_-6px_rgba(15,23,42,0.45)]">
        <div className="h-1.5 w-full bg-gradient-to-r from-[#F0AB00] via-[#0A6ED1] to-[#107E3E]" />
        <div className="max-w-2xl mx-auto px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {branding?.logoDataUrl ? (
              <div className="w-11 h-11 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 ring-2 ring-[#F0AB00]/80 shadow-[0_3px_0_#1B2836] overflow-hidden">
                <img src={branding.logoDataUrl} alt={companyName} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0A6ED1] to-[#064A94] flex items-center justify-center text-[#F0AB00] shrink-0 ring-2 ring-[#F0AB00]/80 shadow-[0_3px_0_#1B2836]">
                <Building2 className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black tracking-wide truncate text-white">{companyName}</h1>
              <p className="text-xs text-[#CBD8E6] truncate">Driver Live Loading Status</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchStatus(true)}
            disabled={loading || refreshing}
            className="app-btn-sm h-10 px-3.5 rounded-xl bg-[#243647] hover:bg-[#1C2C3B] text-white border border-[#526E8A] shrink-0"
            title="Refresh Live Status"
          >
            <RefreshCw className={`w-4 h-4 text-[#F0AB00] ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-5 sm:py-7 space-y-5">
        {loading && !data ? (
          <div className="surface-3d rounded-3xl p-12 text-center space-y-3.5">
            <Loader2 className="w-9 h-9 animate-spin text-[#0A6ED1] mx-auto" />
            <p className="text-base font-extrabold text-[#354A5F]">Loading your live gate &amp; queue status...</p>
          </div>
        ) : errorMsg && !data ? (
          <div className="surface-3d rounded-3xl border-[#F4B8B8] p-7 text-center space-y-3.5">
            <AlertCircle className="w-10 h-10 text-[#BB0000] mx-auto" />
            <h2 className="text-lg font-black text-[#1C2833]">Connection Error</h2>
            <p className="text-sm text-[#5B738B]">{errorMsg}</p>
            <button
              type="button"
              onClick={() => fetchStatus(false)}
              className="app-btn bg-[#0A6ED1] hover:bg-[#085CAF] text-white mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
          </div>
        ) : data?.expired ? (
          <div className="surface-3d rounded-3xl border-[#F4B8B8] p-7 text-center space-y-3.5">
            <div className="w-14 h-14 rounded-2xl bg-[#FFF0F0] border border-[#F4B8B8] flex items-center justify-center mx-auto text-[#BB0000] inset-3d">
              <TimerOff className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-black text-[#1C2833]">Status Link Expired</h2>
            <p className="text-sm text-[#475E75] leading-relaxed">
              {data.message || 'This Driver Live Loading Status link has expired. Please contact Gate Security or Dispatch.'}
            </p>
            {data.expiredAt && (
              <p className="text-xs font-mono text-[#5B738B] tabular-nums">
                Expired at: {formatDateTimeShort(data.expiredAt)}
              </p>
            )}
          </div>
        ) : !data?.found || !slip ? (
          <div className="surface-3d rounded-3xl p-7 text-center space-y-3.5">
            <div className="w-14 h-14 rounded-2xl bg-[#EFF4F9] border border-[#BCC8D4] flex items-center justify-center mx-auto text-[#354A5F] inset-3d">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-black text-[#1C2833]">Loading Slip Not Found</h2>
            <p className="text-sm text-[#475E75] leading-relaxed">
              {data?.message || 'This Driver Live Loading Status link is invalid or no longer active.'}
            </p>
          </div>
        ) : (
          (() => {
            const style = getStatusBannerStyle(slip.status);
            const isCompletedOrCancelled = slip.status === 'completed' || slip.status === 'cancelled';
            const statusUrl =
              typeof window !== 'undefined'
                ? `${window.location.origin}/driver-loading-status/${encodeURIComponent(token)}`
                : `/driver-loading-status/${encodeURIComponent(token)}`;

            return (
              <>
                {/* 1. Primary Above-the-Fold 3D Hero: GATE NUMBER + QUEUE NUMBER */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-b from-[#3E556D] to-[#263748] text-white rounded-2xl p-5 border border-[#4A6580] surface-3d-dark flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-[#B8CAE0]">
                        GATE NUMBER
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-[#1F2F3F] border border-[#4A6580] flex items-center justify-center shrink-0">
                        <DoorOpen className="w-4 h-4 text-[#F0AB00]" />
                      </div>
                    </div>
                    <p className="text-3xl sm:text-4xl font-black tracking-tight text-white mt-3">
                      {slip.gateNumber}
                    </p>
                  </div>

                  <div className="bg-gradient-to-b from-[#0C78E2] to-[#0854A0] text-white rounded-2xl p-5 border border-[#3B97F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_5px_0_#063E75,0_16px_32px_-8px_rgba(10,110,209,0.42)] flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-[#CBE5FF]">
                        QUEUE NUMBER
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-[#084B8A] border border-[#3B97F5]/60 flex items-center justify-center shrink-0">
                        <Truck className="w-4 h-4 text-[#F0AB00]" />
                      </div>
                    </div>
                    <p className="text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums mt-3">
                      {slip.status === 'completed'
                        ? 'DONE'
                        : slip.status === 'cancelled'
                        ? '—'
                        : `#${slip.queueNumber}`}
                    </p>
                  </div>
                </div>

                {/* 2. Prominent CURRENT STATUS Card */}
                <section
                  className={`rounded-2xl border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_0_#C5D3E2,0_14px_28px_-8px_rgba(24,42,64,0.14)] ${style.bg} ${style.border}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#475E75]">
                      CURRENT LOADING STATUS
                    </span>
                    <span className="text-xs font-mono font-semibold text-[#475E75] tabular-nums">
                      Auto-updating every 10s
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <span
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-base sm:text-lg font-black tracking-wide shadow-[0_3px_0_rgba(0,0,0,0.22)] ${style.badgeBg} ${style.badgeText}`}
                    >
                      {slip.status === 'completed' ? (
                        <CheckCircle2 className="w-5 h-5 shrink-0" />
                      ) : slip.status === 'under_loading' ? (
                        <PackageCheck className="w-5 h-5 shrink-0" />
                      ) : slip.status === 'called' ? (
                        <Megaphone className="w-5 h-5 shrink-0" />
                      ) : (
                        <Clock className="w-5 h-5 shrink-0" />
                      )}
                      <span>{style.headline}</span>
                    </span>
                  </div>

                  <p className={`text-sm font-semibold mt-3 leading-relaxed ${style.titleColor}`}>
                    {style.instruction}
                  </p>
                </section>

                {/* 3. Slip & Vehicle Identification Card */}
                <section className="surface-3d rounded-2xl p-5 space-y-3.5">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="bg-[#F4F7FB] rounded-xl p-3.5 border border-[#C8D6E5] inset-3d">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B738B] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#0A6ED1]" />
                        Delivery Number
                      </span>
                      <p className="text-base sm:text-lg font-black text-[#1C2833] font-mono mt-1.5 break-all">
                        {slip.delNoteNumber}
                      </p>
                    </div>

                    <div className="bg-[#F4F7FB] rounded-xl p-3.5 border border-[#C8D6E5] inset-3d">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B738B] flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-[#354A5F]" />
                        Truck Number
                      </span>
                      <p className="text-base sm:text-lg font-black text-[#1C2833] mt-1.5 tracking-wide">
                        {slip.truckNumber}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="bg-[#F4F7FB] rounded-xl p-3.5 border border-[#C8D6E5] inset-3d">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B738B] block">
                        Queue Position
                      </span>
                      <p className="text-sm sm:text-base font-black text-[#1C2833] tabular-nums mt-1.5">
                        {isCompletedOrCancelled
                          ? slip.status === 'completed'
                            ? 'Loading Finished'
                            : 'Not in Queue'
                          : slip.trucksAhead === 0 && slip.status !== 'under_loading'
                          ? `Next in Line (1 of ${slip.totalActiveAtGate})`
                          : slip.status === 'under_loading'
                          ? 'At Bay — Active Loading'
                          : `#${slip.queuePosition} of ${slip.totalActiveAtGate} (${slip.trucksAhead} ahead)`}
                      </p>
                    </div>

                    <div className="bg-[#F4F7FB] rounded-xl p-3.5 border border-[#C8D6E5] inset-3d">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B738B] block">
                        Last Updated Time
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-[#1C2833] font-mono tabular-nums mt-1.5">
                        {formatDateTimeShort(slip.lastUpdatedAt)}
                      </p>
                    </div>
                  </div>

                  {slip.destinationPlace && (
                    <div className="flex items-center gap-2 text-sm text-[#475E75] bg-[#F4F7FB] px-3.5 py-2.5 rounded-xl border border-[#C8D6E5] inset-3d">
                      <MapPin className="w-4 h-4 text-[#0A6ED1] shrink-0" />
                      <span>
                        <strong>Destination:</strong> {slip.destinationPlace}
                      </span>
                    </div>
                  )}

                  {slip.currentlyLoadingTruck && slip.status !== 'completed' && slip.status !== 'under_loading' && (
                    <div className="text-sm text-[#354A5F] bg-[#EBF5FF] px-3.5 py-2.5 rounded-xl border border-[#B8DCFF]">
                      Currently loading at {slip.gateNumber}:{' '}
                      <strong className="font-mono">{slip.currentlyLoadingTruck}</strong>
                    </div>
                  )}
                </section>

                {/* 4. Loading Progress & Stages */}
                <section className="surface-3d rounded-2xl p-5 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black uppercase tracking-wide text-[#354A5F]">
                      Loading Progress
                    </span>
                    <span className="text-sm font-black text-[#0A6ED1] tabular-nums">
                      {slip.progressPercent}%
                    </span>
                  </div>

                  <div className="w-full h-3.5 bg-[#E3EAF2] rounded-full overflow-hidden inset-3d p-0.5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        slip.status === 'completed'
                          ? 'bg-gradient-to-r from-[#107E3E] to-[#16A34A]'
                          : slip.status === 'under_loading'
                          ? 'bg-gradient-to-r from-[#E9730C] to-[#F59E0B]'
                          : slip.status === 'cancelled'
                          ? 'bg-gradient-to-r from-[#BB0000] to-[#EF4444]'
                          : 'bg-gradient-to-r from-[#0A6ED1] to-[#3B82F6]'
                      }`}
                      style={{ width: `${slip.progressPercent}%` }}
                    />
                  </div>

                  {slip.totalItemsCount > 0 && (
                    <p className="text-xs font-semibold text-[#475E75] tabular-nums">
                      Material Checklist Progress: <strong>{slip.loadedItemsCount}</strong> of{' '}
                      <strong>{slip.totalItemsCount}</strong> line items loaded
                    </p>
                  )}

                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {PROGRESS_STEPS.map((step, idx) => {
                      const Icon = step.icon;
                      const reached = slip.status !== 'cancelled' && idx <= slip.stepIndex;
                      const active = slip.status !== 'cancelled' && idx === slip.stepIndex;
                      return (
                        <div
                          key={step.label}
                          className={`rounded-xl p-2.5 text-center border transition ${
                            active
                              ? 'bg-gradient-to-b from-[#EBF5FF] to-[#DBEAFE] border-[#0A6ED1] text-[#0854A0] shadow-[0_3px_0_#93C5FD]'
                              : reached
                              ? 'bg-gradient-to-b from-[#F1FDF6] to-[#DCFCE7] border-[#72C896] text-[#107E3E] shadow-[0_2px_0_#A7F3D0]'
                              : 'bg-[#F4F7FB] border-[#D1DBE5] text-[#7A8FA3] inset-3d'
                          }`}
                        >
                          <Icon className="w-4 h-4 mx-auto mb-1" />
                          <span className="block text-[10.5px] font-extrabold leading-tight">{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 5. Gate Guard Scan QR Pass */}
                <LiveStatusQrCard
                  statusUrl={statusUrl}
                  truckNumber={slip.truckNumber}
                  gateNumber={slip.gateNumber}
                  delNoteNumber={slip.delNoteNumber}
                  statusLabel={style.headline}
                />
              </>
            );
          })()
        )}
      </main>
    </div>
  );
};
