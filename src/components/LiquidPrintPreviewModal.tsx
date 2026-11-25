import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LiquidStoreState, LiquidTankComputed, LiquidTransaction } from '../types';
import {
  generateLiquidAuditPDF,
  generateLiquidRegisterPDF,
  generateLiquidSingleTankPDF,
  generateLiquidStockReportPDF,
  generateLiquidTanksPDF,
  generateLiquidTransactionPDF,
} from '../utils/liquidPdf';
import { Printer, Download, X, CheckCircle2, Droplets } from 'lucide-react';

export type LiquidPrintTarget =
  | { kind: 'transaction'; tx: LiquidTransaction }
  | { kind: 'register'; mode: 'INWARD' | 'OUTWARD' | 'HISTORY'; rows: LiquidTransaction[]; filterSummary: string }
  | { kind: 'audit' }
  | { kind: 'tanks' }
  | { kind: 'tank-detail'; tank: LiquidTankComputed }
  | {
      kind: 'stock-report';
      rows: Array<{ name: string; inKg: number; outKg: number; balKg: number; tankNames?: string[] }>;
      filterSummary: string;
    };

interface LiquidPrintPreviewModalProps {
  target: LiquidPrintTarget;
  store: LiquidStoreState;
  operatorName: string;
  companyLogoUrl?: string;
  autoPrint?: boolean;
  onClose: () => void;
}

function fmtKG(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n || 0);
}

function fmtMT(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n || 0);
}

