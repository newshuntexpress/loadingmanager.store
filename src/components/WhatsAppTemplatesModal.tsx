import React, { useMemo, useRef, useState } from 'react';
import { CompanySettings, TicketRecord } from '../types';
import { ApiClient } from '../services/api';
import { StorageService } from '../services/storage';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  WHATSAPP_MANAGED_TEMPLATES,
  WHATSAPP_TEMPLATE_VARIABLES,
  WhatsAppTemplateId,
  buildTicketTemplateValues,
  renderWhatsAppTemplateString,
} from '../utils/whatsapp';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';

interface WhatsAppTemplatesModalProps {
  settings: CompanySettings;
  onSaved: (updatedSettings: CompanySettings) => void;
  onClose: () => void;
}

const SAMPLE_TICKET: TicketRecord = {
  id: 'sample-preview',
  ticketNumber: 'AWZR-20261120-001',
  sequenceNumber: 1,
  date: '2026-11-20',
  timeIn: '08:40 AM',
  gateNumber: 'Gate 2',
  gateSequenceNumber: 1,
  truckNumber: '5332 AXG',
  driverName: 'FAYAZ',
  driverPhone: '+966595755375',
  transporterName: 'AWAZEL',
  destinationPlace: 'RIYADH LOCAL',
  delNoteNumber: 'A1DD002525',
  status: 'called',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  loadingSlip: {
    delNoteNumber: 'A1DD002525',
    placeName: 'RIYADH LOCAL',
    items: [],
    totalQty: 565,
    totalPallets: 24,
    totalLooseRolls: 13,
    preparedBy: 'Store Incharge',
    checkedBy: 'Forklift Operator',
    createdAt: '2026-11-20',
  },
};

