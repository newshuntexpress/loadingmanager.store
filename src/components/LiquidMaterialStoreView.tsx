import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AuthUser,
  LiquidMaterial,
  LiquidStoreState,
  LiquidTankComputed,
  LiquidTransaction,
} from '../types';
import { ApiClient, withBackgroundPoll } from '../services/api';
import { LiquidTankSvg } from './LiquidTankSvg';
import { LiquidPrintPreviewModal, LiquidPrintTarget } from './LiquidPrintPreviewModal';
import {
  generateLiquidAuditPDF,
  generateLiquidRegisterPDF,
  generateLiquidSingleTankPDF,
  generateLiquidStockReportPDF,
  generateLiquidTanksPDF,
} from '../utils/liquidPdf';
import {
  Droplets,
  Plus,
  Minus,
  LayoutDashboard,
  Database,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  FileBarChart2,
  Settings,
  RefreshCw,
  Sun,
  Moon,
  Printer,
  Download,
  Edit2,
  Trash2,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface LiquidMaterialStoreViewProps {
  currentUser: AuthUser;
  plantId?: string;
  companyLogoUrl?: string;
  canManageStore?: boolean;
  canManageMaterials?: boolean;
}

type LiquidSubTab = 'dashboard' | 'tanks' | 'inward' | 'outward' | 'history' | 'reports' | 'settings';

function nowLocalInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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
  if (!val) return 'No transactions yet';
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

function computeClientPreviewTank(
  tank: LiquidTankComputed,
  txList: LiquidTransaction[]
): { currentStockKg: number; currentStockMt: number; filledPercentage: number; materialBalances: Record<string, number> } {
  const txs = txList.filter((t) => t.tankId === tank.id);
  let inward = 0;
  let outward = 0;
  const matBalances: Record<string, number> = {};
  for (const tx of txs) {
    if (!(tx.materialName in matBalances)) matBalances[tx.materialName] = 0;
    if (tx.type === 'INWARD') {
      inward += tx.quantityKg;
      matBalances[tx.materialName] += tx.quantityKg;
    } else {
      outward += tx.quantityKg;
      matBalances[tx.materialName] -= tx.quantityKg;
    }
  }
  const currentKg = inward - outward;
  const filledPct = tank.totalCapacityKg > 0 ? Math.min(100, Math.max(0, (currentKg / tank.totalCapacityKg) * 100)) : 0;
  return {
    currentStockKg: currentKg,
    currentStockMt: currentKg / 1000,
    filledPercentage: filledPct,
    materialBalances: matBalances,
  };
}

export const LiquidMaterialStoreView: React.FC<LiquidMaterialStoreViewProps> = ({
  currentUser,
  plantId = 'RIYADH',
  companyLogoUrl,
  canManageStore = true,
  canManageMaterials = true,
}) => {
  const [store, setStore] = useState<LiquidStoreState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [subTab, setSubTab] = useState<LiquidSubTab>('dashboard');
  const [dashMaterialFilter, setDashMaterialFilter] = useState<string>('ALL');
  const [dashViewMode, setDashViewMode] = useState<'by-material' | 'all-tanks'>('by-material');
  const [historySubTab, setHistorySubTab] = useState<'ledger' | 'audit'>('ledger');

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Register filters
  const [regSearch, setRegSearch] = useState('');
  const [regType, setRegType] = useState<'ALL' | 'INWARD' | 'OUTWARD'>('ALL');
  const [regTankId, setRegTankId] = useState('ALL');
  const [regMaterial, setRegMaterial] = useState('ALL');
  const [regStart, setRegStart] = useState('');
  const [regEnd, setRegEnd] = useState('');

  // Report filters
  const [repTankId, setRepTankId] = useState('ALL');
  const [repMaterial, setRepMaterial] = useState('ALL');
  const [repStart, setRepStart] = useState('');
  const [repEnd, setRepEnd] = useState('');

  // Transaction modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txEditId, setTxEditId] = useState<number | null>(null);
  const [txType, setTxType] = useState<'INWARD' | 'OUTWARD'>('INWARD');
  const [txDate, setTxDate] = useState(nowLocalInput());
  const [txTankId, setTxTankId] = useState<number>(1);
  const [txMaterial, setTxMaterial] = useState<string>('');
  const [txQtyKg, setTxQtyKg] = useState<string>('');
  const [txRef, setTxRef] = useState<string>('');
  const [txDocumentNumber, setTxDocumentNumber] = useState<string>('');
  const [txParty, setTxParty] = useState<string>('');
  const [txVehicle, setTxVehicle] = useState<string>('');
  const [txDriverName, setTxDriverName] = useState<string>('');
  const [txRemarks, setTxRemarks] = useState<string>('');
  const [txConfirmStep, setTxConfirmStep] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // Tank modal state
  const [tankModalOpen, setTankModalOpen] = useState(false);
  const [tankEditId, setTankEditId] = useState<number | null>(null);
  const [tankName, setTankName] = useState('');
  const [tankCapKg, setTankCapKg] = useState('2000000');
  const [tankDepthM, setTankDepthM] = useState('7');
  const [tankLocation, setTankLocation] = useState('Main Storage Bay A');
  const [tankNotes, setTankNotes] = useState('');
  const [tankError, setTankError] = useState<string | null>(null);

  // Tank Detail modal
  const [detailTankId, setDetailTankId] = useState<number | null>(null);

  // View / Print / PDF Preview modal
  const [printPreview, setPrintPreview] = useState<{ target: LiquidPrintTarget; autoPrint?: boolean } | null>(null);

  // Settings & Material CRUD state
  const [facilityInput, setFacilityInput] = useState('');
  const [newMatName, setNewMatName] = useState('');
  const [newMatCode, setNewMatCode] = useState('');
  const [newMatDesc, setNewMatDesc] = useState('');
  const [editingMatId, setEditingMatId] = useState<number | null>(null);
  const [editMatName, setEditMatName] = useState('');
  const [editMatCode, setEditMatCode] = useState('');
  const [editMatDesc, setEditMatDesc] = useState('');

  // Inline confirm dialog state (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadState = useCallback(async (isBackgroundPoll?: unknown) => {
    try {
      const data =
        isBackgroundPoll === true
          ? await withBackgroundPoll(() => ApiClient.getLiquidState(plantId))
          : await ApiClient.getLiquidState(plantId);
      setStore(data);
      setFacilityInput(data.settings.facilityName);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to load Liquid Material Camp Store data.');
    } finally {
      setLoading(false);
    }
  }, [plantId, showToast]);

  useEffect(() => {
    loadState(false);
    const timer = setInterval(() => {
      loadState(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [loadState]);

  const isDark = store?.settings.theme === 'dark';

  // Semantic scoped 3D surface classes
  const shellBg = isDark
    ? 'bg-slate-950 text-slate-100 border-slate-800 shadow-[0_14px_34px_-10px_rgba(2,6,23,0.7)]'
    : 'bg-gradient-to-b from-[#F9FBFE] to-[#EEF3FA] text-[#1C2833] border-[#C5D3E2] shadow-[0_6px_0_#C5D3E2,0_18px_36px_-10px_rgba(24,42,64,0.16)]';
  const cardCls = isDark
    ? 'bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700/80 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_0_#0F172A,0_12px_24px_-6px_rgba(0,0,0,0.45)]'
    : 'surface-3d text-[#1C2833]';
  const altBoxCls = isDark
    ? 'bg-slate-800/75 border-slate-700 text-slate-100 shadow-[inset_0_2px_5px_rgba(0,0,0,0.35)]'
    : 'bg-[#EFF4F9] border-[#C8D6E5] text-[#1C2833] inset-3d';
  const mutedCls = isDark ? 'text-slate-400' : 'text-[#5B738B]';
  const inputCls = isDark
    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:ring-[#0A6ED1]'
    : 'bg-white border-[#BCC8D4] text-[#1C2833] placeholder:text-[#7A8FA3] focus:ring-[#0A6ED1]';
  const thCls = isDark ? 'bg-slate-800/80 text-slate-300 border-slate-700' : 'bg-[#EFF4F9] text-[#354A5F] border-[#D1DBE5]';
  const tdBorderCls = isDark ? 'border-slate-800' : 'border-[#E3EAF2]';

  const todayPrefix = useMemo(() => nowLocalInput().slice(0, 10), []);

  const matStats = useMemo(() => {
    if (!store) return [];
    const names = Array.from(
      new Set([...store.materials.map((m) => m.name), ...store.transactions.map((t) => t.materialName)])
    );
    return names.map((name) => {
      let inKg = 0;
      let outKg = 0;
      let todayIn = 0;
      let todayOut = 0;
      for (const tx of store.transactions) {
        if (tx.materialName !== name) continue;
        const isToday = tx.txDate.slice(0, 10) === todayPrefix;
        if (tx.type === 'INWARD') {
          inKg += tx.quantityKg;
          if (isToday) todayIn += tx.quantityKg;
        } else {
          outKg += tx.quantityKg;
          if (isToday) todayOut += tx.quantityKg;
        }
      }
      const activeTanks = store.tanks.filter((t) =>
        t.materials.some((m) => m.materialName === name && m.balanceKg > 0.0001)
      );
      const allocCap = activeTanks.reduce((a, t) => a + t.totalCapacityKg, 0);
      const bal = inKg - outKg;
      return {
        name,
        inKg,
        outKg,
        todayIn,
        todayOut,
        bal,
        allocCap,
        emptyCap: Math.max(0, allocCap - bal),
        tanks: activeTanks,
      };
    });
  }, [store, todayPrefix]);

  const emptyTanks = useMemo(() => {
    if (!store) return [];
    return store.tanks.filter((t) => t.currentStockKg <= 0.0001);
  }, [store]);

  const kpi = useMemo(() => {
    if (!store) {
      return { cap: 0, stock: 0, empty: 0, inToday: 0, outToday: 0, count: 0 };
    }
    if (dashMaterialFilter === 'EMPTY') {
      const cap = emptyTanks.reduce((a, t) => a + t.totalCapacityKg, 0);
      return { cap, stock: 0, empty: cap, inToday: 0, outToday: 0, count: emptyTanks.length };
    }
    if (dashMaterialFilter !== 'ALL') {
      const s = matStats.find((m) => m.name === dashMaterialFilter);
      if (s) {
        return {
          cap: s.allocCap,
          stock: s.bal,
          empty: s.emptyCap,
          inToday: s.todayIn,
          outToday: s.todayOut,
          count: s.tanks.length,
        };
      }
    }
    return {
      cap: store.tanks.reduce((a, t) => a + t.totalCapacityKg, 0),
      stock: store.tanks.reduce((a, t) => a + t.currentStockKg, 0),
      empty: store.tanks.reduce((a, t) => a + t.emptyCapacityKg, 0),
      inToday: store.transactions
        .filter((t) => t.type === 'INWARD' && t.txDate.slice(0, 10) === todayPrefix)
        .reduce((a, t) => a + t.quantityKg, 0),
      outToday: store.transactions
        .filter((t) => t.type === 'OUTWARD' && t.txDate.slice(0, 10) === todayPrefix)
        .reduce((a, t) => a + t.quantityKg, 0),
      count: store.tanks.length,
    };
  }, [store, dashMaterialFilter, emptyTanks, matStats, todayPrefix]);

  const recentDashTxs = useMemo(() => {
    if (!store) return [];
    return store.transactions
      .filter((tx) =>
        dashMaterialFilter === 'ALL'
          ? true
          : dashMaterialFilter === 'EMPTY'
          ? false
          : tx.materialName === dashMaterialFilter
      )
      .slice()
      .sort((a, b) => b.txDate.localeCompare(a.txDate) || b.id - a.id)
      .slice(0, 10);
  }, [store, dashMaterialFilter]);

  const openTxModal = (type: 'INWARD' | 'OUTWARD', tankId?: number, editTx?: LiquidTransaction) => {
    if (!store || store.tanks.length === 0) {
      showToast('error', 'Please create a tank first.');
      return;
    }
    setTxError(null);
    setTxConfirmStep(false);

    if (editTx) {
      setTxEditId(editTx.id);
      setTxType(editTx.type);
      setTxDate(editTx.txDate.slice(0, 16));
      setTxTankId(editTx.tankId);
      setTxMaterial(editTx.materialName);
      setTxQtyKg(String(editTx.quantityKg));
      setTxRef(editTx.referenceNumber);
      setTxDocumentNumber(editTx.documentNumber || '');
      setTxParty(editTx.partyName);
      setTxVehicle(editTx.vehicleNumber || '');
      setTxDriverName(editTx.driverName || '');
      setTxRemarks(editTx.remarks || '');
    } else {
      setTxEditId(null);
      setTxType(type);
      setTxDate(nowLocalInput());
      setTxTankId(tankId || store.tanks[0].id);
      setTxMaterial(store.materials[0]?.name || 'ASPHALT 60/70');
      setTxQtyKg('');
      setTxRef('');
      setTxDocumentNumber('');
      setTxParty('');
      setTxVehicle('');
      setTxDriverName('');
      setTxRemarks('');
    }
    setTxModalOpen(true);
  };

  const selectedTxTank = useMemo(() => {
    return store?.tanks.find((t) => t.id === txTankId) || null;
  }, [store, txTankId]);

  const txProjectedPreview = useMemo(() => {
    if (!store || !selectedTxTank) return null;
    const qty = Number(txQtyKg) || 0;
    const fakeTx: LiquidTransaction = {
      id: txEditId || -1,
      txCode: 'PREVIEW',
      type: txType,
      txDate,
      tankId: txTankId,
      materialName: txMaterial,
      quantityKg: qty,
      quantityMt: qty / 1000,
      referenceNumber: txRef,
      documentNumber: txDocumentNumber,
      partyName: txParty,
      vehicleNumber: txVehicle,
      driverName: txDriverName,
      remarks: txRemarks,
    };
    const nextList = txEditId
      ? store.transactions.map((t) => (t.id === txEditId ? fakeTx : t))
      : [...store.transactions, fakeTx];
    return computeClientPreviewTank(selectedTxTank, nextList);
  }, [store, selectedTxTank, txQtyKg, txEditId, txType, txDate, txTankId, txMaterial, txRef, txDocumentNumber, txParty, txVehicle, txDriverName, txRemarks]);

  const handleTxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store || !selectedTxTank) return;
    setTxError(null);

    const qtyNum = Number(txQtyKg);
    if (!(qtyNum > 0)) {
      setTxError('Quantity (KG) must be greater than 0.');
      return;
    }

    // Validate across affected tanks locally first for clean 2-step confirmation UX
    const fakeTx: LiquidTransaction = {
      id: txEditId || -1,
      txCode: 'PREVIEW',
      type: txType,
      txDate,
      tankId: txTankId,
      materialName: txMaterial,
      quantityKg: qtyNum,
      quantityMt: qtyNum / 1000,
      referenceNumber: txRef.trim(),
      documentNumber: txDocumentNumber.trim(),
      partyName: txParty.trim(),
      vehicleNumber: txVehicle.trim().toUpperCase(),
      driverName: txDriverName.trim(),
      remarks: txRemarks.trim(),
    };
    const nextList = txEditId
      ? store.transactions.map((t) => (t.id === txEditId ? fakeTx : t))
      : [...store.transactions, fakeTx];

    for (const tk of store.tanks) {
      const check = computeClientPreviewTank(tk, nextList);
      if (check.currentStockKg < -0.0001) {
        setTxError(`Operation rejected: ${tk.name} stock would drop below 0 (${fmtKG(check.currentStockKg)} KG).`);
        setTxConfirmStep(false);
        return;
      }
      if (check.currentStockKg > tk.totalCapacityKg + 0.0001) {
        setTxError(
          `Operation rejected: ${tk.name} stock (${fmtKG(check.currentStockKg)} KG) exceeds capacity (${fmtKG(tk.totalCapacityKg)} KG).`
        );
        setTxConfirmStep(false);
        return;
      }
      for (const [mName, bal] of Object.entries(check.materialBalances)) {
        if (bal < -0.0001) {
          setTxError(`Operation rejected: ${mName} balance in ${tk.name} would become negative (${fmtKG(bal)} KG).`);
          setTxConfirmStep(false);
          return;
        }
      }
    }

    if (!txConfirmStep) {
      setTxConfirmStep(true);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        plantId,
        type: txType,
        txDate,
        tankId: txTankId,
        materialName: txMaterial,
        quantityKg: qtyNum,
        referenceNumber: txRef.trim(),
        documentNumber: txDocumentNumber.trim(),
        partyName: txParty.trim(),
        vehicleNumber: txVehicle.trim().toUpperCase(),
        driverName: txDriverName.trim(),
        remarks: txRemarks.trim(),
      };
      if (txEditId) {
        const res = await ApiClient.updateLiquidTransaction(txEditId, payload);
        setStore(res.state);
        showToast('success', `Updated ${res.txCode} and recalculated stock.`);
      } else {
        const res = await ApiClient.createLiquidTransaction(payload);
        setStore(res.state);
        showToast('success', `Saved ${res.txCode} (${fmtMT(qtyNum / 1000)} MT).`);
      }
      setTxModalOpen(false);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to save transaction.');
      setTxConfirmStep(false);
    } finally {
      setSubmitting(false);
    }
  };

  const openTankModal = (tank?: LiquidTankComputed) => {
    setTankError(null);
    if (tank) {
      setTankEditId(tank.id);
      setTankName(tank.name);
      setTankCapKg(String(tank.totalCapacityKg));
      setTankDepthM(String(tank.depthMeters));
      setTankLocation(tank.location);
      setTankNotes(tank.notes || '');
    } else {
      setTankEditId(null);
      setTankName('');
      setTankCapKg('2000000');
      setTankDepthM('7');
      setTankLocation('Main Storage Bay A');
      setTankNotes('');
    }
    setTankModalOpen(true);
  };

  const handleTankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTankError(null);
    setSubmitting(true);
    try {
      const payload = {
        plantId,
        name: tankName.trim(),
        totalCapacityKg: Number(tankCapKg),
        depthMeters: Number(tankDepthM),
        location: tankLocation.trim() || 'Main Storage Bay',
        notes: tankNotes.trim(),
      };
      if (tankEditId) {
        const res = await ApiClient.updateLiquidTank(tankEditId, payload);
        setStore(res.state);
        showToast('success', `Updated ${payload.name}.`);
      } else {
        const res = await ApiClient.createLiquidTank(payload);
        setStore(res.state);
        showToast('success', `Created new tank ${payload.name}.`);
      }
      setTankModalOpen(false);
    } catch (err: any) {
      setTankError(err?.message || 'Failed to save tank.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTx = (tx: LiquidTransaction) => {
    setConfirmDialog({
      title: 'Delete Transaction',
      message: `Delete transaction ${tx.txCode} (${fmtKG(tx.quantityKg)} KG ${tx.materialName})? Tank balance will be recalculated immediately.`,
      confirmLabel: 'Delete Transaction',
      onConfirm: async () => {
        const res = await ApiClient.deleteLiquidTransaction(tx.id, plantId);
        setStore(res.state);
        showToast('success', `Deleted ${res.txCode} and recalculated tank stock.`);
      },
    });
  };

  const handleDeleteTank = (tank: LiquidTankComputed) => {
    if (!store) return;
    if (tank.currentStockKg > 0.0001) {
      showToast('error', `Cannot delete ${tank.name} while it holds stock.`);
      return;
    }
    if (store.transactions.some((tx) => tx.tankId === tank.id)) {
      showToast('error', `Cannot delete ${tank.name} because register transactions reference it.`);
      return;
    }
    setConfirmDialog({
      title: 'Delete Tank',
      message: `Delete ${tank.name} permanently?`,
      confirmLabel: 'Delete Tank',
      onConfirm: async () => {
        const res = await ApiClient.deleteLiquidTank(tank.id, plantId);
        setStore(res.state);
        showToast('success', `Deleted ${tank.name}.`);
      },
    });
  };

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMatName.trim()) return;
    setSubmitting(true);
    try {
      const res = await ApiClient.createLiquidMaterial({
        plantId,
        name: newMatName.trim().toUpperCase(),
        code: newMatCode.trim().toUpperCase(),
        description: newMatDesc.trim(),
      });
      setStore(res.state);
      setNewMatName('');
      setNewMatCode('');
      setNewMatDesc('');
      showToast('success', `Added material ${newMatName.trim().toUpperCase()}.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to add material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveMaterialEdit = async (mat: LiquidMaterial) => {
    if (!editMatName.trim()) return;
    setSubmitting(true);
    try {
      const res = await ApiClient.updateLiquidMaterial(mat.id, {
        plantId,
        name: editMatName.trim().toUpperCase(),
        code: editMatCode.trim().toUpperCase(),
        description: editMatDesc.trim(),
      });
      setStore(res.state);
      setEditingMatId(null);
      showToast('success', `Updated material ${editMatName.trim().toUpperCase()}.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMaterial = (mat: LiquidMaterial) => {
    if (!store) return;
    const usedCount = store.transactions.filter((t) => t.materialName === mat.name).length;
    if (usedCount > 0) {
      showToast('error', `Cannot delete "${mat.name}" because ${usedCount} transaction(s) reference it.`);
      return;
    }
    setConfirmDialog({
      title: 'Delete Material',
      message: `Delete material "${mat.name}" permanently?`,
      confirmLabel: 'Delete Material',
      onConfirm: async () => {
        const res = await ApiClient.deleteLiquidMaterial(mat.id, plantId);
        setStore(res.state);
        showToast('success', `Deleted material ${mat.name}.`);
      },
    });
  };

  const handleThemeToggle = async (theme: 'light' | 'dark') => {
    try {
      const res = await ApiClient.updateLiquidSettings({ plantId, theme });
      setStore(res.state);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update theme.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await ApiClient.updateLiquidSettings({
        plantId,
        facilityName: facilityInput.trim() || 'Liquid Material Camp Store — Sector 4',
      });
      setStore(res.state);
      showToast('success', 'Store settings saved.');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save settings.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetDefault = () => {
    setConfirmDialog({
      title: 'Reset Liquid Store Data',
      message: 'Reset all 14 tanks, materials, transactions, and settings back to initial Camp Store defaults?',
      confirmLabel: 'Reset Default Data',
      onConfirm: async () => {
        const res = await ApiClient.resetLiquidStore(plantId);
        setStore(res.state);
        setFacilityInput(res.state.settings.facilityName);
        setDashMaterialFilter('ALL');
        showToast('success', 'Reset to default Liquid Material Camp Store inventory.');
      },
    });
  };

  const exportRegisterCSV = (mode: 'INWARD' | 'OUTWARD' | 'HISTORY') => {
    if (!store) return;
    const rows = store.transactions.filter((tx) => (mode === 'HISTORY' ? true : tx.type === mode));
    const header = [
      'Date',
      'Transaction ID',
      'Type',
      'Tank',
      'Material',
      'Qty (KG)',
      'Qty (MT)',
      'Document No.',
      'Reference',
      'Party',
      'Vehicle',
      'Driver Name',
      'Remarks',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) => {
        const tn = store.tanks.find((t) => t.id === r.tankId)?.name || '';
        return [
          r.txDate,
          r.txCode,
          r.type,
          tn,
          r.materialName,
          r.quantityKg,
          r.quantityMt,
          r.documentNumber || '',
          r.referenceNumber,
          r.partyName,
          r.vehicleNumber,
          r.driverName || '',
          r.remarks,
        ]
          .map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`)
          .join(',');
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liquid_camp_store_${mode.toLowerCase()}_register.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRegisterRows = useMemo(() => {
    if (!store) return [];
    const q = regSearch.trim().toLowerCase();
    return store.transactions
      .filter((tx) => {
        if (subTab === 'inward' && tx.type !== 'INWARD') return false;
        if (subTab === 'outward' && tx.type !== 'OUTWARD') return false;
        if (subTab === 'history' && regType !== 'ALL' && tx.type !== regType) return false;
        if (regTankId !== 'ALL' && String(tx.tankId) !== regTankId) return false;
        if (regMaterial !== 'ALL' && tx.materialName !== regMaterial) return false;
        const d = tx.txDate.slice(0, 10);
        if (regStart && d < regStart) return false;
        if (regEnd && d > regEnd) return false;
        if (q) {
          const tankName = store.tanks.find((t) => t.id === tx.tankId)?.name || '';
          const hay = `${tx.txCode} ${tankName} ${tx.materialName} ${tx.documentNumber || ''} ${tx.referenceNumber} ${tx.partyName} ${tx.vehicleNumber} ${tx.driverName || ''} ${tx.remarks}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.txDate.localeCompare(a.txDate) || b.id - a.id);
  }, [store, subTab, regSearch, regType, regTankId, regMaterial, regStart, regEnd]);

  const reportSummaryRows = useMemo(() => {
    if (!store) return [];
    const txs = store.transactions.filter((tx) => {
      if (repTankId !== 'ALL' && String(tx.tankId) !== repTankId) return false;
      if (repMaterial !== 'ALL' && tx.materialName !== repMaterial) return false;
      const d = tx.txDate.slice(0, 10);
      if (repStart && d < repStart) return false;
      if (repEnd && d > repEnd) return false;
      return true;
    });
    const names =
      repMaterial === 'ALL'
        ? Array.from(new Set([...store.materials.map((m) => m.name), ...txs.map((t) => t.materialName)]))
        : [repMaterial];
    return names.map((name) => {
      const list = txs.filter((t) => t.materialName === name);
      const inKg = list.filter((t) => t.type === 'INWARD').reduce((a, b) => a + b.quantityKg, 0);
      const outKg = list.filter((t) => t.type === 'OUTWARD').reduce((a, b) => a + b.quantityKg, 0);
      const involvedTankIds = new Set(list.map((t) => t.tankId));
      const tankNames = store.tanks.filter((t) => involvedTankIds.has(t.id)).map((t) => t.name);
      return { name, inKg, outKg, balKg: inKg - outKg, tankNames };
    });
  }, [store, repTankId, repMaterial, repStart, repEnd]);

  const reportGrandTotals = useMemo(
    () =>
      reportSummaryRows.reduce(
        (acc, r) => ({
          inKg: acc.inKg + r.inKg,
          outKg: acc.outKg + r.outKg,
          balKg: acc.balKg + r.balKg,
        }),
        { inKg: 0, outKg: 0, balKg: 0 }
      ),
    [reportSummaryRows]
  );

  const registerFilterSummary = useMemo(() => {
    if (!store) return 'All records';
    const parts: string[] = [];
    if (regTankId !== 'ALL') {
      const tk = store.tanks.find((t) => String(t.id) === regTankId);
      if (tk) parts.push(`Tank: ${tk.name}`);
    }
    if (regMaterial !== 'ALL') parts.push(`Material: ${regMaterial}`);
    if (subTab === 'history' && regType !== 'ALL') parts.push(`Type: ${regType}`);
    if (regStart || regEnd) parts.push(`Dates: ${regStart || 'Start'} to ${regEnd || 'Today'}`);
    if (regSearch.trim()) parts.push(`Search: "${regSearch.trim()}"`);
    return parts.length > 0 ? parts.join(' | ') : 'All records';
  }, [store, regTankId, regMaterial, subTab, regType, regStart, regEnd, regSearch]);

  const reportFilterSummary = useMemo(() => {
    if (!store) return 'All Tanks & Materials';
    const parts: string[] = [];
    if (repTankId !== 'ALL') {
      const tk = store.tanks.find((t) => String(t.id) === repTankId);
      if (tk) parts.push(`Tank: ${tk.name}`);
    }
    if (repMaterial !== 'ALL') parts.push(`Material: ${repMaterial}`);
    if (repStart || repEnd) parts.push(`Dates: ${repStart || 'Start'} to ${repEnd || 'Today'}`);
    return parts.length > 0 ? parts.join(' | ') : 'All Tanks & All Materials';
  }, [store, repTankId, repMaterial, repStart, repEnd]);

  const openPrintOrView = (target: LiquidPrintTarget, autoPrint = false) => {
    setPrintPreview({ target, autoPrint });
  };

  const handleDirectDownloadPdf = (target: LiquidPrintTarget) => {
    if (!store) return;
    const facilityName = store.settings.facilityName;
    try {
      switch (target.kind) {
        case 'register':
          generateLiquidRegisterPDF(
            target.mode,
            target.rows,
            store.tanks,
            facilityName,
            target.filterSummary,
            companyLogoUrl
          );
          showToast('success', `${target.mode} Register PDF downloaded.`);
          break;
        case 'audit':
          generateLiquidAuditPDF(store.auditLogs, facilityName, companyLogoUrl);
          showToast('success', 'Audit Log PDF downloaded.');
          break;
        case 'tanks':
          generateLiquidTanksPDF(store.tanks, facilityName, companyLogoUrl);
          showToast('success', 'Tank Inventory PDF downloaded.');
          break;
        case 'tank-detail': {
          const tankTxs = store.transactions
            .filter((t) => t.tankId === target.tank.id)
            .sort((a, b) => b.txDate.localeCompare(a.txDate) || b.id - a.id);
          generateLiquidSingleTankPDF(target.tank, tankTxs, facilityName, companyLogoUrl);
          showToast('success', `${target.tank.name} Specification PDF downloaded.`);
          break;
        }
        case 'stock-report':
          generateLiquidStockReportPDF(target.rows, facilityName, target.filterSummary, companyLogoUrl);
          showToast('success', 'Consolidated Stock Report PDF downloaded.');
          break;
        default:
          break;
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to generate PDF.');
    }
  };

  const renderTankCard = (tank: LiquidTankComputed) => (
    <div key={tank.id} className={`rounded-2xl border p-4 sm:p-5 ${cardCls}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 pb-3 border-b ${tdBorderCls}`}>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-extrabold tracking-tight">{tank.name}</h3>
            <span className="text-sm font-bold text-sky-600">— {tank.productLabel}</span>
            <span className={`text-xs ${mutedCls}`}>· {tank.location}</span>
          </div>
          <p className={`text-xs font-mono tabular-nums mt-1 ${mutedCls}`}>
            {fmtMT(tank.totalCapacityMt)} MT Capacity · {fmtM(tank.depthMeters)} m Depth · Last Activity:{' '}
            {fmtDate(tank.lastTransactionAt)}
          </p>
        </div>

        <div className="flex items-center gap-1.5 print:hidden">
          {canManageStore && (
            <>
              <button
                type="button"
                onClick={() => openTxModal('INWARD', tank.id)}
                className="app-btn-sm bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Inward</span>
              </button>
              <button
                type="button"
                onClick={() => openTxModal('OUTWARD', tank.id)}
                className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
              >
                <Minus className="w-3.5 h-3.5 shrink-0" />
                <span>Outward</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setDetailTankId(tank.id)}
            className={`app-btn-sm border ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
          >
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span>Details</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[235px_1fr] gap-5 items-center mt-4">
        <div className={`rounded-xl border p-3 flex flex-col items-center ${altBoxCls}`}>
          <LiquidTankSvg tank={tank} />
          <div className="flex items-center gap-4 text-[11px] font-medium mt-1 font-mono tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" />
              Filled ({fmtPct(tank.filledPercentage)})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
              Empty ({fmtPct(tank.emptyPercentage)})
            </span>
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className={`rounded-xl border p-3 ${altBoxCls}`}>
              <div className={`text-[11px] font-semibold ${mutedCls}`}>Current Stock (MT)</div>
              <div className="text-lg font-bold font-mono tabular-nums text-sky-600 mt-0.5">
                {fmtMT(tank.currentStockMt)} MT
              </div>
              <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>
                {fmtKG(tank.currentStockKg)} KG
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${altBoxCls}`}>
              <div className={`text-[11px] font-semibold ${mutedCls}`}>Empty Capacity</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {fmtMT(tank.emptyCapacityMt)} MT
              </div>
              <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>
                {fmtKG(tank.emptyCapacityKg)} KG
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${altBoxCls}`}>
              <div className={`text-[11px] font-semibold ${mutedCls}`}>Total Capacity</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {fmtMT(tank.totalCapacityMt)} MT
              </div>
              <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>
                {fmtKG(tank.totalCapacityKg)} KG
              </div>
            </div>
          </div>

          <div className={`rounded-xl border overflow-hidden ${tdBorderCls}`}>
            <div className={`grid grid-cols-1 sm:grid-cols-3 border-b ${tdBorderCls}`}>
              <div className={`px-3 py-2 text-xs flex justify-between gap-2 sm:border-r ${tdBorderCls}`}>
                <span className={mutedCls}>Filled %</span>
                <strong className="font-mono tabular-nums text-sky-600">{fmtPct(tank.filledPercentage)}</strong>
              </div>
              <div className={`px-3 py-2 text-xs flex justify-between gap-2 sm:border-r ${tdBorderCls}`}>
                <span className={mutedCls}>Empty %</span>
                <strong className="font-mono tabular-nums">{fmtPct(tank.emptyPercentage)}</strong>
              </div>
              <div className="px-3 py-2 text-xs flex justify-between gap-2">
                <span className={mutedCls}>Depth</span>
                <strong className="font-mono tabular-nums">{fmtM(tank.depthMeters)} m</strong>
              </div>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-3 border-b ${tdBorderCls}`}>
              <div className={`px-3 py-2 text-xs flex justify-between gap-2 sm:border-r ${tdBorderCls}`}>
                <span className={mutedCls}>Filling Meter</span>
                <strong className="font-mono tabular-nums text-sky-600">{fmtM(tank.filledMeters)} m</strong>
              </div>
              <div className={`px-3 py-2 text-xs flex justify-between gap-2 sm:border-r ${tdBorderCls}`}>
                <span className={mutedCls}>Empty Meter</span>
                <strong className="font-mono tabular-nums">{fmtM(tank.emptyMeters)} m</strong>
              </div>
              <div className="px-3 py-2 text-xs flex justify-between gap-2">
                <span className={mutedCls}>Stock (KG)</span>
                <strong className="font-mono tabular-nums">{fmtKG(tank.currentStockKg)} KG</strong>
              </div>
            </div>

            <div className={`px-3 py-2 text-xs flex flex-wrap justify-between gap-2 ${altBoxCls}`}>
              <span className={mutedCls}>Last Transaction Date & Time</span>
              <span className="font-mono tabular-nums">{fmtDate(tank.lastTransactionAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading && !store) {
    return (
      <div className={`rounded-2xl border p-12 flex flex-col items-center justify-center gap-3 ${cardCls}`}>
        <Loader2 className="w-7 h-7 animate-spin text-sky-600" />
        <p className={`text-sm font-semibold ${mutedCls}`}>Loading Liquid Material Camp Store inventory...</p>
      </div>
    );
  }

  if (!store) return null;

  const detailTank = detailTankId ? store.tanks.find((t) => t.id === detailTankId) || null : null;

  return (
    <div className={`rounded-xl border overflow-hidden shadow-xs transition-colors ${shellBg}`}>
      {/* Liquid Store Header & Top Quick Actions */}
      <div className={`px-4 sm:px-6 py-4 border-b flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 print:hidden ${cardCls}`}>
        <div className="flex items-center gap-3 min-w-0">
          {companyLogoUrl ? (
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 ring-1 ring-[#F0AB00]/60 overflow-hidden p-0.5 shadow-xs">
              <img src={companyLogoUrl} alt={store.settings.facilityName} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-[#0A6ED1] text-white flex items-center justify-center shrink-0 ring-1 ring-[#F0AB00]/50">
              <Droplets className="w-5 h-5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
              Liquid Material Camp Store
            </h2>
            <p className={`text-xs truncate ${mutedCls}`}>
              {store.settings.facilityName} · {currentUser.fullName} ({currentUser.roleDisplayName})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!canManageStore && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>View Only</span>
            </span>
          )}
          {canManageStore && (
            <button
              type="button"
              onClick={() => handleThemeToggle(isDark ? 'light' : 'dark')}
              className={`app-btn border ${
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-[#EFF4F9] border-[#BCC8D4] text-[#354A5F]'
              }`}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-4 h-4 text-[#F0AB00] shrink-0" /> : <Moon className="w-4 h-4 text-[#354A5F] shrink-0" />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => loadState(false)}
            className={`app-btn border ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                : 'bg-white hover:bg-[#EFF4F9] border-[#BCC8D4] text-[#354A5F]'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>Sync</span>
          </button>

          {canManageStore && (
            <>
              <button
                type="button"
                onClick={() => openTxModal('INWARD')}
                className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Inward Entry</span>
              </button>

              <button
                type="button"
                onClick={() => openTxModal('OUTWARD')}
                className="app-btn bg-[#BB0000] hover:bg-[#9E0000] text-white"
              >
                <Minus className="w-4 h-4 shrink-0" />
                <span>Outward Entry</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sub-navigation bar */}
      <div className={`px-4 sm:px-6 py-2.5 border-b flex flex-wrap items-center gap-1.5 print:hidden ${altBoxCls}`}>
        {(
          [
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'tanks', label: 'Tank Management', icon: Database },
            { id: 'inward', label: 'Material Inward', icon: ArrowDownToLine },
            { id: 'outward', label: 'Material Outward', icon: ArrowUpFromLine },
            { id: 'history', label: 'Transaction History', icon: History },
            { id: 'reports', label: 'Stock Reports', icon: FileBarChart2 },
            { id: 'settings', label: 'Store Settings', icon: Settings },
          ] as Array<{ id: LiquidSubTab; label: string; icon: React.ComponentType<{ className?: string }> }>
        ).map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`app-btn-sm ${
                active
                  ? 'bg-[#0A6ED1] text-white shadow-xs'
                  : isDark
                  ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  : 'text-[#354A5F] hover:bg-white hover:text-[#1C2833]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="p-4 sm:p-6 space-y-5">
        {/* SUB-VIEW 1: DASHBOARD */}
        {subTab === 'dashboard' && (
          <div className="space-y-5">
            {/* Material Filter & View Mode Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className={`inline-flex flex-wrap gap-1 p-1 rounded-xl border ${altBoxCls}`}>
                <button
                  type="button"
                  onClick={() => setDashMaterialFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    dashMaterialFilter === 'ALL'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  All Materials ({store.tanks.length})
                </button>
                {matStats.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setDashMaterialFilter(s.name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      dashMaterialFilter === s.name
                        ? isDark
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white text-slate-900 shadow-xs'
                        : mutedCls
                    }`}
                  >
                    {s.name} ({s.tanks.length})
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDashMaterialFilter('EMPTY')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    dashMaterialFilter === 'EMPTY'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  Empty Tanks ({emptyTanks.length})
                </button>
              </div>

              <div className={`inline-flex gap-1 p-1 rounded-xl border ${altBoxCls}`}>
                <button
                  type="button"
                  onClick={() => setDashViewMode('by-material')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    dashViewMode === 'by-material'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  Grouped by Material
                </button>
                <button
                  type="button"
                  onClick={() => setDashViewMode('all-tanks')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    dashViewMode === 'all-tanks'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  Sequential (Tank 01–{String(store.tanks.length).padStart(2, '0')})
                </button>
              </div>
            </div>

            {/* Material Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {matStats.map((s) => {
                const isSelected = dashMaterialFilter === s.name;
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setDashMaterialFilter(isSelected ? 'ALL' : s.name)}
                    className={`text-left rounded-2xl border p-4 transition cursor-pointer ${cardCls} ${
                      isSelected ? 'ring-2 ring-sky-600 border-sky-600' : 'hover:border-sky-500/60'
                    }`}
                  >
                    <div className={`flex justify-between items-start gap-2 pb-2.5 border-b ${tdBorderCls}`}>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold">{s.name}</div>
                        <div className={`text-xs truncate ${mutedCls}`}>
                          {s.tanks.length ? `Stored in: ${s.tanks.map((t) => t.name).join(', ')}` : 'No active tanks holding stock'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold font-mono tabular-nums text-sky-600">
                          {fmtMT(s.bal / 1000)} MT
                        </div>
                        <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(s.bal)} KG</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2.5 text-xs font-mono tabular-nums">
                      <div>
                        <span className={mutedCls}>Inward: </span>
                        <strong className="text-emerald-600">+{fmtMT(s.inKg / 1000)} MT</strong>
                      </div>
                      <div className="text-right">
                        <span className={mutedCls}>Outward: </span>
                        <strong className="text-red-600">-{fmtMT(s.outKg / 1000)} MT</strong>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 6-Card KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className={`text-xs font-semibold ${mutedCls}`}>Total Tank Capacity</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">{fmtMT(kpi.cap / 1000)} MT</div>
                <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(kpi.cap)} KG</div>
              </div>

              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className={`text-xs font-semibold ${mutedCls}`}>Total Available Stock</div>
                <div className="text-xl font-bold font-mono tabular-nums text-sky-600 mt-1">
                  {fmtMT(kpi.stock / 1000)} MT
                </div>
                <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(kpi.stock)} KG</div>
              </div>

              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className={`text-xs font-semibold ${mutedCls}`}>Total Empty Capacity</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">{fmtMT(kpi.empty / 1000)} MT</div>
                <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(kpi.empty)} KG</div>
              </div>

              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className="text-xs font-semibold text-emerald-600">Total Inward Today</div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 mt-1">
                  +{fmtMT(kpi.inToday / 1000)} MT
                </div>
                <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(kpi.inToday)} KG</div>
              </div>

              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className="text-xs font-semibold text-red-600">Total Outward Today</div>
                <div className="text-xl font-bold font-mono tabular-nums text-red-600 mt-1">
                  -{fmtMT(kpi.outToday / 1000)} MT
                </div>
                <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(kpi.outToday)} KG</div>
              </div>

              <div className={`rounded-2xl border p-4 ${cardCls}`}>
                <div className={`text-xs font-semibold ${mutedCls}`}>Total Number of Tanks</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">
                  {kpi.count} {kpi.count === 1 ? 'Tank' : 'Tanks'}
                </div>
                <div className={`text-[11px] truncate ${mutedCls}`}>
                  {dashMaterialFilter === 'ALL' ? 'Active storage units' : dashMaterialFilter}
                </div>
              </div>
            </div>

            {/* Tanks Display */}
            {dashViewMode === 'by-material' && dashMaterialFilter === 'ALL' ? (
              <div className="space-y-6">
                {matStats.map((g) => (
                  <div key={g.name} className="space-y-3">
                    <div className={`flex flex-wrap justify-between items-baseline gap-2 pb-2 border-b ${tdBorderCls}`}>
                      <div>
                        <strong className="text-sm font-extrabold">{g.name}</strong>{' '}
                        <span className={`text-xs font-mono tabular-nums ${mutedCls}`}>
                          ({g.tanks.length} {g.tanks.length === 1 ? 'Tank' : 'Tanks'})
                        </span>
                      </div>
                      <div className="text-xs font-mono tabular-nums font-bold text-sky-600">
                        Stock: {fmtMT(g.bal / 1000)} MT ({fmtKG(g.bal)} KG)
                      </div>
                    </div>

                    {g.tanks.length === 0 ? (
                      <div className={`rounded-2xl border p-6 text-center text-xs ${cardCls} ${mutedCls}`}>
                        No tanks currently hold {g.name}.
                      </div>
                    ) : (
                      <div className={`grid gap-5 ${g.tanks.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
                        {g.tanks.map(renderTankCard)}
                      </div>
                    )}
                  </div>
                ))}

                <div className="space-y-3">
                  <div className={`flex flex-wrap justify-between items-baseline gap-2 pb-2 border-b ${tdBorderCls}`}>
                    <div>
                      <strong className="text-sm font-extrabold">Empty / Standby Tanks</strong>{' '}
                      <span className={`text-xs font-mono tabular-nums ${mutedCls}`}>
                        ({emptyTanks.length} {emptyTanks.length === 1 ? 'Tank' : 'Tanks'})
                      </span>
                    </div>
                    <div className={`text-xs font-mono tabular-nums ${mutedCls}`}>
                      Available: {fmtMT(emptyTanks.reduce((a, t) => a + t.emptyCapacityMt, 0))} MT
                    </div>
                  </div>
                  <div className={`grid gap-5 ${emptyTanks.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
                    {emptyTanks.map(renderTankCard)}
                  </div>
                </div>
              </div>
            ) : (
              (() => {
                const list =
                  dashMaterialFilter === 'ALL'
                    ? store.tanks
                    : dashMaterialFilter === 'EMPTY'
                    ? emptyTanks
                    : store.tanks.filter((t) =>
                        t.materials.some((m) => m.materialName === dashMaterialFilter && m.balanceKg > 0.0001)
                      );
                if (list.length === 0) {
                  return (
                    <div className={`rounded-2xl border p-8 text-center text-xs ${cardCls} ${mutedCls}`}>
                      No tanks match the selected filter.
                    </div>
                  );
                }
                return (
                  <div className={`grid gap-5 ${list.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
                    {list.map(renderTankCard)}
                  </div>
                );
              })()
            )}

            {/* Recent Register Movements */}
            <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
              <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${tdBorderCls}`}>
                <strong className="text-sm font-extrabold">Recent Register Movements</strong>
                <button
                  type="button"
                  onClick={() => setSubTab('history')}
                  className={`app-btn-sm border print:hidden ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  View Full History
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className={`border-b ${thCls}`}>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ID</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Type</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tank</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Material</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Qty (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Qty (KG)</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Party</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap print:hidden">View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDashTxs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className={`py-8 text-center ${mutedCls}`}>
                          No movements recorded.
                        </td>
                      </tr>
                    ) : (
                      recentDashTxs.map((tx) => {
                        const tankObj = store.tanks.find((t) => t.id === tx.tankId);
                        const isIn = tx.type === 'INWARD';
                        return (
                          <tr key={tx.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                            <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">{fmtDate(tx.txDate)}</td>
                            <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">{tx.txCode}</td>
                            <td className={`py-2.5 px-3 font-bold ${isIn ? 'text-emerald-600' : 'text-red-600'}`}>
                              {tx.type}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {tankObj?.name || '-'} —{' '}
                              <span className="text-sky-600 font-semibold">{tankObj?.productLabel || tx.materialName}</span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">{tx.materialName}</td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                                isIn ? 'text-emerald-600' : 'text-red-600'
                              }`}
                            >
                              {isIn ? '+' : '-'}
                              {fmtMT(tx.quantityMt)} MT
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              {fmtKG(tx.quantityKg)} KG
                            </td>
                            <td className="py-2.5 px-3">{tx.partyName || '-'}</td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap print:hidden">
                              <button
                                type="button"
                                onClick={() => openPrintOrView({ kind: 'transaction', tx }, false)}
                                className={`app-btn-sm border ${
                                  isDark
                                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                    : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                                }`}
                              >
                                <Eye className="w-3 h-3 shrink-0" />
                                <span>View</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUB-VIEW 2: TANK MANAGEMENT */}
        {subTab === 'tanks' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h3 className="text-lg font-extrabold">Tank Configuration & Management</h3>
                <p className={`text-xs mt-0.5 ${mutedCls}`}>
                  Configure vertical storage tanks, total capacities in KG and MT, and tank depth in meters
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => openPrintOrView({ kind: 'tanks' }, false)}
                  className={`app-btn-sm border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>View</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDirectDownloadPdf({ kind: 'tanks' })}
                  className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => openPrintOrView({ kind: 'tanks' }, true)}
                  className={`app-btn-sm border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Print</span>
                </button>
                {canManageStore && (
                  <button
                    type="button"
                    onClick={() => openTankModal()}
                    className="app-btn bg-sky-600 hover:bg-sky-500 text-white"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Add New Tank</span>
                  </button>
                )}
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className={`border-b ${thCls}`}>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tank Name</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Location</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Capacity (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Capacity (KG)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Depth</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Stock (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Empty (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Filled / Empty</th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Last Transaction</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap print:hidden">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.tanks.map((t) => (
                      <tr key={t.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <strong>{t.name}</strong> — <span className="text-sky-600 font-semibold">{t.productLabel}</span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">{t.location}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                          {fmtMT(t.totalCapacityMt)} MT
                        </td>
                        <td className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${mutedCls}`}>
                          {fmtKG(t.totalCapacityKg)} KG
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {fmtM(t.depthMeters)} m
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-sky-600 whitespace-nowrap">
                          {fmtMT(t.currentStockMt)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {fmtMT(t.emptyCapacityMt)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className="text-sky-600 font-semibold">{fmtPct(t.filledPercentage)}</span> /{' '}
                          {fmtPct(t.emptyPercentage)}
                        </td>
                        <td className={`py-2.5 px-3 font-mono tabular-nums whitespace-nowrap ${mutedCls}`}>
                          {fmtDate(t.lastTransactionAt)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap print:hidden">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailTankId(t.id)}
                              className={`app-btn-sm border ${
                                isDark
                                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                  : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                              }`}
                            >
                              <Eye className="w-3 h-3 shrink-0" />
                              <span>View</span>
                            </button>
                            {canManageStore && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openTankModal(t)}
                                  className={`app-btn-sm border ${
                                    isDark
                                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                  }`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTank(t)}
                                  className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUB-VIEW 3, 4, 5: INWARD / OUTWARD / TRANSACTION HISTORY */}
        {(subTab === 'inward' || subTab === 'outward' || subTab === 'history') && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h3 className="text-lg font-extrabold">
                {subTab === 'inward'
                  ? 'Material Inward Register'
                  : subTab === 'outward'
                  ? 'Material Outward Register'
                  : 'Transaction History & Audit Trail'}
              </h3>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {canManageStore && subTab !== 'outward' && (
                  <button
                    type="button"
                    onClick={() => openTxModal('INWARD')}
                    className="app-btn-sm bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Add Inward</span>
                  </button>
                )}
                {canManageStore && subTab !== 'inward' && (
                  <button
                    type="button"
                    onClick={() => openTxModal('OUTWARD')}
                    className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
                  >
                    <Minus className="w-3.5 h-3.5 shrink-0" />
                    <span>Add Outward</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    exportRegisterCSV(subTab === 'inward' ? 'INWARD' : subTab === 'outward' ? 'OUTWARD' : 'HISTORY')
                  }
                  className={`app-btn-sm border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Export Excel (CSV)</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openPrintOrView(
                      subTab === 'history' && historySubTab === 'audit'
                        ? { kind: 'audit' }
                        : {
                            kind: 'register',
                            mode: subTab === 'inward' ? 'INWARD' : subTab === 'outward' ? 'OUTWARD' : 'HISTORY',
                            rows: filteredRegisterRows,
                            filterSummary: registerFilterSummary,
                          },
                      false
                    )
                  }
                  className={`app-btn-sm border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>View</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDirectDownloadPdf(
                      subTab === 'history' && historySubTab === 'audit'
                        ? { kind: 'audit' }
                        : {
                            kind: 'register',
                            mode: subTab === 'inward' ? 'INWARD' : subTab === 'outward' ? 'OUTWARD' : 'HISTORY',
                            rows: filteredRegisterRows,
                            filterSummary: registerFilterSummary,
                          }
                    )
                  }
                  className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openPrintOrView(
                      subTab === 'history' && historySubTab === 'audit'
                        ? { kind: 'audit' }
                        : {
                            kind: 'register',
                            mode: subTab === 'inward' ? 'INWARD' : subTab === 'outward' ? 'OUTWARD' : 'HISTORY',
                            rows: filteredRegisterRows,
                            filterSummary: registerFilterSummary,
                          },
                      true
                    )
                  }
                  className={`app-btn-sm border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            {subTab === 'history' && (
              <div className={`inline-flex gap-1 p-1 rounded-xl border print:hidden ${altBoxCls}`}>
                <button
                  type="button"
                  onClick={() => setHistorySubTab('ledger')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    historySubTab === 'ledger'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  Transaction Ledger ({filteredRegisterRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistorySubTab('audit')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    historySubTab === 'audit'
                      ? isDark
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : mutedCls
                  }`}
                >
                  Audit Log ({store.auditLogs.length})
                </button>
              </div>
            )}

            {subTab === 'history' && historySubTab === 'audit' ? (
              <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className={`border-b ${thCls}`}>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Timestamp</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Action</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Entity</th>
                        <th className="py-2.5 px-3 font-semibold">Summary</th>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Performed By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {store.auditLogs.map((a) => (
                        <tr key={a.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                          <td className={`py-2.5 px-3 font-mono tabular-nums whitespace-nowrap ${mutedCls}`}>
                            {fmtDate(a.createdAt)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">{a.action}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">{a.entityType}</td>
                          <td className="py-2.5 px-3">{a.summary}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">{a.performedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <>
                <div className={`rounded-2xl border p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 print:hidden ${cardCls}`}>
                  <input
                    type="text"
                    placeholder="Search ID, doc no, ref, party, driver, vehicle..."
                    value={regSearch}
                    onChange={(e) => setRegSearch(e.target.value)}
                    className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
                  />
                  {subTab === 'history' && (
                    <select
                      value={regType}
                      onChange={(e) => setRegType(e.target.value as 'ALL' | 'INWARD' | 'OUTWARD')}
                      className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 cursor-pointer ${inputCls}`}
                    >
                      <option value="ALL">All Types</option>
                      <option value="INWARD">Inward</option>
                      <option value="OUTWARD">Outward</option>
                    </select>
                  )}
                  <select
                    value={regTankId}
                    onChange={(e) => setRegTankId(e.target.value)}
                    className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 cursor-pointer ${inputCls}`}
                  >
                    <option value="ALL">All Tanks</option>
                    {store.tanks.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={regMaterial}
                    onChange={(e) => setRegMaterial(e.target.value)}
                    className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 cursor-pointer ${inputCls}`}
                  >
                    <option value="ALL">All Materials</option>
                    {store.materials.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={regStart}
                    onChange={(e) => setRegStart(e.target.value)}
                    aria-label="Start Date"
                    className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
                  />
                  <input
                    type="date"
                    value={regEnd}
                    onChange={(e) => setRegEnd(e.target.value)}
                    aria-label="End Date"
                    className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
                  />
                </div>

                <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className={`border-b ${thCls}`}>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Date</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Transaction ID</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Type</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tank</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Material</th>
                          <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Qty (KG)</th>
                          <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Qty (MT)</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Document No.</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Ref No.</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Supplier / Customer</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Vehicle</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Driver Name</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Remarks</th>
                          <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap print:hidden">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRegisterRows.length === 0 ? (
                          <tr>
                            <td colSpan={14} className={`py-8 text-center ${mutedCls}`}>
                              No matching transactions.
                            </td>
                          </tr>
                        ) : (
                          filteredRegisterRows.map((tx) => {
                            const isIn = tx.type === 'INWARD';
                            const tankName = store.tanks.find((t) => t.id === tx.tankId)?.name || '-';
                            return (
                              <tr key={tx.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                                <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                                  {fmtDate(tx.txDate)}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">{tx.txCode}</td>
                                <td className={`py-2.5 px-3 font-bold ${isIn ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {tx.type}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">{tankName}</td>
                                <td className="py-2.5 px-3 whitespace-nowrap">{tx.materialName}</td>
                                <td
                                  className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                                    isIn ? 'text-emerald-600' : 'text-red-600'
                                  }`}
                                >
                                  {isIn ? '+' : '-'}
                                  {fmtKG(tx.quantityKg)}
                                </td>
                                <td
                                  className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                                    isIn ? 'text-emerald-600' : 'text-red-600'
                                  }`}
                                >
                                  {isIn ? '+' : '-'}
                                  {fmtMT(tx.quantityMt)} MT
                                </td>
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">{tx.documentNumber || '-'}</td>
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">{tx.referenceNumber || '-'}</td>
                                <td className="py-2.5 px-3">{tx.partyName || '-'}</td>
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">{tx.vehicleNumber || '-'}</td>
                                <td className="py-2.5 px-3 whitespace-nowrap">{tx.driverName || '-'}</td>
                                <td className="py-2.5 px-3">{tx.remarks || '-'}</td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap print:hidden">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openPrintOrView({ kind: 'transaction', tx }, false)}
                                      className={`app-btn-sm border ${
                                        isDark
                                          ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                          : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                                      }`}
                                      title="View Entry Slip / Print / Download PDF"
                                    >
                                      <Eye className="w-3 h-3 shrink-0" />
                                      <span>View</span>
                                    </button>
                                    {canManageStore && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => openTxModal(tx.type, tx.tankId, tx)}
                                          className={`app-btn-sm border ${
                                            isDark
                                              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                              : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                          }`}
                                        >
                                          <Edit2 className="w-3 h-3 shrink-0" />
                                          <span>Edit</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteTx(tx)}
                                          className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
                                        >
                                          <Trash2 className="w-3 h-3 shrink-0" />
                                          <span>Delete</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* SUB-VIEW 6: STOCK REPORTS */}
        {subTab === 'reports' && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h3 className="text-lg font-extrabold">Product-Wise Stock Report</h3>
                <p className={`text-xs mt-0.5 ${mutedCls}`}>
                  Product-wise consolidated inward, outward, and total stock balance in KG & MT
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {(repTankId !== 'ALL' || repMaterial !== 'ALL' || repStart || repEnd) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRepTankId('ALL');
                      setRepMaterial('ALL');
                      setRepStart('');
                      setRepEnd('');
                    }}
                    className={`app-btn border ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    openPrintOrView(
                      { kind: 'stock-report', rows: reportSummaryRows, filterSummary: reportFilterSummary },
                      false
                    )
                  }
                  className={`app-btn border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-[#0A6ED1]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>View</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDirectDownloadPdf({
                      kind: 'stock-report',
                      rows: reportSummaryRows,
                      filterSummary: reportFilterSummary,
                    })
                  }
                  className="app-btn bg-[#107E3E] hover:bg-[#0D6B34] text-white"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openPrintOrView(
                      { kind: 'stock-report', rows: reportSummaryRows, filterSummary: reportFilterSummary },
                      true
                    )
                  }
                  className={`app-btn border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            <div className={`rounded-2xl border p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 print:hidden ${cardCls}`}>
              <select
                value={repTankId}
                onChange={(e) => setRepTankId(e.target.value)}
                className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 cursor-pointer ${inputCls}`}
              >
                <option value="ALL">All Tanks</option>
                {store.tanks.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={repMaterial}
                onChange={(e) => setRepMaterial(e.target.value)}
                className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 cursor-pointer ${inputCls}`}
              >
                <option value="ALL">All Products / Materials</option>
                {store.materials.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={repStart}
                onChange={(e) => setRepStart(e.target.value)}
                aria-label="Report Start Date"
                className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
              />
              <input
                type="date"
                value={repEnd}
                onChange={(e) => setRepEnd(e.target.value)}
                aria-label="Report End Date"
                className={`px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
              />
            </div>

            {/* Product-Wise Total Summary Cards */}
            {reportSummaryRows.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className={`text-xs font-extrabold tracking-wider ${mutedCls}`}>
                    Product-Wise Total Stock Summary ({reportSummaryRows.length}{' '}
                    {reportSummaryRows.length === 1 ? 'Product' : 'Products'})
                  </h4>
                  <div className="text-xs font-mono tabular-nums font-bold text-sky-600">
                    All Products Total: {fmtMT(reportGrandTotals.balKg / 1000)} MT ({fmtKG(reportGrandTotals.balKg)} KG)
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {reportSummaryRows.map((r) => (
                    <div key={r.name} className={`rounded-2xl border p-4 ${cardCls}`}>
                      <div className={`flex justify-between items-start gap-2 pb-2.5 border-b ${tdBorderCls}`}>
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold truncate">{r.name}</div>
                          <div className={`text-[11px] truncate ${mutedCls}`}>
                            {r.tankNames.length > 0
                              ? `${r.tankNames.length} ${r.tankNames.length === 1 ? 'Tank' : 'Tanks'}: ${r.tankNames.join(', ')}`
                              : 'No movements in selected filter'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black font-mono tabular-nums text-sky-600">
                            {fmtMT(r.balKg / 1000)} MT
                          </div>
                          <div className={`text-[11px] font-mono tabular-nums ${mutedCls}`}>{fmtKG(r.balKg)} KG</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-2.5 text-xs font-mono tabular-nums">
                        <div>
                          <span className={mutedCls}>Inward: </span>
                          <strong className="text-emerald-600">+{fmtMT(r.inKg / 1000)} MT</strong>
                        </div>
                        <div className="text-right">
                          <span className={mutedCls}>Outward: </span>
                          <strong className="text-red-600">-{fmtMT(r.outKg / 1000)} MT</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className={`border-b ${thCls}`}>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Product / Material</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Total Inward (KG)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Total Inward (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Total Outward (KG)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Total Outward (MT)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Current Balance (KG)</th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Current Balance (MT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportSummaryRows.map((r) => (
                      <tr key={r.name} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-bold">{r.name}</div>
                          {r.tankNames.length > 0 && (
                            <div className={`text-[10px] font-medium ${mutedCls}`}>{r.tankNames.join(', ')}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-600 whitespace-nowrap">
                          {fmtKG(r.inKg)} KG
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-600 whitespace-nowrap">
                          {fmtMT(r.inKg / 1000)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-600 whitespace-nowrap">
                          {fmtKG(r.outKg)} KG
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-red-600 whitespace-nowrap">
                          {fmtMT(r.outKg / 1000)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {fmtKG(r.balKg)} KG
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-sky-600 whitespace-nowrap">
                          {fmtMT(r.balKg / 1000)} MT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t-2 font-extrabold ${thCls}`}>
                      <td className="py-2.5 px-3 whitespace-nowrap">GRAND TOTAL</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-600 whitespace-nowrap">
                        {fmtKG(reportGrandTotals.inKg)} KG
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-600 whitespace-nowrap">
                        {fmtMT(reportGrandTotals.inKg / 1000)} MT
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-600 whitespace-nowrap">
                        {fmtKG(reportGrandTotals.outKg)} KG
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-600 whitespace-nowrap">
                        {fmtMT(reportGrandTotals.outKg / 1000)} MT
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {fmtKG(reportGrandTotals.balKg)} KG
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-sky-600 whitespace-nowrap">
                        {fmtMT(reportGrandTotals.balKg / 1000)} MT
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUB-VIEW 7: STORE SETTINGS & MATERIAL MASTER DATA */}
        {subTab === 'settings' && (
          <div className="max-w-4xl space-y-5">
            <h3 className="text-lg font-extrabold">Store Settings & Material Master Data</h3>

            {canManageStore && (
              <form onSubmit={handleSaveSettings} className={`rounded-2xl border p-5 space-y-4 ${cardCls}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-extrabold">Camp Store Facility Configuration</h4>
                  <div className={`inline-flex gap-1 p-1 rounded-xl border ${altBoxCls}`}>
                    <button
                      type="button"
                      onClick={() => handleThemeToggle('light')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                        !isDark ? 'bg-white text-slate-900 shadow-xs' : mutedCls
                      }`}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => handleThemeToggle('dark')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                        isDark ? 'bg-slate-900 text-white shadow-xs' : mutedCls
                      }`}
                    >
                      Dark
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">Facility / Camp Store Name</label>
                    <input
                      type="text"
                      required
                      value={facilityInput}
                      onChange={(e) => setFacilityInput(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${inputCls}`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Signed-In Operator</label>
                    <input
                      type="text"
                      disabled
                      value={`${currentUser.fullName} (${currentUser.roleDisplayName})`}
                      className={`w-full px-3 py-2 text-xs rounded-xl border opacity-75 ${inputCls}`}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleResetDefault}
                    className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Default Data</span>
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="app-btn bg-sky-600 hover:bg-sky-500 text-white"
                  >
                    Save Settings
                  </button>
                </div>
              </form>
            )}

            <div className={`rounded-2xl border p-5 space-y-4 ${cardCls}`}>
              <h4 className="text-sm font-extrabold">Material Master Data (Create / Edit / Delete)</h4>

              <div className={`rounded-xl border overflow-hidden ${tdBorderCls}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className={`border-b ${thCls}`}>
                        <th className="py-2.5 px-3 font-semibold">Material Name</th>
                        <th className="py-2.5 px-3 font-semibold">Code</th>
                        <th className="py-2.5 px-3 font-semibold">Description</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {store.materials.map((m) =>
                        editingMatId === m.id ? (
                          <tr key={m.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={editMatName}
                                onChange={(e) => setEditMatName(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-lg border uppercase ${inputCls}`}
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={editMatCode}
                                onChange={(e) => setEditMatCode(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-lg border uppercase font-mono ${inputCls}`}
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={editMatDesc}
                                onChange={(e) => setEditMatDesc(e.target.value)}
                                className={`w-full px-2.5 py-1.5 text-xs rounded-lg border ${inputCls}`}
                              />
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSaveMaterialEdit(m)}
                                  className="app-btn-sm bg-sky-600 hover:bg-sky-500 text-white"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingMatId(null)}
                                  className={`app-btn-sm border ${
                                    isDark
                                      ? 'bg-slate-800 border-slate-700 text-slate-200'
                                      : 'bg-white border-slate-300 text-slate-700'
                                  }`}
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={m.id} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                            <td className="py-2.5 px-3 font-bold whitespace-nowrap">{m.name}</td>
                            <td className="py-2.5 px-3 font-mono whitespace-nowrap">{m.code}</td>
                            <td className={`py-2.5 px-3 ${mutedCls}`}>{m.description || '-'}</td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {canManageMaterials ? (
                                <div className="inline-flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMatId(m.id);
                                      setEditMatName(m.name);
                                      setEditMatCode(m.code);
                                      setEditMatDesc(m.description || '');
                                    }}
                                    className={`app-btn-sm border ${
                                      isDark
                                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                    }`}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMaterial(m)}
                                    className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-[11px] italic ${mutedCls}`}>View only</span>
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {canManageMaterials && (
                <form
                  onSubmit={handleAddMaterial}
                  className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-2"
                >
                  <input
                    type="text"
                    required
                    value={newMatName}
                    onChange={(e) => setNewMatName(e.target.value)}
                    placeholder="Material Name (e.g. FURNACE OIL)"
                    className={`px-3 py-2 text-xs rounded-xl border uppercase ${inputCls}`}
                  />
                  <input
                    type="text"
                    value={newMatCode}
                    onChange={(e) => setNewMatCode(e.target.value)}
                    placeholder="Code"
                    className={`px-3 py-2 text-xs rounded-xl border uppercase font-mono ${inputCls}`}
                  />
                  <input
                    type="text"
                    value={newMatDesc}
                    onChange={(e) => setNewMatDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className={`px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="app-btn bg-sky-600 hover:bg-sky-500 text-white"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Add Material</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: 2-STEP TRANSACTION MODAL (INWARD / OUTWARD CREATE & EDIT) */}
      {txModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-2xl border shadow-2xl w-full max-w-2xl overflow-hidden ${cardCls}`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${tdBorderCls}`}>
              <div>
                <h3 className="text-base font-extrabold">
                  {txEditId ? 'Edit' : 'Add'} Material {txType === 'INWARD' ? 'Inward' : 'Outward'} Entry
                </h3>
                <p className={`text-xs ${mutedCls}`}>
                  Enter quantity in KG · Automatically converted to MT (1 MT = 1,000 KG)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTxModalOpen(false)}
                className={`app-btn-sm border ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Close</span>
              </button>
            </div>

            <form onSubmit={handleTxSubmit}>
              <div className="p-5 space-y-4">
                {txError && (
                  <div className="rounded-xl bg-red-500/15 border border-red-500/40 text-red-600 px-3.5 py-2.5 text-xs font-semibold">
                    {txError}
                  </div>
                )}

                {!txConfirmStep ? (
                  <div className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1">Transaction Date & Time *</label>
                        <input
                          type="datetime-local"
                          required
                          value={txDate}
                          onChange={(e) => setTxDate(e.target.value)}
                          className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Tank Selection *</label>
                        <select
                          required
                          value={txTankId}
                          onChange={(e) => setTxTankId(Number(e.target.value))}
                          className={`w-full px-3 py-2 text-xs rounded-xl border cursor-pointer ${inputCls}`}
                        >
                          {store.tanks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} — {t.productLabel} ({fmtMT(t.currentStockMt)} / {fmtMT(t.totalCapacityMt)} MT)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {selectedTxTank && (
                      <div className={`rounded-xl border px-3.5 py-2.5 text-xs ${altBoxCls}`}>
                        Current Stock: <strong>{fmtMT(selectedTxTank.currentStockMt)} MT</strong> (
                        {fmtKG(selectedTxTank.currentStockKg)} KG) · Empty Capacity:{' '}
                        <strong>{fmtMT(selectedTxTank.emptyCapacityMt)} MT</strong> · {txMaterial}:{' '}
                        <strong>
                          {fmtMT(
                            (selectedTxTank.materials.find((m) => m.materialName === txMaterial)?.balanceKg || 0) / 1000
                          )}{' '}
                          MT
                        </strong>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1">Material Name *</label>
                        <select
                          required
                          value={txMaterial}
                          onChange={(e) => setTxMaterial(e.target.value)}
                          className={`w-full px-3 py-2 text-xs rounded-xl border cursor-pointer ${inputCls}`}
                        >
                          {store.materials.map((m) => (
                            <option key={m.id} value={m.name}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="flex justify-between text-xs font-bold mb-1">
                          <span>Quantity (KG) *</span>
                          <span className="font-mono tabular-nums text-sky-600">
                            = {fmtMT((Number(txQtyKg) || 0) / 1000)} MT
                          </span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          required
                          value={txQtyKg}
                          onChange={(e) => setTxQtyKg(e.target.value)}
                          placeholder="e.g. 100000"
                          className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${inputCls}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1">Document Number</label>
                        <input
                          type="text"
                          value={txDocumentNumber}
                          onChange={(e) => setTxDocumentNumber(e.target.value)}
                          placeholder="e.g. DOC-2026-001 / Gate Pass"
                          className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${inputCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Reference Number *</label>
                        <input
                          type="text"
                          required
                          value={txRef}
                          onChange={(e) => setTxRef(e.target.value)}
                          placeholder="PO / DO No."
                          className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1">
                          {txType === 'INWARD' ? 'Supplier Name *' : 'Customer / Department *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={txParty}
                          onChange={(e) => setTxParty(e.target.value)}
                          placeholder="Vendor / Customer"
                          className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Vehicle Number</label>
                        <input
                          type="text"
                          value={txVehicle}
                          onChange={(e) => setTxVehicle(e.target.value)}
                          placeholder="MH-12-TK-4401"
                          className={`w-full px-3 py-2 text-xs rounded-xl border uppercase font-mono ${inputCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Driver Name</label>
                        <input
                          type="text"
                          value={txDriverName}
                          onChange={(e) => setTxDriverName(e.target.value)}
                          placeholder="Driver full name"
                          className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold mb-1">Remarks</label>
                      <textarea
                        rows={2}
                        value={txRemarks}
                        onChange={(e) => setTxRemarks(e.target.value)}
                        placeholder="Optional weighbridge notes..."
                        className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-xl border p-4 space-y-3 ${altBoxCls}`}>
                    <div>
                      <strong className="text-sm font-extrabold">Confirm Transaction</strong>
                      <p className={`text-xs mt-0.5 ${mutedCls}`}>
                        Please review details and projected tank stock before saving.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className={mutedCls}>Tank:</span>
                        <div className="font-bold text-sm">{selectedTxTank?.name}</div>
                      </div>
                      <div>
                        <span className={mutedCls}>Material:</span>
                        <div className="font-bold text-sm">{txMaterial}</div>
                      </div>
                      <div>
                        <span className={mutedCls}>Quantity:</span>
                        <div className="font-bold font-mono tabular-nums text-sm">
                          {fmtKG(Number(txQtyKg))} KG ({fmtMT(Number(txQtyKg) / 1000)} MT)
                        </div>
                      </div>
                      <div>
                        <span className={mutedCls}>Projected Level:</span>
                        <div className="font-bold font-mono tabular-nums text-sm text-[#0A6ED1]">
                          {fmtMT(txProjectedPreview?.currentStockMt || 0)} MT (
                          {fmtPct(txProjectedPreview?.filledPercentage || 0)})
                        </div>
                      </div>
                      <div>
                        <span className={mutedCls}>Document Number:</span>
                        <div className="font-bold font-mono">{txDocumentNumber.trim() || '—'}</div>
                      </div>
                      <div>
                        <span className={mutedCls}>Driver Name:</span>
                        <div className="font-bold">{txDriverName.trim() || '—'}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className={`px-5 py-3.5 border-t flex justify-end gap-2 ${tdBorderCls}`}>
                {txConfirmStep && (
                  <button
                    type="button"
                    onClick={() => setTxConfirmStep(false)}
                    className={`app-btn border ${
                      isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    Back to Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTxModalOpen(false)}
                  className={`app-btn border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`app-btn text-white ${
                    txType === 'INWARD' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {txConfirmStep ? `Confirm & Save ${txType}` : 'Review & Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD / EDIT TANK MODAL */}
      {tankModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-2xl border shadow-2xl w-full max-w-lg overflow-hidden ${cardCls}`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${tdBorderCls}`}>
              <div>
                <h3 className="text-base font-extrabold">{tankEditId ? `Edit ${tankName}` : 'Add New Tank'}</h3>
                <p className={`text-xs ${mutedCls}`}>
                  Configure tank capacity in KG (converted to MT) and depth in meters
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTankModalOpen(false)}
                className={`app-btn-sm border ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Close</span>
              </button>
            </div>

            <form onSubmit={handleTankSubmit}>
              <div className="p-5 space-y-3.5">
                {tankError && (
                  <div className="rounded-xl bg-red-500/15 border border-red-500/40 text-red-600 px-3.5 py-2.5 text-xs font-semibold">
                    {tankError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold mb-1">Tank Name *</label>
                  <input
                    type="text"
                    required
                    value={tankName}
                    onChange={(e) => setTankName(e.target.value)}
                    placeholder="e.g. Tank 15"
                    className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="flex justify-between text-xs font-bold mb-1">
                      <span>Total Capacity (KG) *</span>
                      <span className="font-mono tabular-nums text-sky-600">
                        = {fmtMT((Number(tankCapKg) || 0) / 1000)} MT
                      </span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      required
                      value={tankCapKg}
                      onChange={(e) => setTankCapKg(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${inputCls}`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold mb-1">Tank Depth (Meters) *</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      required
                      value={tankDepthM}
                      onChange={(e) => setTankDepthM(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${inputCls}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Location / Bay</label>
                  <input
                    type="text"
                    value={tankLocation}
                    onChange={(e) => setTankLocation(e.target.value)}
                    className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Technical Notes</label>
                  <textarea
                    rows={2}
                    value={tankNotes}
                    onChange={(e) => setTankNotes(e.target.value)}
                    placeholder="Optional tank calibration remarks..."
                    className={`w-full px-3 py-2 text-xs rounded-xl border ${inputCls}`}
                  />
                </div>
              </div>

              <div className={`px-5 py-3.5 border-t flex justify-end gap-2 ${tdBorderCls}`}>
                <button
                  type="button"
                  onClick={() => setTankModalOpen(false)}
                  className={`app-btn border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="app-btn bg-sky-600 hover:bg-sky-500 text-white"
                >
                  Save Tank
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: TANK DETAIL MODAL */}
      {detailTank && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-2xl border shadow-2xl w-full max-w-xl overflow-hidden ${cardCls}`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${tdBorderCls}`}>
              <div>
                <h3 className="text-base font-extrabold">
                  {detailTank.name} — {detailTank.productLabel}
                </h3>
                <p className={`text-xs ${mutedCls}`}>{detailTank.location} · Specifications</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => openPrintOrView({ kind: 'tank-detail', tank: detailTank }, false)}
                  className={`app-btn-sm border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-[#0A6ED1]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>View A4</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDirectDownloadPdf({ kind: 'tank-detail', tank: detailTank })}
                  className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => openPrintOrView({ kind: 'tank-detail', tank: detailTank }, true)}
                  className={`app-btn-sm border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTankId(null)}
                  className={`app-btn-sm border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Close</span>
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Total Capacity</div>
                  <div className="font-bold font-mono tabular-nums text-sm mt-0.5">
                    {fmtMT(detailTank.totalCapacityMt)} MT ({fmtKG(detailTank.totalCapacityKg)} KG)
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Tank Depth</div>
                  <div className="font-bold font-mono tabular-nums text-sm mt-0.5">
                    {fmtM(detailTank.depthMeters)} Meters
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Current Stock</div>
                  <div className="font-bold font-mono tabular-nums text-sm text-sky-600 mt-0.5">
                    {fmtMT(detailTank.currentStockMt)} MT ({fmtKG(detailTank.currentStockKg)} KG)
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Empty Capacity</div>
                  <div className="font-bold font-mono tabular-nums text-sm mt-0.5">
                    {fmtMT(detailTank.emptyCapacityMt)} MT ({fmtKG(detailTank.emptyCapacityKg)} KG)
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Filled / Empty (%)</div>
                  <div className="font-bold font-mono tabular-nums text-sm mt-0.5">
                    {fmtPct(detailTank.filledPercentage)} / {fmtPct(detailTank.emptyPercentage)}
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${altBoxCls}`}>
                  <div className={`text-[11px] font-semibold ${mutedCls}`}>Filled / Empty (m)</div>
                  <div className="font-bold font-mono tabular-nums text-sm mt-0.5">
                    {fmtM(detailTank.filledMeters)} m / {fmtM(detailTank.emptyMeters)} m
                  </div>
                </div>
              </div>

              {detailTank.materials.length > 0 && (
                <div className={`rounded-xl border overflow-hidden ${tdBorderCls}`}>
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className={`border-b ${thCls}`}>
                        <th className="py-2 px-3 font-semibold">Material</th>
                        <th className="py-2 px-3 font-semibold text-right">Inward (MT)</th>
                        <th className="py-2 px-3 font-semibold text-right">Outward (MT)</th>
                        <th className="py-2 px-3 font-semibold text-right">Balance (MT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailTank.materials.map((m) => (
                        <tr key={m.materialName} className={`border-b last:border-b-0 ${tdBorderCls}`}>
                          <td className="py-2 px-3 font-bold">{m.materialName}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-600">
                            {fmtMT(m.inwardKg / 1000)} MT
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-red-600">
                            {fmtMT(m.outwardKg / 1000)} MT
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-sky-600">
                            {fmtMT(m.balanceMt)} MT
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={`text-xs ${mutedCls}`}>
                Last Transaction: {fmtDate(detailTank.lastTransactionAt)}
                {detailTank.notes ? ` · ${detailTank.notes}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: INLINE CONFIRMATION DIALOG (REPLACES window.confirm) */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] bg-slate-950/65 flex items-center justify-center p-4">
          <div className={`rounded-2xl border shadow-2xl w-full max-w-md overflow-hidden ${cardCls}`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between ${tdBorderCls}`}>
              <h3 className="text-sm font-extrabold">{confirmDialog.title}</h3>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className={mutedCls}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 text-xs leading-relaxed">{confirmDialog.message}</div>
            <div className={`px-5 py-3.5 border-t flex justify-end gap-2 ${tdBorderCls}`}>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className={`app-btn-sm border ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  } catch (err: any) {
                    showToast('error', err?.message || 'Operation failed.');
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="app-btn-sm bg-red-600 hover:bg-red-500 text-white"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: A4 VIEW / PRINT / PDF PREVIEW PORTAL */}
      {printPreview && (
        <LiquidPrintPreviewModal
          target={printPreview.target}
          store={store}
          operatorName={currentUser.fullName}
          companyLogoUrl={companyLogoUrl}
          autoPrint={printPreview.autoPrint}
          onClose={() => setPrintPreview(null)}
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