function fmtM(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function fmtPct(n: number): string {
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(n || 0)}%`;
}

function fmtDate(val: string | number | null | undefined): string {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export const LiquidPrintPreviewModal: React.FC<LiquidPrintPreviewModalProps> = ({
  target,
  store,
  operatorName,
  companyLogoUrl,
  autoPrint = false,
  onClose,
}) => {
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const facilityName = store.settings.facilityName;

  const isLandscape = target.kind === 'register' || target.kind === 'audit' || target.kind === 'tanks';

  const triggerPdfDownload = () => {
    switch (target.kind) {
      case 'transaction': {
        const tank = store.tanks.find((t) => t.id === target.tx.tankId);
        generateLiquidTransactionPDF(target.tx, tank, facilityName, operatorName, companyLogoUrl);
        break;
      }
      case 'register':
        generateLiquidRegisterPDF(target.mode, target.rows, store.tanks, facilityName, target.filterSummary, companyLogoUrl);
        break;
      case 'audit':
        generateLiquidAuditPDF(store.auditLogs, facilityName, companyLogoUrl);
        break;
      case 'tanks':
        generateLiquidTanksPDF(store.tanks, facilityName, companyLogoUrl);
        break;
      case 'tank-detail': {
        const tankTxs = store.transactions
          .filter((t) => t.tankId === target.tank.id)
          .sort((a, b) => b.txDate.localeCompare(a.txDate) || b.id - a.id);
        generateLiquidSingleTankPDF(target.tank, tankTxs, facilityName, companyLogoUrl);
        break;
      }
      case 'stock-report':
        generateLiquidStockReportPDF(target.rows, facilityName, target.filterSummary, companyLogoUrl);
        break;
    }
  };

  const handleSavePDF = () => {
    triggerPdfDownload();
    setPdfNotice('PDF downloaded! Open the file to view or print.');
    setTimeout(() => setPdfNotice(null), 4500);
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
        triggerPdfDownload();
        setPdfNotice('PDF downloaded (preview frame restricts browser print popup). Open the PDF to print.');
        setTimeout(() => setPdfNotice(null), 5500);
      }
    }, 250);
  };

  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => {
      handlePrint();
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  const docTitle = (() => {
    switch (target.kind) {
      case 'transaction':
        return `Material ${target.tx.type} Entry Voucher — ${target.tx.txCode}`;
      case 'register':
        return target.mode === 'INWARD'
          ? 'Material Inward Register'
          : target.mode === 'OUTWARD'
          ? 'Material Outward Register'
          : 'Transaction History Ledger';
      case 'audit':
        return 'Liquid Store Audit Log';
      case 'tanks':
        return 'Liquid Storage Tank Inventory';
      case 'tank-detail':
        return `${target.tank.name} — Specification & Stock Sheet`;
      case 'stock-report':
        return 'Product-Wise Consolidated Stock Report';
    }
  })();

  const docSubtitle = (() => {
    switch (target.kind) {
      case 'transaction':
        return `Entry Date: ${fmtDate(target.tx.txDate)}`;
      case 'register':
        return `${target.filterSummary} · ${target.rows.length} entries`;
      case 'audit':
        return `${store.auditLogs.length} audit log records`;
      case 'tanks':
        return `${store.tanks.length} configured storage tanks`;
      case 'tank-detail':
        return `${target.tank.location} · Product: ${target.tank.productLabel}`;
      case 'stock-report':
        return target.filterSummary;
    }
  })();

  return createPortal(
    <div className="liquid-print-root fixed inset-0 z-[80] overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex flex-col items-center p-3 sm:p-6 pt-16 sm:pt-18">
      {/* Floating Top Toolbar (hidden on print) */}
      <div className="print-toolbar print:hidden fixed top-3 right-3 left-3 sm:left-auto z-[90] flex flex-wrap items-center justify-end gap-2 bg-[#354A5F] text-white px-3.5 py-2.5 rounded-xl shadow-2xl border border-slate-500/40">
        <button
          type="button"
          onClick={handlePrint}
          className="app-btn bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow"
        >
          <Printer className="w-4 h-4 shrink-0" />
          <span>Print</span>
        </button>
        <button
          type="button"
          onClick={handleSavePDF}
          className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white shadow"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Download PDF</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="app-btn bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600"
        >
          <X className="w-4 h-4 shrink-0" />
          <span>Close</span>
        </button>
      </div>

      {pdfNotice && (
        <div className="print:hidden fixed bottom-5 right-5 z-[95] flex items-center gap-2 bg-emerald-950 text-emerald-100 border border-emerald-500 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold max-w-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{pdfNotice}</span>
        </div>
      )}

      {/* Printable A4 Sheet */}
      <div
        className={`liquid-print-sheet bg-white text-[#1C2833] w-full ${
          isLandscape ? 'max-w-[1120px]' : 'max-w-[794px]'
        } rounded-xl shadow-2xl border border-slate-300 p-5 sm:p-7 font-sans`}
      >
        {/* SAP Navy Document Banner */}
        <div className="bg-[#354A5F] text-white px-4 py-3.5 rounded-t-lg border-b-4 border-[#F0AB00] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {companyLogoUrl ? (
              <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden p-0.5 ring-1 ring-[#F0AB00]/60">
                <img src={companyLogoUrl} alt={facilityName} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-lg bg-[#0A6ED1] flex items-center justify-center shrink-0">
                <Droplets className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-black uppercase tracking-tight">{docTitle}</h1>
              <p className="text-[11px] text-slate-200 truncate">
                {facilityName} · {docSubtitle}
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-200 font-mono">
            <div>Generated: {fmtDate(Date.now())}</div>
            <div>Operator: {operatorName}</div>
          </div>
        </div>

        {/* BODY BY DOCUMENT TYPE */}
        <div className="pt-5 space-y-5">
          {/* 1. SINGLE TRANSACTION VOUCHER */}
          {target.kind === 'transaction' &&
            (() => {
              const tx = target.tx;
              const isIn = tx.type === 'INWARD';
              const tank = store.tanks.find((t) => t.id === tx.tankId);
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#EFF4F9] border border-[#D1DBE5] rounded-lg p-3.5">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#5B738B]">Transaction ID</div>
                      <div className="text-sm font-black font-mono mt-0.5">{tx.txCode}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#5B738B]">Entry Type</div>
                      <div className="mt-1">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-extrabold text-white ${
                            isIn ? 'bg-[#107E3E]' : 'bg-[#BB0000]'
                          }`}
                        >
                          {tx.type}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#5B738B]">Quantity (MT)</div>
                      <div
                        className={`text-base font-black font-mono tabular-nums mt-0.5 ${
                          isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'
                        }`}
                      >
                        {isIn ? '+' : '-'}
                        {fmtMT(tx.quantityMt)} MT
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#5B738B]">Quantity (KG)</div>
                      <div
                        className={`text-base font-black font-mono tabular-nums mt-0.5 ${
                          isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'
                        }`}
                      >
                        {isIn ? '+' : '-'}
                        {fmtKG(tx.quantityKg)} KG
                      </div>
                    </div>
                  </div>

                  <div className="border border-[#D1DBE5] rounded-lg overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#D1DBE5] border-b border-[#D1DBE5]">
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Transaction Date & Time</div>
                        <div className="text-xs font-bold font-mono mt-0.5">{fmtDate(tx.txDate)}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Storage Tank & Material</div>
                        <div className="text-xs font-bold mt-0.5">
                          {tank ? `${tank.name} (${tank.location})` : `Tank #${tx.tankId}`} — {tx.materialName}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#D1DBE5] border-b border-[#D1DBE5]">
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Document Number</div>
                        <div className="text-xs font-bold font-mono mt-0.5">{tx.documentNumber || '—'}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Reference Number (PO / DO)</div>
                        <div className="text-xs font-bold font-mono mt-0.5">{tx.referenceNumber || '—'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#D1DBE5] border-b border-[#D1DBE5]">
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">
                          {isIn ? 'Supplier Name' : 'Customer / Department'}
                        </div>
                        <div className="text-xs font-bold mt-0.5">{tx.partyName || '—'}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Vehicle Number</div>
                        <div className="text-xs font-bold font-mono mt-0.5">{tx.vehicleNumber || '—'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#D1DBE5] border-b border-[#D1DBE5]">
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Driver Name</div>
                        <div className="text-xs font-bold mt-0.5">{tx.driverName || '—'}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] font-bold uppercase text-[#5B738B]">Recorded By</div>
                        <div className="text-xs font-bold mt-0.5">{tx.createdBy || operatorName || '—'}</div>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50">
                      <div className="text-[10px] font-bold uppercase text-[#5B738B]">Remarks / Weighbridge Notes</div>
                      <div className="text-xs mt-0.5">{tx.remarks || 'No remarks recorded.'}</div>
                    </div>
                  </div>

                  {tank && (
                    <div>
                      <h3 className="text-xs font-extrabold uppercase text-[#354A5F] mb-2">
                        Current Tank Stock Snapshot ({tank.name})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                        <div className="border border-[#D1DBE5] rounded-lg p-2.5 bg-[#EFF4F9]">
                          <div className="text-[10px] font-bold text-[#5B738B] uppercase">Total Capacity</div>
                          <div className="font-bold font-mono mt-0.5">{fmtMT(tank.totalCapacityMt)} MT</div>
                        </div>
                        <div className="border border-[#D1DBE5] rounded-lg p-2.5 bg-[#EFF4F9]">
                          <div className="text-[10px] font-bold text-[#5B738B] uppercase">Current Stock</div>
                          <div className="font-bold font-mono text-[#0A6ED1] mt-0.5">{fmtMT(tank.currentStockMt)} MT</div>
                        </div>
                        <div className="border border-[#D1DBE5] rounded-lg p-2.5 bg-[#EFF4F9]">
                          <div className="text-[10px] font-bold text-[#5B738B] uppercase">Empty Capacity</div>
                          <div className="font-bold font-mono mt-0.5">{fmtMT(tank.emptyCapacityMt)} MT</div>
                        </div>
                        <div className="border border-[#D1DBE5] rounded-lg p-2.5 bg-[#EFF4F9]">
                          <div className="text-[10px] font-bold text-[#5B738B] uppercase">Fill Level</div>
                          <div className="font-bold font-mono text-[#0A6ED1] mt-0.5">
                            {fmtPct(tank.filledPercentage)} ({fmtM(tank.filledMeters)}m)
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-6 pt-10 text-center text-[11px] font-bold text-[#354A5F]">
                    <div className="border-t border-[#354A5F] pt-1.5">Store Keeper / Operator</div>
                    <div className="border-t border-[#354A5F] pt-1.5">Driver / Transporter Sign</div>
                    <div className="border-t border-[#354A5F] pt-1.5">Camp Store Incharge</div>
                  </div>
                </>
              );
            })()}

          {/* 2. REGISTER (INWARD / OUTWARD / HISTORY) */}
          {target.kind === 'register' &&
            (() => {
              const totalIn = target.rows
                .filter((r) => r.type === 'INWARD')
                .reduce((a, b) => a + b.quantityKg, 0);
              const totalOut = target.rows
                .filter((r) => r.type === 'OUTWARD')
                .reduce((a, b) => a + b.quantityKg, 0);
              return (
                <>
                  <div className="overflow-x-auto border border-[#D1DBE5] rounded-lg">
                    <table className="w-full text-[11px] text-left border-collapse">
                      <thead>
                        <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                          <th className="py-2 px-2 font-bold">Date</th>
                          <th className="py-2 px-2 font-bold">Tx ID</th>
                          <th className="py-2 px-2 font-bold">Type</th>
                          <th className="py-2 px-2 font-bold">Tank</th>
                          <th className="py-2 px-2 font-bold">Material</th>
                          <th className="py-2 px-2 font-bold text-right">Qty (KG)</th>
                          <th className="py-2 px-2 font-bold text-right">Qty (MT)</th>
                          <th className="py-2 px-2 font-bold">Doc No.</th>
                          <th className="py-2 px-2 font-bold">Ref No.</th>
                          <th className="py-2 px-2 font-bold">Party</th>
                          <th className="py-2 px-2 font-bold">Vehicle</th>
                          <th className="py-2 px-2 font-bold">Driver Name</th>
                          <th className="py-2 px-2 font-bold">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {target.rows.length === 0 ? (
                          <tr>
                            <td colSpan={13} className="py-6 text-center text-[#5B738B]">
                              No matching transactions.
                            </td>
                          </tr>
                        ) : (
                          target.rows.map((tx) => {
                            const isIn = tx.type === 'INWARD';
                            const tankName = store.tanks.find((t) => t.id === tx.tankId)?.name || '-';
                            return (
                              <tr key={tx.id} className="border-b border-[#E3EAF2] last:border-b-0">
                                <td className="py-1.5 px-2 font-mono whitespace-nowrap">{fmtDate(tx.txDate)}</td>
                                <td className="py-1.5 px-2 font-mono font-bold whitespace-nowrap">{tx.txCode}</td>
                                <td className={`py-1.5 px-2 font-bold ${isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'}`}>
                                  {tx.type}
                                </td>
                                <td className="py-1.5 px-2 whitespace-nowrap">{tankName}</td>
                                <td className="py-1.5 px-2 whitespace-nowrap">{tx.materialName}</td>
                                <td
                                  className={`py-1.5 px-2 text-right font-mono font-bold whitespace-nowrap ${
                                    isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'
                                  }`}
                                >
                                  {isIn ? '+' : '-'}
                                  {fmtKG(tx.quantityKg)}
                                </td>
                                <td
                                  className={`py-1.5 px-2 text-right font-mono font-bold whitespace-nowrap ${
                                    isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'
                                  }`}
                                >
                                  {isIn ? '+' : '-'}
                                  {fmtMT(tx.quantityMt)}
                                </td>
                                <td className="py-1.5 px-2 font-mono whitespace-nowrap">{tx.documentNumber || '-'}</td>
                                <td className="py-1.5 px-2 font-mono whitespace-nowrap">{tx.referenceNumber || '-'}</td>
                                <td className="py-1.5 px-2">{tx.partyName || '-'}</td>
                                <td className="py-1.5 px-2 font-mono whitespace-nowrap">{tx.vehicleNumber || '-'}</td>
                                <td className="py-1.5 px-2 whitespace-nowrap">{tx.driverName || '-'}</td>
                                <td className="py-1.5 px-2">{tx.remarks || '-'}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#EFF4F9] border border-[#354A5F]/40 rounded-lg p-3 text-xs font-bold">
                    <div>Records: {target.rows.length}</div>
                    <div className="text-[#107E3E]">Inward: +{fmtMT(totalIn / 1000)} MT</div>
                    <div className="text-[#BB0000]">Outward: -{fmtMT(totalOut / 1000)} MT</div>
                    <div className="text-[#0A6ED1] sm:text-right">Net: {fmtMT((totalIn - totalOut) / 1000)} MT</div>
                  </div>
                </>
              );
            })()}

          {/* 3. AUDIT LOG */}
          {target.kind === 'audit' && (
            <div className="overflow-x-auto border border-[#D1DBE5] rounded-lg">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead>
                  <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                    <th className="py-2 px-2.5 font-bold">Timestamp</th>
                    <th className="py-2 px-2.5 font-bold">Action</th>
                    <th className="py-2 px-2.5 font-bold">Entity</th>
                    <th className="py-2 px-2.5 font-bold">Summary</th>
                    <th className="py-2 px-2.5 font-bold">Performed By</th>
                  </tr>
                </thead>
                <tbody>
                  {store.auditLogs.map((a) => (
                    <tr key={a.id} className="border-b border-[#E3EAF2] last:border-b-0">
                      <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                      <td className="py-1.5 px-2.5 font-mono font-bold whitespace-nowrap">{a.action}</td>
                      <td className="py-1.5 px-2.5 whitespace-nowrap">{a.entityType}</td>
                      <td className="py-1.5 px-2.5">{a.summary}</td>
                      <td className="py-1.5 px-2.5 whitespace-nowrap">{a.performedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 4. TANKS INVENTORY */}
          {target.kind === 'tanks' && (
            <>
              <div className="overflow-x-auto border border-[#D1DBE5] rounded-lg">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead>
                    <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                      <th className="py-2 px-2.5 font-bold">Tank Name</th>
                      <th className="py-2 px-2.5 font-bold">Product</th>
                      <th className="py-2 px-2.5 font-bold">Location</th>
                      <th className="py-2 px-2.5 font-bold text-right">Capacity (MT)</th>
                      <th className="py-2 px-2.5 font-bold text-right">Depth</th>
                      <th className="py-2 px-2.5 font-bold text-right">Stock (MT)</th>
                      <th className="py-2 px-2.5 font-bold text-right">Empty (MT)</th>
                      <th className="py-2 px-2.5 font-bold text-right">Fill %</th>
                      <th className="py-2 px-2.5 font-bold">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.tanks.map((t) => (
                      <tr key={t.id} className="border-b border-[#E3EAF2] last:border-b-0">
                        <td className="py-1.5 px-2.5 font-bold whitespace-nowrap">{t.name}</td>
                        <td className="py-1.5 px-2.5 text-[#0A6ED1] font-semibold">{t.productLabel}</td>
                        <td className="py-1.5 px-2.5 whitespace-nowrap">{t.location}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">
                          {fmtMT(t.totalCapacityMt)} MT
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">{fmtM(t.depthMeters)} m</td>
                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-[#0A6ED1] whitespace-nowrap">
                          {fmtMT(t.currentStockMt)} MT
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">
                          {fmtMT(t.emptyCapacityMt)} MT
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono font-bold whitespace-nowrap">
                          {fmtPct(t.filledPercentage)}
                        </td>
                        <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">{fmtDate(t.lastTransactionAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#EFF4F9] border border-[#354A5F]/40 rounded-lg p-3 text-xs font-bold">
                <div>Total Tanks: {store.tanks.length}</div>
                <div>Capacity: {fmtMT(store.tanks.reduce((a, b) => a + b.totalCapacityMt, 0))} MT</div>
                <div className="text-[#0A6ED1]">
                  Stock: {fmtMT(store.tanks.reduce((a, b) => a + b.currentStockMt, 0))} MT
                </div>
                <div className="sm:text-right">
                  Empty: {fmtMT(store.tanks.reduce((a, b) => a + b.emptyCapacityMt, 0))} MT
                </div>
              </div>
            </>
          )}

          {/* 5. SINGLE TANK DETAIL */}
          {target.kind === 'tank-detail' &&
            (() => {
              const tk = target.tank;
              const tankTxs = store.transactions
                .filter((t) => t.tankId === tk.id)
                .sort((a, b) => b.txDate.localeCompare(a.txDate) || b.id - a.id)
                .slice(0, 15);
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Total Capacity</div>
                      <div className="font-bold font-mono text-sm mt-0.5">
                        {fmtMT(tk.totalCapacityMt)} MT ({fmtKG(tk.totalCapacityKg)} KG)
                      </div>
                    </div>
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Current Stock</div>
                      <div className="font-bold font-mono text-sm text-[#0A6ED1] mt-0.5">
                        {fmtMT(tk.currentStockMt)} MT ({fmtKG(tk.currentStockKg)} KG)
                      </div>
                    </div>
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Empty Capacity</div>
                      <div className="font-bold font-mono text-sm mt-0.5">
                        {fmtMT(tk.emptyCapacityMt)} MT ({fmtKG(tk.emptyCapacityKg)} KG)
                      </div>
                    </div>
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Tank Depth</div>
                      <div className="font-bold font-mono text-sm mt-0.5">{fmtM(tk.depthMeters)} m</div>
                    </div>
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Filled Level</div>
                      <div className="font-bold font-mono text-sm text-[#0A6ED1] mt-0.5">
                        {fmtM(tk.filledMeters)} m ({fmtPct(tk.filledPercentage)})
                      </div>
                    </div>
                    <div className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                      <div className="text-[10px] font-bold text-[#5B738B] uppercase">Empty Headspace</div>
                      <div className="font-bold font-mono text-sm mt-0.5">
                        {fmtM(tk.emptyMeters)} m ({fmtPct(tk.emptyPercentage)})
                      </div>
                    </div>
                  </div>

                  {tk.materials.length > 0 && (
                    <div className="border border-[#D1DBE5] rounded-lg overflow-hidden">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                            <th className="py-2 px-3 font-bold">Material</th>
                            <th className="py-2 px-3 font-bold text-right">Inward (MT)</th>
                            <th className="py-2 px-3 font-bold text-right">Outward (MT)</th>
                            <th className="py-2 px-3 font-bold text-right">Balance (MT)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tk.materials.map((m) => (
                            <tr key={m.materialName} className="border-b border-[#E3EAF2] last:border-b-0">
                              <td className="py-2 px-3 font-bold">{m.materialName}</td>
                              <td className="py-2 px-3 text-right font-mono text-[#107E3E]">
                                {fmtMT(m.inwardKg / 1000)} MT
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-[#BB0000]">
                                {fmtMT(m.outwardKg / 1000)} MT
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-[#0A6ED1]">
                                {fmtMT(m.balanceMt)} MT
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="border border-[#D1DBE5] rounded-lg overflow-hidden">
                    <div className="bg-[#EFF4F9] px-3 py-2 text-xs font-extrabold text-[#354A5F] border-b border-[#D1DBE5]">
                      Recent Tank Movements ({tankTxs.length})
                    </div>
                    <table className="w-full text-[11px] text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[#354A5F] border-b border-[#D1DBE5]">
                          <th className="py-1.5 px-2.5 font-bold">Date</th>
                          <th className="py-1.5 px-2.5 font-bold">Tx ID</th>
                          <th className="py-1.5 px-2.5 font-bold">Type</th>
                          <th className="py-1.5 px-2.5 font-bold text-right">Qty (MT)</th>
                          <th className="py-1.5 px-2.5 font-bold">Doc No.</th>
                          <th className="py-1.5 px-2.5 font-bold">Driver</th>
                          <th className="py-1.5 px-2.5 font-bold">Party</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tankTxs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-4 text-center text-[#5B738B]">
                              No transactions recorded for this tank.
                            </td>
                          </tr>
                        ) : (
                          tankTxs.map((tx) => {
                            const isIn = tx.type === 'INWARD';
                            return (
                              <tr key={tx.id} className="border-b border-[#E3EAF2] last:border-b-0">
                                <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">{fmtDate(tx.txDate)}</td>
                                <td className="py-1.5 px-2.5 font-mono font-bold whitespace-nowrap">{tx.txCode}</td>
                                <td className={`py-1.5 px-2.5 font-bold ${isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'}`}>
                                  {tx.type}
                                </td>
                                <td
                                  className={`py-1.5 px-2.5 text-right font-mono font-bold whitespace-nowrap ${
                                    isIn ? 'text-[#107E3E]' : 'text-[#BB0000]'
                                  }`}
                                >
                                  {isIn ? '+' : '-'}
                                  {fmtMT(tx.quantityMt)} MT
                                </td>
                                <td className="py-1.5 px-2.5 font-mono">{tx.documentNumber || '-'}</td>
                                <td className="py-1.5 px-2.5">{tx.driverName || '-'}</td>
                                <td className="py-1.5 px-2.5">{tx.partyName || '-'}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

          {/* 6. STOCK REPORT */}
          {target.kind === 'stock-report' &&
            (() => {
              const totIn = target.rows.reduce((a, r) => a + r.inKg, 0);
              const totOut = target.rows.reduce((a, r) => a + r.outKg, 0);
              const totBal = target.rows.reduce((a, r) => a + r.balKg, 0);
              return (
                <>
                  {target.rows.length > 0 && (
                    <div>
                      <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[#354A5F] mb-2">
                        Product-Wise Total Stock Summary
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {target.rows.map((r) => (
                          <div key={r.name} className="border border-[#D1DBE5] rounded-lg p-3 bg-[#EFF4F9]">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold text-[#1C2833] truncate">{r.name}</div>
                                <div className="text-[10px] text-[#5B738B] truncate">
                                  {r.tankNames && r.tankNames.length > 0
                                    ? `${r.tankNames.length} ${r.tankNames.length === 1 ? 'Tank' : 'Tanks'}: ${r.tankNames.join(', ')}`
                                    : 'No movements in filter'}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-black font-mono text-[#0A6ED1]">
                                  {fmtMT(r.balKg / 1000)} MT
                                </div>
                                <div className="text-[10px] font-mono text-[#5B738B]">{fmtKG(r.balKg)} KG</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-[#D1DBE5] text-[10px] font-mono font-bold">
                              <span className="text-[#107E3E]">IN: +{fmtMT(r.inKg / 1000)} MT</span>
                              <span className="text-[#BB0000]">OUT: -{fmtMT(r.outKg / 1000)} MT</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto border border-[#D1DBE5] rounded-lg">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                          <th className="py-2.5 px-3 font-bold">Product / Material</th>
                          <th className="py-2.5 px-3 font-bold text-right">Inward (KG)</th>
                          <th className="py-2.5 px-3 font-bold text-right">Inward (MT)</th>
                          <th className="py-2.5 px-3 font-bold text-right">Outward (KG)</th>
                          <th className="py-2.5 px-3 font-bold text-right">Outward (MT)</th>
                          <th className="py-2.5 px-3 font-bold text-right">Balance (KG)</th>
                          <th className="py-2.5 px-3 font-bold text-right">Balance (MT)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {target.rows.map((r) => (
                          <tr key={r.name} className="border-b border-[#E3EAF2] last:border-b-0">
                            <td className="py-2 px-3">
                              <div className="font-bold">{r.name}</div>
                              {r.tankNames && r.tankNames.length > 0 && (
                                <div className="text-[10px] text-[#5B738B] font-medium">
                                  {r.tankNames.join(', ')}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[#107E3E]">{fmtKG(r.inKg)} KG</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-[#107E3E]">
                              {fmtMT(r.inKg / 1000)} MT
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[#BB0000]">{fmtKG(r.outKg)} KG</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-[#BB0000]">
                              {fmtMT(r.outKg / 1000)} MT
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{fmtKG(r.balKg)} KG</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-[#0A6ED1]">
                              {fmtMT(r.balKg / 1000)} MT
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-[#EFF4F9] border-t-2 border-[#354A5F] font-extrabold">
                          <td className="py-2.5 px-3 text-[#354A5F]">GRAND TOTAL</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#107E3E]">{fmtKG(totIn)} KG</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#107E3E]">{fmtMT(totIn / 1000)} MT</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#BB0000]">{fmtKG(totOut)} KG</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#BB0000]">{fmtMT(totOut / 1000)} MT</td>
                          <td className="py-2.5 px-3 text-right font-mono">{fmtKG(totBal)} KG</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#0A6ED1]">{fmtMT(totBal / 1000)} MT</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-3 gap-6 pt-10 text-center text-[11px] font-bold text-[#354A5F]">
                    <div className="border-t border-[#354A5F] pt-1.5">Store Operator</div>
                    <div className="border-t border-[#354A5F] pt-1.5">Camp Store Incharge</div>
                    <div className="border-t border-[#354A5F] pt-1.5">MMD Manager</div>
                  </div>
                </>
              );
            })()}
        </div>
      </div>

      <style>{`
        @page {
          size: A4 ${isLandscape ? 'landscape' : 'portrait'};
          margin: 8mm;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body > *:not(.liquid-print-root) {
            display: none !important;
          }
          .liquid-print-root {
            position: static !important;
            inset: auto !important;
            display: block !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #ffffff !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            overflow: visible !important;
          }
          .print-toolbar {
            display: none !important;
          }
          .liquid-print-sheet {
            max-width: none !important;
            width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>,
    document.body
  );
};
