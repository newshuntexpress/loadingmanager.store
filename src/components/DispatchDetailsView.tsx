import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import { CompanySettings, ExFactoryEntry, TicketRecord, TruckLoadingType } from '../types';
import { ApiClient, withBackgroundPoll } from '../services/api';
import { formatDisplayDate, getTodayDateString } from '../services/storage';
import { drawPdfLogo } from '../utils/logo';
import { resolveLoadingType } from '../utils/loadingType';
import {
  ClipboardList,
  Calendar,
  Search,
  Filter,
  Download,
  Copy,
  Check,
  FileSpreadsheet,
  RefreshCw,
  Layers,
  Package,
  Boxes,
  X,
  Truck,
  MapPin,
  Globe,
} from 'lucide-react';

interface DispatchDetailsViewProps {
  tickets: TicketRecord[];
  settings: CompanySettings;
  selectedDate?: string;
  canAccessExFactory?: boolean;
  sectionMode?: 'summary' | 'register';
  onRefreshTickets?: () => Promise<void> | void;
}

interface DispatchMaterialRow {
  rowKey: string;
  date: string;
  source: 'Main Gate' | 'Ex-Factory';
  refNumber: string;
  gateLabel: string;
  delNoteNumber: string;
  truckNumber: string;
  destination: string;
  loadingType: TruckLoadingType;
  status: string;
  materialDescription: string;
  materialKey: string;
  pack: string;
  palletRatio: number;
  qty: number;
  pallets: number;
  looseRolls: number;
  remarks: string;
  createdAt: number;
}

interface MaterialSummaryRow {
  materialKey: string;
  materialDescription: string;
  packs: string[];
  palletRatio: number;
  slipPalletRatio: number;
  lineCount: number;
  slipCount: number;
  totalQty: number;
  totalPallets: number;
  totalLooseRolls: number;
}

function extractNumeric(val?: string | number | null): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const match = String(val).replace(/,/g, '').match(/(-?\d+(\.\d+)?)/);
  if (!match) return 0;
  const parsed = parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function divideQtyByRatio(totalQty: number, ratio: number): { pallets: number; looseRolls: number } {
  if (totalQty <= 0 || ratio <= 0) {
    return { pallets: 0, looseRolls: 0 };
  }
  let pallets = Math.floor((totalQty + 1e-9) / ratio);
  let looseRolls = Math.max(0, Math.round((totalQty - pallets * ratio) * 100) / 100);
  if (looseRolls >= ratio) {
    pallets += 1;
    looseRolls = Math.round((looseRolls - ratio) * 100) / 100;
  }
  return { pallets, looseRolls };
}

