import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TicketRecord,
  LoadingSlipData,
  LoadingSlipItem,
  CompanySettings,
  MaterialMasterRecord,
} from '../types';
import { ApiClient } from '../services/api';
import { StorageService, createEmpty8Rows, getCurrentTimeString } from '../services/storage';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { buildDriverLiveStatusUrl, generateQrPngDataUrl } from '../utils/driverStatusUrl';
import {
  FileText,
  Save,
  Printer,
  X,
  Trash2,
  AlertCircle,
  AlertTriangle,
  Clock,
  QrCode,
  Maximize2,
  Layers,
  CheckCircle2,
  Sparkles,
  Loader2,
} from 'lucide-react';

export const PACK_DROPDOWN_OPTIONS = [
  'Can',
  'Drum',
  'Board',
  'EA',
  'KG',
  'Rolls',
  'Pallet',
  'Box',
];

interface LoadingSlipModalProps {
  ticket: TicketRecord;
  settings: CompanySettings;
  materials?: MaterialMasterRecord[];
  currentUserId?: string;
  storeInchargeFullName?: string;
  storeInchargeSignatureDataUrl?: string;
  isExFactory?: boolean;
  onSave: (updatedTicket: TicketRecord, openPrintDirectly?: boolean) => Promise<void> | void;
  onClose: () => void;
}

interface DropdownAnchorRect {
  top: number;
  left: number;
  width: number;
}

function scoreMaterialMatch(materialName: string, query: string): number {
  if (!query) return 999;
  const upperName = materialName.toUpperCase();
  if (upperName === query) return 0;
  if (upperName.startsWith(query)) return 1;
  const tokens = upperName.split(/[\s\-_/]+/);
  if (tokens.some((t) => t.startsWith(query))) return 2;
  if (upperName.includes(query)) return 3;
  return 999;
}

