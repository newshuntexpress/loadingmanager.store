import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type SheetData } from 'write-excel-file/browser';
import type { MaterialMasterRecord } from '../types';

export interface ParsedMaterialImportRow {
  rowNumber: number;
  materialName: string;
  packType: string;
  palletRatio: number;
  remarks: string;
  isIntraFileDuplicate?: boolean;
}

export interface ParsedMaterialImportResult {
  validRows: ParsedMaterialImportRow[];
  invalidRows: Array<{ rowNumber: number; reason: string; rawName?: string }>;
  duplicateFileNames: string[];
  totalDataRows: number;
}

const STANDARD_PACK_MAP = new Map<string, string>([
  ['CAN', 'Can'],
  ['CANS', 'Can'],
  ['DRUM', 'Drum'],
  ['DRUMS', 'Drum'],
  ['BOARD', 'Board'],
  ['BOARDS', 'Board'],
  ['EA', 'EA'],
  ['EACH', 'EA'],
  ['PCS', 'EA'],
  ['PC', 'EA'],
  ['KG', 'KG'],
  ['KGS', 'KG'],
  ['ROLL', 'Rolls'],
  ['ROLLS', 'Rolls'],
  ['PALLET', 'Pallet'],
  ['PALLETS', 'Pallet'],
  ['BOX', 'Box'],
  ['BOXES', 'Box'],
]);

export function normalizePackTypeClient(val: unknown): string {
  const raw = String(val ?? '').trim();
  if (!raw) return 'Rolls';
  return STANDARD_PACK_MAP.get(raw.toUpperCase()) ?? raw.toUpperCase();
}

function parseRatioClient(val: unknown): number | null {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0 || val > 10000) return null;
    return Math.round(val);
  }
  const str = String(val ?? '').trim();
  if (!str) return null;
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0 || num > 10000) return null;
  return Math.round(num);
}

