import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { TicketRecord, CompanySettings } from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { formatDisplayDate } from '../services/storage';
import { generateGateTokenPDF } from '../utils/pdfSlip';
import { Printer, Download, X, CheckCircle2, ShieldCheck } from 'lucide-react';

interface TicketPrintViewProps {
  ticket: TicketRecord;
  settings: CompanySettings;
  onClose: () => void;
}

export const TicketPrintView: React.FC<TicketPrintViewProps> = ({ ticket, settings, onClose }) => {
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);

  const handleSavePDF = () => {
    generateGateTokenPDF(ticket, settings);
    setPdfNotice('Gate Token PDF downloaded!');
    setTimeout(() => setPdfNotice(null), 4000);
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
        generateGateTokenPDF(ticket, settings);
        setPdfNotice('Gate Token PDF downloaded (preview frame restricts browser print popup).');
        setTimeout(() => setPdfNotice(null), 5000);
      }
    }, 250);
  };

  return createPortal(
    <div className="ticket-print-root fixed inset-0 z-50 overflow-y-auto bg-black/75 flex items-center justify-center p-4">
      {/* Top action toolbar (hidden when printing) */}
      <div className="print-toolbar print:hidden fixed top-3 right-3 left-3 sm:left-auto z-50 flex flex-wrap items-center justify-end gap-2 bg-neutral-900/95 text-white px-3.5 py-2.5 rounded-xl shadow-2xl border border-neutral-700">
        <button
          type="button"
          onClick={handlePrint}
          className="app-btn flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-500 text-white shadow"
        >
          <Printer className="w-4 h-4 shrink-0" />
          <span>Print Gate Token</span>
        </button>
        <button
          type="button"
          onClick={handleSavePDF}
          className="app-btn flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-500 text-white shadow"
          title="Download Gate Token PDF"
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

      {pdfNotice && (
        <div className="print:hidden fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-emerald-950 text-emerald-100 border border-emerald-600 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{pdfNotice}</span>
        </div>
      )}

      {/* Gate Token Slip - compact 80mm receipt style */}
      <div className="print-ticket-container bg-white text-black w-full max-w-sm rounded-xl p-5 shadow-2xl border-2 border-dashed border-gray-400 font-sans print:border-none print:shadow-none print:p-2 print:max-w-[80mm]">
        <div className="text-center pb-3 border-b-2 border-black">
          {settings.logoDataUrl ? (
            <img
              src={settings.logoDataUrl}
              alt={settings.companyName}
              className="h-12 w-auto max-w-[140px] object-contain mx-auto mb-1"
            />
          ) : (
            <div className="inline-flex items-center justify-center p-1.5 bg-black text-white rounded-lg mb-1">
              <ShieldCheck className="w-5 h-5" />
            </div>
          )}
          <h2 className="text-base font-black uppercase tracking-tight">{settings.companyName}</h2>
          <p className="text-[10px] text-gray-600">{settings.address}</p>
          <div className="mt-1 bg-black text-white text-[11px] font-extrabold uppercase py-0.5 px-3 rounded inline-block">
            GATE INWARD & LOADING TOKEN
          </div>
        </div>

        {/* Big Ticket and Gate Box */}
        <div className="my-3 text-center bg-gray-100 p-2.5 rounded-lg border border-black/40">
          <p className="text-[11px] font-bold text-gray-600 uppercase">Assigned Loading Gate</p>
          <p className="text-3xl font-black text-blue-900 tracking-tight my-0.5">{ticket.gateNumber}</p>
          <div className="inline-block bg-blue-900 text-white font-black text-xs px-2.5 py-0.5 rounded-full">
            Position at Gate: #{ticket.gateSequenceNumber}
          </div>
        </div>

        {/* Details Table */}
        <div className="space-y-1.5 text-xs border-y border-black/30 py-2.5">
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Ticket Number:</span>
            <span className="font-extrabold">{ticket.ticketNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Daily Overall Seq:</span>
            <span className="font-extrabold text-indigo-700">#{ticket.sequenceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Truck Number:</span>
            <span className="font-black text-sm tracking-wide">{ticket.truckNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Driver Name:</span>
            <span className="font-bold">{ticket.driverName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Driver Mobile:</span>
            <span className="font-bold font-mono">{formatSaudiPhoneNumber(ticket.driverPhone)}</span>
          </div>
          {ticket.iqamaNumber && (
            <div className="flex justify-between">
              <span className="text-gray-600 font-semibold">ID / Iqama No:</span>
              <span className="font-bold font-mono">{ticket.iqamaNumber}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Destination Place:</span>
            <span className="font-bold text-gray-900">{ticket.destinationPlace || 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Date & Time In:</span>
            <span className="font-medium">{formatDisplayDate(ticket.date)} {ticket.timeIn}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-semibold">Transporter:</span>
            <span className="font-medium truncate max-w-[150px]">{ticket.transporterName || 'Self / Own'}</span>
          </div>
        </div>

        {/* Simulated Barcode */}
        <div className="mt-3 text-center">
          <div className="font-mono tracking-widest text-lg font-black select-none">
            ||||| | |||| || |||||| | ||||| |||
          </div>
          <p className="text-[10px] text-gray-500 font-mono mt-0.5">{ticket.ticketNumber}</p>
        </div>

        {/* Notice */}
        <div className="mt-2 text-[9px] text-gray-700 bg-amber-50 border border-amber-300 p-1.5 rounded text-center">
          ⚠️ When your turn is called at the gate, you will receive a WhatsApp message. Please wait in the designated yard.
        </div>

        <div className="mt-4 pt-3 border-t border-dashed border-gray-400 flex justify-between text-[9px] text-gray-600 font-bold">
          <span>Security Guard Sign</span>
          <span>Driver Signature</span>
        </div>
      </div>

      <style>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body > *:not(.ticket-print-root) {
            display: none !important;
          }
          .ticket-print-root {
            position: static !important;
            inset: auto !important;
            display: block !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
          }
          .print-toolbar {
            display: none !important;
          }
          .print-ticket-container {
            position: static !important;
            margin: 0 auto !important;
            padding: 8px !important;
            width: 80mm !important;
            max-width: 80mm !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>,
    document.body
  );
};
