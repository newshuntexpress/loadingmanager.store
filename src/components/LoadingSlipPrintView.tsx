import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TicketRecord, CompanySettings } from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { formatDisplayDate, resolveSettingsForPlant } from '../services/storage';
import { generateLoadingSlipPDF } from '../utils/pdfSlip';
import { buildDriverLiveStatusUrl, generateQrPngDataUrl } from '../utils/driverStatusUrl';
import { Printer, Download, X, Scissors, CheckCircle2 } from 'lucide-react';

interface LoadingSlipPrintViewProps {
  ticket: TicketRecord;
  settings: CompanySettings;
  currentUserId?: string;
  storeInchargeFullName?: string;
  storeInchargeSignatureDataUrl?: string;
  autoPrint?: boolean;
  onClose: () => void;
}

export const LoadingSlipPrintView: React.FC<LoadingSlipPrintViewProps> = ({
  ticket,
  settings,
  currentUserId,
  storeInchargeFullName,
  storeInchargeSignatureDataUrl,
  autoPrint = false,
  onClose,
}) => {
  const plantSettings = resolveSettingsForPlant(settings, ticket.plantId);
  const slip = ticket.loadingSlip;
  const isDifferentPreparer = Boolean(
    slip?.storeInchargeUserId && currentUserId && slip.storeInchargeUserId !== currentUserId
  );
  const displayStoreInchargeName = isDifferentPreparer
    ? (slip?.storeInchargeName || storeInchargeFullName || '').trim()
    : (storeInchargeFullName || slip?.storeInchargeName || '').trim();
  const displaySignatureDataUrl = isDifferentPreparer
    ? slip?.storeInchargeSignatureDataUrl || plantSettings.storeInchargeSignatureDataUrl || ''
    : storeInchargeSignatureDataUrl || plantSettings.storeInchargeSignatureDataUrl || '';
  const items = slip?.items || [];
  // Ensure we always have 8 rows
  const paddedItems = Array.from({ length: 8 }, (_, i) => {
    return items[i] || {
      srNo: i + 1,
      description: '',
      pack: '',
      qty: '',
      pallets: '',
      looseRolls: '',
      remarks: '',
    };
  });

  const printSheetRef = useRef<HTMLDivElement>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const liveStatusUrl = buildDriverLiveStatusUrl(ticket);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrResolved, setQrResolved] = useState<boolean>(false);
  const autoPrintedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setQrResolved(false);
    generateQrPngDataUrl(liveStatusUrl, 360)
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
          setQrResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [liveStatusUrl]);

  const handleSavePDF = () => {
    generateLoadingSlipPDF(ticket, plantSettings, displayStoreInchargeName, displaySignatureDataUrl);
    setPdfNotice('2-Copy A4 PDF downloaded! Open the PDF file to view or print.');
    setTimeout(() => setPdfNotice(null), 5000);
  };

  const handlePrint = useCallback(() => {
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
        generateLoadingSlipPDF(ticket, plantSettings, displayStoreInchargeName, displaySignatureDataUrl);
        setPdfNotice('2-Copy A4 PDF downloaded (preview frame restricts browser print popup). Open the PDF to print!');
        setTimeout(() => setPdfNotice(null), 6000);
      }
    }, 250);
  }, [ticket, plantSettings, displayStoreInchargeName, displaySignatureDataUrl]);

  useEffect(() => {
    if (!autoPrint || autoPrintedRef.current || !qrResolved) return;
    autoPrintedRef.current = true;
    const timer = window.setTimeout(() => {
      handlePrint();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [autoPrint, qrResolved, handlePrint]);

  const plantHeaderInfoLine = [
    plantSettings.address,
    plantSettings.phone ? `Ph: ${plantSettings.phone}` : '',
    plantSettings.email ? plantSettings.email : '',
    plantSettings.gstin ? `Tax/GSTIN: ${plantSettings.gstin}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const renderSingleCopy = (copyType: 'ORIGINAL (OFFICE USE)' | 'DUPLICATE (FOR FORKLIFT OPERATOR)') => (
    <div className="single-slip-copy border-2 border-black bg-white p-2.5 text-black flex flex-col justify-between text-[11px] leading-tight">
      {/* Header */}
      <div>
        <div className="flex justify-between items-start border-b border-black pb-1 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {plantSettings.logoDataUrl && (
              <img
                src={plantSettings.logoDataUrl}
                alt={plantSettings.companyName}
                className="h-9 w-9 object-contain shrink-0 bg-white"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-sm font-black uppercase tracking-wide text-black">
                {plantSettings.companyName}
              </h1>
              <p className="text-[9.5px] text-gray-700 font-medium">
                {plantHeaderInfoLine}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block border border-black px-1.5 py-0.5 text-[9px] font-bold uppercase bg-gray-100">
              {copyType}
            </span>
            <p className="text-[12px] font-black text-black mt-0.5 tracking-wider">
              MATERIAL LOADING SLIP
            </p>
          </div>
        </div>

        {/* Master Info Grid */}
        <div className="grid grid-cols-4 border border-black mb-1 bg-gray-50/50">
          <div className="border-r border-b border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">Del Note No:</span>
            <span className="font-extrabold text-[12px] text-black">
              {slip?.delNoteNumber || ticket.delNoteNumber || '—'}
            </span>
          </div>
          <div className="border-r border-b border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">Date & Time:</span>
            <span className="font-bold text-black">
              {formatDisplayDate(ticket.date)} | {ticket.timeLoadingStarted || ticket.timeIn}
            </span>
          </div>
          <div className="border-r border-b border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">
              {ticket.gateNumber === 'EX-FACTORY' ? 'Ref No:' : 'Ticket No:'}
            </span>
            <span className="font-bold text-black">
              {ticket.ticketNumber} (#{ticket.sequenceNumber})
            </span>
          </div>
          <div className="border-b border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">
              {ticket.gateNumber === 'EX-FACTORY' ? 'Dispatch Mode:' : 'Gate & Queue Pos:'}
            </span>
            <span className="font-extrabold text-[12px] text-black">
              {ticket.gateNumber === 'EX-FACTORY'
                ? `EX-FACTORY (#${ticket.gateSequenceNumber})`
                : `${ticket.gateNumber} (Seq. #${ticket.gateSequenceNumber})`}
            </span>
          </div>

          <div className="border-r border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">Truck Number:</span>
            <span className="font-black text-[12.5px] tracking-wide text-black">
              {ticket.truckNumber}
            </span>
          </div>
          <div className="border-r border-black p-1 flex flex-col justify-between">
            <div>
              <span className="text-[8.5px] font-bold text-gray-600 uppercase block leading-none">Driver Name:</span>
              <span className="font-extrabold text-[11px] text-black truncate block mt-0.5 leading-tight">
                {ticket.driverName || '—'}
              </span>
            </div>
            <div className="mt-0.5 pt-0.5 border-t border-gray-200">
              <span className="text-[8px] font-bold text-gray-500 uppercase block leading-none">Mobile No:</span>
              <span className="font-bold text-[10px] text-black font-mono leading-tight tracking-tight block">
                {formatSaudiPhoneNumber(ticket.driverPhone) || '—'}
              </span>
            </div>
          </div>
          <div className="border-r border-black p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">Destination / Place:</span>
            <span className="font-extrabold text-[11.5px] text-blue-900 truncate block">
              {slip?.placeName || ticket.destinationPlace || '—'}
            </span>
          </div>
          <div className="p-1">
            <span className="text-[9px] font-bold text-gray-600 uppercase block">
              {ticket.gateNumber === 'EX-FACTORY' ? 'Customer Name:' : 'Transporter:'}
            </span>
            <span className="font-semibold text-black truncate block">
              {ticket.transporterName || 'Self / Own'}
            </span>
          </div>
        </div>

        {/* 8 Rows Materials Table */}
        <table className="w-full border-collapse border border-black text-left text-[10px]">
          <thead>
            <tr className="bg-gray-200 text-black border-b border-black text-[9.5px]">
              <th className="border-r border-black py-0.5 px-1 w-7 text-center font-bold">#</th>
              <th className="border-r border-black py-0.5 px-1.5 font-bold">
                Material Description
              </th>
              <th className="border-r border-black py-0.5 px-1 w-20 text-center font-bold">
                Pack Type
              </th>
              <th className="border-r border-black py-0.5 px-1 w-16 text-center font-bold">
                Quantity
              </th>
              <th className="border-r border-black py-0.5 px-1 w-20 text-center font-bold">
                Pallets
              </th>
              <th className="border-r border-black py-0.5 px-1 w-20 text-center font-bold">
                Loose Rolls
              </th>
              <th className="py-0.5 px-1 w-28 text-center font-bold">
                Remarks / Batch
              </th>
            </tr>
          </thead>
          <tbody>
            {paddedItems.map((item, index) => {
              const hasData = item.description || item.qty || item.pallets || item.looseRolls;
              return (
                <tr
                  key={index}
                  className={`border-b border-black/80 h-[19px] ${
                    index % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'
                  }`}
                >
                  <td className="border-r border-black text-center font-bold text-[9.5px]">
                    {index + 1}
                  </td>
                  <td className="border-r border-black px-1.5 font-bold text-[11.5px] text-black truncate max-w-[200px]">
                    {item.description || (hasData ? '' : '—')}
                  </td>
                  <td className="border-r border-black text-center px-1 font-medium">
                    {item.pack}
                  </td>
                  <td className="border-r border-black text-center px-1 font-bold">
                    {item.qty}
                  </td>
                  <td className="border-r border-black text-center px-1 font-bold">
                    {item.pallets}
                    {item.palletRatio && item.pallets ? (
                      <span className="text-[7.5px] font-normal text-gray-600 block leading-none">
                        @{item.palletRatio}/P
                      </span>
                    ) : null}
                  </td>
                  <td className="border-r border-black text-center px-1 font-bold">
                    {item.looseRolls}
                  </td>
                  <td className="px-1 text-left text-[9px] text-gray-700 truncate max-w-[100px]">
                    {item.remarks}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-extrabold border-t-2 border-black text-[10.5px]">
              <td colSpan={3} className="border-r border-black text-right px-2 py-0.5 uppercase tracking-wide">
                TOTAL DISPATCHED :
              </td>
              <td className="border-r border-black text-center px-1 py-0.5 font-black text-black">
                {slip?.totalQty || 0}
              </td>
              <td className="border-r border-black text-center px-1 py-0.5 font-black text-black bg-yellow-50">
                {slip?.totalPallets || 0}
              </td>
              <td className="border-r border-black text-center px-1 py-0.5 font-black text-black bg-yellow-50">
                {slip?.totalLooseRolls || 0}
              </td>
              <td className="px-1 py-0.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Footer Live Status QR (Left) + Signatures */}
      <div className="mt-1 pt-1 border-t border-black">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-center text-[9.5px] items-stretch">
          <div className="border border-black rounded bg-white px-1.5 py-1 flex items-center gap-1.5 min-h-[60px] shrink-0">
            <div className="w-[56px] h-[56px] bg-white border border-gray-200 flex items-center justify-center shrink-0">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Live Status QR for ${ticket.truckNumber}`}
                  className="w-full h-full object-contain block"
                />
              ) : (
                <span className="text-[7px] text-gray-500 font-bold">QR</span>
              )}
            </div>
            <div className="text-left w-[72px] leading-tight">
              <p className="text-[8px] font-black uppercase text-black tracking-tight">LIVE STATUS QR</p>
              <p className="text-[7px] text-gray-700 font-medium mt-0.5">Scan at Gate for</p>
              <p className="text-[7px] text-gray-700 font-medium">Queue &amp; Status</p>
              <p className="text-[8px] font-extrabold text-black mt-1 truncate">{ticket.gateNumber}</p>
            </div>
          </div>
          <div className="border border-black/50 p-1 rounded bg-white flex flex-col justify-between min-h-[60px]">
            <p className="font-bold text-gray-800">Forklift Operator / Loaded By</p>
            <div>
              <div className="h-6 flex items-end justify-center font-medium text-gray-900 text-[9px]">
                {slip?.checkedBy ? slip.checkedBy : ''}
              </div>
              <div className="border-t border-dashed border-gray-400"></div>
            </div>
          </div>
          <div className="border border-black/50 p-1 rounded bg-white flex flex-col justify-between min-h-[60px]">
            <p className="font-bold text-gray-800 leading-tight">Store Incharge Signature</p>
            <div className="flex-1 flex flex-col justify-end">
              <div className="h-[26px] flex items-center justify-center overflow-hidden py-0.5">
                {displaySignatureDataUrl ? (
                  <img
                    src={displaySignatureDataUrl}
                    alt="Store Incharge Digital Signature"
                    className="max-h-[24px] max-w-[140px] object-contain block"
                  />
                ) : null}
              </div>
              <div className="border-t border-dashed border-gray-400 pt-0.5 min-h-[13px] flex items-center justify-center">
                {displayStoreInchargeName ? (
                  <span className="font-bold text-black text-[9.5px] leading-tight">
                    {displayStoreInchargeName}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="loading-slip-print-root fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm flex items-start justify-center pt-16 pb-8 px-2 sm:px-4">
      {/* Top action toolbar (hidden when printing) */}
      <div className="print-toolbar print:hidden fixed top-3 right-3 left-3 sm:left-auto z-50 flex flex-wrap items-center justify-between sm:justify-end gap-2 bg-neutral-900/95 backdrop-blur-md text-white px-3.5 py-2.5 rounded-xl shadow-2xl border border-neutral-700">
        <div className="text-xs hidden lg:block mr-1">
          <span className="font-bold text-amber-400">A4 Print Preview:</span> Exact 1 Page (Original + Duplicate 2-Copy)
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={handlePrint}
            className="app-btn flex-1 sm:flex-initial bg-emerald-600 hover:bg-emerald-500 text-white shadow"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>Print / Save PDF (1 Sheet, 2 Copies)</span>
          </button>
          <button
            type="button"
            onClick={handleSavePDF}
            className="app-btn flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-500 text-white shadow"
            title="Download 2-Copy A4 PDF directly"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Save PDF</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="app-btn bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700"
            title="Close Preview"
          >
            <X className="w-4 h-4 shrink-0" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* PDF Download Confirmation Banner */}
      {pdfNotice && (
        <div className="print:hidden fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-emerald-950 text-emerald-100 border border-emerald-600 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{pdfNotice}</span>
        </div>
      )}

      {/* The Printable A4 Sheet Preview */}
      <div
        ref={printSheetRef}
        className="print-a4-container bg-white text-black w-full max-w-[210mm] shadow-2xl rounded-sm pt-[12mm] px-[5mm] pb-[5mm]"
      >
        {/* COPY 1: ORIGINAL (UPPER HALF) */}
        {renderSingleCopy('ORIGINAL (OFFICE USE)')}

        {/* PERFORATION / SCISSOR CUT LINE IN THE MIDDLE */}
        <div className="cut-divider-line my-1 flex items-center justify-between text-neutral-500 text-[9px] font-semibold select-none border-t-2 border-dashed border-neutral-400 pt-0.5">
          <span className="flex items-center gap-1">
            <Scissors className="w-3.5 h-3.5" />
            <span>CUT HERE ALONG DOTTED LINE</span>
          </span>
          <span className="tracking-widest">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂</span>
          <span>A4 DUAL COPY SHEET</span>
        </div>

        {/* COPY 2: DUPLICATE (LOWER HALF) */}
        {renderSingleCopy('DUPLICATE (FOR FORKLIFT OPERATOR)')}
      </div>

      {/* Print Specific Inline Styles */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0mm !important;
        }
        @media print {
          *, *::before, *::after {
            box-sizing: border-box !important;
          }
          html, body {
            width: 210mm !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body > *:not(.loading-slip-print-root) {
            display: none !important;
          }
          .loading-slip-print-root {
            position: static !important;
            inset: auto !important;
            display: block !important;
            width: 210mm !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 auto !important;
            background: #ffffff !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            overflow: visible !important;
          }
          .print-toolbar {
            display: none !important;
          }
          .print-a4-container {
            position: static !important;
            width: 210mm !important;
            max-width: 210mm !important;
            height: auto !important;
            max-height: 295mm !important;
            padding: 12mm 6mm 6mm 6mm !important;
            margin: 0 auto !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .single-slip-copy {
            height: 132mm !important;
            max-height: 133mm !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }
          .cut-divider-line {
            height: 5mm !important;
            max-height: 5mm !important;
            margin: 0 !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>
    </div>,
    document.body
  );
};
