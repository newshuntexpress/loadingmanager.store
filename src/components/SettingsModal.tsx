import React, { useRef, useState } from 'react';
import { CompanySettings } from '../types';
import { StorageService } from '../services/storage';
import { ApiClient } from '../services/api';
import { processLogoFile, processSignatureFile } from '../utils/logo';
import {
  Settings,
  Plus,
  Trash2,
  Save,
  X,
  DoorOpen,
  RotateCcw,
  BookmarkCheck,
  CheckCircle2,
  AlertCircle,
  Upload,
  Image as ImageIcon,
  Building2,
  Loader2,
  PenTool,
  MessageSquare,
  Edit2,
  GitBranch,
  Copy,
} from 'lucide-react';

interface SettingsModalProps {
  settings: CompanySettings;
  isAdmin?: boolean;
  canViewWhatsAppLogs?: boolean;
  waPendingRetryCount?: number;
  onOpenWhatsAppLogs?: () => void;
  onOpenWhatsAppTemplates?: () => void;
  onSave: (newSettings: CompanySettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isAdmin = false,
  canViewWhatsAppLogs = true,
  waPendingRetryCount = 0,
  onOpenWhatsAppLogs,
  onOpenWhatsAppTemplates,
  onSave,
  onClose,
}) => {
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [companySubtitle, setCompanySubtitle] = useState(settings.companySubtitle);
  const [logoDataUrl, setLogoDataUrl] = useState<string>(settings.logoDataUrl || '');
  const [logoProcessing, setLogoProcessing] = useState<boolean>(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [storeInchargeSignatureDataUrl, setStoreInchargeSignatureDataUrl] = useState<string>(
    settings.storeInchargeSignatureDataUrl || ''
  );
  const [signatureProcessing, setSignatureProcessing] = useState<boolean>(false);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(settings.address);
  const [phone, setPhone] = useState(settings.phone);
  const [email, setEmail] = useState(settings.email);
  const [gstin, setGstin] = useState(settings.gstin);
  const [ticketPrefix, setTicketPrefix] = useState(settings.ticketPrefix || 'TK');
  const [autoPrintTokenAfterSave, setAutoPrintTokenAfterSave] = useState(settings.autoPrintTokenAfterSave ?? true);
  const [sessionIdleMinutes, setSessionIdleMinutes] = useState<number>(settings.sessionIdleMinutes || 30);
  const [gates, setGates] = useState<string[]>([...settings.gates]);
  const [newGateName, setNewGateName] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleAddGate = () => {
    const trimmed = newGateName.trim();
    if (!trimmed) return;
    if (gates.includes(trimmed)) {
      showFeedback('error', 'This gate already exists!');
      return;
    }
    setGates([...gates, trimmed]);
    setNewGateName('');
    setFeedback(null);
  };

  const handleRemoveGate = (gate: string) => {
    if (gates.length <= 1) {
      showFeedback('error', 'At least 1 gate must be configured!');
      return;
    }
    setGates(gates.filter((g) => g !== gate));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoProcessing(true);
    try {
      const normalizedPng = await processLogoFile(file);
      setLogoDataUrl(normalizedPng);
      showFeedback('success', 'Logo uploaded! Click "Save Settings" or "Save as Default" to apply across the system.');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to process selected logo image.');
    } finally {
      setLogoProcessing(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoDataUrl('');
    showFeedback('success', 'Logo removed. Click "Save Settings" to apply.');
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSignatureProcessing(true);
    try {
      const normalizedPng = await processSignatureFile(file);
      setStoreInchargeSignatureDataUrl(normalizedPng);
      showFeedback(
        'success',
        'Digital signature uploaded! Click "Save Settings" or "Save as Default" to show it on Loading Slips.'
      );
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to process selected signature image.');
    } finally {
      setSignatureProcessing(false);
    }
  };

  const handleRemoveSignature = () => {
    setStoreInchargeSignatureDataUrl('');
    showFeedback('success', 'Digital signature removed. Click "Save Settings" to apply.');
  };

  const buildCurrentSettings = (): CompanySettings => {
    const finalGates = [...gates];
    const pendingGate = newGateName.trim();
    if (pendingGate && !finalGates.includes(pendingGate)) {
      finalGates.push(pendingGate);
    }
    return {
      companyName: companyName.trim() || 'Factory / Plant Name',
      companySubtitle: companySubtitle.trim(),
      logoDataUrl: logoDataUrl || '',
      storeInchargeSignatureDataUrl: storeInchargeSignatureDataUrl || '',
      address: address.trim(),
      phone: phone.trim(),
      email: email.trim(),
      gstin: gstin.trim(),
      ticketPrefix: ticketPrefix.trim().toUpperCase() || 'TK',
      autoPrintTokenAfterSave,
      sessionIdleMinutes: Math.max(5, Math.min(720, Number(sessionIdleMinutes) || 30)),
      gates: finalGates,
      ...(settings.whatsappTemplates ? { whatsappTemplates: settings.whatsappTemplates } : {}),
    };
  };

  const handleSaveAsDefault = async () => {
    const updated = buildCurrentSettings();
    try {
      const saved = await ApiClient.saveAsDefaultSettings(updated);
      setGates(saved.gates);
      setNewGateName('');
      StorageService.saveAsDefaultSettings(saved);
      onSave(saved);
      showFeedback('success', 'Current settings saved as Default! All fields and loading gates are now saved as default.');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save default settings.');
    }
  };

  const handleRestoreDefault = () => {
    const def = StorageService.getDefaultSettings();
    setCompanyName(def.companyName);
    setCompanySubtitle(def.companySubtitle);
    setLogoDataUrl(def.logoDataUrl || '');
    setStoreInchargeSignatureDataUrl(def.storeInchargeSignatureDataUrl || '');
    setAddress(def.address);
    setPhone(def.phone);
    setEmail(def.email);
    setGstin(def.gstin);
    setTicketPrefix(def.ticketPrefix || 'TK');
    setAutoPrintTokenAfterSave(def.autoPrintTokenAfterSave ?? true);
    setSessionIdleMinutes(def.sessionIdleMinutes || 30);
    setGates([...def.gates]);
    setNewGateName('');
    showFeedback('success', 'Loaded saved default settings into form. Click Save Settings to apply.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = buildCurrentSettings();
    try {
      const saved = await ApiClient.saveSettings(updated);
      StorageService.saveSettings(saved);
      onSave(saved);
      onClose();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save settings.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Settings className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Plant & System Settings</h2>
              <p className="text-xs text-neutral-300">
                Print Header, Company Info & Loading Gates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Company Logo Upload & Live Preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-700" />
                <span className="text-xs font-bold text-neutral-800 tracking-wide">
                  Company Logo (Shown Everywhere)
                </span>
              </div>
              <span className="text-[10px] font-semibold text-neutral-500">
                PNG, JPG, WebP or SVG
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Live Header Preview Box */}
              <div className="flex items-center gap-3 bg-[#354A5F] text-white px-3 py-2.5 rounded-xl border border-[#223242] flex-1 min-w-0">
                <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-[#F0AB00]/70 p-1">
                  {logoDataUrl ? (
                    <img
                      src={logoDataUrl}
                      alt="Company Logo Preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full rounded bg-gradient-to-br from-[#0A6ED1] to-[#004A99] flex items-center justify-center text-[#F0AB00]">
                      <Building2 className="w-5 h-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-wide truncate text-white">
                    {companyName || 'Company / Plant Name'}
                  </p>
                  <p className="text-[10px] text-[#CBD8E6] truncate">
                    {companySubtitle || 'App Header, Login, Slips & All PDFs'}
                  </p>
                </div>
              </div>

              {/* Upload / Remove Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={logoProcessing}
                  onClick={() => logoInputRef.current?.click()}
                  className="app-btn-sm bg-blue-700 hover:bg-blue-600 text-white shadow-xs"
                >
                  {logoProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{logoDataUrl ? 'Change Logo' : 'Upload Logo'}</span>
                </button>

                {logoDataUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="app-btn-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"
                    title="Remove uploaded logo"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Store Incharge Digital Signature Upload & Preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <PenTool className="w-4 h-4 text-blue-700" />
                <span className="text-xs font-bold text-neutral-800 tracking-wide">
                  Default Store Incharge Signature (Fallback)
                </span>
              </div>
              <span className="text-[10px] font-semibold text-neutral-500">
                PNG, JPG, WebP or SVG
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Live Signature Box Preview (matches Loading Slip layout) */}
              <div className="bg-white border border-neutral-300 rounded-xl px-3 py-2 flex-1 min-w-0 flex flex-col items-center justify-between min-h-[68px]">
                <span className="text-[10px] font-bold text-neutral-700">
                  Store Incharge Signature
                </span>
                <div className="h-8 w-full flex items-center justify-center my-0.5">
                  {storeInchargeSignatureDataUrl ? (
                    <img
                      src={storeInchargeSignatureDataUrl}
                      alt="Store Incharge Digital Signature Preview"
                      className="max-h-8 max-w-[180px] object-contain"
                    />
                  ) : (
                    <span className="text-[10px] text-neutral-400 italic">
                      No fallback signature uploaded
                    </span>
                  )}
                </div>
                <div className="w-full border-t border-dashed border-neutral-300 pt-0.5 text-center">
                  <span className="text-[9.5px] font-semibold text-neutral-500">
                    Printed as Store Incharge signature on all generated Loading Slips
                  </span>
                </div>
              </div>

              {/* Upload / Remove Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={signatureInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={handleSignatureUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={signatureProcessing}
                  onClick={() => signatureInputRef.current?.click()}
                  className="app-btn-sm bg-blue-700 hover:bg-blue-600 text-white shadow-xs"
                >
                  {signatureProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{storeInchargeSignatureDataUrl ? 'Change Signature' : 'Upload Signature'}</span>
                </button>

                {storeInchargeSignatureDataUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveSignature}
                    className="app-btn-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"
                    title="Remove uploaded signature"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-neutral-700 block mb-1">
              Company / Plant Name *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-neutral-700 block mb-1">
              Subtitle / Tagline
            </label>
            <input
              type="text"
              value={companySubtitle}
              onChange={(e) => setCompanySubtitle(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-neutral-700 block mb-1">
              Plant / Factory Address
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Helpdesk / Phone Number
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                GSTIN / Tax ID
              </label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono uppercase rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-neutral-700 block mb-1">
              Ticket Number Prefix
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={ticketPrefix}
                onChange={(e) => setTicketPrefix(e.target.value)}
                placeholder="e.g. TK"
                className="w-24 px-3 py-1.5 text-xs font-bold uppercase rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
              <span className="text-[11px] text-neutral-500">
                (Preview: {ticketPrefix}-20261113-001)
              </span>
            </div>
          </div>

          {/* Auto-Print Token After Save Default Toggle */}
          <div className="p-3 bg-blue-50/80 rounded-xl border border-blue-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-blue-950 block">
                Auto-Print Token After Save (Default)
              </span>
              <p className="text-[11px] text-blue-800">
                Immediately trigger ticket print view right after registering a new vehicle entry.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoPrintTokenAfterSave}
              onChange={(e) => setAutoPrintTokenAfterSave(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded border-blue-300 focus:ring-blue-500 cursor-pointer"
            />
          </div>

          {/* WhatsApp Notification Logs & Templates */}
          {((canViewWhatsAppLogs && onOpenWhatsAppLogs) || (isAdmin && onOpenWhatsAppTemplates)) && (
            <div className="bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-bold text-emerald-950 block">
                  WhatsApp Messaging &amp; Logs
                </span>
                <p className="text-[11px] text-emerald-800">
                  Review dispatch delivery logs, retry failed sends, or edit message templates.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {canViewWhatsAppLogs && onOpenWhatsAppLogs && (
                  <button
                    type="button"
                    onClick={onOpenWhatsAppLogs}
                    className="app-btn-sm bg-[#2B3E50] hover:bg-[#3A526A] text-white border border-[#4A6580]"
                    title="Automatic WhatsApp Notification Logs & Retry"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#68D391] shrink-0" />
                    <span>WA Logs</span>
                    {waPendingRetryCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-black rounded-full bg-[#BB0000] text-white tabular-nums">
                        {waPendingRetryCount}
                      </span>
                    )}
                  </button>
                )}

                {isAdmin && onOpenWhatsAppTemplates && (
                  <button
                    type="button"
                    onClick={onOpenWhatsAppTemplates}
                    className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white border border-[#24A159]"
                    title="Admin: Customize WhatsApp Message Templates"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>WA Templates</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* GitHub Repository & Cloud Deployment */}
          {isAdmin && (
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                  <span>GitHub Repository &amp; Cloud Sync</span>
                </span>
                <p className="text-[11px] text-slate-600 mt-0.5 break-all">
                  Connected repo: <span className="font-mono font-semibold text-slate-800">newshuntexpress/loadingmanager.store</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    const repoUrl = 'https://github.com/newshuntexpress/loadingmanager.store.git';
                    try {
                      await navigator.clipboard.writeText(repoUrl);
                      showFeedback('success', 'Copied GitHub repository URL to clipboard.');
                    } catch {
                      showFeedback('error', `Repository URL: ${repoUrl}`);
                    }
                  }}
                  className="app-btn-sm bg-slate-800 hover:bg-slate-700 text-white border border-slate-600"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Copy Git URL</span>
                </button>
              </div>
            </div>
          )}

          {/* Gate Management */}
          <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
            <label className="text-xs font-bold text-neutral-800 uppercase tracking-wide block mb-2 flex items-center gap-1.5">
              <DoorOpen className="w-4 h-4 text-blue-700" />
              <span>Available Loading Gates:</span>
            </label>

            <div className="flex flex-wrap gap-2 mb-3">
              {gates.map((g) => (
                <div
                  key={g}
                  className="bg-white border border-neutral-300 px-3 py-1.5 rounded-xl shadow-sm text-xs font-bold text-neutral-800 flex items-center gap-2"
                >
                  <span>{g}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveGate(g)}
                    className="text-neutral-400 hover:text-red-500 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newGateName}
                onChange={(e) => setNewGateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddGate();
                  }
                }}
                placeholder="New gate name e.g. Gate 5"
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleAddGate}
                className="bg-neutral-800 hover:bg-neutral-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Gate</span>
              </button>
            </div>
          </div>

          {feedback && (
            <div
              className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-red-50 text-red-800 border-red-200'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pt-3 border-t border-neutral-200">
            <div className="grid grid-cols-2 md:flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="app-btn w-full md:w-auto md:min-w-[110px] text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreDefault}
                className="app-btn w-full md:w-auto text-neutral-700 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300"
                title="Load saved default settings"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>Restore Default</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAsDefault}
                className="app-btn w-full md:w-auto bg-emerald-700 hover:bg-emerald-600 text-white shadow"
                title="Save all current fields & loading gates as permanent default"
              >
                <BookmarkCheck className="w-4 h-4 shrink-0" />
                <span>Save as Default</span>
              </button>
              <button
                type="submit"
                className="app-btn w-full md:w-auto bg-blue-700 hover:bg-blue-600 text-white shadow-lg shadow-blue-700/30"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>Save Settings</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
