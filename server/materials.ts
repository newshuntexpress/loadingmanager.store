import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { db, logAudit } from './db.ts';
import { upperStr } from './normalize.ts';
import {
  getClientIp,
  requireAuth,
  requireCsrf,
  requirePasswordChanged,
  requirePermission,
  requireAnyPermission,
} from './security.ts';

export interface DbMaterialMasterRow {
  id: string;
  material_name: string;
  pack_type: string;
  pallet_ratio: number;
  remarks: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface MaterialMasterRecordDto {
  id: string;
  materialName: string;
  packType: string;
  palletRatio: number;
  remarks: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
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

export function normalizePackType(val: unknown): string {
  const raw = String(val ?? '').trim();
  if (!raw) return '';
  return STANDARD_PACK_MAP.get(raw.toUpperCase()) ?? raw.toUpperCase();
}

export function normalizePalletRatio(val: unknown): number | null {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0 || val > 10000) return null;
    return Math.round(val);
  }
  const str = String(val ?? '').trim();
  if (!str) return null;
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) return null;
  return Math.round(parsed);
}

export function mapMaterialRow(r: DbMaterialMasterRow): MaterialMasterRecordDto {
  return {
    id: r.id,
    materialName: upperStr(r.material_name),
    packType: normalizePackType(r.pack_type) || 'Rolls',
    palletRatio: Number(r.pallet_ratio) > 0 ? Number(r.pallet_ratio) : 23,
    remarks: upperStr(r.remarks),
    createdBy: r.created_by || undefined,
    updatedBy: r.updated_by || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function syncMissingMaterialsFromLoadingSlip(
  items: unknown,
  actorUsername: string
): MaterialMasterRecordDto[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const selectExisting = db.prepare(
    `SELECT id FROM material_master WHERE material_name = ? COLLATE NOCASE`
  );
  const insertStmt = db.prepare(
    `INSERT INTO material_master (
      id, material_name, pack_type, pallet_ratio, remarks, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectInserted = db.prepare(`SELECT * FROM material_master WHERE id = ?`);

  const seenInBatch = new Set<string>();
  const autoSaved: MaterialMasterRecordDto[] = [];
  const now = Date.now();
  const cleanActor = String(actorUsername || 'system').trim() || 'system';

  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const materialName = upperStr(item.description);
    if (!materialName || seenInBatch.has(materialName)) continue;
    seenInBatch.add(materialName);

    const existing = selectExisting.get(materialName) as { id: string } | undefined;
    if (existing) continue;

    const packType = normalizePackType(item.pack) || 'Rolls';
    const palletRatio = normalizePalletRatio(item.palletRatio) ?? 23;
    const remarks = upperStr(item.remarks);
    const id = `mat-${now}-${crypto.randomBytes(3).toString('hex')}`;

    insertStmt.run(
      id,
      materialName,
      packType,
      palletRatio,
      remarks,
      cleanActor,
      cleanActor,
      now,
      now
    );

    const inserted = selectInserted.get(id) as DbMaterialMasterRow | undefined;
    if (inserted) {
      autoSaved.push(mapMaterialRow(inserted));
    }
  }

  return autoSaved;
}

function rejectRestrictedOperators(req: Request, res: Response, next: NextFunction): void {
  const roleName = req.auth?.user.roleName;
  if (roleName === 'forklift_operator' || roleName === 'liquid_store_operator' || roleName === 'security_guard') {
    logAudit({
      actorUserId: req.auth?.user.id,
      actorUsername: req.auth?.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'material_master',
      targetId: `${req.method} ${req.originalUrl}`,
      details: `Restricted operator (${roleName}) denied access to Material Master`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({
      error: 'Access denied: Your account is restricted from accessing Material Master.',
    });
    return;
  }
  next();
}

export const materialsRouter = express.Router();

materialsRouter.use(
  requireAuth,
  requirePasswordChanged,
  rejectRestrictedOperators,
  requireAnyPermission([
    'materials.view',
    'materials.manage',
    'tickets.view',
    'tickets.create',
    'tickets.update',
    'ex_factory.view',
    'ex_factory.create',
    'ex_factory.update',
  ])
);

materialsRouter.get('/', (_req: Request, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM material_master ORDER BY material_name COLLATE NOCASE ASC`)
    .all() as DbMaterialMasterRow[];
  res.json({ materials: rows.map(mapMaterialRow) });
});

materialsRouter.post(
  '/',
  requirePermission('materials.manage'),
  requireCsrf,
  (req: Request, res: Response) => {
    const b = req.body || {};
    const materialName = upperStr(b.materialName);
    const packType = normalizePackType(b.packType);
    const palletRatio = normalizePalletRatio(b.palletRatio);
    const remarks = upperStr(b.remarks);

    if (!materialName) {
      res.status(400).json({ error: 'Material Name is required.' });
      return;
    }
    if (!packType) {
      res.status(400).json({ error: 'Pack Type is required.' });
      return;
    }
    if (palletRatio === null) {
      res.status(400).json({ error: 'Auto-Pallet Ratio (1 Pallet =) must be a valid number between 1 and 10000.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM material_master WHERE material_name = ? COLLATE NOCASE`)
      .get(materialName) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({
        error: `Warning: Material "${materialName}" is already saved in Material Master. Duplicate material names are not allowed.`,
      });
      return;
    }

    const now = Date.now();
    const id = `mat-${now}-${crypto.randomBytes(3).toString('hex')}`;
    const actor = req.auth!.user.username;

    db.prepare(
      `INSERT INTO material_master (
        id, material_name, pack_type, pallet_ratio, remarks, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, materialName, packType, palletRatio, remarks, actor, actor, now, now);

    const created = db.prepare(`SELECT * FROM material_master WHERE id = ?`).get(id) as DbMaterialMasterRow;

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: actor,
      action: 'MATERIAL_CREATED',
      targetType: 'material_master',
      targetId: materialName,
      details: `Created material "${materialName}" (Pack: ${packType}, 1 Pallet = ${palletRatio})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ material: mapMaterialRow(created) });
  }
);

materialsRouter.post(
  '/import',
  requirePermission('materials.manage'),
  requireCsrf,
  (req: Request, res: Response) => {
    const b = req.body || {};
    const rawItems = b.items;
    const mode = b.mode === 'upsert' ? 'upsert' : 'skip_existing';

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: 'Please provide at least one material row to import.' });
      return;
    }
    if (rawItems.length > 2000) {
      res.status(400).json({ error: 'Import limit exceeded. Maximum 2000 materials per file upload.' });
      return;
    }

    const actor = req.auth!.user.username;
    const now = Date.now();

    const selectByName = db.prepare(
      `SELECT * FROM material_master WHERE material_name = ? COLLATE NOCASE`
    );
    const insertStmt = db.prepare(
      `INSERT INTO material_master (
        id, material_name, pack_type, pallet_ratio, remarks, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateStmt = db.prepare(
      `UPDATE material_master
       SET material_name = ?, pack_type = ?, pallet_ratio = ?, remarks = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    );

    const summary = db.transaction(() => {
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const duplicateNames: string[] = [];
      const errors: string[] = [];
      const seenInRequest = new Set<string>();

      rawItems.forEach((rawRow: unknown, idx: number) => {
        if (!rawRow || typeof rawRow !== 'object') {
          errors.push(`Row ${idx + 1}: Invalid record structure.`);
          return;
        }
        const row = rawRow as Record<string, unknown>;
        const materialName = upperStr(row.materialName);
        const packType = normalizePackType(row.packType) || 'Rolls';
        const palletRatio = normalizePalletRatio(row.palletRatio);
        const remarks = upperStr(row.remarks);

        if (!materialName) {
          errors.push(`Row ${idx + 1}: Material Name is required.`);
          return;
        }
        if (palletRatio === null) {
          errors.push(`Row ${idx + 1} (${materialName}): Auto-Pallet Ratio must be between 1 and 10000.`);
          return;
        }

        if (seenInRequest.has(materialName)) {
          skippedCount += 1;
          if (!duplicateNames.includes(materialName)) {
            duplicateNames.push(materialName);
          }
          return;
        }
        seenInRequest.add(materialName);

        const existing = selectByName.get(materialName) as DbMaterialMasterRow | undefined;
        if (existing) {
          if (mode === 'upsert') {
            updateStmt.run(
              materialName,
              packType,
              palletRatio,
              remarks || existing.remarks || '',
              actor,
              now,
              existing.id
            );
            updatedCount += 1;
          } else {
            skippedCount += 1;
            if (!duplicateNames.includes(materialName)) {
              duplicateNames.push(materialName);
            }
          }
          return;
        }

        const id = `mat-${now}-${idx}-${crypto.randomBytes(2).toString('hex')}`;
        insertStmt.run(id, materialName, packType, palletRatio, remarks, actor, actor, now, now);
        createdCount += 1;
      });

      const allRows = db
        .prepare(`SELECT * FROM material_master ORDER BY material_name COLLATE NOCASE ASC`)
        .all() as DbMaterialMasterRow[];

      return {
        createdCount,
        updatedCount,
        skippedCount,
        duplicateNames,
        errors,
        materials: allRows.map(mapMaterialRow),
      };
    })();

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: actor,
      action: 'MATERIAL_IMPORTED',
      targetType: 'material_master',
      targetId: `${summary.createdCount + summary.updatedCount} rows`,
      details: `Material Master Excel/CSV import (${mode}): ${summary.createdCount} added, ${summary.updatedCount} updated, ${summary.skippedCount} skipped`,
      ipAddress: getClientIp(req),
    });

    res.json(summary);
  }
);

