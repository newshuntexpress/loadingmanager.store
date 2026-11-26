import React, { useRef, useState } from 'react';
import { CompanySettings, PlantConfig, PlantSpecificSettings } from '../types';
import {
  DEFAULT_JEDDAH_SETTINGS,
  DEFAULT_PLANTS,
  StorageService,
  mergeSettingsWithDefaults,
  resolveSettingsForPlant,
} from '../services/storage';
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
  MapPin,
} from 'lucide-react';

interface SettingsModalProps {
  settings: CompanySettings;
  activePlantId?: string;
  isAdmin?: boolean;
  canViewWhatsAppLogs?: boolean;
  waPendingRetryCount?: number;
  onOpenWhatsAppLogs?: () => void;
  onOpenWhatsAppTemplates?: () => void;
  onSave: (newSettings: CompanySettings) => void;
  onClose: () => void;
}

function buildInitialPlantMap(settings: CompanySettings): Record<string, PlantSpecificSettings> {
  const merged = mergeSettingsWithDefaults(settings);
  const map: Record<string, PlantSpecificSettings> = {
    ...(merged.plantSettingsMap || {}),
  };
  if (!map.JEDDAH) {
    map.JEDDAH = { ...DEFAULT_JEDDAH_SETTINGS };
  }
  return map;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  activePlantId = 'RIYADH',
  isAdmin = false,
  canViewWhatsAppLogs = true,
  waPendingRetryCount = 0,
  onOpenWhatsAppLogs,
  onOpenWhatsAppTemplates,
  onSave,
  onClose,
}) => {
  const initialPlants =
    Array.isArray(settings.plants) && settings.plants.length > 0 ? settings.plants : DEFAULT_PLANTS;
  const initialEditingPlant = (() => {
    const clean = (activePlantId || 'RIYADH').trim().toUpperCase();
    if (clean && clean !== 'ALL' && initialPlants.some((p) => p.id.toUpperCase() === clean)) {
      return clean;
    }
    return 'RIYADH';
  })();

  const [editingPlantId, setEditingPlantId] = useState<string>(initialEditingPlant);
  const [baseSettings, setBaseSettings] = useState<CompanySettings>(() =>
    mergeSettingsWithDefaults(settings)
  );
  const [plantSettingsMap, setPlantSettingsMap] = useState<Record<string, PlantSpecificSettings>>(() =>
    buildInitialPlantMap(settings)
  );

  const initialResolved = resolveSettingsForPlant(
    {
      ...mergeSettingsWithDefaults(settings),
      plantSettingsMap: buildInitialPlantMap(settings),
    },
    initialEditingPlant
  );
  const initialOwnOverride =
    initialEditingPlant === 'RIYADH'
      ? undefined
      : buildInitialPlantMap(settings)[initialEditingPlant];

  const [companyName, setCompanyName] = useState(initialResolved.companyName);
  const [companySubtitle, setCompanySubtitle] = useState(initialResolved.companySubtitle);
  const [logoDataUrl, setLogoDataUrl] = useState<string>(
    initialEditingPlant === 'RIYADH'
      ? initialResolved.logoDataUrl || ''
      : initialOwnOverride?.logoDataUrl || ''
  );
  const [logoProcessing, setLogoProcessing] = useState<boolean>(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [storeInchargeSignatureDataUrl, setStoreInchargeSignatureDataUrl] = useState<string>(
    initialEditingPlant === 'RIYADH'
      ? initialResolved.storeInchargeSignatureDataUrl || ''
      : initialOwnOverride?.storeInchargeSignatureDataUrl || ''
  );
  const [signatureProcessing, setSignatureProcessing] = useState<boolean>(false);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(initialResolved.address);
  const [phone, setPhone] = useState(initialResolved.phone);
  const [email, setEmail] = useState(initialResolved.email);
  const [gstin, setGstin] = useState(initialResolved.gstin);
  const [ticketPrefix, setTicketPrefix] = useState(initialResolved.ticketPrefix || 'AWZR');
  const [autoPrintTokenAfterSave, setAutoPrintTokenAfterSave] = useState(
    settings.autoPrintTokenAfterSave ?? true
  );
  const [sessionIdleMinutes, setSessionIdleMinutes] = useState<number>(
    settings.sessionIdleMinutes || 30
  );
  const [gates, setGates] = useState<string[]>([...initialResolved.gates]);
  const [newGateName, setNewGateName] = useState('');
  const [plants, setPlants] = useState<PlantConfig[]>(initialPlants);
  const [newPlantName, setNewPlantName] = useState('');
  const [newPlantCode, setNewPlantCode] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isEditingRiyadh = editingPlantId === 'RIYADH';
  const activePlantConfig =
    plants.find((p) => p.id.toUpperCase() === editingPlantId) ||
    DEFAULT_PLANTS.find((p) => p.id === editingPlantId) ||
    DEFAULT_PLANTS[0];

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Flush current form fields into baseSettings + plantSettingsMap snapshot
  const captureCurrentFormDraft = (): {
    nextBase: CompanySettings;
    nextMap: Record<string, PlantSpecificSettings>;
  } => {
    const finalGates = [...gates];
    const pendingGate = newGateName.trim();
    if (pendingGate && !finalGates.includes(pendingGate)) {
      finalGates.push(pendingGate);
    }

    const nextPlants = plants.length > 0 ? plants : DEFAULT_PLANTS;
    const nextMap: Record<string, PlantSpecificSettings> = { ...plantSettingsMap };
    let nextBase: CompanySettings = {
      ...baseSettings,
      autoPrintTokenAfterSave,
      sessionIdleMinutes: Math.max(5, Math.min(720, Number(sessionIdleMinutes) || 30)),
      plants: nextPlants,
      ...(settings.plantGates ? { plantGates: settings.plantGates } : {}),
      ...(settings.whatsappTemplates ? { whatsappTemplates: settings.whatsappTemplates } : {}),
    };

    const trimmedPrefix =
      ticketPrefix.trim().toUpperCase() ||
      (isEditingRiyadh ? 'AWZR' : `${activePlantConfig.code || editingPlantId.slice(0, 3)}`);

    if (isEditingRiyadh) {
      nextBase = {
        ...nextBase,
        companyName: companyName.trim() || 'Factory / Plant Name',
        companySubtitle: companySubtitle.trim(),
        logoDataUrl: logoDataUrl || '',
        storeInchargeSignatureDataUrl: storeInchargeSignatureDataUrl || '',
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gstin: gstin.trim(),
        ticketPrefix: trimmedPrefix,
        gates: finalGates,
      };
      delete nextMap.RIYADH;
    } else {
      const entry: PlantSpecificSettings = {
        companyName: companyName.trim() || `${nextBase.companyName} - ${activePlantConfig.name.toUpperCase()}`,
        companySubtitle: companySubtitle.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gstin: gstin.trim(),
        ticketPrefix: trimmedPrefix,
        gates: finalGates,
      };
      if (logoDataUrl.trim()) {
        entry.logoDataUrl = logoDataUrl.trim();
      }
      if (storeInchargeSignatureDataUrl.trim()) {
        entry.storeInchargeSignatureDataUrl = storeInchargeSignatureDataUrl.trim();
      }
      nextMap[editingPlantId] = entry;
    }

    return { nextBase, nextMap };
  };

  const loadPlantIntoForm = (
    targetPlantId: string,
    draftBase: CompanySettings,
    draftMap: Record<string, PlantSpecificSettings>
  ) => {
    const cleanTarget = targetPlantId.trim().toUpperCase();
    const synthetic: CompanySettings = {
      ...draftBase,
      plantSettingsMap: draftMap,
    };
    const resolved = resolveSettingsForPlant(synthetic, cleanTarget);
    const ownOverride = cleanTarget === 'RIYADH' ? undefined : draftMap[cleanTarget];

    setCompanyName(resolved.companyName);
    setCompanySubtitle(resolved.companySubtitle);
    setLogoDataUrl(
      cleanTarget === 'RIYADH' ? resolved.logoDataUrl || '' : ownOverride?.logoDataUrl || ''
    );
    setStoreInchargeSignatureDataUrl(
      cleanTarget === 'RIYADH'
        ? resolved.storeInchargeSignatureDataUrl || ''
        : ownOverride?.storeInchargeSignatureDataUrl || ''
    );
    setAddress(resolved.address);
    setPhone(resolved.phone);
    setEmail(resolved.email);
    setGstin(resolved.gstin);
    setTicketPrefix(resolved.ticketPrefix || 'TK');
    setGates([...resolved.gates]);
    setNewGateName('');
    setEditingPlantId(cleanTarget);
    setFeedback(null);
  };

  const handleSelectPlantTab = (targetPlantId: string) => {
    const cleanTarget = targetPlantId.trim().toUpperCase();
    if (cleanTarget === editingPlantId) return;
    const { nextBase, nextMap } = captureCurrentFormDraft();
    setBaseSettings(nextBase);
    setPlantSettingsMap(nextMap);
    loadPlantIntoForm(cleanTarget, nextBase, nextMap);
  };

  const handleCopyFromRiyadh = () => {
    if (isEditingRiyadh) return;
    const { nextBase } = captureCurrentFormDraft();
    setCompanyName(`${nextBase.companyName} - ${activePlantConfig.name.toUpperCase()}`);
    setCompanySubtitle(`${activePlantConfig.name} • ${nextBase.companySubtitle}`);
    setAddress(activePlantConfig.city ? `${activePlantConfig.city} Industrial City, KSA` : nextBase.address);
    setPhone(nextBase.phone);
    setEmail(nextBase.email);
    setGstin(nextBase.gstin);
    setGates([...nextBase.gates]);
    showFeedback(
      'success',
      `Copied base company info & gates into ${activePlantConfig.name}. Review fields and click "Save Settings".`
    );
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

  const handleAddPlant = () => {
    const cleanName = newPlantName.trim();
    const cleanId = cleanName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
    const cleanCode = (newPlantCode.trim() || cleanId.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!cleanName || !cleanId) {
      showFeedback('error', 'Enter a valid Plant Name (e.g. Dammam Plant).');
      return;
    }
    if (plants.some((p) => p.id === cleanId || p.name.toLowerCase() === cleanName.toLowerCase())) {
      showFeedback('error', 'This plant already exists.');
      return;
    }
    const newPlant: PlantConfig = {
      id: cleanId,
      name: cleanName,
      code: cleanCode || cleanId.slice(0, 3),
      isActive: true,
    };
    setPlants([...plants, newPlant]);
    setNewPlantName('');
    setNewPlantCode('');
    setFeedback(null);
  };

  const handleTogglePlantActive = (id: string) => {
    if (id === 'RIYADH') return;
    setPlants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p))
    );
  };

  const handleRemovePlant = (id: string) => {
    if (id === 'RIYADH' || id === 'JEDDAH') {
      showFeedback('error', 'Core plants (Riyadh & Jeddah) cannot be deleted.');
      return;
    }
    if (editingPlantId === id) {
      handleSelectPlantTab('RIYADH');
    }
    setPlants((prev) => prev.filter((p) => p.id !== id));
    setPlantSettingsMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoProcessing(true);
    try {
      const normalizedPng = await processLogoFile(file);
      setLogoDataUrl(normalizedPng);
      showFeedback(
        'success',
        `${activePlantConfig.name} logo uploaded! Click "Save Settings" or "Save as Default" to apply.`
      );
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to process selected logo image.');
    } finally {
      setLogoProcessing(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoDataUrl('');
    showFeedback(
      'success',
      isEditingRiyadh
        ? 'Logo removed. Click "Save Settings" to apply.'
        : 'Plant-specific logo cleared (will fall back to main company logo). Click "Save Settings" to apply.'
    );
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
        `${activePlantConfig.name} signature uploaded! Click "Save Settings" or "Save as Default" to show it on Loading Slips.`
      );
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to process selected signature image.');
    } finally {
      setSignatureProcessing(false);
    }
  };

  const handleRemoveSignature = () => {
    setStoreInchargeSignatureDataUrl('');
    showFeedback(
      'success',
      isEditingRiyadh
        ? 'Digital signature removed. Click "Save Settings" to apply.'
        : 'Plant-specific signature cleared (will fall back to default/user signature). Click "Save Settings" to apply.'
    );
  };

  const buildCurrentSettings = (): CompanySettings => {
    const { nextBase, nextMap } = captureCurrentFormDraft();
    return {
      ...nextBase,
      plantSettingsMap: nextMap,
    };
  };

  const validateSerializedSize = (candidate: CompanySettings): boolean => {
    const byteLen = JSON.stringify(candidate).length;
    if (byteLen > 340000) {
      showFeedback(
        'error',
        'Combined logos & signatures across plants exceed cloud sync size (340KB). Please remove duplicate plant logos or upload smaller images.'
      );
      return false;
    }
    return true;
  };

  const handleSaveAsDefault = async () => {
    const updated = buildCurrentSettings();
    if (!validateSerializedSize(updated)) return;
    try {
      const saved = await ApiClient.saveAsDefaultSettings(updated);
      const merged = mergeSettingsWithDefaults(saved);
      setBaseSettings(merged);
      setPlantSettingsMap(buildInitialPlantMap(merged));
      setPlants(Array.isArray(merged.plants) && merged.plants.length > 0 ? merged.plants : DEFAULT_PLANTS);
      loadPlantIntoForm(editingPlantId, merged, buildInitialPlantMap(merged));
      StorageService.saveAsDefaultSettings(merged);
      onSave(merged);
      showFeedback('success', 'Settings saved as Default across Riyadh, Jeddah & all plants!');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save default settings.');
    }
  };

  const handleRestoreDefault = () => {
    const def = mergeSettingsWithDefaults(StorageService.getDefaultSettings());
    const defMap = buildInitialPlantMap(def);
    setBaseSettings(def);
    setPlantSettingsMap(defMap);
    setAutoPrintTokenAfterSave(def.autoPrintTokenAfterSave ?? true);
    setSessionIdleMinutes(def.sessionIdleMinutes || 30);
    setPlants(Array.isArray(def.plants) && def.plants.length > 0 ? def.plants : DEFAULT_PLANTS);
    loadPlantIntoForm(editingPlantId, def, defMap);
    showFeedback(
      'success',
      `Loaded saved default settings for ${activePlantConfig.name}. Click Save Settings to apply.`
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = buildCurrentSettings();
    if (!validateSerializedSize(updated)) return;
    try {
      const saved = await ApiClient.saveSettings(updated);
      const merged = mergeSettingsWithDefaults(saved);
      StorageService.saveSettings(merged);
      onSave(merged);
      onClose();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save settings.');
    }
  };

  const effectivePreviewLogo = logoDataUrl || (!isEditingRiyadh ? baseSettings.logoDataUrl || '' : '');
  const effectivePreviewSignature =
    storeInchargeSignatureDataUrl ||
    (!isEditingRiyadh ? baseSettings.storeInchargeSignatureDataUrl || '' : '');
  const effectivePreviewPrefix =
    ticketPrefix.trim().toUpperCase() ||
    (isEditingRiyadh ? 'AWZR' : `AWZ-${activePlantConfig.code || editingPlantId.slice(0, 3)}`);

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
                Per-Plant Loading Slip Header, Company Info, Prefix & Loading Gates
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
          {/* Active Plant Profile Selector Tabs */}
          <div className="bg-[#EEF4FA] border border-[#BFD5EB] rounded-xl p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#0A6ED1]" />
                <span className="text-xs font-black text-[#1C2833] uppercase tracking-wide">
                  Select Plant Settings Profile
                </span>
              </div>
              {!isEditingRiyadh && (
                <button
                  type="button"
                  onClick={handleCopyFromRiyadh}
                  className="text-[11px] font-bold text-[#0A6ED1] hover:text-[#084B8A] underline cursor-pointer"
                >
                  Copy Info from Riyadh
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {plants.map((pl) => {
                const isSelected = pl.id.toUpperCase() === editingPlantId;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handleSelectPlantTab(pl.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-[#0A6ED1] text-white border-[#084B8A] shadow-sm'
                        : 'bg-white text-[#354A5F] border-[#C2D0DF] hover:bg-[#F7FAFD]'
                    }`}
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-[#EFF4F9] text-[#354A5F]'
                      }`}
                    >
                      {pl.code}
                    </span>
                    <span>{pl.name}</span>
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-[#354A5F] leading-snug">
              Editing <strong>{activePlantConfig.name} ({activePlantConfig.code})</strong>: Company/Plant Name, Address, Phone, Tax ID, Ticket Prefix, Gates, Logo &amp; Signature configured here appear on <strong>{activePlantConfig.name} Loading Slips</strong> &amp; Gate Tokens.
            </p>
          </div>

          {/* Company Logo Upload & Live Preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-700" />
                <span className="text-xs font-bold text-neutral-800 tracking-wide">
                  {isEditingRiyadh
                    ? 'Company Logo (Shown Everywhere)'
                    : `${activePlantConfig.name} Logo (Optional Override)`}
                </span>
              </div>
              <span className="text-[10px] font-semibold text-neutral-500">
                {!isEditingRiyadh && !logoDataUrl ? 'Using Main Company Logo' : 'PNG, JPG, WebP or SVG'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Live Header Preview Box */}
              <div className="flex items-center gap-3 bg-[#354A5F] text-white px-3 py-2.5 rounded-xl border border-[#223242] flex-1 min-w-0">
                <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-[#F0AB00]/70 p-1">
                  {effectivePreviewLogo ? (
                    <img
                      src={effectivePreviewLogo}
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
                  {isEditingRiyadh
                    ? 'Default Store Incharge Signature (Fallback)'
                    : `${activePlantConfig.name} Store Incharge Signature`}
                </span>
              </div>
              <span className="text-[10px] font-semibold text-neutral-500">
                {!isEditingRiyadh && !storeInchargeSignatureDataUrl
                  ? 'Using Default / User Signature'
                  : 'PNG, JPG, WebP or SVG'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Live Signature Box Preview (matches Loading Slip layout) */}
              <div className="bg-white border border-neutral-300 rounded-xl px-3 py-2 flex-1 min-w-0 flex flex-col items-center justify-between min-h-[68px]">
                <span className="text-[10px] font-bold text-neutral-700">
                  Store Incharge Signature ({activePlantConfig.code})
                </span>
                <div className="h-8 w-full flex items-center justify-center my-0.5">
                  {effectivePreviewSignature ? (
                    <img
                      src={effectivePreviewSignature}
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
                    Printed on {activePlantConfig.name} Loading Slips
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
              Company / Plant Name ({activePlantConfig.code}) *
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
              Subtitle / Tagline ({activePlantConfig.code})
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
              Plant / Factory Address ({activePlantConfig.code})
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Helpdesk / Phone
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
                Plant Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              Ticket Number Prefix ({activePlantConfig.code})
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={ticketPrefix}
                onChange={(e) => setTicketPrefix(e.target.value)}
                placeholder={isEditingRiyadh ? 'e.g. AWZR' : `e.g. AWZ-${activePlantConfig.code}`}
                className="w-32 px-3 py-1.5 text-xs font-bold uppercase rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
              />
              <span className="text-[11px] text-neutral-500 font-mono">
                (Preview: {effectivePreviewPrefix}-20261126-001)
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

          {/* Gate Management (Per-Plant) */}
          <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
            <label className="text-xs font-bold text-neutral-800 uppercase tracking-wide block mb-2 flex items-center gap-1.5">
              <DoorOpen className="w-4 h-4 text-blue-700" />
              <span>Available Loading Gates ({activePlantConfig.name}):</span>
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

          {/* Multi-Plant Management */}
          <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200 space-y-3">
            <div>
              <label className="text-xs font-bold text-neutral-800 uppercase tracking-wide flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-700" />
                <span>Multi-Plant Configuration (Riyadh, Jeddah &amp; Locations)</span>
              </label>
              <p className="text-[11px] text-neutral-600 mt-0.5">
                Each plant maintains isolated Gate Tickets, Ex-Factory logs, Liquid Store tanks, and its own Loading Slip header settings.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {plants.map((pl) => {
                const isCore = pl.id === 'RIYADH' || pl.id === 'JEDDAH';
                return (
                  <div
                    key={pl.id}
                    className={`bg-white border px-3 py-1.5 rounded-xl shadow-sm text-xs font-bold flex items-center gap-2 ${
                      pl.isActive ? 'border-emerald-300 text-neutral-800' : 'border-neutral-300 text-neutral-400'
                    }`}
                  >
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-700">
                      {pl.code}
                    </span>
                    <span>{pl.name}</span>
                    {pl.id !== 'RIYADH' && (
                      <button
                        type="button"
                        onClick={() => handleTogglePlantActive(pl.id)}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                          pl.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'
                        }`}
                      >
                        {pl.isActive ? 'Active' : 'Disabled'}
                      </button>
                    )}
                    {!isCore && (
                      <button
                        type="button"
                        onClick={() => handleRemovePlant(pl.id)}
                        className="text-neutral-400 hover:text-red-500 transition cursor-pointer"
                        title="Remove custom plant"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newPlantName}
                  onChange={(e) => setNewPlantName(e.target.value)}
                  placeholder="New plant name e.g. Dammam Plant"
                  className="flex-1 min-w-[160px] px-3 py-1.5 text-xs rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newPlantCode}
                  onChange={(e) => setNewPlantCode(e.target.value)}
                  placeholder="Code (e.g. DMM)"
                  maxLength={6}
                  className="w-28 px-3 py-1.5 text-xs font-mono uppercase rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddPlant}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Plant</span>
                </button>
              </div>
            )}
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
                title="Save all current plant settings & loading gates as permanent default"
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
