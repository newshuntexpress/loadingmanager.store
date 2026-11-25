import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import { AuthUser, CompanySettings, DriverMasterRecord, ExFactoryEntry, TicketRecord, TruckLoadingType } from '../types';
import { ApiClient, withBackgroundPoll } from '../services/api';
import { StorageService, formatDisplayDate, getTodayDateString } from '../services/storage';
import { drawPdfLogo } from '../utils/logo';
import { resolveLoadingType } from '../utils/loadingType';
import { LoadingSlipModal } from './LoadingSlipModal';
import { LoadingSlipPrintView } from './LoadingSlipPrintView';
import {
  Truck,
  Plus,
  Copy,
  Check,
  FileSpreadsheet,
  Download,
  Edit2,
  Trash2,
  Search,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  RefreshCw,
  Eye,
  FileText,
  Printer,
  MapPin,
  Globe,
} from 'lucide-react';

interface ExFactoryViewProps {
  currentUser: AuthUser;
  drivers: DriverMasterRecord[];
  settings: CompanySettings;
  facilityName: string;
  companyLogoUrl?: string;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function formatRecordSummaryForChat(record: {
  driverName?: string;
  truckNumber: string;
  mobileNumber?: string;
  iqamaNumber?: string;
}): string {
  return [
    (record.driverName || '').trim().toUpperCase() || '-',
    record.truckNumber.trim().toUpperCase() || '-',
    (record.mobileNumber || '').trim().toUpperCase() || '-',
    (record.iqamaNumber || '').trim().toUpperCase() || '-',
  ].join(' # ');
}

function formatExFactoryTime(timestampMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

function exFactoryToTicketRecord(entry: ExFactoryEntry, srNo: number): TicketRecord {
  const safeSeq = Math.max(1, srNo);
  const cleanDate = (entry.entryDate || getTodayDateString()).replace(/-/g, '');
  return {
    id: entry.id,
    ticketNumber: `EXF-${cleanDate}-${String(safeSeq).padStart(3, '0')}`,
    sequenceNumber: safeSeq,
    date: entry.entryDate,
    timeIn: formatExFactoryTime(entry.createdAt || Date.now()),
    gateNumber: 'EX-FACTORY',
    gateSequenceNumber: safeSeq,
    truckNumber: entry.truckNumber,
    driverName: entry.driverName || '',
    driverPhone: entry.mobileNumber || '',
    iqamaNumber: entry.iqamaNumber || '',
    transporterName: entry.customerName || 'EX-FACTORY',
    destinationPlace: entry.loadingSlip?.placeName || 'EX-FACTORY',
    delNoteNumber: entry.delNoteNumber,
    status: 'waiting',
    loadingSlip: entry.loadingSlip,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    createdBy: entry.createdBy,
    updatedBy: entry.updatedBy,
  };
}

export const ExFactoryView: React.FC<ExFactoryViewProps> = ({
  currentUser,
  drivers,
  settings,
  facilityName,
  companyLogoUrl,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
}) => {
  const [entries, setEntries] = useState<ExFactoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Automatic date (defaults to today's date automatically)
  const todayDate = getTodayDateString();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState<string>(todayDate);
  const [delNoteNumber, setDelNoteNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [loadingType, setLoadingType] = useState<TruckLoadingType>('local');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [iqamaNumber, setIqamaNumber] = useState('');

  // Filters & Selection
  const [dateFilterMode, setDateFilterMode] = useState<'TODAY' | 'ALL' | 'CUSTOM'>('TODAY');
  const [customDate, setCustomDate] = useState<string>(todayDate);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Feedback & Confirm Dialog
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedMode, setCopiedMode] = useState<'summary' | 'excel' | 'current' | string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExFactoryEntry | null>(null);
  const [lastSavedEntry, setLastSavedEntry] = useState<ExFactoryEntry | null>(null);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [activeEntryForSlip, setActiveEntryForSlip] = useState<{ entry: ExFactoryEntry; srNo: number } | null>(null);
  const [activeEntryForPrintSlip, setActiveEntryForPrintSlip] = useState<{ entry: ExFactoryEntry; srNo: number } | null>(null);

  // Driver / Iqama Lookup & Suggestions
  type DriverLookupItem = {
    key: string;
    driverName: string;
    truckNumber: string;
    mobileNumber: string;
    iqamaNumber: string;
    transporterOrCustomer?: string;
    source: 'Master' | 'Ex-Factory';
  };
  const [driverSuggestions, setDriverSuggestions] = useState<DriverLookupItem[]>([]);
  const [activeSuggestField, setActiveSuggestField] = useState<'driver' | 'iqama' | 'truck' | null>(null);
  const [matchedDriverInfo, setMatchedDriverInfo] = useState<DriverLookupItem | null>(null);

  const driverLookupPool = useMemo<DriverLookupItem[]>(() => {
    const map = new Map<string, DriverLookupItem>();
    for (const d of drivers) {
      const k = `${d.truckNumber.trim().toUpperCase()}|${(d.iqamaNumber || '').trim()}|${d.driverName.trim().toLowerCase()}`;
      map.set(k, {
        key: `drv_${d.id}`,
        driverName: d.driverName.trim(),
        truckNumber: d.truckNumber.trim().toUpperCase(),
        mobileNumber: (d.driverPhone || '').trim(),
        iqamaNumber: (d.iqamaNumber || '').trim(),
        transporterOrCustomer: d.transporterName?.trim() || d.defaultDestination?.trim(),
        source: 'Master',
      });
    }
    for (const e of entries) {
      if (!e.driverName?.trim() && !e.iqamaNumber?.trim() && !e.truckNumber?.trim()) continue;
      const k = `${e.truckNumber.trim().toUpperCase()}|${(e.iqamaNumber || '').trim()}|${(e.driverName || '').trim().toLowerCase()}`;
      if (!map.has(k)) {
        map.set(k, {
          key: `exf_${e.id}`,
          driverName: (e.driverName || '').trim(),
          truckNumber: e.truckNumber.trim().toUpperCase(),
          mobileNumber: (e.mobileNumber || '').trim(),
          iqamaNumber: (e.iqamaNumber || '').trim(),
          transporterOrCustomer: e.customerName?.trim(),
          source: 'Ex-Factory',
        });
      }
    }
    return Array.from(map.values());
  }, [drivers, entries]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadEntries = useCallback(
    async (isBackgroundPoll = false) => {
      try {
        const list = isBackgroundPoll
          ? await withBackgroundPoll(() => ApiClient.getExFactoryEntries())
          : await ApiClient.getExFactoryEntries();
        setEntries(list);
      } catch (err: any) {
        if (!isBackgroundPoll) {
          showToast('error', err?.message || 'Failed to load Ex-Factory entries.');
        }
      } finally {
        if (!isBackgroundPoll) {
          setLoading(false);
        }
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadEntries(false);
    const pollInterval = setInterval(() => {
      loadEntries(true);
    }, 10000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadEntries(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadEntries]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setEntryDate(getTodayDateString());
    setDelNoteNumber('');
    setCustomerName('');
    setLoadingType('local');
    setTruckNumber('');
    setDriverName('');
    setMobileNumber('');
    setIqamaNumber('');
    setMatchedDriverInfo(null);
    setActiveSuggestField(null);
  }, []);

  const applyDriverLookupItem = (item: DriverLookupItem) => {
    if (item.driverName) setDriverName(item.driverName);
    if (item.truckNumber) setTruckNumber(item.truckNumber);
    if (item.mobileNumber) setMobileNumber(item.mobileNumber);
    if (item.iqamaNumber) setIqamaNumber(item.iqamaNumber);
    setMatchedDriverInfo(item);
    setActiveSuggestField(null);
  };

  const searchLookupPool = (query: string): DriverLookupItem[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return driverLookupPool
      .filter(
        (d) =>
          d.driverName.toLowerCase().includes(q) ||
          d.iqamaNumber.toLowerCase().includes(q) ||
          d.truckNumber.toLowerCase().includes(q) ||
          d.mobileNumber.toLowerCase().includes(q)
      )
      .slice(0, 8);
  };

  // Auto-fill truck, mobile & iqama when entering or selecting Driver Name
  const handleDriverNameChange = (val: string) => {
    setDriverName(val);
    const clean = val.trim().toLowerCase();
    if (!clean) {
      setActiveSuggestField(null);
      setMatchedDriverInfo(null);
      return;
    }
    const exact = driverLookupPool.find((d) => d.driverName && d.driverName.toLowerCase() === clean);
    if (exact) {
      applyDriverLookupItem(exact);
      return;
    }
    if (clean.length >= 2) {
      const matches = searchLookupPool(val);
      setDriverSuggestions(matches);
      setActiveSuggestField(matches.length > 0 ? 'driver' : null);
    } else {
      setActiveSuggestField(null);
    }
  };

  // Auto-fill driver name, mobile & iqama when entering or selecting Truck No.
  const handleTruckChange = (val: string) => {
    const upper = val.toUpperCase();
    setTruckNumber(upper);
    const clean = upper.trim();
    if (!clean) {
      setActiveSuggestField(null);
      setMatchedDriverInfo(null);
      return;
    }
    const exact = driverLookupPool.find((d) => d.truckNumber === clean);
    if (exact) {
      applyDriverLookupItem(exact);
      return;
    }
    if (clean.length >= 2) {
      const matches = searchLookupPool(upper);
      setDriverSuggestions(matches);
      setActiveSuggestField(matches.length > 0 ? 'truck' : null);
    } else {
      setActiveSuggestField(null);
    }
  };

  // Auto-fill driver name, truck & mobile when entering or selecting Iqama No.
  const handleIqamaChange = (val: string) => {
    setIqamaNumber(val);
    const clean = val.trim().toLowerCase();
    if (!clean) {
      setActiveSuggestField(null);
      setMatchedDriverInfo(null);
      return;
    }
    const exact =
      clean.length >= 4
        ? driverLookupPool.find((d) => d.iqamaNumber && d.iqamaNumber.toLowerCase() === clean)
        : undefined;
    if (exact) {
      applyDriverLookupItem(exact);
      return;
    }
    if (clean.length >= 2) {
      const matches = searchLookupPool(val);
      setDriverSuggestions(matches);
      setActiveSuggestField(matches.length > 0 ? 'iqama' : null);
    } else {
      setActiveSuggestField(null);
    }
  };

  const saveEntryCore = async (openSlipAfterSave = false) => {
    const cleanDn = delNoteNumber.trim().toUpperCase();
    const cleanCust = customerName.trim().toUpperCase();
    const cleanTruck = truckNumber.trim().toUpperCase();
    const cleanDriver = driverName.trim().toUpperCase();
    const cleanMobile = mobileNumber.trim().toUpperCase();
    const cleanIqama = iqamaNumber.trim().toUpperCase();

    if (!cleanDn || !cleanCust || !cleanTruck) {
      showToast('error', 'Del Note No., Customer Name, and Truck No. are required.');
      return;
    }

    setSaving(true);
    try {
      const autoDate = editingId ? entryDate : getTodayDateString();
      let savedRecord: ExFactoryEntry;
      if (editingId) {
        savedRecord = await ApiClient.updateExFactoryEntry(editingId, {
          entryDate: autoDate,
          delNoteNumber: cleanDn,
          customerName: cleanCust,
          loadingType,
          truckNumber: cleanTruck,
          driverName: cleanDriver,
          mobileNumber: cleanMobile,
          iqamaNumber: cleanIqama,
        });
        setEntries((prev) => prev.map((item) => (item.id === savedRecord.id ? savedRecord : item)));
        setLastSavedEntry(savedRecord);
        showToast('success', `Updated Ex-Factory entry (${savedRecord.delNoteNumber}).`);
      } else {
        savedRecord = await ApiClient.createExFactoryEntry({
          entryDate: autoDate,
          delNoteNumber: cleanDn,
          customerName: cleanCust,
          loadingType,
          truckNumber: cleanTruck,
          driverName: cleanDriver,
          mobileNumber: cleanMobile,
          iqamaNumber: cleanIqama,
        });
        setEntries((prev) => [savedRecord, ...prev]);
        setLastSavedEntry(savedRecord);
        showToast('success', `Saved Ex-Factory entry (${savedRecord.delNoteNumber} · ${savedRecord.truckNumber}).`);
      }
      resetForm();
      if (openSlipAfterSave) {
        setActiveEntryForSlip({ entry: savedRecord, srNo: 1 });
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save Ex-Factory entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveEntryCore(false);
  };

  const handleSaveExFactoryLoadingSlip = async (
    updatedTicket: TicketRecord,
    openPrintDirectly?: boolean
  ) => {
    if (!activeEntryForSlip || !updatedTicket.loadingSlip) return;
    const targetSrNo = activeEntryForSlip.srNo;
    try {
      const { entry: updatedEntry, autoSavedMaterials } = await ApiClient.saveExFactoryLoadingSlipWithResult(
        activeEntryForSlip.entry.id,
        {
          loadingSlip: updatedTicket.loadingSlip,
          truckNumber: updatedTicket.truckNumber,
          driverName: updatedTicket.driverName,
          mobileNumber: updatedTicket.driverPhone,
        }
      );
      if (autoSavedMaterials && autoSavedMaterials.length > 0) {
        StorageService.mergeMaterialsCache(autoSavedMaterials);
      }
      setEntries((prev) => prev.map((item) => (item.id === updatedEntry.id ? updatedEntry : item)));
      setLastSavedEntry((prev) => (prev?.id === updatedEntry.id ? updatedEntry : prev));
      setActiveEntryForSlip(null);
      const autoSavedSuffix =
        autoSavedMaterials && autoSavedMaterials.length > 0
          ? ` · Auto-saved ${autoSavedMaterials.length} new material(s) to Material Master (${autoSavedMaterials
              .map((m) => m.materialName)
              .join(', ')})`
          : '';
      showToast(
        'success',
        `Loading Slip saved for ${updatedEntry.delNoteNumber} (${updatedEntry.loadingSlip?.totalQty || 0} Qty · ${updatedEntry.loadingSlip?.totalPallets || 0} Pallets)${autoSavedSuffix}`
      );
      if (openPrintDirectly) {
        setActiveEntryForPrintSlip({ entry: updatedEntry, srNo: targetSrNo });
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save Ex-Factory Loading Slip.');
    }
  };

  const handleEdit = (entry: ExFactoryEntry) => {
    setEditingId(entry.id);
    setEntryDate(entry.entryDate);
    setDelNoteNumber(entry.delNoteNumber);
    setCustomerName(entry.customerName);
    setLoadingType(resolveLoadingType({ loadingType: entry.loadingType, destinationPlace: entry.customerName }));
    setTruckNumber(entry.truckNumber);
    setDriverName(entry.driverName || '');
    setMobileNumber(entry.mobileNumber || '');
    setIqamaNumber(entry.iqamaNumber || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await ApiClient.deleteExFactoryEntry(confirmDelete.id);
      setEntries((prev) => prev.filter((item) => item.id !== confirmDelete.id));
      setSelectedIds((prev) => prev.filter((id) => id !== confirmDelete.id));
      showToast('success', `Deleted Ex-Factory entry (${confirmDelete.delNoteNumber}).`);
      if (editingId === confirmDelete.id) resetForm();
      if (lastSavedEntry?.id === confirmDelete.id) setLastSavedEntry(null);
      setConfirmDelete(null);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete entry.');
    } finally {
      setSaving(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((item) => {
      if (dateFilterMode === 'TODAY' && item.entryDate !== todayDate) return false;
      if (dateFilterMode === 'CUSTOM' && customDate && item.entryDate !== customDate) return false;
      if (q) {
        const hay = `${item.entryDate} ${item.delNoteNumber} ${item.customerName} ${item.truckNumber} ${item.driverName || ''} ${item.mobileNumber} ${item.iqamaNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, dateFilterMode, todayDate, customDate, searchQuery]);

  const targetCopyEntries = useMemo(() => {
    if (selectedIds.length === 0) return filteredEntries;
    const idSet = new Set(selectedIds);
    return filteredEntries.filter((e) => idSet.has(e.id));
  }, [filteredEntries, selectedIds]);

  const allFilteredSelected =
    filteredEntries.length > 0 && filteredEntries.every((e) => selectedIds.includes(e.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredEntries.map((e) => e.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const todayCount = useMemo(() => entries.filter((e) => e.entryDate === todayDate).length, [entries, todayDate]);
  const localFilteredCount = useMemo(
    () =>
      filteredEntries.filter(
        (e) =>
          resolveLoadingType({
            loadingType: e.loadingType,
            destinationPlace: e.loadingSlip?.placeName,
            placeName: e.customerName,
          }) === 'local'
      ).length,
    [filteredEntries]
  );
  const exportFilteredCount = filteredEntries.length - localFilteredCount;
  const uniqueCustomersCount = useMemo(
    () => new Set(filteredEntries.map((e) => e.customerName.trim().toUpperCase())).size,
    [filteredEntries]
  );

  const handleCopyTotalSummary = async () => {
    if (targetCopyEntries.length === 0) {
      showToast('error', 'No Ex-Factory entries available to copy.');
      return;
    }

    const lines = [
      ...targetCopyEntries.map((e) => formatRecordSummaryForChat(e)),
      `Total: ${targetCopyEntries.length}`,
    ];

    const ok = await copyTextReliable(lines.join('\n'));
    if (ok) {
      setCopiedMode('summary');
      setTimeout(() => setCopiedMode(null), 2500);
      showToast('success', `Copied ${targetCopyEntries.length} Ex-Factory entry(s) & total summary to clipboard.`);
    } else {
      showToast('error', 'Clipboard copy was blocked by browser permissions.');
    }
  };

  const handleCopyExcelTable = async () => {
    if (targetCopyEntries.length === 0) {
      showToast('error', 'No Ex-Factory entries available to copy.');
      return;
    }
    const header = [
      'Sr.No',
      'Date',
      'Del Note No.',
      'Customer Name',
      'Driver Name',
      'Truck No.',
      'Mobile No.',
      'Iqama No.',
    ].join('\t');
    const rows = targetCopyEntries.map((e, idx) =>
      [
        idx + 1,
        formatDisplayDate(e.entryDate),
        e.delNoteNumber,
        e.customerName,
        e.driverName || '-',
        e.truckNumber,
        e.mobileNumber || '-',
        e.iqamaNumber || '-',
      ]
        .map((v) => String(v).replace(/[\t\r\n]+/g, ' '))
        .join('\t')
    );
    const totalRow = ['Total', '', `${targetCopyEntries.length} entries`, '', '', '', '', ''].join('\t');
    const text = [header, ...rows, totalRow].join('\n');

    const ok = await copyTextReliable(text);
    if (ok) {
      setCopiedMode('excel');
      setTimeout(() => setCopiedMode(null), 2500);
      showToast('success', `Copied ${targetCopyEntries.length} row(s) with Total row for Excel.`);
    } else {
      showToast('error', 'Clipboard copy was blocked by browser permissions.');
    }
  };

  const hasFormInput = Boolean(
    delNoteNumber.trim() ||
      customerName.trim() ||
      truckNumber.trim() ||
      driverName.trim() ||
      mobileNumber.trim() ||
      iqamaNumber.trim()
  );

  const activeSummaryRecord = useMemo(() => {
    if (hasFormInput) {
      return {
        entryDate: editingId ? entryDate : todayDate,
        delNoteNumber,
        customerName,
        truckNumber,
        driverName,
        mobileNumber,
        iqamaNumber,
      };
    }
    if (lastSavedEntry) {
      return lastSavedEntry;
    }
    return null;
  }, [
    hasFormInput,
    editingId,
    entryDate,
    todayDate,
    delNoteNumber,
    customerName,
    truckNumber,
    driverName,
    mobileNumber,
    iqamaNumber,
    lastSavedEntry,
  ]);

  const currentSummaryPreview = useMemo(() => {
    if (!activeSummaryRecord) return '';
    return formatRecordSummaryForChat(activeSummaryRecord);
  }, [activeSummaryRecord]);

  const handleCopyCurrentRecord = async () => {
    if (!activeSummaryRecord) {
      showToast('error', 'Enter record details (or save an entry first) to copy to clipboard.');
      return;
    }
    const text = formatRecordSummaryForChat(activeSummaryRecord);
    const ok = await copyTextReliable(text);
    if (ok) {
      setCopiedMode('current');
      setTimeout(() => setCopiedMode((prev) => (prev === 'current' ? null : prev)), 2500);
      showToast('success', `Copied: ${text}`);
    } else {
      showToast('error', 'Clipboard copy was blocked by browser permissions.');
    }
  };

  const handleCopySingleRow = async (e: ExFactoryEntry) => {
    const summary = formatRecordSummaryForChat(e);
    const ok = await copyTextReliable(summary);
    if (ok) {
      setCopiedMode(e.id);
      setTimeout(() => setCopiedMode((prev) => (prev === e.id ? null : prev)), 2000);
      showToast('success', `Copied: ${summary}`);
    } else {
      showToast('error', 'Clipboard copy failed.');
    }
  };

  const handleExportCsv = () => {
    if (targetCopyEntries.length === 0) {
      showToast('error', 'No Ex-Factory entries to export.');
      return;
    }
    const header = ['Sr.No', 'Date', 'Del Note No.', 'Customer Name', 'Type', 'Driver Name', 'Truck No.', 'Mobile No.', 'Iqama No.'];
    const lines = [
      header.join(','),
      ...targetCopyEntries.map((e, i) =>
        [
          i + 1,
          formatDisplayDate(e.entryDate),
          e.delNoteNumber,
          e.customerName,
          resolveLoadingType({ loadingType: e.loadingType, destinationPlace: e.loadingSlip?.placeName, placeName: e.customerName }).toUpperCase(),
          e.driverName || '',
          e.truckNumber,
          e.mobileNumber,
          e.iqamaNumber,
        ]
          .map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`)
          .join(',')
      ),
      ['"Total"', '""', `"${targetCopyEntries.length} entries"`, '""', '""', '""', '""', '""', '""'].join(','),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ex_Factory_Report_${todayDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (targetCopyEntries.length === 0) {
      showToast('error', 'No Ex-Factory entries to export as PDF.');
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;
    const margin = 10;

    const cols = [
      { label: 'Sr.', w: 10 },
      { label: 'Date', w: 25 },
      { label: 'Del Note No.', w: 32 },
      { label: 'Customer Name', w: 58 },
      { label: 'Driver Name', w: 46 },
      { label: 'Truck No.', w: 30 },
      { label: 'Mobile No.', w: 36 },
      { label: 'Iqama No.', w: 40 },
    ]; // 277mm

    const drawHeader = () => {
      doc.setFillColor(53, 74, 95);
      doc.rect(margin, 8, pageW - margin * 2, 16, 'F');
      doc.setFillColor(240, 171, 0);
      doc.rect(margin, 24, pageW - margin * 2, 1.2, 'F');
      const hasLogo = drawPdfLogo(doc, companyLogoUrl, margin + 3, 9.5, 13, 13, true);
      const titleX = hasLogo ? margin + 19 : margin + 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      doc.text('Ex-Factory Dispatch Register', titleX, 15.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(220, 232, 244);
      doc.text(`${facilityName}  |  Total Entries: ${targetCopyEntries.length}`, titleX, 21);

      const hy = 29;
      doc.setFillColor(239, 244, 249);
      doc.setDrawColor(209, 219, 229);
      doc.rect(margin, hy, 277, 7.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(53, 74, 95);
      let x = margin;
      for (const c of cols) {
        doc.text(c.label, x + 2, hy + 5);
        x += c.w;
      }
      return hy + 7.5;
    };

    let y = drawHeader();
    targetCopyEntries.forEach((e, idx) => {
      if (y > pageH - 22) {
        doc.addPage();
        y = drawHeader();
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, 277, 7, 'F');
      }
      doc.setDrawColor(227, 234, 242);
      doc.line(margin, y + 7, margin + 277, y + 7);
      const vals = [
        String(idx + 1),
        formatDisplayDate(e.entryDate),
        e.delNoteNumber,
        e.customerName,
        e.driverName || '-',
        e.truckNumber,
        e.mobileNumber || '-',
        e.iqamaNumber || '-',
      ];
      let x = margin;
      vals.forEach((v, i) => {
        doc.setFont('helvetica', i === 2 || i === 5 ? 'bold' : 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(28, 40, 51);
        doc.text(String(v).slice(0, 42), x + 2, y + 4.8);
        x += cols[i].w;
      });
      y += 7;
    });

    y += 4;
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(53, 74, 95);
    doc.rect(margin, y, 277, 9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(53, 74, 95);
    doc.text(`Total Ex-Factory Entries: ${targetCopyEntries.length}`, margin + 4, y + 6);

    doc.save(`Ex_Factory_Register_${todayDate}.pdf`);
    showToast('success', 'Ex-Factory Register PDF downloaded.');
  };

  return (
    <div className="space-y-5">
      {/* Header & Copy Total Action Bar */}
      <div className="surface-3d rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          {companyLogoUrl ? (
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shrink-0 ring-2 ring-[#F0AB00]/70 overflow-hidden p-1 shadow-[0_3px_0_#C5D3E2]">
              <img src={companyLogoUrl} alt={facilityName} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0A6ED1] to-[#084B8A] text-white flex items-center justify-center shrink-0 ring-2 ring-[#F0AB00]/60 shadow-[0_3px_0_#063E75]">
              <Truck className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-[#1C2833]">
                Ex-Factory Dispatch Section
              </h2>
              <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-[#EFF4F9] text-[#0A6ED1] border border-[#C2D8EE]">
                Auto Date: {formatDisplayDate(todayDate)}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#5B738B] truncate mt-0.5">
              Save Ex-Factory Delivery Note, Customer, Truck, Driver, Mobile &amp; Iqama records and copy dispatch summaries
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyTotalSummary}
            disabled={targetCopyEntries.length === 0}
            className="app-btn bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow-xs"
            title="Copy all filtered/selected entries with Total summary"
          >
            {copiedMode === 'summary' ? <Check className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
            <span>
              {copiedMode === 'summary'
                ? 'Copied Total!'
                : selectedIds.length > 0
                ? `Copy Selected (${targetCopyEntries.length})`
                : `Copy Total (${targetCopyEntries.length})`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyExcelTable}
            disabled={targetCopyEntries.length === 0}
            className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white shadow-xs"
            title="Copy as Tab-Separated Table with Total row for Excel"
          >
            {copiedMode === 'excel' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
            )}
            <span>{copiedMode === 'excel' ? 'Copied for Excel!' : 'Copy Excel Table'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={targetCopyEntries.length === 0}
            className="app-btn bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={targetCopyEntries.length === 0}
            className="app-btn bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
          >
            <Download className="w-4 h-4 shrink-0 text-[#0A6ED1]" />
            <span>PDF</span>
          </button>

          <button
            type="button"
            onClick={() => loadEntries(false)}
            className="app-btn bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
            title="Refresh records"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="surface-3d surface-3d-hover rounded-2xl p-5">
          <div className="text-xs font-bold text-[#5B738B]">Total Truck Loading (Filtered)</div>
          <div className="text-3xl font-black font-mono tabular-nums text-[#0A6ED1] mt-1">
            {filteredEntries.length}
          </div>
          <div className="text-[11px] font-bold text-[#5B738B] mt-0.5">
            Local: {localFilteredCount} · Export: {exportFilteredCount}
          </div>
        </div>
        <div className="surface-3d surface-3d-hover rounded-2xl p-5">
          <div className="text-xs font-bold text-[#5B738B]">Today's Ex-Factory</div>
          <div className="text-3xl font-black font-mono tabular-nums text-[#107E3E] mt-1">{todayCount}</div>
        </div>
        <div className="surface-3d surface-3d-hover rounded-2xl p-5">
          <div className="text-xs font-bold text-[#5B738B]">Unique Customers</div>
          <div className="text-3xl font-black font-mono tabular-nums text-[#1C2833] mt-1">
            {uniqueCustomersCount}
          </div>
        </div>
        <div className="surface-3d surface-3d-hover rounded-2xl p-5">
          <div className="text-xs font-bold text-[#5B738B]">Total All Records</div>
          <div className="text-3xl font-black font-mono tabular-nums text-[#354A5F] mt-1">{entries.length}</div>
        </div>
      </div>

      {/* Entry / Edit Form */}
      {(canCreate || (editingId && canUpdate)) && (
        <form
          onSubmit={handleSubmit}
          className="surface-3d rounded-2xl p-5 sm:p-6 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E3EAF2]">
            <div>
              <h3 className="text-sm font-extrabold text-[#1C2833]">
                {editingId ? 'Edit Ex-Factory Dispatch Entry' : 'New Ex-Factory Entry'}
              </h3>
              <p className="text-[11px] text-[#5B738B]">
                Date is set automatically to today ({formatDisplayDate(todayDate)})
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Cancel Edit</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Automatic Date */}
            <div>
              <label className="flex items-center justify-between text-xs font-bold text-[#354A5F] mb-1">
                <span>Date (Automatic)</span>
                <span className="text-[10px] font-extrabold text-[#107E3E]">AUTO</span>
              </label>
              {editingId ? (
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border font-mono bg-white border-[#BCC8D4] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
                />
              ) : (
                <input
                  type="text"
                  value={formatDisplayDate(todayDate)}
                  readOnly
                  className="w-full px-3 py-2 text-xs rounded-lg border font-mono bg-[#EFF4F9] border-[#D1DBE5] text-[#354A5F] font-bold cursor-default"
                />
              )}
            </div>

            {/* Del Note No. */}
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Del Note No. *</label>
              <input
                type="text"
                required
                value={delNoteNumber}
                onChange={(e) => setDelNoteNumber(e.target.value)}
                placeholder="e.g. A1DD00001"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
            </div>

            {/* Customer Name */}
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Customer Name *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer / Company name"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
            </div>

            {/* Loading Type (Local / Export) */}
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Loading Type *</label>
              <div className="grid grid-cols-2 gap-1 bg-[#EFF4F9] p-1 rounded-lg border border-[#BCC8D4]">
                <button
                  type="button"
                  onClick={() => setLoadingType('local')}
                  className={`py-1.5 px-2 rounded text-xs font-extrabold flex items-center justify-center gap-1 transition cursor-pointer ${
                    loadingType === 'local'
                      ? 'bg-[#107E3E] text-white shadow-xs'
                      : 'text-[#354A5F] hover:bg-white'
                  }`}
                >
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span>Local</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLoadingType('export')}
                  className={`py-1.5 px-2 rounded text-xs font-extrabold flex items-center justify-center gap-1 transition cursor-pointer ${
                    loadingType === 'export'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-[#354A5F] hover:bg-white'
                  }`}
                >
                  <Globe className="w-3 h-3 shrink-0" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {/* Driver Name (with instant lookup & autocomplete) */}
            <div className="relative">
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Driver Name</label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => handleDriverNameChange(e.target.value)}
                onFocus={() => {
                  if (driverName.trim().length >= 2) {
                    const m = searchLookupPool(driverName);
                    setDriverSuggestions(m);
                    setActiveSuggestField(m.length > 0 ? 'driver' : null);
                  }
                }}
                placeholder="Type driver name to show details"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
              {activeSuggestField === 'driver' && driverSuggestions.length > 0 && (
                <div className="absolute top-full left-0 sm:w-80 right-0 mt-1 bg-white border border-[#C2D8EE] rounded-lg shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-[#E3EAF2]">
                  <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#5B738B] bg-[#EFF4F9] flex items-center justify-between">
                    <span>Matched Drivers (Click to Fill)</span>
                    <button type="button" onClick={() => setActiveSuggestField(null)} className="text-[#5B738B] hover:text-[#1C2833]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {driverSuggestions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => applyDriverLookupItem(item)}
                      className="w-full text-left px-3 py-2 hover:bg-[#EFF4F9] transition text-xs cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#0A6ED1]">{item.driverName || '—'}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EFF4F9] text-[#354A5F]">
                          {item.source}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#354A5F] mt-0.5">
                        {item.truckNumber} · {item.mobileNumber || '-'} · Iqama: {item.iqamaNumber || '-'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Truck No. (with instant lookup & autocomplete) */}
            <div className="relative">
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Truck No. *</label>
              <input
                type="text"
                required
                value={truckNumber}
                onChange={(e) => handleTruckChange(e.target.value)}
                onFocus={() => {
                  if (truckNumber.trim().length >= 2) {
                    const m = searchLookupPool(truckNumber);
                    setDriverSuggestions(m);
                    setActiveSuggestField(m.length > 0 ? 'truck' : null);
                  }
                }}
                placeholder="e.g. 5275 AXG"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] uppercase font-mono focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
              {activeSuggestField === 'truck' && driverSuggestions.length > 0 && (
                <div className="absolute top-full left-0 sm:w-80 right-0 mt-1 bg-white border border-[#C2D8EE] rounded-lg shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-[#E3EAF2]">
                  <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#5B738B] bg-[#EFF4F9] flex items-center justify-between">
                    <span>Matched Trucks (Click to Fill)</span>
                    <button type="button" onClick={() => setActiveSuggestField(null)} className="text-[#5B738B] hover:text-[#1C2833]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {driverSuggestions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => applyDriverLookupItem(item)}
                      className="w-full text-left px-3 py-2 hover:bg-[#EFF4F9] transition text-xs cursor-pointer"
                    >
                      <div className="font-bold font-mono text-[#0A6ED1]">{item.truckNumber}</div>
                      <div className="text-[11px] text-[#354A5F] mt-0.5">
                        {item.driverName || '-'} · {item.mobileNumber || '-'} · Iqama: {item.iqamaNumber || '-'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile No. */}
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Mobile No.</label>
              <input
                type="tel"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="05XXXXXXXX"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] font-mono focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
            </div>

            {/* Iqama No. (with instant lookup & autocomplete) */}
            <div className="relative">
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Iqama No.</label>
              <input
                type="text"
                value={iqamaNumber}
                onChange={(e) => handleIqamaChange(e.target.value)}
                onFocus={() => {
                  if (iqamaNumber.trim().length >= 2) {
                    const m = searchLookupPool(iqamaNumber);
                    setDriverSuggestions(m);
                    setActiveSuggestField(m.length > 0 ? 'iqama' : null);
                  }
                }}
                placeholder="Type Iqama No. to show details"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] font-mono focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
              {activeSuggestField === 'iqama' && driverSuggestions.length > 0 && (
                <div className="absolute top-full right-0 sm:w-80 left-0 sm:left-auto mt-1 bg-white border border-[#C2D8EE] rounded-lg shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-[#E3EAF2]">
                  <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#5B738B] bg-[#EFF4F9] flex items-center justify-between">
                    <span>Matched by Iqama (Click to Fill)</span>
                    <button type="button" onClick={() => setActiveSuggestField(null)} className="text-[#5B738B] hover:text-[#1C2833]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {driverSuggestions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => applyDriverLookupItem(item)}
                      className="w-full text-left px-3 py-2 hover:bg-[#EFF4F9] transition text-xs cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold font-mono text-[#0A6ED1]">Iqama: {item.iqamaNumber || '—'}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EFF4F9] text-[#354A5F]">
                          {item.source}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#354A5F] mt-0.5">
                        {item.driverName || '-'} · <span className="font-mono font-bold">{item.truckNumber}</span> ·{' '}
                        {item.mobileNumber || '-'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {matchedDriverInfo && (
            <div className="rounded-lg border border-[#A8D5BA] bg-[#ECFDF3] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0B5B2C]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#107E3E] text-white">
                  Driver Details Matched ({matchedDriverInfo.source})
                </span>
                <span>
                  <strong>Driver:</strong> {matchedDriverInfo.driverName || '—'}
                </span>
                <span className="font-mono">
                  <strong>Truck:</strong> {matchedDriverInfo.truckNumber || '—'}
                </span>
                <span className="font-mono">
                  <strong>Mobile:</strong> {matchedDriverInfo.mobileNumber || '—'}
                </span>
                <span className="font-mono">
                  <strong>Iqama:</strong> {matchedDriverInfo.iqamaNumber || '—'}
                </span>
                {matchedDriverInfo.transporterOrCustomer && (
                  <span>
                    <strong>Ref:</strong> {matchedDriverInfo.transporterOrCustomer}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMatchedDriverInfo(null)}
                className="text-[#0D6B34] hover:text-[#084421] font-bold text-[11px] cursor-pointer"
              >
                Hide
              </button>
            </div>
          )}

          {showSharePreview && currentSummaryPreview && (
            <div className="rounded-lg border border-[#C2D8EE] bg-[#EFF4F9] p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-extrabold tracking-wider text-[#0A6ED1] mb-1">
                  {hasFormInput ? 'Current Entry Chat Summary Preview' : `Last Saved Entry Preview (${lastSavedEntry?.delNoteNumber})`}
                </div>
                <pre className="text-[11px] font-mono text-[#1C2833] whitespace-pre-wrap break-words leading-relaxed">
                  {currentSummaryPreview}
                </pre>
              </div>
              <button
                type="button"
                onClick={handleCopyCurrentRecord}
                className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white shrink-0"
              >
                {copiedMode === 'current' ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Copy className="w-3.5 h-3.5 shrink-0" />}
                <span>{copiedMode === 'current' ? 'Copied!' : 'Copy Summary'}</span>
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCurrentRecord}
                disabled={!activeSummaryRecord}
                className="app-btn bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow-xs"
                title="Copy formatted current record details for WhatsApp, Teams, or other chat apps"
              >
                {copiedMode === 'current' ? <Check className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
                <span>
                  {copiedMode === 'current'
                    ? 'Copied to Clipboard!'
                    : !hasFormInput && lastSavedEntry
                    ? `Copy Last Saved (${lastSavedEntry.delNoteNumber})`
                    : 'Copy to Clipboard'}
                </span>
              </button>

              {activeSummaryRecord && (
                <button
                  type="button"
                  onClick={() => setShowSharePreview((prev) => !prev)}
                  className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
                  title="Preview formatted chat message"
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>{showSharePreview ? 'Hide Preview' : 'Preview'}</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={resetForm}
                className="app-btn bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveEntryCore(true)}
                className="app-btn bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow-xs"
                title="Save entry and immediately create its 8-row Loading Slip"
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span>{editingId ? 'Update & Loading Slip' : 'Save & Loading Slip'}</span>
              </button>
              <button
                type="submit"
                disabled={saving}
                className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white shadow-xs"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Plus className="w-4 h-4 shrink-0" />}
                <span>{editingId ? 'Update Entry' : 'Save Ex-Factory Entry'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Register Table */}
      <div className="surface-3d rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-[#D1DBE5] bg-[#EFF4F9] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDateFilterMode('TODAY')}
              className={`app-btn-sm ${
                dateFilterMode === 'TODAY'
                  ? 'bg-[#0A6ED1] text-white'
                  : 'bg-white text-[#354A5F] border border-[#BCC8D4] hover:bg-slate-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>Today ({todayCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setDateFilterMode('ALL')}
              className={`app-btn-sm ${
                dateFilterMode === 'ALL'
                  ? 'bg-[#0A6ED1] text-white'
                  : 'bg-white text-[#354A5F] border border-[#BCC8D4] hover:bg-slate-50'
              }`}
            >
              <span>All Dates ({entries.length})</span>
            </button>
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDateFilterMode('CUSTOM')}
                className={`app-btn-sm ${
                  dateFilterMode === 'CUSTOM'
                    ? 'bg-[#0A6ED1] text-white'
                    : 'bg-white text-[#354A5F] border border-[#BCC8D4] hover:bg-slate-50'
                }`}
              >
                <span>Pick Date</span>
              </button>
              {dateFilterMode === 'CUSTOM' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="h-8 px-2 text-xs rounded-md border border-[#BCC8D4] bg-white text-[#1C2833] font-mono"
                />
              )}
            </div>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#5B738B] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Del Note, Customer, Truck, Driver, Mobile, Iqama..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#BCC8D4] bg-white text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-[#EFF4F9] text-[#354A5F] border-b border-[#D1DBE5]">
                <th className="py-2.5 px-3 w-9 text-center">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all entries"
                    className="rounded border-[#BCC8D4] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Sr.</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Date</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Del Note No.</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Customer Name</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Driver Name</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Truck No.</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Mobile No.</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Iqama No.</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Loading Slip</th>
                <th className="py-2.5 px-3 font-bold whitespace-nowrap">Saved By</th>
                <th className="py-2.5 px-3 font-bold text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-[#5B738B]">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#0A6ED1]" />
                    Loading Ex-Factory entries...
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-[#5B738B]">
                    No Ex-Factory entries found for this filter. Add a new entry above.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((item, idx) => {
                  const checked = selectedIds.includes(item.id);
                  const slip = item.loadingSlip;
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-[#E3EAF2] last:border-b-0 ${
                        checked ? 'bg-sky-50/70' : 'hover:bg-[#F7F9FB]'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectOne(item.id)}
                          aria-label={`Select ${item.delNoteNumber}`}
                          className="rounded border-[#BCC8D4] cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#5B738B]">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{formatDisplayDate(item.entryDate)}</td>
                      <td className="py-2.5 px-3 font-mono font-extrabold text-[#0A6ED1] whitespace-nowrap">
                        {item.delNoteNumber}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#1C2833]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{item.customerName}</span>
                          {(() => {
                            const lType = resolveLoadingType({
                              loadingType: item.loadingType,
                              destinationPlace: item.loadingSlip?.placeName,
                              placeName: item.customerName,
                            });
                            return (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase border ${
                                  lType === 'export'
                                    ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                }`}
                              >
                                {lType === 'export' ? 'Export' : 'Local'}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[#1C2833] whitespace-nowrap">{item.driverName || '—'}</td>
                      <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">{item.truckNumber}</td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{item.mobileNumber || '—'}</td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{item.iqamaNumber || '—'}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {slip && (slip.totalQty > 0 || slip.totalPallets > 0) ? (
                          <div className="space-y-0.5">
                            <div className="text-[10px] flex gap-1 font-medium tabular-nums">
                              <span className="bg-[#EBF5FF] text-[#0854A0] border border-[#B8DCFF] px-1.5 rounded font-bold">
                                {slip.totalQty} Qty
                              </span>
                              <span className="bg-[#FEF7F1] text-[#A64B00] border border-[#F9C99B] px-1.5 rounded font-bold">
                                {slip.totalPallets} Pallets
                              </span>
                              <span className="bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4] px-1.5 rounded font-bold">
                                {slip.totalLooseRolls} Loose
                              </span>
                            </div>
                            {slip.placeName && (
                              <span className="text-[10px] text-[#5B738B] block font-semibold truncate max-w-[160px]">
                                {slip.placeName}
                              </span>
                            )}
                          </div>
                        ) : slip ? (
                          <span className="text-[10px] text-[#0A6ED1] font-semibold">Slip Prepared</span>
                        ) : (
                          <span className="text-[11px] text-[#7A8FA3] italic">No slip created</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[#5B738B] whitespace-nowrap">
                        {item.createdBy || currentUser.username}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {(canUpdate || canCreate) && (
                            <button
                              type="button"
                              onClick={() => setActiveEntryForSlip({ entry: item, srNo: idx + 1 })}
                              className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow-xs"
                              title="Generate or edit 8-row loading slip"
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span>{slip ? 'Edit Slip' : 'Create Slip'}</span>
                            </button>
                          )}
                          {slip && (
                            <button
                              type="button"
                              onClick={() => setActiveEntryForPrintSlip({ entry: item, srNo: idx + 1 })}
                              className="app-btn-sm bg-[#354A5F] hover:bg-[#243647] text-white shadow-xs"
                              title="Print 2-Copy A4 Single Sheet Preview"
                            >
                              <Printer className="w-3.5 h-3.5 text-[#F0AB00] shrink-0" />
                              <span>Print Slip</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCopySingleRow(item)}
                            className="app-btn-sm bg-white hover:bg-[#EFF4F9] border border-[#BCC8D4] text-[#0A6ED1]"
                            title="Copy formatted record summary to clipboard for chat apps"
                          >
                            {copiedMode === item.id ? (
                              <Check className="w-3 h-3 shrink-0" />
                            ) : (
                              <Copy className="w-3 h-3 shrink-0" />
                            )}
                            <span>{copiedMode === item.id ? 'Copied' : 'Copy'}</span>
                          </button>
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => handleEdit(item)}
                              className="app-btn-sm bg-white hover:bg-[#EFF4F9] border border-[#BCC8D4] text-[#354A5F]"
                            >
                              <Edit2 className="w-3 h-3 shrink-0" />
                              <span>Edit</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(item)}
                              className="app-btn-sm bg-[#BB0000] hover:bg-[#9E0000] text-white"
                            >
                              <Trash2 className="w-3 h-3 shrink-0" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredEntries.length > 0 && (
              <tfoot>
                <tr className="bg-[#EFF4F9] border-t-2 border-[#354A5F] font-extrabold text-xs">
                  <td colSpan={4} className="py-2.5 px-3 text-[#354A5F]">
                    TOTAL EX-FACTORY ENTRIES: {filteredEntries.length}
                    {selectedIds.length > 0 ? ` (${selectedIds.length} selected for copy)` : ''}
                  </td>
                  <td colSpan={8} className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={handleCopyTotalSummary}
                      className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white"
                    >
                      <Copy className="w-3 h-3 shrink-0" />
                      <span>Copy All Total ({targetCopyEntries.length})</span>
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Inline Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] bg-slate-950/65 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#D1DBE5] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E3EAF2] flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1C2833]">Delete Ex-Factory Entry</h3>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="text-[#5B738B] hover:text-[#1C2833] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-[#1C2833] leading-relaxed">
              Delete Ex-Factory record <strong>{confirmDelete.delNoteNumber}</strong> ({confirmDelete.customerName} ·{' '}
              {confirmDelete.truckNumber})?
            </div>
            <div className="px-5 py-3.5 border-t border-[#E3EAF2] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] border border-[#BCC8D4] text-[#354A5F]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmDelete}
                className="app-btn-sm bg-[#BB0000] hover:bg-[#9E0000] text-white"
              >
                Delete Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ex-Factory 8-Row Loading Slip Modal (Identical to Main Section) */}
      {activeEntryForSlip && (
        <LoadingSlipModal
          ticket={exFactoryToTicketRecord(activeEntryForSlip.entry, activeEntryForSlip.srNo)}
          settings={settings}
          materials={StorageService.getMaterials()}
          currentUserId={currentUser.id}
          storeInchargeFullName={currentUser.fullName}
          storeInchargeSignatureDataUrl={currentUser.signatureDataUrl}
          isExFactory
          onSave={handleSaveExFactoryLoadingSlip}
          onClose={() => setActiveEntryForSlip(null)}
        />
      )}

      {/* Ex-Factory 2-Copy A4 Loading Slip Print Preview */}
      {activeEntryForPrintSlip && (
        <LoadingSlipPrintView
          ticket={exFactoryToTicketRecord(activeEntryForPrintSlip.entry, activeEntryForPrintSlip.srNo)}
          settings={settings}
          currentUserId={currentUser.id}
          storeInchargeFullName={currentUser.fullName}
          storeInchargeSignatureDataUrl={currentUser.signatureDataUrl}
          onClose={() => setActiveEntryForPrintSlip(null)}
        />
      )}

      {/* Floating Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[70] max-w-md px-4 py-3 rounded-xl border shadow-xl text-xs font-semibold flex items-center gap-2.5 text-white ${
            toast.type === 'success' ? 'bg-emerald-900 border-emerald-600' : 'bg-red-900 border-red-600'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-300 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="text-white/75 hover:text-white cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
