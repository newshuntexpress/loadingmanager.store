import React, { useState } from 'react';
import { TicketRecord, CompanySettings } from '../types';
import { WHATSAPP_TEMPLATES, openWhatsAppChat, cleanPhoneNumber, formatSaudiPhoneNumber } from '../utils/whatsapp';
import { MessageSquare, Send, Check, Phone, Copy, X, ExternalLink } from 'lucide-react';

interface WhatsAppModalProps {
  ticket: TicketRecord;
  settings: CompanySettings;
  initialTemplateId?: string;
  onClose: () => void;
  onStatusUpdate?: (status: TicketRecord['status']) => void;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  ticket,
  settings,
  initialTemplateId = 'gate_call',
  onClose,
  onStatusUpdate,
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplateId);
  const [phoneNumber, setPhoneNumber] = useState<string>(() => formatSaudiPhoneNumber(ticket.driverPhone || ''));
  const [customMessage, setCustomMessage] = useState<string>(() => {
    const tpl = WHATSAPP_TEMPLATES.find((t) => t.id === initialTemplateId) || WHATSAPP_TEMPLATES[0];
    return tpl.generateText(ticket, settings.companyName, settings.whatsappTemplates);
  });
  const [copied, setCopied] = useState(false);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePhoneChange = (val: string) => {
    setErrorMsg(null);
    setPhoneNumber(val);
    const digits = val.replace(/\D/g, '');
    if (digits.startsWith('05') && digits.length === 10) {
      setPhoneNumber('+966' + digits.slice(1));
    } else if (digits.startsWith('5') && digits.length === 9) {
      setPhoneNumber('+966' + digits);
    }
  };

  const handlePhoneBlur = () => {
    if (phoneNumber.trim()) {
      setPhoneNumber(formatSaudiPhoneNumber(phoneNumber));
    }
  };

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const tpl = WHATSAPP_TEMPLATES.find((t) => t.id === id);
    if (tpl) {
      setCustomMessage(tpl.generateText(ticket, settings.companyName, settings.whatsappTemplates));
    }
  };

  const handleSend = () => {
    if (!phoneNumber.trim()) {
      setErrorMsg('Please enter Driver Mobile Number.');
      return;
    }
    setErrorMsg(null);

    const formatted = formatSaudiPhoneNumber(phoneNumber);

    // Auto update status if requested
    if (autoUpdateStatus && onStatusUpdate) {
      if (selectedTemplateId === 'gate_call' && ticket.status === 'waiting') {
        onStatusUpdate('called');
      } else if (selectedTemplateId === 'under_loading' && ticket.status !== 'under_loading') {
        onStatusUpdate('under_loading');
      } else if (selectedTemplateId === 'completed_dispatch' && ticket.status !== 'completed') {
        onStatusUpdate('completed');
      }
    }

    openWhatsAppChat(formatted, customMessage);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(customMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Send WhatsApp Driver Alert</h2>
              <p className="text-xs text-emerald-100">
                Notify {ticket.driverName} ({ticket.truckNumber})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2 rounded-xl text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Recipient Details & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase block mb-1">
                Vehicle & Driver Details
              </label>
              <p className="text-sm font-bold text-neutral-800">{ticket.truckNumber}</p>
              <p className="text-xs text-neutral-600">{ticket.driverName}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-neutral-500 uppercase">
                  WhatsApp Mobile Number
                </label>
                <span className="text-[9.5px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded">
                  🇸🇦 +966
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-emerald-600">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  placeholder="e.g. 0550000000"
                  className="w-full pl-9 pr-3 py-1.5 text-sm font-bold text-neutral-900 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white font-mono"
                />
              </div>
              <p className="text-[11px] text-emerald-800 font-semibold mt-1 flex items-center justify-between">
                <span>Target: +{cleanPhoneNumber(phoneNumber)}</span>
                <span className="text-[10px] text-neutral-500 font-normal">wa.me/{cleanPhoneNumber(phoneNumber)}</span>
              </p>
            </div>
          </div>

          {/* Quick Template Selector */}
          <div>
            <label className="text-xs font-bold text-neutral-700 uppercase tracking-wide block mb-2">
              Select WhatsApp Template:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WHATSAPP_TEMPLATES.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl.id)}
                    className={`text-left p-2.5 rounded-xl border transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'border-neutral-200 hover:border-emerald-300 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-neutral-900">{tpl.titleHindi}</span>
                      {isSelected && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <span className="text-[11px] text-neutral-500">{tpl.titleEnglish}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message Preview in WhatsApp Green Bubble */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-neutral-700 uppercase tracking-wide">
                WhatsApp Message Preview:
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs flex items-center gap-1 text-neutral-600 hover:text-emerald-700 transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>
            </div>

            <div className="relative rounded-xl border border-emerald-200 bg-[#EFEAE2] p-3 shadow-inner">
              <div className="bg-[#DCF8C6] border border-emerald-300/60 rounded-xl p-3 shadow-sm text-neutral-800 text-xs sm:text-[13px] font-sans whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {customMessage}
              </div>
            </div>

            <div className="mt-2">
              <label className="text-[11px] font-medium text-neutral-500 block mb-1">
                Customize message before sending:
              </label>
              <textarea
                data-preserve-case="true"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={3}
                className="w-full p-2.5 text-xs rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-neutral-800"
              />
            </div>
          </div>

          {/* Quick Auto-Update Status Checkbox */}
          {onStatusUpdate && (
            <label className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={autoUpdateStatus}
                onChange={(e) => setAutoUpdateStatus(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-500"
              />
              <span className="text-xs text-neutral-800">
                <span className="font-bold">Auto Status Transition:</span> Automatically update truck status (e.g. to 'Called to Gate' or 'Under Loading') upon sending.
              </span>
            </label>
          )}

          {/* Footer Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              className="app-btn w-full sm:w-auto sm:min-w-[110px] text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSend}
              className="app-btn w-full sm:w-auto sm:min-w-[170px] bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
            >
              <Send className="w-4 h-4 shrink-0" />
              <span>Send via WhatsApp</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-75 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