function parseDelimitedTextRows(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const firstLine = cleaned.split(/\r?\n/)[0] || '';
  const delimiter =
    firstLine.includes('\t') && !firstLine.includes(',')
      ? '\t'
      : firstLine.includes(';') && !firstLine.includes(',')
      ? ';'
      : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"' && cleaned[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && cleaned[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

function normalizeHeaderKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectColumns(headerRow: unknown[]): {
  isHeader: boolean;
  nameIdx: number;
  packIdx: number;
  ratioIdx: number;
  remarksIdx: number;
} {
  const keys = headerRow.map(normalizeHeaderKey);
  let nameIdx = -1;
  let packIdx = -1;
  let ratioIdx = -1;
  let remarksIdx = -1;

  keys.forEach((k, idx) => {
    if (!k) return;
    if (
      nameIdx === -1 &&
      (k === 'materialname' ||
        k === 'material' ||
        k === 'materialdescription' ||
        k === 'description' ||
        k === 'itemname' ||
        k === 'item' ||
        k === 'productname' ||
        k === 'materialcode' ||
        k === 'code' ||
        k === 'name')
    ) {
      nameIdx = idx;
    } else if (
      packIdx === -1 &&
      (k === 'packtype' || k === 'pack' || k === 'uom' || k === 'unit' || k === 'packaging')
    ) {
      packIdx = idx;
    } else if (
      ratioIdx === -1 &&
      (k.includes('ratio') ||
        k.includes('pallet') ||
        k.includes('1p') ||
        k.includes('qtyperpallet') ||
        k.includes('rollsperpallet') ||
        k === 'qty')
    ) {
      ratioIdx = idx;
    } else if (
      remarksIdx === -1 &&
      (k.includes('remark') || k.includes('note') || k.includes('batch') || k.includes('grade'))
    ) {
      remarksIdx = idx;
    }
  });

  const isHeader = nameIdx !== -1 || packIdx !== -1 || ratioIdx !== -1;
  if (!isHeader) {
    return {
      isHeader: false,
      nameIdx: 0,
      packIdx: 1,
      ratioIdx: 2,
      remarksIdx: 3,
    };
  }

  return {
    isHeader: true,
    nameIdx: nameIdx !== -1 ? nameIdx : 0,
    packIdx: packIdx !== -1 ? packIdx : 1,
    ratioIdx: ratioIdx !== -1 ? ratioIdx : 2,
    remarksIdx: remarksIdx !== -1 ? remarksIdx : 3,
  };
}

export async function parseMaterialExcelFile(file: File): Promise<ParsedMaterialImportResult> {
  const fileName = (file.name || '').toLowerCase();
  let rawRows: unknown[][] = [];

  if (fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt')) {
    const text = await file.text();
    rawRows = parseDelimitedTextRows(text);
  } else {
    try {
      rawRows = (await readSheet(file)) as unknown[][];
    } catch {
      const text = await file.text().catch(() => '');
      if (text && (text.includes(',') || text.includes('\t') || text.includes(';'))) {
        rawRows = parseDelimitedTextRows(text);
      } else {
        throw new Error(
          'Unable to read this file. Please upload a valid Excel (.xlsx) or CSV (.csv) Material Master file.'
        );
      }
    }
  }

  const nonEmptyRows = rawRows.filter(
    (r) => Array.isArray(r) && r.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
  );

  if (nonEmptyRows.length === 0) {
    throw new Error('The uploaded file is empty. Please add at least one Material Name row.');
  }

  const cols = detectColumns(nonEmptyRows[0]);
  const startIdx = cols.isHeader ? 1 : 0;

  const validRows: ParsedMaterialImportRow[] = [];
  const invalidRows: Array<{ rowNumber: number; reason: string; rawName?: string }> = [];
  const duplicateFileNames: string[] = [];
  const seenNames = new Set<string>();

  for (let i = startIdx; i < nonEmptyRows.length; i += 1) {
    const row = nonEmptyRows[i];
    const rowNumber = i + 1;
    const rawName = String(row[cols.nameIdx] ?? '').trim().toUpperCase();
    const rawPack = row[cols.packIdx];
    const rawRatio = row[cols.ratioIdx];
    const rawRemarks = cols.remarksIdx >= 0 ? String(row[cols.remarksIdx] ?? '').trim().toUpperCase() : '';

    if (!rawName) {
      invalidRows.push({ rowNumber, reason: 'Material Name is missing.' });
      continue;
    }

    const parsedRatio =
      rawRatio === null || rawRatio === undefined || String(rawRatio).trim() === ''
        ? 23
        : parseRatioClient(rawRatio);

    if (parsedRatio === null) {
      invalidRows.push({
        rowNumber,
        rawName,
        reason: `Invalid Auto-Pallet Ratio "${String(rawRatio ?? '')}" (must be 1 to 10000).`,
      });
      continue;
    }

    const packType = normalizePackTypeClient(rawPack);
    const isIntraFileDuplicate = seenNames.has(rawName);
    if (isIntraFileDuplicate) {
      if (!duplicateFileNames.includes(rawName)) {
        duplicateFileNames.push(rawName);
      }
    } else {
      seenNames.add(rawName);
    }

    validRows.push({
      rowNumber,
      materialName: rawName,
      packType,
      palletRatio: parsedRatio,
      remarks: rawRemarks,
      isIntraFileDuplicate,
    });
  }

  return {
    validRows,
    invalidRows,
    duplicateFileNames,
    totalDataRows: Math.max(0, nonEmptyRows.length - startIdx),
  };
}

export async function downloadMaterialMasterTemplateXlsx(): Promise<void> {
  const sheetData: SheetData = [
    [
      {
        value: 'Material Name',
        fontWeight: 'bold',
        backgroundColor: '#1E3A5F',
        textColor: '#FFFFFF',
      },
      {
        value: 'Pack Type',
        fontWeight: 'bold',
        backgroundColor: '#1E3A5F',
        textColor: '#FFFFFF',
      },
      {
        value: 'Auto-Pallet Ratio (1 Pallet =)',
        fontWeight: 'bold',
        backgroundColor: '#1E3A5F',
        textColor: '#FFFFFF',
      },
      {
        value: 'Default Remarks (Optional)',
        fontWeight: 'bold',
        backgroundColor: '#1E3A5F',
        textColor: '#FFFFFF',
      },
    ],
    ['DS40200', 'Rolls', 23, 'STANDARD BITUMEN MEMBRANE'],
    ['DS40250', 'Rolls', 20, 'HEAVY DUTY MEMBRANE'],
    ['PRIMER-AWAZEL', 'Drum', 4, '200 LTR DRUM'],
    ['AWAZEL-COAT', 'Can', 36, '20 LTR CAN'],
  ];

  await writeXlsxFile(sheetData, {
    sheet: 'Material Master',
    columns: [{ width: 32 }, { width: 16 }, { width: 28 }, { width: 32 }],
  }).toFile('Material_Master_Template.xlsx');
}

export async function exportMaterialMasterXlsx(materials: MaterialMasterRecord[]): Promise<void> {
  const headerRow = [
    {
      value: 'Sr No',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
    {
      value: 'Material Name',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
    {
      value: 'Pack Type',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
    {
      value: 'Auto-Pallet Ratio (1 Pallet =)',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
    {
      value: 'Default Remarks',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
    {
      value: 'Updated By',
      fontWeight: 'bold' as const,
      backgroundColor: '#1E3A5F',
      textColor: '#FFFFFF',
    },
  ];

  const dataRows: SheetData = materials.map((mat, idx) => [
    idx + 1,
    mat.materialName,
    mat.packType,
    mat.palletRatio,
    mat.remarks || '',
    mat.updatedBy || mat.createdBy || '',
  ]);

  await writeXlsxFile([headerRow, ...dataRows], {
    sheet: 'Material Master',
    columns: [
      { width: 8 },
      { width: 34 },
      { width: 16 },
      { width: 28 },
      { width: 30 },
      { width: 18 },
    ],
  }).toFile(`Material_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
}