function renderHighlightedName(name: string, query: string): React.ReactNode {
  const q = query.trim().toUpperCase();
  if (!q) return name;
  const idx = name.toUpperCase().indexOf(q);
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-amber-200 text-neutral-950 font-black rounded-xs px-0.5">
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export const LoadingSlipModal: React.FC<LoadingSlipModalProps> = ({
  ticket,
  settings,
  materials: materialsProp,
  currentUserId,
  storeInchargeFullName,
  storeInchargeSignatureDataUrl,
  isExFactory = false,
  onSave,
  onClose,
}) => {
  const existingSlip = ticket.loadingSlip;
  const isSlipLocked = Boolean(existingSlip?.isLocked);
  const isOtherPreparerLocked = Boolean(
    isSlipLocked &&
      existingSlip?.storeInchargeUserId &&
      currentUserId &&
      existingSlip.storeInchargeUserId !== currentUserId
  );
  const displayStoreInchargeName = isOtherPreparerLocked
    ? (existingSlip?.storeInchargeName || storeInchargeFullName || '').trim()
    : (storeInchargeFullName || existingSlip?.storeInchargeName || '').trim();
  const displaySignatureDataUrl = isOtherPreparerLocked
    ? existingSlip?.storeInchargeSignatureDataUrl || settings.storeInchargeSignatureDataUrl || ''
    : storeInchargeSignatureDataUrl || settings.storeInchargeSignatureDataUrl || '';

  const [delNoteNumber, setDelNoteNumber] = useState<string>(
    existingSlip?.delNoteNumber || ticket.delNoteNumber || 'A1DD00001'
  );
  const [placeName, setPlaceName] = useState<string>(
    existingSlip?.placeName || ticket.destinationPlace || (isExFactory ? 'EX-FACTORY' : '')
  );
  const [driverName, setDriverName] = useState<string>(ticket.driverName);
  const [driverPhone, setDriverPhone] = useState<string>(() => formatSaudiPhoneNumber(ticket.driverPhone));
  const [truckNumber, setTruckNumber] = useState<string>(ticket.truckNumber);
  const transporterName = ticket.transporterName || '';
  const preparedBy = existingSlip?.preparedBy || '';
  const [checkedBy, setCheckedBy] = useState<string>(existingSlip?.checkedBy || '');
  const [markCompleteOnSave, setMarkCompleteOnSave] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<'save' | 'print' | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrEnlarged, setQrEnlarged] = useState<boolean>(false);
  const delNoteInputRef = useRef<HTMLInputElement | null>(null);
  const placeNameInputRef = useRef<HTMLInputElement | null>(null);

  // Material Master catalog hydration (falls back to StorageService cache and live fetch if empty)
  const [localMaterials, setLocalMaterials] = useState<MaterialMasterRecord[]>(() =>
    materialsProp && materialsProp.length > 0 ? materialsProp : StorageService.getMaterials()
  );

  useEffect(() => {
    if (materialsProp && materialsProp.length > 0) {
      setLocalMaterials(materialsProp);
    }
  }, [materialsProp]);

  useEffect(() => {
    if ((materialsProp && materialsProp.length > 0) || localMaterials.length > 0) return;
    let cancelled = false;
    ApiClient.getMaterials()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) {
          StorageService.saveMaterials(list);
          setLocalMaterials(list);
        }
      })
      .catch(() => {
        // Silent best-effort sync when modal opens
      });
    return () => {
      cancelled = true;
    };
  }, [materialsProp, localMaterials.length]);

  const materialExactMap = useMemo(() => {
    const map = new Map<string, MaterialMasterRecord>();
    for (const m of localMaterials) {
      const key = (m.materialName || '').trim().toUpperCase();
      if (key) map.set(key, m);
    }
    return map;
  }, [localMaterials]);

  // Search dropdown Portal state
  const [activeDescRow, setActiveDescRow] = useState<number | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(0);
  const [dropdownRect, setDropdownRect] = useState<DropdownAnchorRect | null>(null);
  const descInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);

  const liveStatusUrl = buildDriverLiveStatusUrl({
    driverStatusToken: ticket.driverStatusToken,
    truckNumber,
  });

  useEffect(() => {
    let cancelled = false;
    generateQrPngDataUrl(liveStatusUrl, 360)
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [liveStatusUrl]);

  // Initialize 8 rows
  const [items, setItems] = useState<LoadingSlipItem[]>(() => {
    if (existingSlip?.items && existingSlip.items.length > 0) {
      const current = existingSlip.items.map((it, idx) => ({
        ...it,
        srNo: idx + 1,
        palletRatio: it.palletRatio || '23',
      }));
      while (current.length < 8) {
        current.push({
          srNo: current.length + 1,
          description: '',
          pack: '',
          palletRatio: '23',
          qty: '',
          pallets: '',
          looseRolls: '',
          remarks: '',
        });
      }
      return current.slice(0, 8);
    }
    return createEmpty8Rows();
  });

  // Safe numeric extraction for manual inputs
  const extractNumeric = (val?: string | number | null): number => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const match = String(val).match(/(\d+(\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const totalQty = items.reduce((acc, row) => acc + extractNumeric(row.qty), 0);
  const totalPallets = items.reduce((acc, row) => acc + extractNumeric(row.pallets), 0);
  const totalLooseRolls = items.reduce((acc, row) => acc + extractNumeric(row.looseRolls), 0);

  const [rollsPerPallet, setRollsPerPallet] = useState<number>(23);

  const updateDropdownPosition = useCallback((rowIdx: number | null) => {
    if (rowIdx === null) {
      setDropdownRect(null);
      return;
    }
    const el = descInputRefs.current[rowIdx];
    if (!el) {
      setDropdownRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
  }, []);

  useEffect(() => {
    if (activeDescRow === null) return;
    updateDropdownPosition(activeDescRow);
    const onReposition = () => updateDropdownPosition(activeDescRow);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [activeDescRow, updateDropdownPosition]);

  const activeSuggestions = useMemo(() => {
    if (activeDescRow === null || isSlipLocked) return [];
    const query = (items[activeDescRow]?.description || '').trim().toUpperCase();
    if (query.length < 1) return [];

    return localMaterials
      .map((mat) => ({
        mat,
        score: scoreMaterialMatch(mat.materialName, query),
      }))
      .filter((entry) => entry.score < 999)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.mat.materialName.localeCompare(b.mat.materialName);
      })
      .slice(0, 50)
      .map((entry) => entry.mat);
  }, [activeDescRow, isSlipLocked, items, localMaterials]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [activeDescRow, items[activeDescRow ?? -1]?.description]);

  const applyMaterialToRow = useCallback((index: number, mat: MaterialMasterRecord) => {
    setItems((prev) => {
      const updated = [...prev];
      const existingRow = updated[index];
      if (!existingRow) return prev;
      const ratioVal = Number(mat.palletRatio) > 0 ? Number(mat.palletRatio) : 23;
      const numQty = extractNumeric(existingRow.qty);
      const nextRow: LoadingSlipItem = {
        ...existingRow,
        description: mat.materialName.trim().toUpperCase(),
        pack: mat.packType || 'Rolls',
        palletRatio: String(ratioVal),
        remarks:
          existingRow.remarks && existingRow.remarks.trim()
            ? existingRow.remarks
            : (mat.remarks || '').trim().toUpperCase(),
      };
      if (numQty > 0 && ratioVal > 0) {
        nextRow.pallets = String(Math.floor(numQty / ratioVal));
        nextRow.looseRolls = String(numQty % ratioVal);
      }
      updated[index] = nextRow;
      return updated;
    });
    setActiveDescRow(null);
  }, []);

  const handleRowChange = (index: number, field: keyof LoadingSlipItem, value: string) => {
    setItems((prev) => {
      const updated = [...prev];
      const nextVal =
        field === 'pack' && (value === '' || PACK_DROPDOWN_OPTIONS.includes(value))
          ? value
          : value.toUpperCase();
      const currentRow: LoadingSlipItem = {
        ...updated[index],
        [field]: nextVal,
      };

      // When user types in Material Description: automatically check exact Material Master match
      // so typing the material name manually auto-fills Pack Type & Auto-Pallet Ratio immediately!
      if (field === 'description') {
        const cleanDesc = nextVal.trim().toUpperCase();
        const exactMatch = cleanDesc ? materialExactMap.get(cleanDesc) : undefined;
        if (exactMatch) {
          const ratioVal = Number(exactMatch.palletRatio) > 0 ? Number(exactMatch.palletRatio) : 23;
          currentRow.pack = exactMatch.packType || currentRow.pack || 'Rolls';
          currentRow.palletRatio = String(ratioVal);
          if (!currentRow.remarks?.trim() && exactMatch.remarks) {
            currentRow.remarks = exactMatch.remarks.trim().toUpperCase();
          }
          const numQty = extractNumeric(currentRow.qty);
          if (numQty > 0 && ratioVal > 0) {
            currentRow.pallets = String(Math.floor(numQty / ratioVal));
            currentRow.looseRolls = String(numQty % ratioVal);
          }
        }
      }

      if (field === 'qty') {
        const numQty = extractNumeric(nextVal);
        const rowRatio = extractNumeric(currentRow.palletRatio) || rollsPerPallet || 23;
        if (numQty > 0 && rowRatio > 0) {
          const autoPallets = Math.floor(numQty / rowRatio);
          const autoLoose = numQty % rowRatio;
          currentRow.pallets = String(autoPallets);
          currentRow.looseRolls = String(autoLoose);
          if (!currentRow.pack) {
            currentRow.pack = 'Rolls';
          }
        } else if (nextVal.trim() === '') {
          currentRow.pallets = '';
          currentRow.looseRolls = '';
        }
      }

      if (field === 'palletRatio') {
        const newRatio = extractNumeric(nextVal);
        const numQty = extractNumeric(currentRow.qty);
        if (numQty > 0 && newRatio > 0) {
          currentRow.pallets = String(Math.floor(numQty / newRatio));
          currentRow.looseRolls = String(numQty % newRatio);
        }
      }

      updated[index] = currentRow;
      return updated;
    });
  };

  // Detect new materials not yet in Material Master and duplicate material names within this slip
  const { newManualMaterials, duplicateSlipMaterials } = useMemo(() => {
    const counts = new Map<string, number>();
    const newNames: string[] = [];
    for (const row of items) {
      const name = (row.description || '').trim().toUpperCase();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
      if (!materialExactMap.has(name) && !newNames.includes(name)) {
        newNames.push(name);
      }
    }
    const dups = Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
    return { newManualMaterials: newNames, duplicateSlipMaterials: dups };
  }, [items, materialExactMap]);

  const handleApplyGlobalRatioToAll = (targetRatio: number) => {
    if (targetRatio <= 0) return;
    setRollsPerPallet(targetRatio);
    setItems((prev) =>
      prev.map((row) => {
        const numQty = extractNumeric(row.qty);
        const updatedRow: LoadingSlipItem = {
          ...row,
          palletRatio: String(targetRatio),
        };
        if (numQty > 0) {
          updatedRow.pallets = String(Math.floor(numQty / targetRatio));
          updatedRow.looseRolls = String(numQty % targetRatio);
          updatedRow.pack = row.pack || 'Rolls';
        }
        return updatedRow;
      })
    );
  };

  const handleRecalculateAllRows = () => {
    setItems((prev) =>
      prev.map((row) => {
        const numQty = extractNumeric(row.qty);
        const rowRatio = extractNumeric(row.palletRatio) || rollsPerPallet || 23;
        if (numQty > 0 && rowRatio > 0) {
          return {
            ...row,
            pallets: String(Math.floor(numQty / rowRatio)),
            looseRolls: String(numQty % rowRatio),
            pack: row.pack || 'Rolls',
          };
        }
        return row;
      })
    );
  };

  const handleClearRow = (index: number) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        srNo: index + 1,
        description: '',
        pack: '',
        palletRatio: String(rollsPerPallet || 23),
        qty: '',
        pallets: '',
        looseRolls: '',
        remarks: '',
      };
      return updated;
    });
    if (activeDescRow === index) {
      setActiveDescRow(null);
    }
  };

  const buildSlipData = (): LoadingSlipData => {
    return {
      delNoteNumber: delNoteNumber.trim().toUpperCase(),
      placeName: placeName.trim().toUpperCase(),
      items: items.map((it) => ({
        ...it,
        description: (it.description || '').toUpperCase(),
        pack: PACK_DROPDOWN_OPTIONS.includes(it.pack) ? it.pack : (it.pack || '').toUpperCase(),
        qty: (it.qty || '').toUpperCase(),
        pallets: (it.pallets || '').toUpperCase(),
        looseRolls: (it.looseRolls || '').toUpperCase(),
        palletRatio: it.palletRatio ? it.palletRatio.toUpperCase() : it.palletRatio,
        remarks: (it.remarks || '').toUpperCase(),
      })),
      totalQty,
      totalPallets,
      totalLooseRolls,
      preparedBy: preparedBy.trim().toUpperCase(),
      checkedBy: checkedBy.trim().toUpperCase(),
      storeInchargeUserId: currentUserId,
      storeInchargeName: displayStoreInchargeName,
      storeInchargeSignatureDataUrl: storeInchargeSignatureDataUrl || '',
      createdAt: existingSlip?.createdAt || new Date().toISOString().split('T')[0],
    };
  };

  const handleSaveOnly = async (printDirectly = false) => {
    if (saving) return;
    if (isSlipLocked) {
      if (printDirectly) {
        await onSave(ticket, true);
      }
      return;
    }
    if (!delNoteNumber.trim()) {
      setValidationError('Please enter Delivery Note / Challan Number!');
      delNoteInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      delNoteInputRef.current?.focus();
      return;
    }
    if (!placeName.trim()) {
      setValidationError('Please enter Destination Place / Unloading Point!');
      placeNameInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      placeNameInputRef.current?.focus();
      return;
    }
    setValidationError(null);

    const updatedSlip = buildSlipData();
    const formattedPhone = formatSaudiPhoneNumber(driverPhone);
    const nowTime = getCurrentTimeString();
    const nowMs = Date.now();
    const delayMinutes =
      ticket.autoLoadingMinutes && ticket.autoLoadingMinutes >= 30
        ? ticket.autoLoadingMinutes
        : 30;
    const isManualComplete = !isExFactory && markCompleteOnSave;
    const nextStatus = isManualComplete ? 'completed' : 'waiting';
    const updatedTicket: TicketRecord = {
      ...ticket,
      delNoteNumber: delNoteNumber.trim().toUpperCase(),
      truckNumber: truckNumber.trim().toUpperCase(),
      driverName: driverName.trim().toUpperCase(),
      driverPhone: formattedPhone,
      transporterName: transporterName.trim().toUpperCase(),
      destinationPlace: placeName.trim().toUpperCase(),
      loadingSlip: updatedSlip,
      status: nextStatus,
      timeLoadingStarted: isManualComplete ? ticket.timeLoadingStarted || nowTime : '',
      timeCompleted: isManualComplete ? ticket.timeCompleted || nowTime : '',
      manualStatusOverride: isManualComplete ? true : false,
      autoUnderLoadingApplied: false,
      autoLoadingMinutes: delayMinutes,
      autoUnderLoadingAt: nowMs + delayMinutes * 60 * 1000,
    };

    setSaving(true);
    setPendingAction(printDirectly ? 'print' : 'save');
    try {
      await onSave(updatedTicket, printDirectly);
    } catch (err: any) {
      setValidationError(err?.message || 'Failed to save loading slip. Please try again.');
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-6xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {isExFactory ? 'Ex-Factory Material Loading Slip' : 'Generate Material Loading Slip'}
              </h2>
              <p className="text-xs text-blue-100">
                {isExFactory
                  ? `Ex-Factory Dispatch | Ref: ${ticket.ticketNumber} | Customer: ${ticket.transporterName || '—'} | Truck: ${ticket.truckNumber}`
                  : `Ticket: ${ticket.ticketNumber} | Gate: ${ticket.gateNumber} (Pos #${ticket.gateSequenceNumber}) | Truck: ${ticket.truckNumber}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-blue-100 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div ref={modalScrollRef} className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {isSlipLocked && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-extrabold">🔒 Loading Completed &amp; Locked</span>
                <span className="ml-1.5 text-emerald-800">
                  Completed by <strong>{existingSlip?.loadingCompletedBy || existingSlip?.checkedBy || 'Operator'}</strong>
                  {existingSlip?.loadingCompletedTime ? ` on ${existingSlip.loadingCompletedTime}` : ''}. Materials and quantities are locked against accidental edits.
                </span>
              </div>
            </div>
          )}

          {/* Header Metadata Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Delivery Note Number (Del Note No.) *
              </label>
              <input
                ref={delNoteInputRef}
                type="text"
                value={delNoteNumber}
                onChange={(e) => {
                  setDelNoteNumber(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="e.g. AWZR-2026/0000000001"
                className={`w-full px-3 py-1.5 text-sm font-semibold rounded-lg border focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white ${
                  validationError && !delNoteNumber.trim() ? 'border-red-500 ring-2 ring-red-200' : 'border-neutral-300'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Destination Place / Unloading Point *
              </label>
              <input
                ref={placeNameInputRef}
                type="text"
                value={placeName}
                onChange={(e) => {
                  setPlaceName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="e.g. KSA"
                className={`w-full px-3 py-1.5 text-sm font-semibold rounded-lg border focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white ${
                  validationError && !placeName.trim() ? 'border-red-500 ring-2 ring-red-200' : 'border-neutral-300'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Vehicle / Truck Number
              </label>
              <input
                type="text"
                value={truckNumber}
                onChange={(e) => setTruckNumber(e.target.value)}
                placeholder="e.g. 4582 AWZ"
                className="w-full px-3 py-1.5 text-sm font-bold uppercase rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Driver Name & Mobile (+966)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="Driver Name"
                  className="w-1/2 px-2.5 py-1.5 text-sm font-medium rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
                <input
                  type="text"
                  value={driverPhone}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDriverPhone(val);
                    const digits = val.replace(/\D/g, '');
                    if (digits.startsWith('05') && digits.length === 10) {
                      setDriverPhone('+966' + digits.slice(1));
                    } else if (digits.startsWith('5') && digits.length === 9) {
                      setDriverPhone('+966' + digits);
                    }
                  }}
                  onBlur={() => {
                    if (driverPhone.trim()) setDriverPhone(formatSaudiPhoneNumber(driverPhone));
                  }}
                  placeholder="e.g. 0550000000"
                  className="w-1/2 px-2.5 py-1.5 text-sm font-bold rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Quick Helper Banner with Auto-Calculation Ratio + Material Master Hint */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-gradient-to-r from-amber-50 via-blue-50 to-emerald-50 border border-amber-300/80 rounded-xl p-3 text-neutral-800 shadow-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-amber-300 shadow-xs">
                <span className="font-bold text-amber-950 text-xs">⚡ Quick Set All Rows:</span>
                <span className="text-neutral-700 font-medium">1 Pallet =</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={rollsPerPallet}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value) || 23);
                    setRollsPerPallet(val);
                  }}
                  className="w-14 px-1.5 py-0.5 text-center font-black text-amber-950 bg-amber-50 border border-amber-400 rounded focus:ring-1 focus:ring-amber-500 focus:outline-none"
                />
                <span className="text-neutral-700 font-medium">Rolls</span>
                <button
                  type="button"
                  onClick={() => handleApplyGlobalRatioToAll(rollsPerPallet)}
                  title="Apply this ratio to all 8 rows"
                  className="ml-1.5 px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition shadow-2xs cursor-pointer"
                >
                  Apply to All Rows
                </button>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-100/80 text-blue-900 border border-blue-200 font-bold text-[11px]">
                <Layers className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                <span>Material Master Active ({localMaterials.length}): Type 1st letter to auto-fill Pack &amp; Ratio</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRecalculateAllRows}
                title="Recalculate Pallets & Loose Rolls for all rows with quantities"
                className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 rounded-lg shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span>🔄 Recalculate Rows</span>
              </button>
              <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg border border-emerald-200 font-bold text-[10.5px]">
                A4 Dual-Copy Ready
              </span>
            </div>
          </div>

          {/* 8-Rows Table */}
          <div className="border border-neutral-300 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-neutral-800 text-white text-[11px] uppercase tracking-wider">
                    <th className="py-2.5 px-2 text-center w-8">#</th>
                    <th className="py-2.5 px-3 min-w-[220px]">
                      Material Description *
                    </th>
                    <th className="py-2.5 px-2 w-32">
                      Pack Type (Dropdown)
                    </th>
                    <th className="py-2.5 px-2 w-36 text-center bg-amber-900/95 text-amber-300 border-x border-amber-800 font-bold">
                      Auto-Pallet Ratio (1 Pallet =)
                    </th>
                    <th className="py-2.5 px-2 w-28 text-center bg-neutral-900 text-amber-300 font-bold">
                      Quantity (e.g. 553)
                    </th>
                    <th className="py-2.5 px-2 w-28 text-center bg-blue-900/90 text-emerald-300 font-bold">
                      Pallets (Auto)
                    </th>
                    <th className="py-2.5 px-2 w-28 text-center bg-indigo-900/90 text-cyan-300 font-bold">
                      Loose Rolls (Remainder)
                    </th>
                    <th className="py-2.5 px-2 min-w-[120px]">Remarks / Batch</th>
                    <th className="py-2.5 px-1 w-9 text-center">Clear</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {items.map((row, index) => {
                    const cleanDesc = (row.description || '').trim().toUpperCase();
                    const isMatchedInMaster = Boolean(cleanDesc && materialExactMap.has(cleanDesc));
                    const isNewManual = Boolean(cleanDesc && !isMatchedInMaster);
                    return (
                      <tr key={index} className={index % 2 === 1 ? 'bg-neutral-50/70' : 'bg-white'}>
                        <td className="py-2 px-2 text-center font-bold text-neutral-600 bg-neutral-100/60">
                          {index + 1}
                        </td>
                        <td className="py-1 px-2">
                          <div className="relative flex items-center gap-1">
                            <input
                              ref={(el) => {
                                descInputRefs.current[index] = el;
                              }}
                              type="text"
                              value={row.description}
                              disabled={isSlipLocked}
                              autoComplete="off"
                              onFocus={() => {
                                if (!isSlipLocked) {
                                  setActiveDescRow(index);
                                  updateDropdownPosition(index);
                                }
                              }}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveDescRow((curr) => (curr === index ? null : curr));
                                }, 140);
                              }}
                              onChange={(e) => {
                                handleRowChange(index, 'description', e.target.value);
                                if (!isSlipLocked) {
                                  setActiveDescRow(index);
                                  updateDropdownPosition(index);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (activeDescRow !== index || activeSuggestions.length === 0) return;
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setHighlightedIdx((prev) => (prev + 1) % activeSuggestions.length);
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setHighlightedIdx((prev) =>
                                    prev <= 0 ? activeSuggestions.length - 1 : prev - 1
                                  );
                                } else if (e.key === 'Enter') {
                                  const selected = activeSuggestions[highlightedIdx] || activeSuggestions[0];
                                  if (selected) {
                                    e.preventDefault();
                                    applyMaterialToRow(index, selected);
                                  }
                                } else if (e.key === 'Tab') {
                                  setActiveDescRow(null);
                                } else if (e.key === 'Escape') {
                                  setActiveDescRow(null);
                                }
                              }}
                              placeholder={`Type material (Row #${index + 1})`}
                              className={`w-full px-2.5 py-1.5 text-xs font-semibold rounded border bg-white focus:outline-none focus:ring-1 ${
                                isMatchedInMaster
                                  ? 'border-emerald-400 focus:border-emerald-600 focus:ring-emerald-500'
                                  : isNewManual
                                  ? 'border-amber-400 focus:border-amber-600 focus:ring-amber-500'
                                  : 'border-neutral-200 focus:border-blue-500 focus:ring-blue-500'
                              }`}
                            />
                            {isMatchedInMaster && (
                              <span
                                title="Auto-filled from Material Master"
                                className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9.5px] font-extrabold"
                              >
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>MM</span>
                              </span>
                            )}
                            {isNewManual && (
                              <span
                                title="Not in Material Master — will auto-save on slip save"
                                className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[9.5px] font-extrabold"
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                <span>NEW</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1 px-2">
                          <div className="space-y-1">
                            <select
                              value={PACK_DROPDOWN_OPTIONS.includes(row.pack) ? row.pack : (row.pack ? '__CUSTOM__' : '')}
                              disabled={isSlipLocked}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '__CUSTOM__') {
                                  handleRowChange(index, 'pack', '');
                                } else {
                                  handleRowChange(index, 'pack', val);
                                }
                              }}
                              className="w-full px-2 py-1.5 text-xs font-bold rounded-lg border border-neutral-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white shadow-sm"
                            >
                              <option value="">-- Select Pack --</option>
                              <option value="Can">Can</option>
                              <option value="Drum">Drum</option>
                              <option value="Board">Board</option>
                              <option value="EA">EA</option>
                              <option value="KG">KG</option>
                              <option value="Rolls">Rolls</option>
                              <option value="Pallet">Pallet</option>
                              <option value="Box">Box</option>
                              <option value="__CUSTOM__">Other / Custom</option>
                            </select>
                            {(!PACK_DROPDOWN_OPTIONS.includes(row.pack) && row.pack !== '') && (
                              <input
                                type="text"
                                value={row.pack}
                                disabled={isSlipLocked}
                                onChange={(e) => handleRowChange(index, 'pack', e.target.value)}
                                placeholder="Type custom pack"
                                className="w-full px-2 py-0.5 text-[10.5px] rounded border border-blue-400 focus:outline-none bg-blue-50/60"
                              />
                            )}
                          </div>
                        </td>

                        {/* Auto-Pallet Ratio directly ahead of Quantity */}
                        <td className="py-1 px-1.5 text-center bg-amber-50/50 border-x border-amber-200/60">
                          <div className="flex items-center justify-center gap-1 bg-white border border-amber-300 rounded-lg px-1.5 py-1 shadow-2xs">
                            <span className="text-[10px] font-bold text-amber-900 whitespace-nowrap">1P =</span>
                            <input
                              type="number"
                              min="1"
                              max="10000"
                              value={row.palletRatio ?? '23'}
                              disabled={isSlipLocked}
                              onChange={(e) => handleRowChange(index, 'palletRatio', e.target.value)}
                              placeholder="23"
                              title="Auto-Pallet Ratio: Number of rolls/units in 1 Pallet for this material"
                              className="w-12 px-1 py-0.5 text-xs text-center font-black text-amber-950 bg-amber-50/70 rounded border border-amber-400 focus:ring-1 focus:ring-amber-500 focus:outline-none"
                            />
                            <span className="text-[9.5px] text-amber-800 font-semibold whitespace-nowrap">
                              {row.pack || 'Rolls'}
                            </span>
                          </div>
                        </td>

                        {/* Quantity */}
                        <td className="py-1 px-2 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.qty}
                            disabled={isSlipLocked}
                            onChange={(e) => handleRowChange(index, 'qty', e.target.value)}
                            placeholder="e.g. 553"
                            className="w-full px-2 py-1.5 text-xs text-center font-bold rounded-lg border border-neutral-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white shadow-sm"
                          />
                        </td>

                        {/* Pallets (Auto) */}
                        <td className="py-1 px-2 text-center bg-blue-50/40">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.pallets}
                            disabled={isSlipLocked}
                            onChange={(e) => handleRowChange(index, 'pallets', e.target.value)}
                            placeholder="24"
                            title="Pallets auto-calculated (Qty ÷ Ratio) or enter manually"
                            className="w-full px-2 py-1.5 text-xs text-center font-black text-blue-900 rounded-lg border border-blue-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white shadow-sm"
                          />
                        </td>

                        {/* Loose Rolls (Remainder) */}
                        <td className="py-1 px-2 text-center bg-indigo-50/40">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.looseRolls}
                            disabled={isSlipLocked}
                            onChange={(e) => handleRowChange(index, 'looseRolls', e.target.value)}
                            placeholder="1"
                            title="Loose rolls auto-calculated (Qty % Ratio) or enter manually"
                            className="w-full px-2 py-1.5 text-xs text-center font-black text-indigo-900 rounded-lg border border-indigo-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white shadow-sm"
                          />
                        </td>

                        <td className="py-1 px-2">
                          <input
                            type="text"
                            value={row.remarks || ''}
                            disabled={isSlipLocked}
                            onChange={(e) => handleRowChange(index, 'remarks', e.target.value)}
                            placeholder="Batch / Grade"
                            className="w-full px-2 py-1.5 text-xs rounded border border-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                          />
                        </td>
                        <td className="py-1 px-1 text-center">
                          <button
                            type="button"
                            disabled={isSlipLocked}
                            onClick={() => handleClearRow(index)}
                            className="p-1 text-neutral-400 hover:text-red-600 rounded transition cursor-pointer disabled:opacity-40"
                            title="Clear this row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Auto Calculated Totals Row */}
                <tfoot>
                  <tr className="bg-neutral-800 text-white font-extrabold text-xs">
                    <td colSpan={4} className="py-2.5 px-4 text-right tracking-wider uppercase">
                      CALCULATED TOTALS :
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black text-amber-300">
                      {totalQty}
                      <span className="text-[9.5px] font-normal text-amber-200 block">Total Qty</span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black text-emerald-300 bg-blue-950">
                      {totalPallets}
                      <span className="text-[9.5px] font-normal text-emerald-200 block">Total Pallets</span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-sm font-black text-cyan-300 bg-indigo-950">
                      {totalLooseRolls}
                      <span className="text-[9.5px] font-normal text-cyan-200 block">Total Loose Rolls</span>
                    </td>
                    <td colSpan={2} className="py-2.5 px-3 text-[11px] text-neutral-300 font-medium">
                      Exact 8 Rows preserved for single A4 printing
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Material Master Auto-Save & Duplicate Line Notice */}
          {!isSlipLocked && (newManualMaterials.length > 0 || duplicateSlipMaterials.length > 0) && (
            <div className="space-y-1.5">
              {newManualMaterials.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950">
                  <Sparkles className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>
                    <strong>Auto-Save to Material Master:</strong> New material(s){' '}
                    <strong>{newManualMaterials.join(', ')}</strong> will be saved automatically to Material Master with their Pack Type &amp; Auto-Pallet Ratio when you save this slip.
                  </span>
                </div>
              )}
              {duplicateSlipMaterials.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>Note:</strong> Material <strong>{duplicateSlipMaterials.join(', ')}</strong> appears in multiple rows of this slip (Material Master will only store unique names once without creating duplicates).
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Live Status QR Pass (Left) + Signatures & Operator Details */}
          <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-200 grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-3 items-center">
            <div className="flex items-center gap-2.5 bg-white border border-neutral-300 rounded-xl px-2.5 py-2 shrink-0">
              <button
                type="button"
                onClick={() => qrDataUrl && setQrEnlarged(true)}
                disabled={!qrDataUrl}
                title="Enlarge Live Loading Status QR Code"
                className="w-14 h-14 rounded-lg border border-neutral-300 bg-white p-0.5 flex items-center justify-center shrink-0 cursor-pointer hover:border-blue-600 transition disabled:cursor-default"
              >
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`Live status QR for ${truckNumber || ticket.truckNumber}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <QrCode className="w-6 h-6 text-neutral-400" />
                )}
              </button>
              <div className="min-w-0 max-w-[175px]">
                <div className="flex items-center gap-1 text-[11px] font-black text-neutral-900">
                  <QrCode className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>Live Status QR</span>
                </div>
                <p className="text-[10px] text-neutral-600 leading-snug mt-0.5">
                  {ticket.driverStatusToken
                    ? 'Same QR prints on both A4 slip copies for Gate Guard scan.'
                    : 'Unique slip QR prints on both A4 copies once saved.'}
                </p>
                <button
                  type="button"
                  onClick={() => qrDataUrl && setQrEnlarged(true)}
                  disabled={!qrDataUrl}
                  className="mt-1 text-[10.5px] font-bold text-blue-700 hover:text-blue-800 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Maximize2 className="w-3 h-3 shrink-0" />
                  <span>Enlarge QR</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-neutral-700 block mb-1">
                Forklift Operator / Loaded By
              </label>
              <input
                type="text"
                value={checkedBy}
                onChange={(e) => setCheckedBy(e.target.value)}
                placeholder="Leave blank or enter name"
                className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>

            <div>
              <span className="text-xs font-semibold text-neutral-700 block mb-1">
                Store Incharge Signature
              </span>
              <div className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 bg-white flex flex-col items-center justify-between min-h-[64px]">
                <div className="h-8 w-full flex items-center justify-center">
                  {displaySignatureDataUrl ? (
                    <img
                      src={displaySignatureDataUrl}
                      alt="Store Incharge Digital Signature"
                      className="max-h-8 max-w-[160px] object-contain"
                    />
                  ) : (
                    <span className="text-[10px] text-neutral-400 italic text-center">
                      No digital signature assigned (Admin upload required)
                    </span>
                  )}
                </div>
                <div className="w-full border-t border-dashed border-neutral-300 pt-0.5 text-center text-xs font-bold text-neutral-900">
                  {displayStoreInchargeName || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Status Info & Optional Completion Override */}
          {!isSlipLocked && (
            <div className="space-y-2">
              {validationError && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{validationError}</span>
                </div>
              )}
              {!isExFactory && (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                    <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      {!existingSlip ? (
                        <>
                          Saving this loading slip sets the status to{' '}
                          <strong className="font-extrabold">Waiting in Queue</strong>, automatically transitions to{' '}
                          <strong className="font-extrabold">Under Loading</strong> after 30 minutes (manual status changes remain available anytime), and sends the live queue WhatsApp link to the driver.
                        </>
                      ) : (
                        <>
                          Editing &amp; saving this loading slip sets status to{' '}
                          <strong className="font-extrabold">Waiting in Queue</strong> and automatically switches to{' '}
                          <strong className="font-extrabold">Under Loading</strong> after 30 minutes (you can also change the status manually anytime).
                        </>
                      )}
                    </span>
                  </div>
                  <label className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={markCompleteOnSave}
                      onChange={(e) => setMarkCompleteOnSave(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-500"
                    />
                    <span className="text-xs text-neutral-800">
                      <span className="font-bold text-emerald-800">Mark as Completed (Optional):</span> Change vehicle status to &apos;Completed&apos; immediately upon saving instead of &apos;Waiting in Queue&apos;.
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="app-btn w-full sm:w-auto sm:min-w-[110px] text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 disabled:opacity-50"
            >
              Cancel
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
              {!isSlipLocked && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveOnly(false)}
                  className="app-btn w-full bg-neutral-800 hover:bg-neutral-900 text-white shadow disabled:opacity-60"
                >
                  {saving && pendingAction === 'save' ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 shrink-0" />
                  )}
                  <span>{saving && pendingAction === 'save' ? 'Saving...' : 'Save Loading Slip'}</span>
                </button>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveOnly(true)}
                className="app-btn w-full bg-blue-700 hover:bg-blue-600 text-white shadow-lg shadow-blue-700/30 disabled:opacity-60"
              >
                {saving && pendingAction === 'print' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {isSlipLocked
                    ? 'Print 2-Copy A4'
                    : saving && pendingAction === 'print'
                    ? 'Saving & Printing...'
                    : 'Save & Print 2-Copy A4'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Search Suggestions Dropdown (Visible from 1st Typed Character) */}
      {activeDescRow !== null &&
        dropdownRect &&
        activeSuggestions.length > 0 &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: Math.min(dropdownRect.top, window.innerHeight - 240),
              left: Math.min(dropdownRect.left, Math.max(8, window.innerWidth - dropdownRect.width - 8)),
              width: dropdownRect.width,
            }}
            className="z-[90] bg-white border border-blue-300 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-3 py-1.5 bg-blue-900 text-white text-[10.5px] font-bold flex items-center justify-between">
              <span>Material Master Matches ({activeSuggestions.length})</span>
              <span className="text-blue-200 font-medium">Enter / Click to Auto-Fill</span>
            </div>
            <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-100">
              {activeSuggestions.map((mat, idx) => {
                const isSelected = idx === highlightedIdx;
                const currentQuery = items[activeDescRow]?.description || '';
                return (
                  <li key={mat.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMaterialToRow(activeDescRow, mat);
                      }}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50 text-blue-950' : 'bg-white hover:bg-neutral-50 text-neutral-900'
                      }`}
                    >
                      <span className="font-bold truncate">
                        {renderHighlightedName(mat.materialName, currentQuery)}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 font-extrabold text-[10px]">
                          {mat.packType}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-950 font-black text-[10px] tabular-nums">
                          1P = {mat.palletRatio}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}

      {qrEnlarged && qrDataUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Loading Slip Live Status QR Code"
          className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setQrEnlarged(false)}
        >
          <div
            className="w-full max-w-xs bg-white rounded-2xl border border-neutral-200 p-5 shadow-2xl space-y-3 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-left">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                  Gate Guard Scan QR
                </p>
                <p className="text-sm font-black text-neutral-900">{truckNumber || ticket.truckNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setQrEnlarged(false)}
                aria-label="Close QR preview"
                className="min-h-[40px] min-w-[40px] rounded-xl bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="w-56 h-56 mx-auto bg-white border-2 border-neutral-900 rounded-xl p-2 flex items-center justify-center">
              <img
                src={qrDataUrl}
                alt={`Full-size QR code for ${truckNumber || ticket.truckNumber}`}
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-[11px] font-mono text-neutral-500 truncate" title={liveStatusUrl}>
              {liveStatusUrl}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