materialsRouter.put(
  '/:id',
  requirePermission('materials.manage'),
  requireCsrf,
  (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    const existing = db
      .prepare(`SELECT * FROM material_master WHERE id = ?`)
      .get(id) as DbMaterialMasterRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Material Master record not found.' });
      return;
    }

    const b = req.body || {};
    const materialName = upperStr(b.materialName);
    const packType = normalizePackType(b.packType);
    const palletRatio = normalizePalletRatio(b.palletRatio);
    const remarks = upperStr(b.remarks);

    if (!materialName) {
      res.status(400).json({ error: 'Material Name is required.' });
      return;
    }
    if (!packType) {
      res.status(400).json({ error: 'Pack Type is required.' });
      return;
    }
    if (palletRatio === null) {
      res.status(400).json({ error: 'Auto-Pallet Ratio (1 Pallet =) must be a valid number between 1 and 10000.' });
      return;
    }

    const duplicate = db
      .prepare(`SELECT id FROM material_master WHERE material_name = ? COLLATE NOCASE AND id != ?`)
      .get(materialName, id) as { id: string } | undefined;
    if (duplicate) {
      res.status(409).json({
        error: `Warning: Material "${materialName}" is already saved in Material Master. Duplicate material names are not allowed.`,
      });
      return;
    }

    const now = Date.now();
    const actor = req.auth!.user.username;

    db.prepare(
      `UPDATE material_master
       SET material_name = ?, pack_type = ?, pallet_ratio = ?, remarks = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(materialName, packType, palletRatio, remarks, actor, now, id);

    const updated = db.prepare(`SELECT * FROM material_master WHERE id = ?`).get(id) as DbMaterialMasterRow;

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: actor,
      action: 'MATERIAL_UPDATED',
      targetType: 'material_master',
      targetId: materialName,
      details: `Updated material "${materialName}" (Pack: ${packType}, 1 Pallet = ${palletRatio})`,
      ipAddress: getClientIp(req),
    });

    res.json({ material: mapMaterialRow(updated) });
  }
);

materialsRouter.delete(
  '/:id',
  requirePermission('materials.manage'),
  requireCsrf,
  (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    const existing = db
      .prepare(`SELECT * FROM material_master WHERE id = ?`)
      .get(id) as DbMaterialMasterRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Material Master record not found.' });
      return;
    }

    db.prepare(`DELETE FROM material_master WHERE id = ?`).run(id);

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'MATERIAL_DELETED',
      targetType: 'material_master',
      targetId: existing.material_name,
      details: `Deleted material "${existing.material_name}" from Material Master`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  }
);
