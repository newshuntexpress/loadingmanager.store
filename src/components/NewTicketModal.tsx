import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  TicketRecord,
  TruckLoadingType,
  DriverMasterRecord,
  CompanySettings,
  LoadingSlipData,
  LoadingSlipItem,
  MaterialMasterRecord,
  WhatsAppDispatchOutcome,
} from '../types';
import { PACK_DROPDOWN_OPTIONS } from './LoadingSlipModal';
import { TicketPrintView } from './TicketPrintView';
import { LoadingSlipPrintView } from './LoadingSlipPrintView';
import { StorageService, getCurrentTimeString, createEmpty8Rows, resolveSettingsForPlant } from '../services/storage';
import { ApiClient } from '../services/api';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { inferLoadingTypeFromDestination } from '../utils/loadingType';
import {
  Ticket,
  Truck,
  User,
  Phone,
  MapPin,
  Building2,
  DoorOpen,
  Hash,
  AlertCircle,
  AlertTriangle,
  Save,
  Printer,
  MessageSquare,
  X,
  FileText,
  Globe,
  ArrowLeftRight,
  Loader2,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  CheckCircle2,
  Trash2,
  Clock,
} from 'lucide-react';

interface NewTicketModalProps {
  date: string;
  plantId?: string;
  settings: CompanySettings;
  materials?: MaterialMasterRecord[];
  currentUserId?: string;
  storeInchargeFullName?: string;
  storeInchargeSignatureDataUrl?: string;
  onSave: (
    ticket: TicketRecord,
    nextAction?: 'print' | 'whatsapp' | 'open_slip' | 'print_slip' | 'slip_saved',
    extra?: {
      autoSavedMaterials?: MaterialMasterRecord[];
      whatsappNotification?: WhatsAppDispatchOutcome;
    }
  ) => Promise<void> | void;
  onClose: () => void;
}

interface DropdownAnchorRect {
  top: number;
  left: number;
  width: number;
}

function extractNumeric(val?: string | number | null): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const match = String(val).match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
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

