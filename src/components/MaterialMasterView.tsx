import React, { useMemo, useRef, useState } from 'react';
import type { MaterialMasterRecord } from '../types';
import { ApiClient } from '../services/api';
import { StorageService } from '../services/storage';
import { PACK_DROPDOWN_OPTIONS } from './LoadingSlipModal';
import {
  parseMaterialExcelFile,
  downloadMaterialMasterTemplateXlsx,
  exportMaterialMasterXlsx,
  type ParsedMaterialImportResult,
} from '../utils/materialExcel';
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Search,
  Upload,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  Loader2,
  Save,
} from 'lucide-react';

interface MaterialMasterViewProps {
  materials: MaterialMasterRecord[];
  canManage: boolean;
  onMaterialsChange: (updated: MaterialMasterRecord[]) => void;
  onRefresh: () => Promise<void>;
}

export const MaterialMasterView: React.FC<MaterialMasterViewProps> = ({
  materials,
  canManage,
  onMaterialsChange,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [packFilter, setPackFilter] = useState('ALL');

  // Form state
  const [editingMaterial, setEditingMaterial] = useState<MaterialMasterRecord | null>(null);
  const [materialName, setMaterialName] = useState('');
  const [packType, setPackType] = useState('Rolls');
  const [customPackType, setCustomPackType] = useState('');
  const [palletRatio, setPalletRatio] = useState('23');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Feedback state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Delete confirmation modal
  const [confirmDelete, setConfirmDelete] = useState<MaterialMasterRecord | null>(null);

  // Excel upload modal state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedImport, setParsedImport] = useState<ParsedMaterialImportResult | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importMode, setImportMode] = useState<'skip_existing' | 'upsert'>('skip_existing');
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const normalizedInputName = materialName.trim().toUpperCase();

  const liveDuplicateConflict = useMemo(() => {
    if (!normalizedInputName) return null;
    return (
      materials.find(
        (m) =>
          m.materialName.trim().toUpperCase() === normalizedInputName &&
          (!editingMaterial || m.id !== editingMaterial.id)
      ) || null
    );
  }, [materials, normalizedInputName, editingMaterial]);

  const effectivePackType =
    packType === '__CUSTOM__' ? customPackType.trim().toUpperCase() : packType;

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return materials.filter((m) => {
      if (packFilter !== 'ALL' && m.packType !== packFilter) return false;
      if (!q) return true;
      return (
        m.materialName.toUpperCase().includes(q) ||
        m.packType.toUpperCase().includes(q) ||
        String(m.palletRatio).includes(q) ||
        (m.remarks || '').toUpperCase().includes(q)
      );
    });
  }, [materials, searchQuery, packFilter]);

  const distinctPackTypes = useMemo(() => {
    const set = new Set<string>(PACK_DROPDOWN_OPTIONS);
    materials.forEach((m) => {
      if (m.packType) set.add(m.packType);
    });
    return Array.from(set);
  }, [materials]);

  const resetForm = () => {
    setEditingMaterial(null);
    setMaterialName('');
    setPackType('Rolls');
    setCustomPackType('');
    setPalletRatio('23');
    setRemarks('');
    setErrorMsg(null);
  };

  const handleStartEdit = (mat: MaterialMasterRecord) => {
    setEditingMaterial(mat);
    setMaterialName(mat.materialName);
    if (PACK_DROPDOWN_OPTIONS.includes(mat.packType)) {
      setPackType(mat.packType);
      setCustomPackType('');
    } else {
      setPackType('__CUSTOM__');
      setCustomPackType(mat.packType);
    }
    setPalletRatio(String(mat.palletRatio));
    setRemarks(mat.remarks || '');
    setErrorMsg(null);
    setSuccessMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    if (!normalizedInputName) {
      setErrorMsg('Please enter Material Name.');
      return;
    }
    if (liveDuplicateConflict) {
      setErrorMsg(
        `Warning: Material "${liveDuplicateConflict.materialName}" is already saved in Material Master. Duplicate material names are not allowed.`
      );
      return;
    }
    if (!effectivePackType) {
      setErrorMsg('Please select or enter a Pack Type.');
      return;
    }
    const parsedRatio = Number(palletRatio);
    if (!Number.isFinite(parsedRatio) || parsedRatio <= 0 || parsedRatio > 10000) {
      setErrorMsg('Auto-Pallet Ratio (1 Pallet =) must be a number between 1 and 10000.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingMaterial) {
        const updated = await ApiClient.updateMaterial(editingMaterial.id, {
          materialName: normalizedInputName,
          packType: effectivePackType,
          palletRatio: Math.round(parsedRatio),
          remarks: remarks.trim().toUpperCase(),
        });
        const nextList = materials
          .map((m) => (m.id === updated.id ? updated : m))
          .sort((a, b) => a.materialName.localeCompare(b.materialName));
        StorageService.saveMaterials(nextList);
        onMaterialsChange(nextList);
        setSuccessMsg(
          `Updated "${updated.materialName}" (Pack: ${updated.packType}, 1 Pallet = ${updated.palletRatio}).`
        );
        resetForm();
      } else {
        const created = await ApiClient.createMaterial({
          materialName: normalizedInputName,
          packType: effectivePackType,
          palletRatio: Math.round(parsedRatio),
          remarks: remarks.trim().toUpperCase(),
        });
        const nextList = [...materials, created].sort((a, b) =>
          a.materialName.localeCompare(b.materialName)
        );
        StorageService.saveMaterials(nextList);
        onMaterialsChange(nextList);
        setSuccessMsg(
          `Saved "${created.materialName}" (Pack: ${created.packType}, 1 Pallet = ${created.palletRatio}) to Material Master.`
        );
        resetForm();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete || !canManage) return;
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await ApiClient.deleteMaterial(confirmDelete.id);
      const nextList = materials.filter((m) => m.id !== confirmDelete.id);
      StorageService.saveMaterials(nextList);
      onMaterialsChange(nextList);
      if (editingMaterial?.id === confirmDelete.id) {
        resetForm();
      }
      setSuccessMsg(`Deleted "${confirmDelete.materialName}" from Material Master.`);
      setConfirmDelete(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const parsed = await parseMaterialExcelFile(file);
      setImportFileName(file.name);
      setParsedImport(parsed);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to read Material Master Excel/CSV file.');
    }
  };

  const existingDuplicateNamesInUpload = useMemo(() => {
    if (!parsedImport) return [];
    const existingSet = new Set(materials.map((m) => m.materialName.trim().toUpperCase()));
    const matches: string[] = [];
    for (const row of parsedImport.validRows) {
      if (existingSet.has(row.materialName) && !matches.includes(row.materialName)) {
        matches.push(row.materialName);
      }
    }
    return matches;
  }, [parsedImport, materials]);

  const handleConfirmImport = async () => {
    if (!parsedImport || parsedImport.validRows.length === 0 || !canManage) return;
    setImporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await ApiClient.importMaterials({
        mode: importMode,
        items: parsedImport.validRows.map((r) => ({
          materialName: r.materialName,
          packType: r.packType,
          palletRatio: r.palletRatio,
          remarks: r.remarks,
        })),
      });
      StorageService.saveMaterials(res.materials);
      onMaterialsChange(res.materials);

      const parts: string[] = [];
      if (res.createdCount > 0) parts.push(`${res.createdCount} added`);
      if (res.updatedCount > 0) parts.push(`${res.updatedCount} updated`);
      if (res.skippedCount > 0) parts.push(`${res.skippedCount} duplicate(s) skipped`);

      setSuccessMsg(
        `Material Master file imported (${importFileName}): ${parts.join(', ') || 'No changes'}.`
      );
      if (res.duplicateNames.length > 0 && importMode === 'skip_existing') {
        setErrorMsg(
          `Warning: ${res.duplicateNames.length} material(s) were skipped because they are already saved in Material Master: ${res.duplicateNames
            .slice(0, 8)
            .join(', ')}${res.duplicateNames.length > 8 ? '...' : ''}.`
        );
      }
      setParsedImport(null);
      setImportFileName('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to import Material Master file.');
    } finally {
      setImporting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Sr No', 'Material Name', 'Pack Type', 'Auto-Pallet Ratio (1 Pallet =)', 'Default Remarks', 'Updated By'];
    const rows = filteredMaterials.map((m, idx) => [
      idx + 1,
      `"${(m.materialName || '').replace(/"/g, '""')}"`,
      `"${(m.packType || '').replace(/"/g, '""')}"`,
      m.palletRatio,
      `"${(m.remarks || '').replace(/"/g, '""')}"`,
      `"${(m.updatedBy || m.createdBy || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Material_Master_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Section Header Card */}
      <div className="surface-3d rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0A6ED1] to-[#00448E] text-white flex items-center justify-center shadow-sm shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-[#1C2833]">
                Material Master Catalog
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-extrabold rounded-md bg-[#EBF5FF] text-[#0A6ED1] border border-[#B8DCFF] tabular-nums">
                {materials.length} Materials
              </span>
            </div>
            <p className="text-xs text-[#4E647B] mt-0.5">
              Maintain Material Name, Pack Type, and Auto-Pallet Ratio (1 Pallet =). Typing any Material Name in Loading Slip instantly searches from the first letter and auto-fills Pack Type &amp; Ratio.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                onChange={handleFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>Upload Excel / CSV</span>
              </button>
              <button
                type="button"
                onClick={() => downloadMaterialMasterTemplateXlsx()}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#107E3E] shrink-0" />
                <span>Sample Excel</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => exportMaterialMasterXlsx(filteredMaterials)}
            className="app-btn-sm bg-[#107E3E] hover:bg-[#0D6B34] text-white"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
          >
            <Download className="w-3.5 h-3.5 text-[#0A6ED1] shrink-0" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
            title="Refresh Material Master"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Alerts */}
      {errorMsg && (
        <div
          role="alert"
          className="bg-[#FFF4E5] border border-[#F59E0B] text-[#92400E] px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 shadow-xs"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
            <span>{errorMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="p-1 hover:bg-amber-200/60 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="bg-[#F1FDF6] border border-[#72C896] text-[#0D4A26] px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 shadow-xs"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#107E3E] shrink-0" />
            <span>{successMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="p-1 hover:bg-emerald-200/60 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add / Edit Form */}
      {canManage && (
        <form onSubmit={handleSubmit} className="surface-3d rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-[#1C2833] flex items-center gap-2">
              {editingMaterial ? (
                <>
                  <Edit2 className="w-4 h-4 text-[#0A6ED1]" />
                  <span>Edit Material: {editingMaterial.materialName}</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 text-[#0A6ED1]" />
                  <span>Add New Material to Master</span>
                </>
              )}
            </h3>
            {editingMaterial && (
              <button
                type="button"
                onClick={resetForm}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-start">
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-extrabold text-[#354A5F] uppercase mb-1">
                Material Name *
              </label>
              <input
                type="text"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                placeholder="e.g. DS40200"
                className={`inset-3d w-full h-10 px-3 text-xs font-bold uppercase rounded-xl border focus:outline-none focus:ring-2 ${
                  liveDuplicateConflict
                    ? 'border-[#D97706] bg-[#FFFBEB] text-[#92400E] focus:ring-[#F59E0B]'
                    : 'border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:ring-[#0A6ED1]'
                }`}
              />
              {liveDuplicateConflict && (
                <p className="mt-1 text-[11px] font-bold text-[#B45309] flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Warning: Material &quot;{liveDuplicateConflict.materialName}&quot; is already saved (Pack: {liveDuplicateConflict.packType}, 1P = {liveDuplicateConflict.palletRatio}).
                  </span>
                </p>
              )}
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-extrabold text-[#354A5F] uppercase mb-1">
                Pack Type *
              </label>
              <select
                value={packType}
                onChange={(e) => setPackType(e.target.value)}
                className="inset-3d w-full h-10 px-2.5 text-xs font-bold rounded-xl border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              >
                {PACK_DROPDOWN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="__CUSTOM__">Other / Custom</option>
              </select>
              {packType === '__CUSTOM__' && (
                <input
                  type="text"
                  value={customPackType}
                  onChange={(e) => setCustomPackType(e.target.value)}
                  placeholder="Enter custom pack type"
                  className="mt-1.5 inset-3d w-full h-8 px-2.5 text-xs font-bold uppercase rounded-lg border border-[#0A6ED1] bg-white focus:outline-none"
                />
              )}
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-extrabold text-[#354A5F] uppercase mb-1">
                Auto-Pallet Ratio (1 Pallet =) *
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={palletRatio}
                  onChange={(e) => setPalletRatio(e.target.value)}
                  placeholder="23"
                  className="inset-3d w-full h-10 px-3 text-xs font-black text-center rounded-xl border border-[#C2D0DF] bg-[#FFFBEB] text-[#92400E] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]"
                />
                <span className="text-[11px] font-bold text-[#4E647B] whitespace-nowrap">
                  {effectivePackType || 'Rolls'}
                </span>
              </div>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-extrabold text-[#354A5F] uppercase mb-1">
                Default Remarks (Optional)
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Batch / Spec (Optional)"
                className="inset-3d w-full h-10 px-3 text-xs font-medium uppercase rounded-xl border border-[#C2D0DF] bg-[#F4F8FC] text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
            </div>

            <div className="lg:col-span-2 flex items-end lg:pt-5">
              <button
                type="submit"
                disabled={submitting || Boolean(liveDuplicateConflict)}
                className="app-btn w-full h-10 bg-[#0A6ED1] hover:bg-[#085CAF] text-white font-bold disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Save className="w-4 h-4 shrink-0" />
                )}
                <span>{editingMaterial ? 'Update Material' : 'Save Material'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Search & Filter Toolbar + Material Master Table */}
      <div className="surface-3d rounded-2xl overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-[#DCE5EF] bg-[#F6F9FC] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#5B738B] absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Material Name, Pack Type or Ratio..."
              className="inset-3d w-full h-9 pl-9 pr-3 text-xs font-medium rounded-xl border border-[#C2D0DF] bg-white focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={packFilter}
              onChange={(e) => setPackFilter(e.target.value)}
              className="inset-3d h-9 px-3 text-xs font-bold rounded-xl border border-[#C2D0DF] bg-white text-[#1C2833] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            >
              <option value="ALL">All Pack Types ({materials.length})</option>
              {distinctPackTypes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="text-xs font-bold text-[#4E647B] whitespace-nowrap">
              Showing {filteredMaterials.length}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#263748] text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-3 w-12 text-center">#</th>
                <th className="py-3 px-4">Material Name</th>
                <th className="py-3 px-4 w-36">Pack Type</th>
                <th className="py-3 px-4 w-56 text-center">Auto-Pallet Ratio (1 Pallet =)</th>
                <th className="py-3 px-4 w-40">Updated By</th>
                {canManage && <th className="py-3 px-4 w-36 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3EAF2]">
              {filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="py-10 text-center text-[#5B738B] text-xs font-medium">
                    No materials found. Add a material above or upload an Excel / CSV Material Master file.
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((mat, idx) => (
                  <tr
                    key={mat.id}
                    className={`hover:bg-[#F2F7FC] transition-colors ${
                      idx % 2 === 1 ? 'bg-[#F9FBFD]' : 'bg-white'
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center font-bold text-[#5B738B] tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-black text-[#1C2833]">{mat.materialName}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-[#EBF5FF] text-[#0A6ED1] border border-[#B8DCFF]">
                        {mat.packType}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-black bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] tabular-nums">
                        1 Pallet = {mat.palletRatio} {mat.packType}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-[#4E647B] font-medium">
                      {mat.updatedBy || mat.createdBy || '—'}
                    </td>
                    {canManage && (
                      <td className="py-2.5 px-4 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(mat)}
                            className="app-btn-sm !h-7 !min-h-[28px] !px-2.5 bg-white hover:bg-[#EBF5FF] text-[#0A6ED1] border border-[#B8DCFF]"
                            title="Edit material"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(mat)}
                            className="app-btn-sm !h-7 !min-h-[28px] !px-2 bg-white hover:bg-[#FFF0F0] text-[#BB0000] border border-[#F4B8B8]"
                            title="Delete material"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excel / CSV Upload Preview Modal */}
      {parsedImport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preview Material Master Excel Import"
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-[#D1DBE5] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-[#263748] to-[#354A5F] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-[#F0AB00]" />
                <div>
                  <h3 className="text-sm font-black">Import Material Master File</h3>
                  <p className="text-[11px] text-[#CBD8E6]">
                    {importFileName} · {parsedImport.validRows.length} valid row(s) detected
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setParsedImport(null);
                  setImportFileName('');
                }}
                className="p-1 text-[#CBD8E6] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3 overflow-y-auto flex-1">
              {(existingDuplicateNamesInUpload.length > 0 || parsedImport.duplicateFileNames.length > 0) && (
                <div className="bg-[#FFFBEB] border border-[#F59E0B] text-[#92400E] rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-extrabold">
                    <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                    <span>Duplicate Material Warning</span>
                  </div>
                  {existingDuplicateNamesInUpload.length > 0 && (
                    <p>
                      {existingDuplicateNamesInUpload.length} material(s) already exist in Material Master (
                      {existingDuplicateNamesInUpload.slice(0, 6).join(', ')}
                      {existingDuplicateNamesInUpload.length > 6 ? '...' : ''}). Choose how to handle duplicates below.
                    </p>
                  )}
                  {parsedImport.duplicateFileNames.length > 0 && (
                    <p>
                      Duplicate rows within the uploaded file ({parsedImport.duplicateFileNames.slice(0, 5).join(', ')}) will be automatically skipped.
                    </p>
                  )}
                </div>
              )}

              {parsedImport.invalidRows.length > 0 && (
                <div className="bg-[#FFF0F0] border border-[#F4B8B8] text-[#BB0000] rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-extrabold">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{parsedImport.invalidRows.length} Invalid Row(s) Will Be Ignored</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {parsedImport.invalidRows.slice(0, 6).map((inv) => (
                      <li key={inv.rowNumber}>
                        Row {inv.rowNumber}
                        {inv.rawName ? ` (${inv.rawName})` : ''}: {inv.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 bg-[#F6F9FC] border border-[#DCE5EF] rounded-xl p-3 text-xs">
                <span className="font-extrabold text-[#1C2833]">When material name already exists:</span>
                <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-[#354A5F]">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'skip_existing'}
                    onChange={() => setImportMode('skip_existing')}
                  />
                  <span>Skip Duplicates (Keep Existing)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-[#354A5F]">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'upsert'}
                    onChange={() => setImportMode('upsert')}
                  />
                  <span>Update Existing Pack Type &amp; Pallet Ratio</span>
                </label>
              </div>

              <div className="border border-[#DCE5EF] rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#263748] text-white sticky top-0 text-[11px] uppercase">
                      <tr>
                        <th className="py-2 px-3 w-14 text-center">Row</th>
                        <th className="py-2 px-3">Material Name</th>
                        <th className="py-2 px-3">Pack Type</th>
                        <th className="py-2 px-3 text-center">Auto-Pallet Ratio (1P =)</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3EAF2]">
                      {parsedImport.validRows.map((row) => {
                        const alreadyExists = existingDuplicateNamesInUpload.includes(row.materialName);
                        return (
                          <tr key={`${row.rowNumber}-${row.materialName}`} className="bg-white">
                            <td className="py-2 px-3 text-center text-[#5B738B] font-mono">
                              {row.rowNumber}
                            </td>
                            <td className="py-2 px-3 font-black text-[#1C2833]">{row.materialName}</td>
                            <td className="py-2 px-3 font-bold text-[#0A6ED1]">{row.packType}</td>
                            <td className="py-2 px-3 text-center font-black text-[#92400E]">
                              1P = {row.palletRatio} {row.packType}
                            </td>
                            <td className="py-2 px-3">
                              {row.isIntraFileDuplicate ? (
                                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-100 text-amber-900">
                                  Duplicate in file (Skip)
                                </span>
                              ) : alreadyExists ? (
                                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-100 text-amber-900">
                                  {importMode === 'upsert' ? 'Already Saved (Will Update)' : 'Already Saved (Will Skip)'}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-emerald-100 text-emerald-900">
                                  New Material
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E3EAF2] bg-[#F6F9FC] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setParsedImport(null);
                  setImportFileName('');
                }}
                className="app-btn-sm bg-white hover:bg-[#EFF4F9] text-[#354A5F] border border-[#BCC8D4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || parsedImport.validRows.length === 0}
                onClick={handleConfirmImport}
                className="app-btn-sm bg-[#0A6ED1] hover:bg-[#085CAF] text-white disabled:opacity-50"
              >
                {importing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>Import {parsedImport.validRows.length} Material(s)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete Material Confirmation"
          className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-[#D1DBE5] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E3EAF2] flex items-center justify-between">
              <h3 className="text-sm font-black text-[#1C2833]">Delete Material</h3>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="text-[#5B738B] hover:text-[#1C2833] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-[#1C2833] leading-relaxed">
              Delete material <strong>{confirmDelete.materialName}</strong> (Pack: {confirmDelete.packType}, 1 Pallet = {confirmDelete.palletRatio}) from Material Master? Existing saved loading slips will keep their text values.
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
                disabled={submitting}
                onClick={handleConfirmDelete}
                className="app-btn-sm bg-[#BB0000] hover:bg-[#9E0000] text-white"
              >
                Delete Material
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