function formatNum(val: number): string {
  if (!Number.isFinite(val)) return '0';
  const rounded = Math.round(val * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toLocaleString('en-US') : rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

export const DispatchDetailsView: React.FC<DispatchDetailsViewProps> = ({
  tickets,
  settings,
  selectedDate,
  canAccessExFactory = false,
  sectionMode = 'summary',
  onRefreshTickets,
}) => {
  const isRegisterMode = sectionMode === 'register';
  const todayDate = getTodayDateString();
  const initialDate = selectedDate || todayDate;

  const [exFactoryEntries, setExFactoryEntries] = useState<ExFactoryEntry[]>([]);
  const [loadingExFactory, setLoadingExFactory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [dateFilterMode, setDateFilterMode] = useState<'ALL' | 'TODAY' | 'RANGE'>('TODAY');
  const [fromDate, setFromDate] = useState<string>(initialDate);
  const [toDate, setToDate] = useState<string>(initialDate);
  const [selectedMaterial, setSelectedMaterial] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'MAIN' | 'EX_FACTORY'>('ALL');
  const [loadingTypeFilter, setLoadingTypeFilter] = useState<'ALL' | 'local' | 'export'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ratioOverrides, setRatioOverrides] = useState<Record<string, number>>({});

  // Action feedback
  const [copiedExcel, setCopiedExcel] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const loadExFactory = useCallback(
    async (isBackgroundPoll = false) => {
      if (!canAccessExFactory) {
        setExFactoryEntries([]);
        return;
      }
      if (!isBackgroundPoll) {
        setLoadingExFactory(true);
      }
      try {
        const list = isBackgroundPoll
          ? await withBackgroundPoll(() => ApiClient.getExFactoryEntries())
          : await ApiClient.getExFactoryEntries();
        setExFactoryEntries(list);
      } catch {
        // Non-fatal if Ex-Factory endpoint is unavailable
      } finally {
        if (!isBackgroundPoll) {
          setLoadingExFactory(false);
        }
      }
    },
    [canAccessExFactory]
  );

  useEffect(() => {
    loadExFactory(false);
    if (!canAccessExFactory) return;
    const pollInterval = setInterval(() => {
      loadExFactory(true);
    }, 10000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadExFactory(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadExFactory, canAccessExFactory]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        onRefreshTickets ? Promise.resolve(onRefreshTickets()) : Promise.resolve(),
        loadExFactory(),
      ]);
      showToast('Dispatch material sheet refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  // Flatten all material rows from Main Gate Loading Slips & Ex-Factory Loading Slips
  const allMaterialRows = useMemo<DispatchMaterialRow[]>(() => {
    const rows: DispatchMaterialRow[] = [];

    for (const t of tickets) {
      const slip = t.loadingSlip;
      if (!slip || !Array.isArray(slip.items) || slip.items.length === 0) continue;

      slip.items.forEach((item, idx) => {
        const desc = (item.description || '').trim();
        const qtyVal = extractNumeric(item.qty);
        const palletsVal = extractNumeric(item.pallets);
        const looseVal = extractNumeric(item.looseRolls);
        const hasAnyContent =
          desc.length > 0 ||
          (item.qty || '').trim().length > 0 ||
          (item.pallets || '').trim().length > 0 ||
          (item.looseRolls || '').trim().length > 0;

        if (!hasAnyContent) return;

        const cleanDesc = desc || 'UNSPECIFIED MATERIAL';
        const rowRatio = extractNumeric(item.palletRatio) || 23;
        rows.push({
          rowKey: `main_${t.id}_${idx}`,
          date: t.date,
          source: 'Main Gate',
          refNumber: t.ticketNumber,
          gateLabel: t.gateNumber || '-',
          delNoteNumber: (slip.delNoteNumber || t.delNoteNumber || '-').trim().toUpperCase(),
          truckNumber: (t.truckNumber || '-').trim().toUpperCase(),
          destination: (slip.placeName || t.destinationPlace || '-').trim(),
          loadingType: resolveLoadingType({
            loadingType: t.loadingType,
            destinationPlace: t.destinationPlace,
            placeName: slip.placeName,
            remarks: t.remarks,
          }),
          status: t.status,
          materialDescription: cleanDesc,
          materialKey: cleanDesc.toUpperCase(),
          pack: (item.pack || '-').trim() || '-',
          palletRatio: rowRatio,
          qty: qtyVal,
          pallets: palletsVal,
          looseRolls: looseVal,
          remarks: (item.remarks || '').trim(),
          createdAt: t.createdAt || 0,
        });
      });
    }

    if (canAccessExFactory) {
      for (const entry of exFactoryEntries) {
        const slip = entry.loadingSlip;
        if (!slip || !Array.isArray(slip.items) || slip.items.length === 0) continue;

        slip.items.forEach((item, idx) => {
          const desc = (item.description || '').trim();
          const qtyVal = extractNumeric(item.qty);
          const palletsVal = extractNumeric(item.pallets);
          const looseVal = extractNumeric(item.looseRolls);
          const hasAnyContent =
            desc.length > 0 ||
            (item.qty || '').trim().length > 0 ||
            (item.pallets || '').trim().length > 0 ||
            (item.looseRolls || '').trim().length > 0;

          if (!hasAnyContent) return;

          const cleanDesc = desc || 'UNSPECIFIED MATERIAL';
          const rowRatio = extractNumeric(item.palletRatio) || 23;
          rows.push({
            rowKey: `exf_${entry.id}_${idx}`,
            date: entry.entryDate,
            source: 'Ex-Factory',
            refNumber: 'EX-FACTORY',
            gateLabel: 'EX-FACTORY',
            delNoteNumber: (slip.delNoteNumber || entry.delNoteNumber || '-').trim().toUpperCase(),
            truckNumber: (entry.truckNumber || '-').trim().toUpperCase(),
            destination: (slip.placeName || entry.customerName || 'EX-FACTORY').trim(),
            loadingType: resolveLoadingType({
              loadingType: entry.loadingType,
              destinationPlace: slip.placeName,
              placeName: entry.customerName,
            }),
            status: 'ex_factory',
            materialDescription: cleanDesc,
            materialKey: cleanDesc.toUpperCase(),
            pack: (item.pack || '-').trim() || '-',
            palletRatio: rowRatio,
            qty: qtyVal,
            pallets: palletsVal,
            looseRolls: looseVal,
            remarks: (item.remarks || '').trim(),
            createdAt: entry.createdAt || 0,
          });
        });
      }
    }

    return rows.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt - a.createdAt;
    });
  }, [tickets, exFactoryEntries, canAccessExFactory]);

  // Available unique materials sorted alphabetically (for dropdown)
  const materialOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allMaterialRows) {
      if (!map.has(r.materialKey)) {
        map.set(r.materialKey, r.materialDescription);
      }
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allMaterialRows]);

  // Step 1 filter: Date + Source + Search (used to compute available date rows)
  const dateAndSourceFilteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allMaterialRows.filter((row) => {
      if (dateFilterMode === 'TODAY' && row.date !== todayDate) {
        return false;
      }
      if (dateFilterMode === 'RANGE') {
        if (fromDate && row.date < fromDate) return false;
        if (toDate && row.date > toDate) return false;
      }
      if (sourceFilter === 'MAIN' && row.source !== 'Main Gate') return false;
      if (sourceFilter === 'EX_FACTORY' && row.source !== 'Ex-Factory') return false;
      if (loadingTypeFilter !== 'ALL' && row.loadingType !== loadingTypeFilter) return false;

      if (q) {
        const hay = [
          row.materialDescription,
          row.delNoteNumber,
          row.truckNumber,
          row.destination,
          row.loadingType,
          row.refNumber,
          row.gateLabel,
          row.pack,
          row.remarks,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [allMaterialRows, dateFilterMode, todayDate, fromDate, toDate, sourceFilter, loadingTypeFilter, searchQuery]);

  // Step 2 filter: + Material dropdown filter
  const filteredRows = useMemo(() => {
    if (selectedMaterial === 'ALL') return dateAndSourceFilteredRows;
    return dateAndSourceFilteredRows.filter((r) => r.materialKey === selectedMaterial);
  }, [dateAndSourceFilteredRows, selectedMaterial]);

  // Material-wise aggregated totals:
  // Sums Total Qty per material, then divides by its Pallet Ratio (default 23) to calculate Total Pallets & Loose Rolls.
  const materialSummary = useMemo<MaterialSummaryRow[]>(() => {
    const map = new Map<
      string,
      {
        materialKey: string;
        materialDescription: string;
        packs: Set<string>;
        slips: Set<string>;
        ratioCounts: Map<number, number>;
        lineCount: number;
        totalQty: number;
        rawPalletsSum: number;
        rawLooseRollsSum: number;
      }
    >();

    for (const r of filteredRows) {
      let bucket = map.get(r.materialKey);
      if (!bucket) {
        bucket = {
          materialKey: r.materialKey,
          materialDescription: r.materialDescription,
          packs: new Set<string>(),
          slips: new Set<string>(),
          ratioCounts: new Map<number, number>(),
          lineCount: 0,
          totalQty: 0,
          rawPalletsSum: 0,
          rawLooseRollsSum: 0,
        };
        map.set(r.materialKey, bucket);
      }
      if (r.pack && r.pack !== '-') bucket.packs.add(r.pack);
      bucket.slips.add(`${r.source}_${r.delNoteNumber}_${r.truckNumber}_${r.date}`);
      const rRatio = r.palletRatio > 0 ? r.palletRatio : 23;
      bucket.ratioCounts.set(rRatio, (bucket.ratioCounts.get(rRatio) || 0) + 1);
      bucket.lineCount += 1;
      bucket.totalQty += r.qty;
      bucket.rawPalletsSum += r.pallets;
      bucket.rawLooseRollsSum += r.looseRolls;
    }

    return Array.from(map.values())
      .map((b) => {
        // Pick the most frequent positive ratio used for this material in loading slips (default 23)
        let dominantRatio = 23;
        let maxCount = -1;
        b.ratioCounts.forEach((cnt, ratio) => {
          if (cnt > maxCount) {
            maxCount = cnt;
            dominantRatio = ratio;
          }
        });

        const overrideRatio = ratioOverrides[b.materialKey];
        const effectiveRatio = overrideRatio && overrideRatio > 0 ? overrideRatio : dominantRatio;

        let calcPallets = b.rawPalletsSum;
        let calcLooseRolls = b.rawLooseRollsSum;
        if (b.totalQty > 0 && effectiveRatio > 0) {
          const divided = divideQtyByRatio(b.totalQty, effectiveRatio);
          calcPallets = divided.pallets;
          calcLooseRolls = divided.looseRolls;
        }

        return {
          materialKey: b.materialKey,
          materialDescription: b.materialDescription,
          packs: Array.from(b.packs),
          palletRatio: effectiveRatio,
          slipPalletRatio: dominantRatio,
          lineCount: b.lineCount,
          slipCount: b.slips.size,
          totalQty: b.totalQty,
          totalPallets: calcPallets,
          totalLooseRolls: calcLooseRolls,
        };
      })
      .sort((a, b) => {
        if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
        return a.materialDescription.localeCompare(b.materialDescription);
      });
  }, [filteredRows, ratioOverrides]);

  // Grand totals derived from materialSummary (so Pallets & Loose Rolls match Total Qty ÷ Ratio)
  const grandTotals = useMemo(() => {
    const slipSet = new Map<string, TruckLoadingType>();
    for (const r of filteredRows) {
      if (r.status === 'cancelled') continue;
      const key = `${r.source}_${r.delNoteNumber}_${r.truckNumber}_${r.date}`;
      if (!slipSet.has(key)) {
        slipSet.set(key, r.loadingType);
      }
    }

    let localTrucks = 0;
    let exportTrucks = 0;
    for (const t of slipSet.values()) {
      if (t === 'export') exportTrucks += 1;
      else localTrucks += 1;
    }

    let totalQty = 0;
    let totalPallets = 0;
    let totalLooseRolls = 0;
    for (const m of materialSummary) {
      totalQty += m.totalQty;
      totalPallets += m.totalPallets;
      totalLooseRolls += m.totalLooseRolls;
    }

    return {
      materialCount: materialSummary.length,
      lineCount: filteredRows.length,
      slipCount: slipSet.size,
      localTrucks,
      exportTrucks,
      totalQty,
      totalPallets,
      totalLooseRolls,
    };
  }, [filteredRows, materialSummary]);

  // Raw sum across individual slip lines for Detailed Register footer
  const detailLineTotals = useMemo(() => {
    let totalQty = 0;
    let totalPallets = 0;
    let totalLooseRolls = 0;
    for (const r of filteredRows) {
      totalQty += r.qty;
      totalPallets += r.pallets;
      totalLooseRolls += r.looseRolls;
    }
    return { totalQty, totalPallets, totalLooseRolls };
  }, [filteredRows]);

  const activeFilterDateLabel = useMemo(() => {
    if (dateFilterMode === 'TODAY') return `Today (${formatDisplayDate(todayDate)})`;
    if (dateFilterMode === 'ALL') return 'All Dates';
    const f = fromDate ? formatDisplayDate(fromDate) : 'Start';
    const t = toDate ? formatDisplayDate(toDate) : 'End';
    return `${f} to ${t}`;
  }, [dateFilterMode, todayDate, fromDate, toDate]);

  const handleCopySummaryForExcel = async () => {
    if (isRegisterMode) {
      if (filteredRows.length === 0) {
        showToast('No loading slip material rows match current filters.');
        return;
      }

      const header = [
        'Sr.No',
        'Date',
        'Source / Gate',
        'Del Note No.',
        'Truck No.',
        'Destination / Customer',
        'Material Description',
        'Pack',
        'Qty',
        'Pallets',
        'Loose Rolls',
        'Remarks / Batch',
      ].join('\t');

      const lines = filteredRows.map((r, idx) =>
        [
          idx + 1,
          formatDisplayDate(r.date),
          r.source === 'Ex-Factory' ? 'EX-FACTORY' : r.gateLabel,
          r.delNoteNumber,
          r.truckNumber,
          r.destination,
          r.materialDescription,
          r.pack,
          formatNum(r.qty),
          formatNum(r.pallets),
          formatNum(r.looseRolls),
          r.remarks || '',
        ]
          .map((v) => String(v).replace(/[\t\r\n]+/g, ' '))
          .join('\t')
      );

      const totalLine = [
        'TOTAL',
        '',
        '',
        '',
        '',
        '',
        `${filteredRows.length} Row(s)`,
        '',
        formatNum(detailLineTotals.totalQty),
        formatNum(detailLineTotals.totalPallets),
        formatNum(detailLineTotals.totalLooseRolls),
        '',
      ].join('\t');

      const ok = await copyTextReliable([header, ...lines, totalLine].join('\n'));
      if (ok) {
        setCopiedExcel(true);
        setTimeout(() => setCopiedExcel(false), 2500);
        showToast(`Copied ${filteredRows.length} register row(s) for Excel.`);
      } else {
        showToast('Clipboard copy failed — check browser permissions.');
      }
      return;
    }

    if (materialSummary.length === 0) {
      showToast('No material dispatch records match current filters.');
      return;
    }

    const header = [
      'Sr.No',
      'Material Description',
      'Pack Type(s)',
      'Total Qty',
      'Ratio (/Pallet)',
      'Total Pallets',
      'Total Loose Rolls',
    ].join('\t');

    const lines = materialSummary.map((m, idx) =>
      [
        idx + 1,
        m.materialDescription,
        m.packs.join(' / ') || '-',
        formatNum(m.totalQty),
        m.palletRatio,
        formatNum(m.totalPallets),
        formatNum(m.totalLooseRolls),
      ]
        .map((v) => String(v).replace(/[\t\r\n]+/g, ' '))
        .join('\t')
    );

    const totalLine = [
      'GRAND TOTAL',
      `${materialSummary.length} Material(s)`,
      '',
      formatNum(grandTotals.totalQty),
      '',
      formatNum(grandTotals.totalPallets),
      formatNum(grandTotals.totalLooseRolls),
    ].join('\t');

    const ok = await copyTextReliable([header, ...lines, totalLine].join('\n'));
    if (ok) {
      setCopiedExcel(true);
      setTimeout(() => setCopiedExcel(false), 2500);
      showToast(`Copied ${materialSummary.length} material summary row(s) for Excel.`);
    } else {
      showToast('Clipboard copy failed — check browser permissions.');
    }
  };

  const handleExportCsv = () => {
    if (filteredRows.length === 0) {
      showToast('No dispatch material rows to export.');
      return;
    }

    const esc = (v: string | number) => `"${String(v ?? '').replaceAll('"', '""')}"`;

    if (isRegisterMode) {
      const detailHeader = [
        'DETAILED LOADING SLIP MATERIAL REGISTER',
        `Filter: ${activeFilterDateLabel}`,
        selectedMaterial === 'ALL' ? 'All Materials' : `Material: ${selectedMaterial}`,
      ].map(esc).join(',');

      const detailCols = [
        'Sr.No',
        'Date',
        'Source',
        'Ref / Ticket',
        'Gate',
        'Del Note No.',
        'Truck No.',
        'Destination / Customer',
        'Material Description',
        'Pack',
        'Qty',
        'Pallets',
        'Loose Rolls',
        'Remarks / Batch',
      ]
        .map(esc)
        .join(',');

      const detailLines = filteredRows.map((r, i) =>
        [
          i + 1,
          formatDisplayDate(r.date),
          r.source,
          r.refNumber,
          r.gateLabel,
          r.delNoteNumber,
          r.truckNumber,
          r.destination,
          r.materialDescription,
          r.pack,
          r.qty,
          r.pallets,
          r.looseRolls,
          r.remarks,
        ]
          .map(esc)
          .join(',')
      );

      const detailTotal = [
        'TOTAL',
        '',
        '',
        '',
        '',
        '',
        '',
        `${filteredRows.length} Row(s)`,
        '',
        '',
        detailLineTotals.totalQty,
        detailLineTotals.totalPallets,
        detailLineTotals.totalLooseRolls,
        '',
      ]
        .map(esc)
        .join(',');

      const csvContent = [detailHeader, detailCols, ...detailLines, detailTotal].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Material_Register_${todayDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Detailed Loading Slip Material Register CSV downloaded.');
      return;
    }

    const summaryHeader = [
      'MATERIAL-WISE DISPATCH SUMMARY',
      `Filter: ${activeFilterDateLabel}`,
      selectedMaterial === 'ALL' ? 'All Materials' : `Material: ${selectedMaterial}`,
    ].map(esc).join(',');

    const summaryCols = [
      'Sr.No',
      'Material Description',
      'Pack Type(s)',
      'Total Qty',
      'Ratio (/Pallet)',
      'Total Pallets',
      'Total Loose Rolls',
    ].map(esc).join(',');

    const summaryLines = materialSummary.map((m, i) =>
      [
        i + 1,
        m.materialDescription,
        m.packs.join(' / ') || '-',
        m.totalQty,
        m.palletRatio,
        m.totalPallets,
        m.totalLooseRolls,
      ]
        .map(esc)
        .join(',')
    );

    const summaryTotal = [
      'GRAND TOTAL',
      `${materialSummary.length} Material(s)`,
      '',
      grandTotals.totalQty,
      '',
      grandTotals.totalPallets,
      grandTotals.totalLooseRolls,
    ]
      .map(esc)
      .join(',');

    const csvContent = [summaryHeader, summaryCols, ...summaryLines, summaryTotal].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Dispatch_Details_${todayDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dispatch Details CSV downloaded.');
  };

  const handleDownloadPdf = () => {
    if (filteredRows.length === 0) {
      showToast('No dispatch material rows to export as PDF.');
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;
    const margin = 10;

    const drawBanner = (title: string, subtitle: string) => {
      // Light SAP Fiori low-ink header banner (saves printer ink/toner)
      doc.setFillColor(244, 248, 252);
      doc.setDrawColor(198, 212, 227);
      doc.rect(margin, 8, pageW - margin * 2, 16, 'FD');
      doc.setFillColor(10, 110, 209);
      doc.rect(margin, 23.2, pageW - margin * 2, 1, 'F');
      const hasLogo = drawPdfLogo(doc, settings.logoDataUrl, margin + 3, 9.5, 13, 13, false);
      const titleX = hasLogo ? margin + 19 : margin + 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(10, 110, 209);
      doc.text(title, titleX, 15.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(53, 74, 95);
      doc.text(
        `${settings.companyName}  |  ${subtitle}  |  Date Filter: ${activeFilterDateLabel}`,
        titleX,
        20.8
      );
      return 29;
    };

    if (isRegisterMode) {
      let y = drawBanner(
        'DETAILED LOADING SLIP MATERIAL REGISTER',
        `${filteredRows.length} Line Item(s)`
      );
      const detCols = [
        { label: 'Sr.', w: 9 },
        { label: 'Date', w: 21 },
        { label: 'Source', w: 20 },
        { label: 'Del Note', w: 24 },
        { label: 'Truck No.', w: 24 },
        { label: 'Destination', w: 36 },
        { label: 'Material Description', w: 69 },
        { label: 'Pack', w: 16 },
        { label: 'Qty', w: 18 },
        { label: 'Pallets', w: 18 },
        { label: 'Loose', w: 22 },
      ]; // 277mm

      const drawDetailHead = (startY: number) => {
        doc.setFillColor(239, 244, 249);
        doc.setDrawColor(209, 219, 229);
        doc.rect(margin, startY, 277, 7.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(53, 74, 95);
        let x = margin;
        for (const c of detCols) {
          doc.text(c.label, x + 1.5, startY + 5);
          x += c.w;
        }
        return startY + 7.5;
      };

      y = drawDetailHead(y);
      filteredRows.forEach((r, idx) => {
        if (y > pageH - 20) {
          doc.addPage();
          y = drawBanner(
            'DETAILED LOADING SLIP MATERIAL REGISTER',
            'Continued'
          );
          y = drawDetailHead(y);
        }
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, 277, 6.5, 'F');
        }
        doc.setDrawColor(227, 234, 242);
        doc.line(margin, y + 6.5, margin + 277, y + 6.5);
        const vals = [
          String(idx + 1),
          formatDisplayDate(r.date),
          r.source,
          r.delNoteNumber,
          r.truckNumber,
          r.destination,
          r.materialDescription,
          r.pack,
          formatNum(r.qty),
          formatNum(r.pallets),
          formatNum(r.looseRolls),
        ];
        let x = margin;
        vals.forEach((v, i) => {
          doc.setFont('helvetica', i === 3 || i === 6 || i >= 8 ? 'bold' : 'normal');
          doc.setFontSize(7);
          doc.setTextColor(28, 40, 51);
          doc.text(String(v).slice(0, i === 6 ? 40 : 20), x + 1.5, y + 4.5);
          x += detCols[i].w;
        });
        y += 6.5;
      });

      doc.setFillColor(239, 244, 249);
      doc.setDrawColor(53, 74, 95);
      doc.rect(margin, y, 277, 8, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(53, 74, 95);
      doc.text(`TOTAL (${filteredRows.length} Line Items)`, margin + 2, y + 5.5);
      doc.text(formatNum(detailLineTotals.totalQty), margin + 220.5, y + 5.5);
      doc.text(formatNum(detailLineTotals.totalPallets), margin + 238.5, y + 5.5);
      doc.text(formatNum(detailLineTotals.totalLooseRolls), margin + 256.5, y + 5.5);

      doc.save(`Material_Register_${todayDate}.pdf`);
      showToast('Detailed Loading Slip Material Register PDF downloaded.');
      return;
    }

    // Summary Mode: Material-Wise Dispatch Totals
    let y = drawBanner(
      'DISPATCH DETAILS — MATERIAL-WISE DISPATCH SUMMARY',
      `Trucks: ${grandTotals.slipCount} (Local: ${grandTotals.localTrucks} | Export: ${grandTotals.exportTrucks})`
    );
    const sumCols = [
      { label: 'Sr.', w: 11 },
      { label: 'Material Description', w: 120 },
      { label: 'Pack Type(s)', w: 36 },
      { label: 'Total Qty', w: 30 },
      { label: 'Ratio', w: 20 },
      { label: 'Total Pallets', w: 30 },
      { label: 'Loose Rolls', w: 30 },
    ]; // 277mm

    const drawSummaryHead = (startY: number) => {
      doc.setFillColor(239, 244, 249);
      doc.setDrawColor(209, 219, 229);
      doc.rect(margin, startY, 277, 7.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(53, 74, 95);
      let x = margin;
      for (const c of sumCols) {
        doc.text(c.label, x + 2, startY + 5);
        x += c.w;
      }
      return startY + 7.5;
    };

    y = drawSummaryHead(y);
    materialSummary.forEach((m, idx) => {
      if (y > pageH - 22) {
        doc.addPage();
        y = drawBanner(
          'DISPATCH DETAILS — MATERIAL-WISE DISPATCH SUMMARY',
          'Material-Wise Dispatch Totals (Cont.)'
        );
        y = drawSummaryHead(y);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, 277, 7, 'F');
      }
      doc.setDrawColor(227, 234, 242);
      doc.line(margin, y + 7, margin + 277, y + 7);
      const vals = [
        String(idx + 1),
        m.materialDescription,
        m.packs.join(', ') || '-',
        formatNum(m.totalQty),
        `/ ${m.palletRatio}`,
        formatNum(m.totalPallets),
        formatNum(m.totalLooseRolls),
      ];
      let x = margin;
      vals.forEach((v, i) => {
        doc.setFont('helvetica', i === 1 || i === 3 || i >= 5 ? 'bold' : 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(28, 40, 51);
        doc.text(String(v).slice(0, i === 1 ? 66 : 20), x + 2, y + 4.8);
        x += sumCols[i].w;
      });
      y += 7;
    });

    // Summary Total Footer
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(53, 74, 95);
    doc.rect(margin, y, 277, 8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(53, 74, 95);
    doc.text(`GRAND TOTAL (${materialSummary.length} Materials)`, margin + 2, y + 5.5);
    doc.text(formatNum(grandTotals.totalQty), margin + 169, y + 5.5);
    doc.text(formatNum(grandTotals.totalPallets), margin + 219, y + 5.5);
    doc.text(formatNum(grandTotals.totalLooseRolls), margin + 249, y + 5.5);

    doc.save(`Dispatch_Details_${todayDate}.pdf`);
    showToast('Dispatch Details PDF downloaded.');
  };

  return (
    <div className="space-y-4">
      {/* Header & Export Bar */}
      <div className="surface-3d rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          {settings.logoDataUrl ? (
            <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shrink-0 ring-2 ring-[#F0AB00]/70 overflow-hidden p-1 shadow-[0_3px_0_#C5D3E2]">
              <img src={settings.logoDataUrl} alt={settings.companyName} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0A6ED1] to-[#084B8A] text-white flex items-center justify-center shrink-0 ring-2 ring-[#F0AB00]/60 shadow-[0_3px_0_#063E75]">
              <ClipboardList className="w-5 h-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black text-[#1C2833] tracking-tight">
                {isRegisterMode ? 'Detailed Loading Slip Material Register' : 'Dispatch Details Sheet'}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#EAF3FD] text-[#0A6ED1] border border-[#BFD7F2]">
                {isRegisterMode ? 'Loading Slip Line Items' : 'Material-Wise Dispatch Summary'}
              </span>
            </div>
            <p className="text-xs text-[#5B738B] font-medium mt-0.5">
              {isRegisterMode
                ? `Line-by-line loading slip material register across Gate Queue${canAccessExFactory ? ' & Ex-Factory' : ''} — filtered by Date and Material.`
                : `Aggregated material totals across Gate Queue${canAccessExFactory ? ' & Ex-Factory' : ''} — Total Qty ÷ Pallet Ratio = Total Pallets & Loose Rolls.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshing || loadingExFactory}
            className="app-btn-sm bg-white hover:bg-[#F1F5F9] text-[#354A5F] border border-[#C6D4E3]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing || loadingExFactory ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleCopySummaryForExcel}
            className={`app-btn-sm border ${
              copiedExcel
                ? 'bg-emerald-600 text-white border-emerald-700'
                : 'bg-[#E9F5FE] hover:bg-[#D7ECFC] text-[#005BB5] border-[#B2D8FA]'
            }`}
          >
            {copiedExcel ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>
              {copiedExcel ? 'Copied!' : isRegisterMode ? 'Copy Excel Rows' : 'Copy Excel Summary'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="app-btn-sm bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-700"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            className="app-btn-sm bg-[#354A5F] hover:bg-[#2A3B4C] text-white border border-[#1E2B38]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Toast Feedback */}
      {toastMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-between shadow-sm">
          <span>{toastMsg}</span>
          <button type="button" onClick={() => setToastMsg(null)} className="text-emerald-700 hover:text-emerald-950 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar: By Date & By Material */}
      <div className="surface-3d rounded-2xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Date Filter Group */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-black text-[#354A5F] uppercase tracking-wider mr-1">
              <Calendar className="w-3.5 h-3.5 text-[#0A6ED1]" />
              <span>Date Filter:</span>
            </span>

            <div className="inset-3d inline-flex items-center bg-[#E4ECF5] p-1 rounded-xl gap-1 border border-[#C6D4E3]">
              <button
                type="button"
                onClick={() => setDateFilterMode('TODAY')}
                className={`app-btn-sm !h-7 !min-h-[28px] !px-2.5 !text-[11px] !rounded-lg ${
                  dateFilterMode === 'TODAY'
                    ? 'bg-[#0A6ED1] text-white'
                    : '!shadow-none bg-transparent text-[#354A5F] hover:bg-white/80'
                }`}
              >
                Today ({formatDisplayDate(todayDate)})
              </button>
              <button
                type="button"
                onClick={() => setDateFilterMode('ALL')}
                className={`app-btn-sm !h-7 !min-h-[28px] !px-2.5 !text-[11px] !rounded-lg ${
                  dateFilterMode === 'ALL'
                    ? 'bg-[#0A6ED1] text-white'
                    : '!shadow-none bg-transparent text-[#354A5F] hover:bg-white/80'
                }`}
              >
                All Dates
              </button>
              <button
                type="button"
                onClick={() => setDateFilterMode('RANGE')}
                className={`app-btn-sm !h-7 !min-h-[28px] !px-2.5 !text-[11px] !rounded-lg ${
                  dateFilterMode === 'RANGE'
                    ? 'bg-[#0A6ED1] text-white'
                    : '!shadow-none bg-transparent text-[#354A5F] hover:bg-white/80'
                }`}
              >
                Date Range
              </button>
            </div>

            {dateFilterMode === 'RANGE' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="text-[11px] font-bold text-[#5B738B]">From:</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="inset-3d h-8 px-2 text-xs font-bold rounded-lg border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
                />
                <label className="text-[11px] font-bold text-[#5B738B] ml-1">To:</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="inset-3d h-8 px-2 text-xs font-bold rounded-lg border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
                />
              </div>
            )}
          </div>

          {/* Material + Source + Text Search Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Material Dropdown */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-[#E9730C] shrink-0" />
              <select
                value={selectedMaterial}
                onChange={(e) => setSelectedMaterial(e.target.value)}
                aria-label="Filter by Material"
                className="inset-3d h-9 text-xs font-bold px-2.5 rounded-lg border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] max-w-[260px] cursor-pointer"
              >
                <option value="ALL">All Materials ({materialOptions.length})</option>
                {materialOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Source Filter */}
            {canAccessExFactory && (
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as 'ALL' | 'MAIN' | 'EX_FACTORY')}
                aria-label="Filter by Dispatch Source"
                className="inset-3d h-9 text-xs font-bold px-2.5 rounded-lg border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] cursor-pointer"
              >
                <option value="ALL">All Sources (Gate + Ex-Factory)</option>
                <option value="MAIN">Main Gate Only</option>
                <option value="EX_FACTORY">Ex-Factory Only</option>
              </select>
            )}

            {/* Local / Export Filter */}
            <select
              value={loadingTypeFilter}
              onChange={(e) => setLoadingTypeFilter(e.target.value as 'ALL' | 'local' | 'export')}
              aria-label="Filter by Loading Type (Local / Export)"
              className="inset-3d h-9 text-xs font-bold px-2.5 rounded-lg border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] cursor-pointer"
            >
              <option value="ALL">All Loading Types (Local + Export)</option>
              <option value="local">Local Only</option>
              <option value="export">Export Only</option>
            </select>

            {/* Text Search */}
            <div className="relative min-w-[200px] sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#5B738B] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search material, truck, del note..."
                className="inset-3d w-full h-9 pl-8 pr-7 text-xs rounded-lg border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F4F8FC] text-[#1C2833] font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2.5 text-[#5B738B] hover:text-[#1C2833] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {(selectedMaterial !== 'ALL' || sourceFilter !== 'ALL' || loadingTypeFilter !== 'ALL' || searchQuery || dateFilterMode !== 'TODAY') && (
              <button
                type="button"
                onClick={() => {
                  setDateFilterMode('TODAY');
                  setFromDate(initialDate);
                  setToDate(initialDate);
                  setSelectedMaterial('ALL');
                  setSourceFilter('ALL');
                  setLoadingTypeFilter('ALL');
                  setSearchQuery('');
                }}
                className="app-btn-sm bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-300"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Total Truck Loading Breakdown: Local & Export */}
      <div className="surface-3d rounded-2xl p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#D9E3EE] gap-3 sm:gap-0">
        <div className="flex items-center justify-between sm:pr-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#EFF4F9] text-[#354A5F] border border-[#C6D4E3]">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold text-[#354A5F] uppercase tracking-wider block">
                Total Truck Loading
              </span>
              <span className="text-[11px] text-[#5B738B]">Slips in selected range</span>
            </div>
          </div>
          <span className="text-2xl font-black text-[#1C2833] tabular-nums">{grandTotals.slipCount}</span>
        </div>

        <div className="flex items-center justify-between sm:px-5 pt-2 sm:pt-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold text-emerald-800 uppercase tracking-wider block">
                Local Trucks
              </span>
              <span className="text-[11px] text-[#5B738B]">Domestic dispatch</span>
            </div>
          </div>
          <span className="text-2xl font-black text-emerald-700 tabular-nums">{grandTotals.localTrucks}</span>
        </div>

        <div className="flex items-center justify-between sm:pl-5 pt-2 sm:pt-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold text-indigo-800 uppercase tracking-wider block">
                Export Trucks
              </span>
              <span className="text-[11px] text-[#5B738B]">International dispatch</span>
            </div>
          </div>
          <span className="text-2xl font-black text-indigo-700 tabular-nums">{grandTotals.exportTrucks}</span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface-3d rounded-2xl p-4 border-l-4 border-[#0A6ED1]">
          <div className="flex items-center justify-between text-[#5B738B]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider">
              {isRegisterMode ? 'Line Items / Slips' : 'Materials / Slips'}
            </span>
            <Layers className="w-4 h-4 text-[#0A6ED1]" />
          </div>
          <p className="text-2xl font-black text-[#1C2833] mt-1 tabular-nums">
            {isRegisterMode ? grandTotals.lineCount : grandTotals.materialCount}
            <span className="text-xs font-bold text-[#5B738B] ml-2">
              {isRegisterMode
                ? `(${grandTotals.slipCount} slips / ${grandTotals.materialCount} materials)`
                : `(${grandTotals.slipCount} slips / ${grandTotals.lineCount} rows)`}
            </span>
          </p>
        </div>

        <div className="surface-3d rounded-2xl p-4 border-l-4 border-emerald-600">
          <div className="flex items-center justify-between text-[#5B738B]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider">Total Dispatched Qty</span>
            <Package className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">
            {formatNum(isRegisterMode ? detailLineTotals.totalQty : grandTotals.totalQty)}
          </p>
        </div>

        <div className="surface-3d rounded-2xl p-4 border-l-4 border-[#E9730C]">
          <div className="flex items-center justify-between text-[#5B738B]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider">Total Pallets</span>
            <Boxes className="w-4 h-4 text-[#E9730C]" />
          </div>
          <p className="text-2xl font-black text-[#C05600] mt-1 tabular-nums">
            {formatNum(isRegisterMode ? detailLineTotals.totalPallets : grandTotals.totalPallets)}
          </p>
        </div>

        <div className="surface-3d rounded-2xl p-4 border-l-4 border-red-700">
          <div className="flex items-center justify-between text-[#5B738B]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider">Total Loose Rolls</span>
            <Truck className="w-4 h-4 text-red-700" />
          </div>
          <p className="text-2xl font-black text-red-800 mt-1 tabular-nums">
            {formatNum(isRegisterMode ? detailLineTotals.totalLooseRolls : grandTotals.totalLooseRolls)}
          </p>
        </div>
      </div>

      {/* Empty State Helper if Today is empty but historical rows exist */}
      {filteredRows.length === 0 && (
        <div className="surface-3d rounded-2xl p-8 text-center space-y-3">
          <ClipboardList className="w-10 h-10 text-[#9BB0C7] mx-auto" />
          <div>
            <h3 className="text-sm font-black text-[#1C2833]">
              No Dispatch Material Entries Found for {activeFilterDateLabel}
            </h3>
            <p className="text-xs text-[#5B738B] mt-1">
              Loading slip materials entered in Gate Tickets or Ex-Factory will appear here automatically.
            </p>
          </div>
          {dateFilterMode === 'TODAY' && allMaterialRows.length > 0 && (
            <button
              type="button"
              onClick={() => setDateFilterMode('ALL')}
              className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white border border-[#074E96] mx-auto"
            >
              Show All Dates ({allMaterialRows.length} Material Rows)
            </button>
          )}
        </div>
      )}

      {/* Sheet 1: Material-Wise Total Qty ÷ Pallet Ratio = Pallets & Loose Rolls */}
      {!isRegisterMode && materialSummary.length > 0 && (
        <div className="surface-3d rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-[#F4F8FC] border-b-2 border-[#0A6ED1] text-[#1C2833] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0A6ED1]" />
              <h3 className="text-xs sm:text-sm font-black text-[#0A6ED1] uppercase tracking-wide">
                Material-Wise Dispatch Summary ({activeFilterDateLabel})
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-[#5B738B]">
              Total Qty ÷ Pallet Ratio = Total Pallets &amp; Loose Rolls (click row to filter material)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EEF4FA] text-[#354A5F] border-b border-[#C6D4E3]">
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider w-12 text-center">Sr.</th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider">Material Description</th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider">Pack Type(s)</th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider text-right bg-emerald-50/70 text-emerald-900">
                    Total Qty
                  </th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider text-center bg-blue-50/70 text-[#0A6ED1]">
                    Ratio (/Pallet)
                  </th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider text-right bg-amber-50/70 text-amber-900">
                    Total Pallets
                  </th>
                  <th className="py-2.5 px-3 font-black uppercase tracking-wider text-right bg-red-50/70 text-red-900">
                    Total Loose Rolls
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF2] bg-white">
                {materialSummary.map((item, idx) => {
                  const isSelected = selectedMaterial === item.materialKey;
                  const isOverridden =
                    ratioOverrides[item.materialKey] !== undefined &&
                    ratioOverrides[item.materialKey] !== item.slipPalletRatio;
                  return (
                    <tr
                      key={item.materialKey}
                      onClick={() =>
                        setSelectedMaterial((prev) =>
                          prev === item.materialKey ? 'ALL' : item.materialKey
                        )
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#E6F1FC] hover:bg-[#D9EBFA]'
                          : 'hover:bg-[#F7FAFD]'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center font-bold text-[#5B738B] tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 font-black text-[#1C2833]">
                        <div className="flex items-center gap-2">
                          <span>{item.materialDescription}</span>
                          {isSelected && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-[#0A6ED1] text-white">
                              FILTERED
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#5B738B]">
                        {item.packs.length > 0 ? item.packs.join(', ') : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-emerald-700 bg-emerald-50/40 tabular-nums">
                        {formatNum(item.totalQty)}
                      </td>
                      <td
                        className="py-2 px-3 text-center bg-blue-50/40"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-center gap-1">
                          <span className="text-[11px] font-black text-[#0A6ED1]">÷</span>
                          <input
                            type="number"
                            min={1}
                            step="any"
                            value={item.palletRatio}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!Number.isNaN(val) && val > 0) {
                                setRatioOverrides((prev) => ({
                                  ...prev,
                                  [item.materialKey]: val,
                                }));
                              }
                            }}
                            aria-label={`Pallet Ratio for ${item.materialDescription}`}
                            className="inset-3d w-14 h-7 px-1.5 text-center text-xs font-black rounded-md border border-[#BFD7F2] bg-white text-[#0A6ED1] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] tabular-nums"
                          />
                          {isOverridden && (
                            <button
                              type="button"
                              onClick={() =>
                                setRatioOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[item.materialKey];
                                  return next;
                                })
                              }
                              title={`Reset to slip ratio (${item.slipPalletRatio})`}
                              className="text-[#5B738B] hover:text-[#0A6ED1] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-amber-800 bg-amber-50/40 tabular-nums">
                        {formatNum(item.totalPallets)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-red-700 bg-red-50/40 tabular-nums">
                        {formatNum(item.totalLooseRolls)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#EEF4FA] border-t-2 border-[#354A5F] font-black text-[#1C2833]">
                  <td colSpan={3} className="py-3 px-3 uppercase tracking-wide">
                    Grand Total ({materialSummary.length} Material{materialSummary.length === 1 ? '' : 's'})
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-800 bg-emerald-100/60 tabular-nums">
                    {formatNum(grandTotals.totalQty)}
                  </td>
                  <td className="py-3 px-3 text-center text-[11px] font-bold text-[#0A6ED1] bg-blue-100/40">
                    Qty ÷ Ratio
                  </td>
                  <td className="py-3 px-3 text-right text-amber-900 bg-amber-100/60 tabular-nums">
                    {formatNum(grandTotals.totalPallets)}
                  </td>
                  <td className="py-3 px-3 text-right text-red-800 bg-red-100/60 tabular-nums">
                    {formatNum(grandTotals.totalLooseRolls)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Separate Section: Detailed Loading Slip Material Register */}
      {isRegisterMode && filteredRows.length > 0 && (
        <div className="surface-3d rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-[#F4F8FC] border-b border-[#C6D4E3] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[#0A6ED1]" />
              <h3 className="text-xs sm:text-sm font-black text-[#1C2833] uppercase tracking-wide">
                Detailed Loading Slip Material Register ({filteredRows.length} Line Item{filteredRows.length === 1 ? '' : 's'})
              </h3>
            </div>
            {selectedMaterial !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedMaterial('ALL')}
                className="app-btn-sm bg-[#EAF3FD] hover:bg-[#D7E9FC] text-[#0A6ED1] border border-[#BFD7F2]"
              >
                <X className="w-3 h-3" />
                <span>Clear Material Filter</span>
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EEF4FA] text-[#354A5F] border-b border-[#C6D4E3]">
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-center w-10">Sr.</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Date</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Source / Gate</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Del Note No.</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Truck No.</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Destination / Customer</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Material Description</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-center">Pack</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-right">Qty</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-right">Pallets</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-right">Loose Rolls</th>
                  <th className="py-2.5 px-2.5 font-black uppercase tracking-wider">Remarks / Batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF2] bg-white">
                {filteredRows.map((row, idx) => (
                  <tr key={row.rowKey} className="hover:bg-[#F7FAFD]">
                    <td className="py-2 px-2.5 text-center font-bold text-[#5B738B] tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-2.5 font-semibold text-[#1C2833] whitespace-nowrap">
                      {formatDisplayDate(row.date)}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                          row.source === 'Ex-Factory'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-blue-800 border-blue-200'
                        }`}
                      >
                        {row.source === 'Ex-Factory' ? 'EX-FACTORY' : row.gateLabel}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 font-black text-[#0A6ED1] whitespace-nowrap">
                      {row.delNoteNumber}
                    </td>
                    <td className="py-2 px-2.5 font-bold text-[#1C2833] whitespace-nowrap">
                      {row.truckNumber}
                    </td>
                    <td className="py-2 px-2.5 font-medium text-[#354A5F] max-w-[180px] truncate" title={row.destination}>
                      {row.destination}
                    </td>
                    <td className="py-2 px-2.5 font-black text-[#1C2833] min-w-[180px]">
                      {row.materialDescription}
                    </td>
                    <td className="py-2 px-2.5 text-center font-semibold text-[#5B738B]">
                      {row.pack}
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-emerald-700 tabular-nums">
                      {formatNum(row.qty)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-amber-800 tabular-nums">
                      {formatNum(row.pallets)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-red-700 tabular-nums">
                      {formatNum(row.looseRolls)}
                    </td>
                    <td className="py-2 px-2.5 text-[#5B738B] max-w-[150px] truncate" title={row.remarks}>
                      {row.remarks || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#EEF4FA] border-t-2 border-[#354A5F] font-black text-[#1C2833]">
                  <td colSpan={8} className="py-2.5 px-3 uppercase tracking-wide">
                    Raw Line Item Sum ({filteredRows.length} Rows)
                  </td>
                  <td className="py-2.5 px-2.5 text-right text-emerald-800 tabular-nums">
                    {formatNum(detailLineTotals.totalQty)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right text-amber-900 tabular-nums">
                    {formatNum(detailLineTotals.totalPallets)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right text-red-800 tabular-nums">
                    {formatNum(detailLineTotals.totalLooseRolls)}
                  </td>
                  <td className="py-2.5 px-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
