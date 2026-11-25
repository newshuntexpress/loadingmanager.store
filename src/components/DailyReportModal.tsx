import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TicketRecord, CompanySettings } from '../types';
import { StorageService } from '../services/storage';
import { ApiClient } from '../services/api';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';
import { generateDailyReportPDF } from '../utils/pdfDailyReport';
import { FileSpreadsheet, Printer, Download, Upload, X, CheckCircle2 } from 'lucide-react';

interface DailyReportModalProps {
  tickets: TicketRecord[];
  settings: CompanySettings;
  date: string;
  isAdmin?: boolean;
  onClose: () => void;
  onDataRestored?: () => void;
}

export const DailyReportModal: React.FC<DailyReportModalProps> = ({
  tickets,
  settings,
  date,
  isAdmin = false,
  onClose,
  onDataRestored,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const dayTickets = tickets.filter((t) => t.date === date);

  const completed = dayTickets.filter((t) => t.status === 'completed');
  const underLoading = dayTickets.filter((t) => t.status === 'under_loading');
  const waiting = dayTickets.filter((t) => t.status === 'waiting');
  const activeLoadingTrucks = dayTickets.filter((t) => t.status !== 'cancelled');
  const localTrucksCount = activeLoadingTrucks.filter((t) => resolveLoadingType(t) === 'local').length;
  const exportTrucksCount = activeLoadingTrucks.filter((t) => resolveLoadingType(t) === 'export').length;

  const totalQty = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalQty || 0), 0);
  const totalPallets = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalPallets || 0), 0);
  const totalLooseRolls = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalLooseRolls || 0), 0);

  const handleSavePDF = () => {
    generateDailyReportPDF(dayTickets, settings, date);
    setPdfNotice('Daily Report PDF downloaded! Open the file to view or print.');
    setTimeout(() => setPdfNotice(null), 5000);
  };

  const handlePrint = () => {
    let printDialogOpened = false;
    const onBeforePrint = () => {
      printDialogOpened = true;
    };
    window.addEventListener('beforeprint', onBeforePrint, { once: true });

    try {
      window.focus();
      window.print();
    } catch {
      // Blocked by sandboxed iframe
    }

    setTimeout(() => {
      window.removeEventListener('beforeprint', onBeforePrint);
      if (!printDialogOpened) {
        generateDailyReportPDF(dayTickets, settings, date);
        setPdfNotice('PDF downloaded (preview frame restricts browser print popup). Open the PDF to print!');
        setTimeout(() => setPdfNotice(null), 6000);
      }
    }, 300);
  };

  const handleExportCSV = () => {
    StorageService.exportToCSV(dayTickets, date);
  };

  const handleBackupDatabase = async () => {
    try {
      const allData = await ApiClient.exportBackup();
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Loading_Database_Backup_${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Handled by global auth/error layer
    }
  };

  const handleRestoreDatabase = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        await ApiClient.restoreBackup(json);
        if (onDataRestored) onDataRestored();
        onClose();
      } catch {
        // Invalid backup JSON or unauthorized ignored
      }
    };
    reader.readAsText(file);
  };

  return createPortal(
    <div className="daily-report-print-root fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 print:p-0 print:bg-white print:static print:inset-auto print:block">
      <div className="daily-report-modal-shell bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 print:shadow-none print:border-none print:rounded-none print:max-w-none print:overflow-visible">
        {/* Header (Hidden in Print) */}
        <div className="print:hidden bg-gradient-to-r from-neutral-900 to-neutral-800 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Daily Dispatch Report & Database Backup</h2>
              <p className="text-xs text-neutral-300">
                Daily Material Loading Summary & Reporting for {date}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="daily-report-printable p-4 sm:p-6 space-y-5 max-h-[85vh] overflow-y-auto print:max-h-none print:overflow-visible print:p-0">
          {/* Company Title on Print */}
          <div className="text-center pb-2 border-b-2 border-black">
            <div className="flex items-center justify-center gap-3">
              {settings.logoDataUrl && (
                <img
                  src={settings.logoDataUrl}
                  alt={settings.companyName}
                  className="h-11 w-11 object-contain rounded border border-neutral-200 p-0.5 bg-white shrink-0"
                />
              )}
              <div>
                <h1 className="text-lg font-black uppercase text-neutral-900">{settings.companyName}</h1>
                <p className="text-xs text-neutral-600">{settings.address} | Ph: {settings.phone}</p>
              </div>
            </div>
            <div className="mt-1.5 inline-block bg-neutral-900 text-white text-xs font-bold px-3 py-0.5 rounded">
              DAILY MATERIAL LOADING & DISPATCH REPORT: {date}
            </div>
          </div>

          {/* Action Bar (CSV & Print & PDF & Backup) - hidden on print */}
          <div className="print:hidden flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleExportCSV}
                className="app-btn w-full lg:w-auto bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Export Daily CSV</span>
              </button>

              <button
                type="button"
                onClick={handleSavePDF}
                className="app-btn w-full lg:w-auto bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Download PDF</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="app-btn w-full lg:w-auto bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>Print Report</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-center gap-2">
              <button
                type="button"
                onClick={handleBackupDatabase}
                className="app-btn w-full lg:w-auto text-neutral-700 hover:text-neutral-900 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50"
              >
                <span>JSON Backup</span>
              </button>

              {isAdmin && (
                <label className="app-btn w-full lg:w-auto text-neutral-700 hover:text-neutral-900 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50">
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Restore Backup</span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".json"
                    onChange={handleRestoreDatabase}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 uppercase block">Total Inward Vehicles</span>
              <span className="text-2xl font-black text-neutral-900">{dayTickets.length}</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-800 uppercase block">Completed & Dispatched</span>
              <span className="text-2xl font-black text-emerald-700">{completed.length}</span>
            </div>
            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
              <span className="text-[10px] font-bold text-amber-800 uppercase block">Active / In Queue</span>
              <span className="text-2xl font-black text-amber-700">{underLoading.length + waiting.length}</span>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
              <span className="text-[10px] font-bold text-blue-800 uppercase block">Total Pallets & Rolls</span>
              <span className="text-base font-black text-blue-900 mt-1 block">
                {totalPallets} Pallets | {totalLooseRolls} Rolls
              </span>
            </div>
          </div>

          {/* Total Truck Loading Breakdown: Local & Export */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-300">
              <span className="text-[10px] font-bold text-slate-600 uppercase block">Total Truck Loading</span>
              <span className="text-xl font-black text-slate-900">{activeLoadingTrucks.length}</span>
            </div>
            <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-300">
              <span className="text-[10px] font-bold text-emerald-800 uppercase block">Local Trucks</span>
              <span className="text-xl font-black text-emerald-700">{localTrucksCount}</span>
            </div>
            <div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-300">
              <span className="text-[10px] font-bold text-indigo-800 uppercase block">Export Trucks</span>
              <span className="text-xl font-black text-indigo-700">{exportTrucksCount}</span>
            </div>
          </div>

          {/* Table of all tickets */}
          <div className="border border-black/80 rounded-lg overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-neutral-200 text-black font-extrabold text-[10px] uppercase border-b border-black">
                  <th className="py-2 px-2 text-center w-8">Seq</th>
                  <th className="py-2 px-2">Ticket No</th>
                  <th className="py-2 px-2">Gate</th>
                  <th className="py-2 px-2">Truck No</th>
                  <th className="py-2 px-2">Driver & Phone</th>
                  <th className="py-2 px-2">Destination</th>
                  <th className="py-2 px-2">Del Note</th>
                  <th className="py-2 px-2 text-center">Qty / Pallet / Loose</th>
                  <th className="py-2 px-2 text-center">Status</th>
                  <th className="py-2 px-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/30 text-[11px]">
                {dayTickets.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 px-3 text-center text-neutral-500 font-semibold">
                      No tickets recorded for {date}.
                    </td>
                  </tr>
                ) : (
                  dayTickets.map((t) => (
                    <tr key={t.id} className="hover:bg-neutral-50">
                      <td className="py-1.5 px-2 text-center font-bold">#{t.sequenceNumber}</td>
                      <td className="py-1.5 px-2 font-extrabold">{t.ticketNumber}</td>
                      <td className="py-1.5 px-2 font-bold">{t.gateNumber}</td>
                      <td className="py-1.5 px-2 font-black">{t.truckNumber}</td>
                      <td className="py-1.5 px-2">
                        <span className="font-semibold">{t.driverName}</span>
                        <span className="text-[10px] text-neutral-600 block font-mono">{formatSaudiPhoneNumber(t.driverPhone)}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <span>{t.destinationPlace || '—'}</span>
                        <span
                          className={`ml-1.5 inline-block px-1.5 py-0.2 rounded text-[9px] font-black uppercase border ${
                            resolveLoadingType(t) === 'export'
                              ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {resolveLoadingType(t) === 'export' ? 'EXPORT' : 'LOCAL'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-bold text-blue-900">
                        {t.loadingSlip?.delNoteNumber || '—'}
                      </td>
                      <td className="py-1.5 px-2 text-center font-semibold">
                        {t.loadingSlip ? (
                          <span>
                            {t.loadingSlip.totalQty} Qty | {t.loadingSlip.totalPallets} P | {t.loadingSlip.totalLooseRolls} R
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-center font-bold">
                        {String(t.status || '')
                          .replace(/_/g, ' ')
                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                      </td>
                      <td className="py-1.5 px-2 text-[10px]">
                        {t.timeIn} {t.timeCompleted ? `-> ${t.timeCompleted}` : ''}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Daily Totals Footer */}
          <div className="bg-neutral-100 p-3 rounded-lg border border-black/40 flex flex-wrap justify-between items-center gap-2 text-xs font-bold text-neutral-800">
            <span>
              TRUCK LOADING: Total {activeLoadingTrucks.length} (Local: {localTrucksCount} | Export: {exportTrucksCount})
            </span>
            <span className="text-sm font-black text-black">
              Total Quantity: {totalQty} Units | Total Pallets: {totalPallets} | Total Loose Rolls: {totalLooseRolls}
            </span>
          </div>

          {/* Signatures on print */}
          <div className="hidden print:grid grid-cols-3 gap-4 pt-8 text-center text-xs font-bold">
            <div className="border-t border-black pt-1">Security Officer</div>
            <div className="border-t border-black pt-1">Dispatch Manager</div>
            <div className="border-t border-black pt-1">Plant Head</div>
          </div>
        </div>
      </div>

      {/* PDF Download Confirmation Banner */}
      {pdfNotice && (
        <div className="print:hidden fixed bottom-5 right-5 z-[60] flex items-center gap-2.5 bg-emerald-950 text-emerald-100 border border-emerald-600 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold max-w-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{pdfNotice}</span>
        </div>
      )}

      <style>{`
        @page {
          size: A4 landscape;
          margin: 10mm;
        }
        @media print {
          *, *::before, *::after {
            box-sizing: border-box !important;
          }
          html, body {
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body > *:not(.daily-report-print-root) {
            display: none !important;
          }
          .daily-report-print-root {
            position: static !important;
            inset: auto !important;
            display: block !important;
            width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #ffffff !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            overflow: visible !important;
          }
          .daily-report-modal-shell {
            width: 100% !important;
            max-width: none !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          .daily-report-printable {
            position: static !important;
            width: 100% !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
          }
          .daily-report-printable table {
            width: 100% !important;
            page-break-inside: auto;
          }
          .daily-report-printable thead {
            display: table-header-group;
          }
          .daily-report-printable tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>,
    document.body
  );
};