export const WhatsAppTemplatesModal: React.FC<WhatsAppTemplatesModalProps> = ({
  settings,
  onSaved,
  onClose,
}) => {
  const initialDrafts = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tpl of WHATSAPP_MANAGED_TEMPLATES) {
      const savedCustom = settings.whatsappTemplates?.[tpl.id];
      map[tpl.id] =
        typeof savedCustom === 'string' && savedCustom.trim().length > 0
          ? savedCustom
          : tpl.defaultBody;
    }
    return map;
  }, [settings.whatsappTemplates]);

  const [drafts, setDrafts] = useState<Record<string, string>>(initialDrafts);
  const [selectedId, setSelectedId] = useState<string>(WHATSAPP_MANAGED_TEMPLATES[0].id);
  const [showAllVariables, setShowAllVariables] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedTemplate =
    WHATSAPP_MANAGED_TEMPLATES.find((t) => t.id === selectedId) || WHATSAPP_MANAGED_TEMPLATES[0];

  const currentBody = drafts[selectedTemplate.id] ?? selectedTemplate.defaultBody;
  const isSelectedCustomized = currentBody !== selectedTemplate.defaultBody;

  const customizedCount = useMemo(
    () =>
      WHATSAPP_MANAGED_TEMPLATES.filter(
        (t) => (drafts[t.id] ?? t.defaultBody) !== t.defaultBody
      ).length,
    [drafts]
  );

  const hasUnsavedChanges = useMemo(
    () =>
      WHATSAPP_MANAGED_TEMPLATES.some(
        (t) => (drafts[t.id] ?? t.defaultBody) !== (initialDrafts[t.id] ?? t.defaultBody)
      ),
    [drafts, initialDrafts]
  );

  const sampleValues = useMemo(
    () =>
      buildTicketTemplateValues(SAMPLE_TICKET, settings.companyName, {
        statusLabel: 'Waiting in Queue',
        liveStatusUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://dispatch.example.com'}/driver-loading-status/sample-token`,
      }),
    [settings.companyName]
  );

  const renderedPreview = useMemo(
    () => renderWhatsAppTemplateString(currentBody, sampleValues),
    [currentBody, sampleValues]
  );

  const displayedVariables = useMemo(() => {
    if (showAllVariables) return WHATSAPP_TEMPLATE_VARIABLES;
    const preferred = new Set(selectedTemplate.variables);
    return WHATSAPP_TEMPLATE_VARIABLES.filter((v) => preferred.has(v.key));
  }, [selectedTemplate.variables, showAllVariables]);

  const handleInsertVariable = (token: string) => {
    const textarea = textareaRef.current;
    const prev = drafts[selectedTemplate.id] ?? selectedTemplate.defaultBody;
    if (!textarea) {
      setDrafts((cur) => ({ ...cur, [selectedTemplate.id]: `${prev}${token}` }));
      return;
    }
    const start = textarea.selectionStart ?? prev.length;
    const end = textarea.selectionEnd ?? prev.length;
    const next = prev.slice(0, start) + token + prev.slice(end);
    setDrafts((cur) => ({ ...cur, [selectedTemplate.id]: next }));
    setFeedback(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorPos = start + token.length;
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };

  const handleResetSingle = () => {
    setDrafts((cur) => ({
      ...cur,
      [selectedTemplate.id]: selectedTemplate.defaultBody,
    }));
    setFeedback(null);
    setConfirmResetAll(false);
  };

  const handleResetAll = () => {
    if (!confirmResetAll) {
      setConfirmResetAll(true);
      return;
    }
    const resetMap: Record<string, string> = {};
    for (const tpl of WHATSAPP_MANAGED_TEMPLATES) {
      resetMap[tpl.id] = tpl.defaultBody;
    }
    setDrafts(resetMap);
    setConfirmResetAll(false);
    setFeedback({
      type: 'success',
      text: 'All templates restored to default text. Click "Save Templates" to apply.',
    });
  };

  const handleCopyPreview = () => {
    navigator.clipboard.writeText(renderedPreview);
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 1800);
  };

  const handleSave = async () => {
    // Validate non-empty templates
    for (const tpl of WHATSAPP_MANAGED_TEMPLATES) {
      const val = (drafts[tpl.id] ?? '').trim();
      if (!val) {
        setSelectedId(tpl.id);
        setFeedback({
          type: 'error',
          text: `Template "${tpl.titleEnglish}" (${tpl.id}) cannot be blank. Use "Reset Default" to restore its standard text.`,
        });
        return;
      }
    }

    setSaving(true);
    setFeedback(null);
    try {
      const customOnly: Record<string, string> = {};
      for (const tpl of WHATSAPP_MANAGED_TEMPLATES) {
        const val = drafts[tpl.id] ?? tpl.defaultBody;
        if (val !== DEFAULT_WHATSAPP_TEMPLATES[tpl.id as WhatsAppTemplateId]) {
          customOnly[tpl.id] = val;
        }
      }

      const res = await ApiClient.updateWhatsAppTemplates(customOnly);
      StorageService.saveSettings(res.settings);
      onSaved(res.settings);
      setFeedback({
        type: 'success',
        text: 'WhatsApp message templates saved and synced for all operators.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Unable to save WhatsApp templates.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-preserve-case="true"
      role="dialog"
      aria-modal="true"
      aria-label="Customize WhatsApp Message Templates"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-[#C8D6E5] w-full max-w-5xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#354A5F] text-white px-5 py-3.5 flex items-center justify-between gap-3 border-b border-[#223242] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[#107E3E] rounded-xl text-white shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold truncate">
                WhatsApp Message Templates
              </h2>
              <p className="text-xs text-[#CBD8E6] truncate">
                Administrator editor for gate notifications, dispatch alerts &amp; live status messages
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close WhatsApp templates editor"
            className="p-1.5 rounded-lg text-[#CBD8E6] hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left Selector Column */}
            <div className="lg:col-span-4 space-y-2">
              <div className="flex items-center justify-between px-1 pb-1 border-b border-[#E3EAF2]">
                <span className="text-xs font-bold text-[#354A5F]">Available Templates</span>
                <span className="text-[11px] font-mono text-[#5B738B] tabular-nums">
                  {customizedCount}/{WHATSAPP_MANAGED_TEMPLATES.length} Custom
                </span>
              </div>

              <div className="space-y-1.5">
                {WHATSAPP_MANAGED_TEMPLATES.map((tpl) => {
                  const isActive = tpl.id === selectedTemplate.id;
                  const isEdited = (drafts[tpl.id] ?? tpl.defaultBody) !== tpl.defaultBody;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(tpl.id);
                        setFeedback(null);
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                        isActive
                          ? 'bg-[#EFF6FF] border-[#0A6ED1] ring-2 ring-[#0A6ED1]/15'
                          : 'bg-[#F8FAFC] border-[#DDE6F0] hover:bg-[#F1F5F9] hover:border-[#BCC8D4]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#1C2833] truncate">
                          {tpl.titleHindi}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#5B738B] truncate">
                        <span className="font-mono text-[#0A6ED1]">{tpl.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{tpl.category === 'automated' ? 'Auto Cloud API' : 'Manual Alert'}</span>
                        <span aria-hidden="true">·</span>
                        <span className={isEdited ? 'font-bold text-[#107E3E]' : 'text-[#64748B]'}>
                          {isEdited ? 'Customized' : 'Default'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Editor + Preview Column */}
            <div className="lg:col-span-8 space-y-3.5">
              {/* Template Title & Per-Template Reset */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#E3EAF2]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-[#1C2833]">
                      {selectedTemplate.titleEnglish}
                    </h3>
                    <span className="text-xs font-mono text-[#0A6ED1]">
                      {selectedTemplate.id}
                    </span>
                  </div>
                  <p className="text-xs text-[#5B738B] mt-0.5">
                    {selectedTemplate.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleResetSingle}
                  disabled={!isSelectedCustomized}
                  className="app-btn-sm bg-white hover:bg-[#F1F5F9] text-[#354A5F] border border-[#BCC8D4] disabled:opacity-45 self-start sm:self-auto"
                  title="Restore this template to its default wording"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Reset Default</span>
                </button>
              </div>

              {/* Dynamic Variable Insertion Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#354A5F]">
                    Insert Dynamic Variable
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllVariables((v) => !v)}
                    className="text-[11px] font-semibold text-[#0A6ED1] hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {showAllVariables ? 'Show Recommended Only' : 'Show All Variables'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {displayedVariables.map((variable) => (
                    <button
                      key={variable.key}
                      type="button"
                      onClick={() => handleInsertVariable(variable.token)}
                      title={`Insert ${variable.token} (Example: ${variable.sampleValue})`}
                      className="px-2.5 py-1 rounded-lg border border-[#C8D6E5] bg-[#F8FAFC] hover:bg-[#EFF6FF] hover:border-[#0A6ED1] text-[11px] font-mono font-semibold text-[#1C2833] transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      + {variable.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Textarea */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="wa-template-editor" className="font-bold text-[#354A5F]">
                    Template Message Content
                  </label>
                  <span className="text-[11px] font-mono text-[#5B738B] tabular-nums">
                    {currentBody.length} / 4000 chars
                  </span>
                </div>
                <textarea
                  id="wa-template-editor"
                  ref={textareaRef}
                  data-preserve-case="true"
                  rows={9}
                  maxLength={4000}
                  value={currentBody}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDrafts((cur) => ({ ...cur, [selectedTemplate.id]: val }));
                    setFeedback(null);
                    setConfirmResetAll(false);
                  }}
                  placeholder="Enter WhatsApp template message using *bold* and {{variable}} placeholders..."
                  className="w-full p-3 text-xs sm:text-[13px] leading-relaxed rounded-xl border border-[#BCC8D4] bg-white text-[#1C2833] font-mono focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] focus:border-transparent"
                />
                <p className="text-[11px] text-[#5B738B]">
                  Supports WhatsApp formatting (*bold*, _italic_) and dynamic placeholders such as{' '}
                  <span className="font-mono text-[#1C2833]">{'{{driverName}}'}</span> and{' '}
                  <span className="font-mono text-[#1C2833]">{'{{truckNumber}}'}</span>.
                </p>
              </div>

              {/* Live Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#354A5F]">
                    Live Sample Preview ({SAMPLE_TICKET.truckNumber} · {SAMPLE_TICKET.gateNumber})
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPreview}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#5B738B] hover:text-[#107E3E] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedPreview ? (
                      <Check className="w-3.5 h-3.5 text-[#107E3E]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedPreview ? 'Copied' : 'Copy Preview'}</span>
                  </button>
                </div>

                <div className="rounded-xl border border-[#BFE3CE] bg-[#EFEAE2] p-3">
                  <div className="bg-[#DCF8C6] border border-[#9CD8B5] rounded-xl p-3 text-[#1C2833] text-xs sm:text-[13px] font-sans whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto shadow-xs">
                    {renderedPreview || 'Preview will appear here as you type...'}
                  </div>
                </div>
              </div>

              {feedback && (
                <div
                  className={`flex items-center gap-2 p-3 rounded-xl text-xs font-semibold border ${
                    feedback.type === 'success'
                      ? 'bg-[#F1FDF6] text-[#0D4A26] border-[#72C896]'
                      : 'bg-[#FFF0F0] text-[#BB0000] border-[#F4B8B8]'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#107E3E] shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-[#BB0000] shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-t border-[#D1DBE5] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="text-xs text-[#5B738B] tabular-nums">
            {hasUnsavedChanges
              ? 'You have unsaved template changes.'
              : customizedCount > 0
              ? `${customizedCount} template${customizedCount === 1 ? '' : 's'} customized.`
              : 'All templates are using system defaults.'}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetAll}
              disabled={customizedCount === 0 || saving}
              className={`app-btn ${
                confirmResetAll
                  ? 'bg-[#FFF0F0] hover:bg-[#FFE1E1] text-[#BB0000] border border-[#F4B8B8]'
                  : 'bg-white hover:bg-[#F1F5F9] text-[#354A5F] border border-[#BCC8D4]'
              }`}
              title="Reset all WhatsApp templates back to factory defaults"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>{confirmResetAll ? 'Confirm Reset All' : 'Reset All'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="app-btn bg-white hover:bg-[#F1F5F9] text-[#354A5F] border border-[#BCC8D4]"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white border border-[#24A159]"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Save className="w-4 h-4 shrink-0" />
              )}
              <span>{saving ? 'Saving...' : 'Save Templates'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