export const NewTicketModal: React.FC<NewTicketModalProps> = ({
  date,
  plantId = 'RIYADH',
  settings,
  materials: materialsProp,
  currentUserId,
  storeInchargeFullName,
  storeInchargeSignatureDataUrl,
  onSave,
  onClose,
}) => {
  const plantSettings = useMemo(
    () => resolveSettingsForPlant(settings, plantId),
    [settings, plantId]
  );
  const [driverMasterList] = useState<DriverMasterRecord[]>(() => StorageService.getDrivers());

  // Automatic sequence number and ticket number for selected date & plant
  const [nextSeq, setNextSeq] = useState<number>(() => StorageService.getNextDailySequence(date, plantId));
  const [ticketNumber, setTicketNumber] = useState<string>(() =>
    StorageService.generateTicketNumber(date, StorageService.getNextDailySequence(date, plantId), plantId)
  );

  // Optional Delivery Note Number (Del Note No.)
  const [delNoteNumber, setDelNoteNumber] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'save' | 'print' | 'whatsapp' | 'open_slip' | 'print_slip' | null
  >(null);
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [iqamaNumber, setIqamaNumber] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [destinationPlace, setDestinationPlace] = useState('');
  const [loadingType, setLoadingType] = useState<TruckLoadingType>('local');
  const [loadingTypeManual, setLoadingTypeManual] = useState(false);
  const [selectedGate, setSelectedGate] = useState<string>(plantSettings.gates[0] || 'Gate 1');
  const [remarks, setRemarks] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [autoPrintToken, setAutoPrintToken] = useState<boolean>(plantSettings.autoPrintTokenAfterSave ?? true);

  // Inline Loading Slip builder state
  const [includeLoadingSlip, setIncludeLoadingSlip] = useState<boolean>(false);
  const [rollsPerPallet, setRollsPerPallet] = useState<number>(23);
  const [items, setItems] = useState<LoadingSlipItem[]>(() => createEmpty8Rows());
  const [checkedBy, setCheckedBy] = useState<string>('');
  const [markCompleteOnSave, setMarkCompleteOnSave] = useState<boolean>(false);

  // Refs to prevent duplicate creation if step 2 fails and user retries, and for focusing invalid inputs
  const createdTicketDraftRef = useRef<TicketRecord | null>(null);
  const delNoteInputRef = useRef<HTMLInputElement | null>(null);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);
  const [localPrintMode, setLocalPrintMode] = useState<'ticket' | 'slip' | null>(null);

  // Material Master catalog hydration
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
        // Silent best-effort sync
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

  // Search dropdown Portal state for Loading Slip Material Description
  const [activeDescRow, setActiveDescRow] = useState<number | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(0);
  const [dropdownRect, setDropdownRect] = useState<DropdownAnchorRect | null>(null);
  const descInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Filtered autocomplete suggestions for truck number, driver name, or iqama number
  const [suggestions, setSuggestions] = useState<DriverMasterRecord[]>([]);
  const [activeSuggestField, setActiveSuggestField] = useState<'truck' | 'driver' | 'iqama' | null>(null);
  const [matchedDriver, setMatchedDriver] = useState<DriverMasterRecord | null>(null);

  // Dynamic gate queue calculation
  const gateQueueInfo = StorageService.getGateQueueInfo(selectedGate, date);

  useEffect(() => {
    const seq = StorageService.getNextDailySequence(date, plantId);
    setNextSeq(seq);
    setTicketNumber(StorageService.generateTicketNumber(date, seq, plantId));
  }, [date, plantId]);

  const displayStoreInchargeName = (storeInchargeFullName || '').trim();
  const displaySignatureDataUrl =
    storeInchargeSignatureDataUrl || plantSettings.storeInchargeSignatureDataUrl || '';

  const totalQty = items.reduce((acc, row) => acc + extractNumeric(row.qty), 0);
  const totalPallets = items.reduce((acc, row) => acc + extractNumeric(row.pallets), 0);
  const totalLooseRolls = items.reduce((acc, row) => acc + extractNumeric(row.looseRolls), 0);
  const filledRowsCount = items.filter(
    (row) => row.description.trim() || row.qty.trim() || row.pack.trim() || (row.remarks || '').trim()
  ).length;

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
    if (activeDescRow === null) return [];
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
  }, [activeDescRow, items, localMaterials]);

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
          currentRow.pallets = String(Math.floor(numQty / rowRatio));
          currentRow.looseRolls = String(numQty % rowRatio);
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

  const handlePhoneChange = (val: string) => {
    setDriverPhone(val);
    const digits = val.replace(/\D/g, '');
    if (digits.startsWith('05') && digits.length === 10) {
      setDriverPhone('+966' + digits.slice(1));
    } else if (digits.startsWith('5') && digits.length === 9) {
      setDriverPhone('+966' + digits);
    }
  };

  const handlePhoneBlur = () => {
    if (driverPhone.trim()) {
      setDriverPhone(formatSaudiPhoneNumber(driverPhone));
    }
  };

  const applyDriverMasterRecord = (item: DriverMasterRecord) => {
    setTruckNumber(item.truckNumber);
    setDriverName(item.driverName);
    setDriverPhone(formatSaudiPhoneNumber(item.driverPhone));
    setIqamaNumber(item.iqamaNumber || '');
    setTransporterName(item.transporterName || '');
    if (item.defaultDestination) {
      setDestinationPlace(item.defaultDestination);
      if (!loadingTypeManual) {
        const inferred = inferLoadingTypeFromDestination(item.defaultDestination);
        if (inferred) setLoadingType(inferred);
      }
    }
    setMatchedDriver(item);
  };

  const findSuggestions = (raw: string): DriverMasterRecord[] => {
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    return driverMasterList.filter(
      (d) =>
        d.truckNumber.toLowerCase().includes(q) ||
        d.driverName.toLowerCase().includes(q) ||
        (d.iqamaNumber && d.iqamaNumber.toLowerCase().includes(q)) ||
        (d.driverPhone && d.driverPhone.toLowerCase().includes(q))
    );
  };

  const handleTruckInput = (val: string) => {
    setTruckNumber(val);
    const trimmed = val.trim().toUpperCase();
    const exact = driverMasterList.find((d) => d.truckNumber.trim().toUpperCase() === trimmed);
    if (exact) {
      applyDriverMasterRecord(exact);
    }
    if (val.trim().length >= 2) {
      const match = findSuggestions(val);
      setSuggestions(match);
      setActiveSuggestField(match.length > 0 ? 'truck' : null);
    } else {
      setActiveSuggestField(null);
      if (!val.trim()) setMatchedDriver(null);
    }
  };

  const handleDriverNameInput = (val: string) => {
    setDriverName(val);
    const clean = val.trim().toLowerCase();
    const exact = clean
      ? driverMasterList.find((d) => d.driverName.trim().toLowerCase() === clean)
      : undefined;
    if (exact) {
      applyDriverMasterRecord(exact);
      setActiveSuggestField(null);
      return;
    }
    if (clean.length >= 2) {
      const match = findSuggestions(val);
      setSuggestions(match);
      setActiveSuggestField(match.length > 0 ? 'driver' : null);
    } else {
      setActiveSuggestField(null);
      if (!clean) setMatchedDriver(null);
    }
  };

  const handleIqamaInput = (val: string) => {
    setIqamaNumber(val);
    const clean = val.trim().toLowerCase();
    const exact =
      clean.length >= 4
        ? driverMasterList.find((d) => (d.iqamaNumber || '').trim().toLowerCase() === clean)
        : undefined;
    if (exact) {
      applyDriverMasterRecord(exact);
      setActiveSuggestField(null);
      return;
    }
    if (clean.length >= 2) {
      const match = findSuggestions(val);
      setSuggestions(match);
      setActiveSuggestField(match.length > 0 ? 'iqama' : null);
    } else {
      setActiveSuggestField(null);
      if (!clean) setMatchedDriver(null);
    }
  };

  const handleSelectSuggestion = (item: DriverMasterRecord) => {
    applyDriverMasterRecord(item);
    setActiveSuggestField(null);
  };

  const buildSlipData = (cleanDelNote: string, cleanDest: string): LoadingSlipData => ({
    delNoteNumber: cleanDelNote,
    placeName: cleanDest,
    items: items.map((it, idx) => ({
      ...it,
      srNo: idx + 1,
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
    preparedBy: '',
    checkedBy: checkedBy.trim().toUpperCase(),
    storeInchargeUserId: currentUserId,
    storeInchargeName: displayStoreInchargeName,
    storeInchargeSignatureDataUrl: storeInchargeSignatureDataUrl || '',
    createdAt: date || new Date().toISOString().split('T')[0],
  });

  const handleSubmit = async (
    action?: 'save' | 'print' | 'whatsapp' | 'open_slip' | 'print_slip'
  ) => {
    if (submitting) return;
    setFormError(null);
    if (!truckNumber.trim()) {
      setFormError('Please enter Vehicle / Truck Number!');
      return;
    }
    if (!driverName.trim()) {
      setFormError('Please enter Driver Name!');
      return;
    }
    if (!driverPhone.trim()) {
      setFormError('Please enter Driver Mobile Number!');
      return;
    }

    const shouldSaveSlip =
      action === 'print_slip' || includeLoadingSlip || filledRowsCount > 0;

    if (shouldSaveSlip && action !== 'open_slip' && !destinationPlace.trim()) {
      setFormError('Please enter Destination Place / Unloading Point * to save Loading Slip!');
      destinationInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      destinationInputRef.current?.focus();
      return;
    }

    const calculatedGateSeq = gateQueueInfo.myPositionAtGate;
    const formattedPhone = formatSaudiPhoneNumber(driverPhone);
    const cleanDelNote = delNoteNumber.trim().toUpperCase();
    const cleanDest = destinationPlace.trim().toUpperCase();
    const cleanTruck = truckNumber.trim().toUpperCase();
    const cleanDriver = driverName.trim().toUpperCase();
    const cleanIqama = iqamaNumber.trim().toUpperCase();
    const cleanTransporter = transporterName.trim().toUpperCase();
    const cleanGate = selectedGate.trim();
    const cleanRemarks = remarks.trim().toUpperCase();

    setSubmitting(true);
    setPendingAction(action || 'save');
    try {
      let baseTicket = createdTicketDraftRef.current;
      if (!baseTicket) {
        baseTicket = await ApiClient.createTicket({
          plantId,
          ticketNumber: ticketNumber.toUpperCase(),
          sequenceNumber: nextSeq,
          date,
          timeIn: getCurrentTimeString(),
          gateNumber: cleanGate,
          gateSequenceNumber: calculatedGateSeq,
          delNoteNumber: cleanDelNote,
          truckNumber: cleanTruck,
          driverName: cleanDriver,
          driverPhone: formattedPhone,
          iqamaNumber: cleanIqama,
          transporterName: cleanTransporter,
          destinationPlace: cleanDest,
          loadingType,
          status: 'waiting',
          priority,
          remarks: cleanRemarks,
          loadingSlip: {
            delNoteNumber: cleanDelNote,
            placeName: cleanDest,
            preparedBy: '',
            checkedBy: '',
            items: createEmpty8Rows(),
            totalQty: 0,
            totalPallets: 0,
            totalLooseRolls: 0,
            createdAt: date,
          },
        });
        createdTicketDraftRef.current = baseTicket;
      }

      if (shouldSaveSlip && action !== 'open_slip') {
        const nowTime = getCurrentTimeString();
        const nowMs = Date.now();
        const delayMinutes =
          baseTicket.autoLoadingMinutes && baseTicket.autoLoadingMinutes >= 30
            ? baseTicket.autoLoadingMinutes
            : 30;
        const nextStatus = markCompleteOnSave ? 'completed' : 'waiting';
        const builtSlip = buildSlipData(cleanDelNote, cleanDest);

        const response = await ApiClient.updateTicketWithNotification(baseTicket.id, {
          ...baseTicket,
          gateNumber: cleanGate,
          delNoteNumber: cleanDelNote,
          truckNumber: cleanTruck,
          driverName: cleanDriver,
          driverPhone: formattedPhone,
          iqamaNumber: cleanIqama,
          transporterName: cleanTransporter,
          destinationPlace: cleanDest,
          loadingType,
          priority,
          remarks: cleanRemarks,
          loadingSlip: builtSlip,
          status: nextStatus,
          timeLoadingStarted: markCompleteOnSave ? baseTicket.timeLoadingStarted || nowTime : '',
          timeCompleted: markCompleteOnSave ? baseTicket.timeCompleted || nowTime : '',
          manualStatusOverride: markCompleteOnSave ? true : false,
          autoUnderLoadingApplied: false,
          autoLoadingMinutes: delayMinutes,
          autoUnderLoadingAt: nowMs + delayMinutes * 60 * 1000,
        });

        const nextAction =
          action === 'print_slip'
            ? 'print_slip'
            : action === 'print'
            ? 'print'
            : action === 'whatsapp'
            ? 'whatsapp'
            : 'slip_saved';

        createdTicketDraftRef.current = null;
        await onSave(response.ticket, nextAction, {
          autoSavedMaterials: response.autoSavedMaterials,
          whatsappNotification: response.whatsappNotification,
        });
      } else {
        const nextAction =
          action === 'open_slip'
            ? 'open_slip'
            : action === 'print'
            ? 'print'
            : action === 'whatsapp'
            ? 'whatsapp'
            : autoPrintToken
            ? 'print'
            : undefined;
        createdTicketDraftRef.current = null;
        await onSave(baseTicket, nextAction);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Failed to generate ticket. Please try again.');
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const buildLocalPreviewTicket = (): TicketRecord => {
    const now = Date.now();
    const cleanDelNote = delNoteNumber.trim().toUpperCase();
    const cleanDest = destinationPlace.trim().toUpperCase();
    return {
      ...(createdTicketDraftRef.current || {}),
      id: createdTicketDraftRef.current?.id || `local_${now}`,
      plantId,
      ticketNumber: ticketNumber.toUpperCase(),
      sequenceNumber: nextSeq,
      date,
      timeIn: createdTicketDraftRef.current?.timeIn || getCurrentTimeString(),
      gateNumber: selectedGate.trim() || 'Gate 1',
      gateSequenceNumber: gateQueueInfo.myPositionAtGate,
      delNoteNumber: cleanDelNote,
      truckNumber: truckNumber.trim().toUpperCase() || 'TRUCK',
      driverName: driverName.trim().toUpperCase() || 'DRIVER',
      driverPhone: formatSaudiPhoneNumber(driverPhone),
      iqamaNumber: iqamaNumber.trim().toUpperCase(),
      transporterName: transporterName.trim().toUpperCase(),
      destinationPlace: cleanDest,
      loadingType,
      status: markCompleteOnSave ? 'completed' : 'waiting',
      priority,
      remarks: remarks.trim().toUpperCase(),
      loadingSlip: buildSlipData(cleanDelNote, cleanDest),
      createdAt: createdTicketDraftRef.current?.createdAt || now,
      updatedAt: now,
    };
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-5">
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full ${
          includeLoadingSlip ? 'max-w-6xl' : 'max-w-2xl'
        } overflow-hidden my-auto transition-all duration-200 animate-in fade-in zoom-in-95`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <Ticket className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {includeLoadingSlip
                  ? 'Generate New Gate Ticket & Loading Slip'
                  : 'Generate New Gate Ticket'}
              </h2>
              <p className="text-xs text-blue-100">
                {plantSettings.companyName} | Auto Ticket &amp; Sequence | Gate Position &amp; Loading Slip
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded-lg text-blue-100 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Auto Generated Numbers Badge */}
        <div className="bg-blue-50/70 border-b border-blue-100 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="bg-white p-2 rounded-xl border border-blue-200 shadow-sm">
            <span className="text-[10px] font-bold text-neutral-500 block">Ticket Number</span>
            <span className="text-sm font-black text-blue-900">{ticketNumber}</span>
          </div>
          <div className="bg-white p-2 rounded-xl border border-blue-200 shadow-sm">
            <span className="text-[10px] font-bold text-neutral-500 block">Daily Overall Seq</span>
            <span className="text-sm font-black text-indigo-700">#{nextSeq}</span>
          </div>
          <div className="bg-white p-2 rounded-xl border border-blue-200 shadow-sm">
            <span className="text-[10px] font-bold text-neutral-500 block">Selected Gate</span>
            <span className="text-sm font-black text-emerald-800">{selectedGate}</span>
          </div>
          <div className="bg-white p-2 rounded-xl border border-blue-200 shadow-sm">
            <span className="text-[10px] font-bold text-neutral-500 block">Position at Gate</span>
            <span className="text-sm font-black text-purple-800">#{gateQueueInfo.myPositionAtGate}</span>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Delivery Note Number (Del Note No.) - Optional */}
          <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-200">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-neutral-800 tracking-wide flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>Delivery Note Number (Del Note No.)</span>
              </label>
              <span className="text-[10px] font-bold text-neutral-600 bg-neutral-200/70 px-2 py-0.5 rounded border border-neutral-300">
                Optional
              </span>
            </div>
            <input
              ref={delNoteInputRef}
              type="text"
              value={delNoteNumber}
              onChange={(e) => {
                setDelNoteNumber(e.target.value.toUpperCase());
                if (formError) setFormError(null);
              }}
              placeholder="e.g. A1DD00001 (Optional)"
              className="w-full px-3 py-2 text-sm font-black uppercase tracking-wider rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-xs font-mono text-neutral-900"
            />
          </div>

          {/* Truck Number with Autocomplete */}
          <div className="relative">
            <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
              Vehicle / Truck Number *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                <Truck className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={truckNumber}
                onChange={(e) => handleTruckInput(e.target.value)}
                onFocus={() => {
                  if (truckNumber.trim().length >= 1) {
                    const m = findSuggestions(truckNumber);
                    setSuggestions(m);
                    setActiveSuggestField(m.length > 0 ? 'truck' : null);
                  }
                }}
                placeholder="e.g. 5275 AXG"
                className="w-full pl-9 pr-3 py-2 text-sm font-black uppercase tracking-wider rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-sm font-mono"
              />
            </div>

            {activeSuggestField === 'truck' && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto divide-y divide-neutral-100">
                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 bg-neutral-50 tracking-wide flex items-center justify-between">
                  <span>Saved Master Directory (Click to Auto-fill)</span>
                  <button type="button" onClick={() => setActiveSuggestField(null)} className="text-neutral-500 hover:text-neutral-800">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(item)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50/80 transition flex items-center justify-between text-xs cursor-pointer"
                  >
                    <div>
                      <span className="font-extrabold text-blue-900 font-mono">{item.truckNumber}</span>
                      <span className="ml-2 font-medium text-neutral-700">{item.driverName}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      <span>{item.driverPhone}</span>
                      {item.iqamaNumber && <span className="ml-1.5 text-neutral-600">| Iqama: {item.iqamaNumber}</span>}
                      <span> | {item.transporterName || 'Self'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Driver Name, Phone & Iqama */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Driver Name *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => handleDriverNameInput(e.target.value)}
                  onFocus={() => {
                    if (driverName.trim().length >= 2) {
                      const m = findSuggestions(driverName);
                      setSuggestions(m);
                      setActiveSuggestField(m.length > 0 ? 'driver' : null);
                    }
                  }}
                  placeholder="Type driver name to auto-fill"
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              </div>
              {activeSuggestField === 'driver' && suggestions.length > 0 && (
                <div className="absolute top-full left-0 sm:w-80 right-0 mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto divide-y divide-neutral-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 bg-neutral-50 tracking-wide flex items-center justify-between">
                    <span>Matched Drivers</span>
                    <button type="button" onClick={() => setActiveSuggestField(null)} className="text-neutral-500 hover:text-neutral-800">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectSuggestion(item)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50/80 transition text-xs cursor-pointer"
                    >
                      <div className="font-bold text-blue-900">{item.driverName}</div>
                      <div className="text-[11px] text-neutral-600 font-mono">
                        {item.truckNumber} · {item.driverPhone}
                        {item.iqamaNumber ? ` · Iqama: ${item.iqamaNumber}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Driver Mobile / WhatsApp *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Phone className="w-4 h-4 text-emerald-600" />
                </div>
                <input
                  type="text"
                  value={driverPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  placeholder="e.g. 0550000000"
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>

            <div className="relative">
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                ID / Iqama Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Hash className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={iqamaNumber}
                  onChange={(e) => handleIqamaInput(e.target.value)}
                  onFocus={() => {
                    if (iqamaNumber.trim().length >= 2) {
                      const m = findSuggestions(iqamaNumber);
                      setSuggestions(m);
                      setActiveSuggestField(m.length > 0 ? 'iqama' : null);
                    }
                  }}
                  placeholder="Type Iqama No. to auto-fill"
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>
              {activeSuggestField === 'iqama' && suggestions.length > 0 && (
                <div className="absolute top-full right-0 sm:w-80 left-0 sm:left-auto mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto divide-y divide-neutral-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 bg-neutral-50 tracking-wide flex items-center justify-between">
                    <span>Matched by Iqama</span>
                    <button type="button" onClick={() => setActiveSuggestField(null)} className="text-neutral-500 hover:text-neutral-800">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectSuggestion(item)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50/80 transition text-xs cursor-pointer"
                    >
                      <div className="font-bold text-blue-900 font-mono">
                        Iqama: {item.iqamaNumber || '—'} · {item.truckNumber}
                      </div>
                      <div className="text-[11px] text-neutral-600">
                        {item.driverName} · {item.driverPhone}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {matchedDriver && (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-extrabold text-emerald-800 text-[10px] tracking-wider bg-emerald-100 px-2 py-0.5 rounded">
                  Driver Details Matched
                </span>
                <span className="font-bold">{matchedDriver.driverName}</span>
                <span className="font-mono font-bold text-blue-900">{matchedDriver.truckNumber}</span>
                <span className="font-mono">{matchedDriver.driverPhone}</span>
                {matchedDriver.iqamaNumber && <span className="font-mono">Iqama: {matchedDriver.iqamaNumber}</span>}
                {matchedDriver.transporterName && <span>· {matchedDriver.transporterName}</span>}
                {matchedDriver.defaultDestination && <span>· {matchedDriver.defaultDestination}</span>}
              </div>
              <button
                type="button"
                onClick={() => setMatchedDriver(null)}
                className="text-emerald-700 hover:text-emerald-950 text-[11px] font-bold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Place Name, Loading Type (Local / Export / STO), and Transporter Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Destination Place / Unloading Point {includeLoadingSlip ? '*' : ''}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <MapPin className="w-4 h-4" />
                </div>
                <input
                  ref={destinationInputRef}
                  type="text"
                  value={destinationPlace}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDestinationPlace(val);
                    if (formError) setFormError(null);
                    if (!loadingTypeManual) {
                      const inferred = inferLoadingTypeFromDestination(val);
                      if (inferred) setLoadingType(inferred);
                    }
                  }}
                  placeholder="e.g. Riyadh / Kuwait / Export"
                  className={`w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white ${
                    includeLoadingSlip && formError && !destinationPlace.trim()
                      ? 'border-red-500 ring-2 ring-red-200'
                      : 'border-neutral-300'
                  }`}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Truck Loading Type *
              </label>
              <div className="grid grid-cols-3 gap-1.5 bg-neutral-100 p-1 rounded-xl border border-neutral-300">
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('local');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'local'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Local</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('export');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'export'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>Export</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('sto');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'sto'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span>STO</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Transporter / Company Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  placeholder="e.g. Al-Majd Freight Lines"
                  className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              </div>
            </div>
          </div>

          {/* Gate Selection with Live Queue Status */}
          <div>
            <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1.5">
              Assign Loading Gate:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {plantSettings.gates.map((gate) => {
                const info = StorageService.getGateQueueInfo(gate, date);
                const isSelected = selectedGate === gate;
                return (
                  <button
                    key={gate}
                    type="button"
                    onClick={() => setSelectedGate(gate)}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-blue-700 bg-blue-50/90 ring-2 ring-blue-500/20 shadow-sm'
                        : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-extrabold text-xs text-neutral-900">{gate}</span>
                      <DoorOpen className={`w-4 h-4 ${isSelected ? 'text-blue-700' : 'text-neutral-400'}`} />
                    </div>
                    <div className="text-[10px] space-y-0.5">
                      {info.currentLoading ? (
                        <p className="text-amber-800 font-semibold truncate">
                          ⏳ 1 Truck Loading
                        </p>
                      ) : (
                        <p className="text-emerald-700 font-semibold">🟢 Available</p>
                      )}
                      <p className="text-neutral-500">
                        {info.waitingQueue.length} in queue | Your Pos: #{info.myPositionAtGate}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority & Remarks */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Loading Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'normal' | 'urgent')}
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              >
                <option value="normal">Normal Loading</option>
                <option value="urgent">Urgent / Express Loading</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-neutral-700 tracking-wide block mb-1">
                Special Remarks / Notes
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Tarpaulin required, Box material, Seal inspection"
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>
          </div>

          {/* Inline Create Loading Slip Toggle & 8-Row Form */}
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setIncludeLoadingSlip((prev) => !prev)}
              className="w-full px-4 py-3 flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-50 via-blue-50 to-indigo-50 hover:from-indigo-100/80 hover:to-blue-100/80 transition cursor-pointer text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0 shadow-xs">
                  <ClipboardList className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-black text-indigo-950">
                      Create Material Loading Slip Here (8 Rows)
                    </span>
                    {filledRowsCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-extrabold">
                        {filledRowsCount} Row(s) · {totalQty} Qty · {totalPallets}P / {totalLooseRolls}L
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-indigo-800/90 font-medium">
                    {includeLoadingSlip
                      ? 'Fill materials below and use "Save Ticket & Slip" or "Save & Print Slip (A4)".'
                      : 'Click to add materials right now, or use "Save & Loading Slip" button below.'}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-indigo-300 text-indigo-800 text-xs font-extrabold shrink-0 shadow-2xs">
                <span>{includeLoadingSlip ? 'Hide Slip' : 'Create Slip Now'}</span>
                {includeLoadingSlip ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </span>
            </button>

            {includeLoadingSlip && (
              <div className="p-3 sm:p-4 space-y-3 bg-white border-t border-indigo-200">
                {/* Quick Helper Banner */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs bg-gradient-to-r from-amber-50 via-blue-50 to-emerald-50 border border-amber-300/80 rounded-xl p-2.5 text-neutral-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-amber-300 shadow-2xs">
                      <span className="font-bold text-amber-950 text-xs">⚡ 1 Pallet =</span>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={rollsPerPallet}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 23);
                          setRollsPerPallet(val);
                        }}
                        className="w-12 px-1 py-0.5 text-center font-black text-amber-950 bg-amber-50 border border-amber-400 rounded focus:ring-1 focus:ring-amber-500 focus:outline-none"
                      />
                      <span className="text-neutral-700 font-medium">Rolls</span>
                      <button
                        type="button"
                        onClick={() => handleApplyGlobalRatioToAll(rollsPerPallet)}
                        className="ml-1 px-2 py-0.5 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition cursor-pointer"
                      >
                        Apply All
                      </button>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-100/80 text-blue-900 border border-blue-200 font-bold text-[11px]">
                      <Layers className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                      <span>Material Master ({localMaterials.length})</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRecalculateAllRows}
                    className="px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    🔄 Recalculate Rows
                  </button>
                </div>

                {/* 8-Row Loading Slip Table */}
                <div className="border border-neutral-300 rounded-xl overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-neutral-800 text-white text-[10.5px] uppercase tracking-wider">
                          <th className="py-2 px-2 text-center w-8">#</th>
                          <th className="py-2 px-2.5 min-w-[200px]">Material Description *</th>
                          <th className="py-2 px-2 w-28">Pack Type</th>
                          <th className="py-2 px-2 w-32 text-center bg-amber-900/95 text-amber-300 border-x border-amber-800 font-bold">
                            1 Pallet =
                          </th>
                          <th className="py-2 px-2 w-24 text-center bg-neutral-900 text-amber-300 font-bold">
                            Quantity
                          </th>
                          <th className="py-2 px-2 w-24 text-center bg-blue-900/90 text-emerald-300 font-bold">
                            Pallets (Auto)
                          </th>
                          <th className="py-2 px-2 w-24 text-center bg-indigo-900/90 text-cyan-300 font-bold">
                            Loose Rolls
                          </th>
                          <th className="py-2 px-2 min-w-[110px]">Remarks</th>
                          <th className="py-2 px-1 w-8 text-center">Clr</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {items.map((row, index) => {
                          const cleanDesc = (row.description || '').trim().toUpperCase();
                          const isMatchedInMaster = Boolean(cleanDesc && materialExactMap.has(cleanDesc));
                          const isNewManual = Boolean(cleanDesc && !isMatchedInMaster);
                          return (
                            <tr key={index} className={index % 2 === 1 ? 'bg-neutral-50/70' : 'bg-white'}>
                              <td className="py-1.5 px-2 text-center font-bold text-neutral-600 bg-neutral-100/60">
                                {index + 1}
                              </td>
                              <td className="py-1 px-1.5">
                                <div className="relative flex items-center gap-1">
                                  <input
                                    ref={(el) => {
                                      descInputRefs.current[index] = el;
                                    }}
                                    type="text"
                                    value={row.description}
                                    autoComplete="off"
                                    onFocus={() => {
                                      setActiveDescRow(index);
                                      updateDropdownPosition(index);
                                    }}
                                    onBlur={() => {
                                      window.setTimeout(() => {
                                        setActiveDescRow((curr) => (curr === index ? null : curr));
                                      }, 140);
                                    }}
                                    onChange={(e) => {
                                      handleRowChange(index, 'description', e.target.value);
                                      setActiveDescRow(index);
                                      updateDropdownPosition(index);
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
                                      } else if (e.key === 'Tab' || e.key === 'Escape') {
                                        setActiveDescRow(null);
                                      }
                                    }}
                                    placeholder={`Material #${index + 1}`}
                                    className={`w-full px-2 py-1 text-xs font-semibold rounded border bg-white focus:outline-none focus:ring-1 ${
                                      isMatchedInMaster
                                        ? 'border-emerald-400 focus:border-emerald-600 focus:ring-emerald-500'
                                        : isNewManual
                                        ? 'border-amber-400 focus:border-amber-600 focus:ring-amber-500'
                                        : 'border-neutral-200 focus:border-blue-500 focus:ring-blue-500'
                                    }`}
                                  />
                                  {isMatchedInMaster && (
                                    <span
                                      title="Matched in Material Master"
                                      className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-extrabold"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      <span>MM</span>
                                    </span>
                                  )}
                                  {isNewManual && (
                                    <span
                                      title="New material — auto-saves on save"
                                      className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-extrabold"
                                    >
                                      <Sparkles className="w-2.5 h-2.5" />
                                      <span>NEW</span>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1 px-1.5">
                                <div className="space-y-1">
                                  <select
                                    value={
                                      PACK_DROPDOWN_OPTIONS.includes(row.pack)
                                        ? row.pack
                                        : row.pack
                                        ? '__CUSTOM__'
                                        : ''
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === '__CUSTOM__') {
                                        handleRowChange(index, 'pack', '');
                                      } else {
                                        handleRowChange(index, 'pack', val);
                                      }
                                    }}
                                    className="w-full px-1.5 py-1 text-xs font-bold rounded-lg border border-neutral-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                                  >
                                    <option value="">-- Pack --</option>
                                    {PACK_DROPDOWN_OPTIONS.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                    <option value="__CUSTOM__">Other</option>
                                  </select>
                                  {!PACK_DROPDOWN_OPTIONS.includes(row.pack) && row.pack !== '' && (
                                    <input
                                      type="text"
                                      value={row.pack}
                                      onChange={(e) => handleRowChange(index, 'pack', e.target.value)}
                                      placeholder="Custom pack"
                                      className="w-full px-1.5 py-0.5 text-[10.5px] rounded border border-blue-400 focus:outline-none bg-blue-50/60"
                                    />
                                  )}
                                </div>
                              </td>
                              <td className="py-1 px-1 text-center bg-amber-50/50 border-x border-amber-200/60">
                                <div className="flex items-center justify-center gap-1 bg-white border border-amber-300 rounded-lg px-1 py-0.5">
                                  <span className="text-[10px] font-bold text-amber-900">1P=</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="10000"
                                    value={row.palletRatio ?? '23'}
                                    onChange={(e) => handleRowChange(index, 'palletRatio', e.target.value)}
                                    className="w-11 px-1 py-0.5 text-xs text-center font-black text-amber-950 bg-amber-50/70 rounded border border-amber-400 focus:outline-none"
                                  />
                                </div>
                              </td>
                              <td className="py-1 px-1.5 text-center">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.qty}
                                  onChange={(e) => handleRowChange(index, 'qty', e.target.value)}
                                  placeholder="Qty"
                                  className="w-full px-1.5 py-1 text-xs text-center font-bold rounded-lg border border-neutral-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                                />
                              </td>
                              <td className="py-1 px-1.5 text-center bg-blue-50/40">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.pallets}
                                  onChange={(e) => handleRowChange(index, 'pallets', e.target.value)}
                                  placeholder="0"
                                  className="w-full px-1.5 py-1 text-xs text-center font-black text-blue-900 rounded-lg border border-blue-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
                                />
                              </td>
                              <td className="py-1 px-1.5 text-center bg-indigo-50/40">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.looseRolls}
                                  onChange={(e) => handleRowChange(index, 'looseRolls', e.target.value)}
                                  placeholder="0"
                                  className="w-full px-1.5 py-1 text-xs text-center font-black text-indigo-900 rounded-lg border border-indigo-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                                />
                              </td>
                              <td className="py-1 px-1.5">
                                <input
                                  type="text"
                                  value={row.remarks || ''}
                                  onChange={(e) => handleRowChange(index, 'remarks', e.target.value)}
                                  placeholder="Batch"
                                  className="w-full px-1.5 py-1 text-xs rounded border border-neutral-200 focus:border-blue-500 focus:outline-none bg-white"
                                />
                              </td>
                              <td className="py-1 px-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleClearRow(index)}
                                  className="p-1 text-neutral-400 hover:text-red-600 rounded transition cursor-pointer"
                                  title="Clear row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-neutral-800 text-white font-extrabold text-xs">
                          <td colSpan={4} className="py-2 px-3 text-right tracking-wider uppercase">
                            TOTALS :
                          </td>
                          <td className="py-2 px-2 text-center font-black text-amber-300">
                            {totalQty}
                          </td>
                          <td className="py-2 px-2 text-center font-black text-emerald-300 bg-blue-950">
                            {totalPallets} Pallets
                          </td>
                          <td className="py-2 px-2 text-center font-black text-cyan-300 bg-indigo-950">
                            {totalLooseRolls} Loose
                          </td>
                          <td colSpan={2} className="py-2 px-2 text-[10.5px] text-neutral-300 font-medium">
                            8 Rows (A4 2-Copy Ready)
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* New Material Auto-Save & Duplicate Line Notices */}
                {(newManualMaterials.length > 0 || duplicateSlipMaterials.length > 0) && (
                  <div className="space-y-1.5">
                    {newManualMaterials.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950">
                        <Sparkles className="w-4 h-4 text-blue-700 shrink-0" />
                        <span>
                          <strong>Auto-Save to Material Master:</strong>{' '}
                          <strong>{newManualMaterials.join(', ')}</strong> will be saved automatically with Pack Type &amp; Pallet Ratio.
                        </span>
                      </div>
                    )}
                    {duplicateSlipMaterials.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>
                          <strong>Note:</strong> <strong>{duplicateSlipMaterials.join(', ')}</strong> appears on multiple rows (saved once in Material Master).
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Forklift Operator & Store Incharge Signature */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
                  <div>
                    <label className="text-xs font-semibold text-neutral-700 block mb-1">
                      Forklift Operator / Loaded By
                    </label>
                    <input
                      type="text"
                      value={checkedBy}
                      onChange={(e) => setCheckedBy(e.target.value)}
                      placeholder="Leave blank or enter operator name"
                      className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-neutral-700 block mb-1">
                      Store Incharge Signature
                    </span>
                    <div className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 bg-white flex items-center justify-between gap-2 min-h-[40px]">
                      {displaySignatureDataUrl ? (
                        <img
                          src={displaySignatureDataUrl}
                          alt="Store Incharge Digital Signature"
                          className="max-h-7 max-w-[120px] object-contain"
                        />
                      ) : (
                        <span className="text-[10.5px] text-neutral-400 italic">No signature assigned</span>
                      )}
                      <span className="text-xs font-bold text-neutral-900 truncate">
                        {displayStoreInchargeName || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Queue & Optional Completed Checkbox */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                    <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Saving generates the unique Driver Live Queue QR link, triggers auto WhatsApp queue alert (if enabled), and opens the 2-Copy A4 print view when using <strong>Save &amp; Print Slip (A4)</strong>.
                    </span>
                  </div>
                  <label className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={markCompleteOnSave}
                      onChange={(e) => setMarkCompleteOnSave(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-500"
                    />
                    <span className="text-xs text-neutral-800">
                      <span className="font-bold text-emerald-800">Mark Loading Completed (Optional):</span> Set vehicle status to &apos;Completed&apos; immediately on save.
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Auto-Print Token Option (shown when inline slip form is collapsed) */}
          {!includeLoadingSlip && (
            <div className="flex items-center justify-between p-3 bg-blue-50/80 border border-blue-200 rounded-xl">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-blue-950">
                <input
                  type="checkbox"
                  checked={autoPrintToken}
                  onChange={(e) => setAutoPrintToken(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-blue-300 focus:ring-blue-500 cursor-pointer"
                />
                <span>Auto-Print Token After Save (Immediately triggers ticket print view upon registration)</span>
              </label>
              <Printer className="w-4 h-4 text-blue-700 shrink-0" />
            </div>
          )}

          {/* Quick Info Box */}
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p>
              Vehicle, driver, and phone details are automatically saved to your master database for future autocomplete.
            </p>
          </div>

          {formError && (
            <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs font-semibold text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="break-all">{formError}</span>
              </div>
              {truckNumber.trim() && driverName.trim() && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLocalPrintMode('ticket')}
                    className="app-btn-sm bg-neutral-800 hover:bg-neutral-900 text-white"
                  >
                    <Printer className="w-3.5 h-3.5 shrink-0" />
                    <span>Print Ticket Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocalPrintMode('slip')}
                    className="app-btn-sm bg-indigo-700 hover:bg-indigo-600 text-white"
                  >
                    <Printer className="w-3.5 h-3.5 shrink-0" />
                    <span>Print Slip Copy</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="app-btn w-full lg:w-auto lg:min-w-[100px] text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 disabled:opacity-50"
            >
              Cancel
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 w-full lg:w-auto">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit('whatsapp')}
                className="app-btn w-full bg-emerald-600 hover:bg-emerald-500 text-white shadow disabled:opacity-60"
              >
                {submitting && pendingAction === 'whatsapp' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <MessageSquare className="w-4 h-4 shrink-0" />
                )}
                <span>{submitting && pendingAction === 'whatsapp' ? 'Saving...' : 'Save & WhatsApp'}</span>
              </button>

              {!includeLoadingSlip ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit('open_slip')}
                  title="Save gate ticket and open full Loading Slip modal"
                  className="app-btn w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow disabled:opacity-60"
                >
                  {submitting && pendingAction === 'open_slip' ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  ) : (
                    <ClipboardList className="w-4 h-4 shrink-0" />
                  )}
                  <span>{submitting && pendingAction === 'open_slip' ? 'Saving...' : 'Create Loading Slip'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit('print_slip')}
                  title="Save Gate Ticket + Loading Slip and print 2-Copy A4 Loading Slip"
                  className="app-btn w-full bg-indigo-700 hover:bg-indigo-600 text-white shadow disabled:opacity-60"
                >
                  {submitting && pendingAction === 'print_slip' ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {submitting && pendingAction === 'print_slip'
                      ? 'Saving & Printing...'
                      : 'Save & Print Slip (A4)'}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit('print')}
                title="Save gate ticket and print Gate Token immediately"
                className="app-btn w-full bg-neutral-800 hover:bg-neutral-900 text-white shadow disabled:opacity-60"
              >
                {submitting && pendingAction === 'print' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {submitting && pendingAction === 'print' ? 'Saving & Printing...' : 'Save & Print Ticket'}
                </span>
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit('save')}
                className="app-btn w-full bg-blue-700 hover:bg-blue-600 text-white shadow-lg shadow-blue-700/30 disabled:opacity-60"
              >
                {submitting && pendingAction === 'save' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {submitting && pendingAction === 'save'
                    ? 'Saving...'
                    : includeLoadingSlip || filledRowsCount > 0
                    ? 'Save Ticket & Slip'
                    : 'Generate Ticket'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Material Master Suggestions Dropdown */}
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

      {localPrintMode === 'ticket' && (
        <TicketPrintView
          ticket={buildLocalPreviewTicket()}
          settings={settings}
          autoPrint={true}
          onClose={() => setLocalPrintMode(null)}
        />
      )}

      {localPrintMode === 'slip' && (
        <LoadingSlipPrintView
          ticket={buildLocalPreviewTicket()}
          settings={settings}
          currentUserId={currentUserId}
          storeInchargeFullName={displayStoreInchargeName}
          storeInchargeSignatureDataUrl={displaySignatureDataUrl}
          autoPrint={true}
          onClose={() => setLocalPrintMode(null)}
        />
      )}
    </div>
  );
};
