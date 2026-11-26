import express, { type Request, type Response, type NextFunction } from 'express';
import { db, logAudit, resetLiquidStoreToDefault, seedLiquidStoreIfEmpty } from './db.ts';
import { upperStr, normalizePlantId } from './normalize.ts';
import {
  getClientIp,
  requireAuth,
  requireCsrf,
  requirePasswordChanged,
  requirePermission,
  requireAnyPermission,
  resolveAuthorizedPlantForUser,
  userCanAccessPlant,
} from './security.ts';

interface DbTankRow {
  id: number;
  plant_id?: string | null;
  name: string;
  total_capacity_kg: number;
  depth_meters: number;
  location: string;
  notes: string;
  created_at: number;
}

interface DbMaterialRow {
  id: number;
  name: string;
  code: string;
  description: string;
  created_at: number;
}

interface DbTxRow {
  id: number;
  plant_id?: string | null;
  tx_code: string;
  type: 'INWARD' | 'OUTWARD';
  tx_date: string;
  tank_id: number;
  material_name: string;
  quantity_kg: number;
  quantity_mt: number;
  reference_number: string;
  document_number: string;
  party_name: string;
  vehicle_number: string;
  driver_name: string;
  remarks: string;
  created_by: string | null;
  created_at: number;
}

interface DbAuditRow {
  id: number;
  plant_id?: string | null;
  action: string;
  entity_type: string;
  summary: string;
  performed_by: string;
  created_at: number;
}

function fmtKG(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n || 0);
}

function fmtMT(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n || 0);
}

function rejectRestrictedOperators(req: Request, res: Response, next: NextFunction): void {
  const roleName = req.auth?.user.roleName;
  if (roleName === 'forklift_operator' || roleName === 'ex_factory_operator' || roleName === 'security_guard') {
    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: req.auth!.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'liquid_store',
      targetId: `${req.method} ${req.originalUrl}`,
      details: `Restricted operator (${roleName}) denied access to Liquid Material Camp Store`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({
      error: 'Access denied: Your account is restricted from accessing the Liquid Material Camp Store.',
    });
    return;
  }
  next();
}

function computeTankBalance(tank: DbTankRow, txList: DbTxRow[]) {
  const txs = txList.filter((t) => t.tank_id === tank.id);
  let inwardKg = 0;
  let outwardKg = 0;
  let lastTx: string | null = null;
  const matMap: Record<string, { materialName: string; inwardKg: number; outwardKg: number }> = {};

  for (const tx of txs) {
    if (!matMap[tx.material_name]) {
      matMap[tx.material_name] = { materialName: tx.material_name, inwardKg: 0, outwardKg: 0 };
    }
    if (tx.type === 'INWARD') {
      inwardKg += tx.quantity_kg;
      matMap[tx.material_name].inwardKg += tx.quantity_kg;
    } else {
      outwardKg += tx.quantity_kg;
      matMap[tx.material_name].outwardKg += tx.quantity_kg;
    }
    if (!lastTx || tx.tx_date > lastTx) lastTx = tx.tx_date;
  }

  const currentKg = inwardKg - outwardKg;
  const capKg = tank.total_capacity_kg;
  const emptyKg = Math.max(0, capKg - currentKg);
  const filledPct = capKg > 0 ? Math.min(100, Math.max(0, (currentKg / capKg) * 100)) : 0;
  const emptyPct = Math.max(0, 100 - filledPct);
  const filledM = tank.depth_meters * (filledPct / 100);
  const emptyM = Math.max(0, tank.depth_meters - filledM);

  const materials = Object.values(matMap).map((m) => ({
    materialName: m.materialName,
    inwardKg: m.inwardKg,
    outwardKg: m.outwardKg,
    balanceKg: m.inwardKg - m.outwardKg,
    balanceMt: (m.inwardKg - m.outwardKg) / 1000,
  }));

  const activeProds = materials.filter((m) => m.balanceKg > 0.0001).map((m) => m.materialName);

  return {
    id: tank.id,
    name: tank.name,
    totalCapacityKg: tank.total_capacity_kg,
    totalCapacityMt: capKg / 1000,
    depthMeters: tank.depth_meters,
    location: tank.location,
    notes: tank.notes,
    totalInwardKg: inwardKg,
    totalOutwardKg: outwardKg,
    currentStockKg: currentKg,
    currentStockMt: currentKg / 1000,
    emptyCapacityKg: emptyKg,
    emptyCapacityMt: emptyKg / 1000,
    filledPercentage: filledPct,
    emptyPercentage: emptyPct,
    filledMeters: filledM,
    emptyMeters: emptyM,
    lastTransactionAt: lastTx,
    materials,
    productLabel: activeProds.length ? activeProds.join(', ') : 'Empty',
    createdAt: tank.created_at,
  };
}

function validateAllLiquidTanks(tanks: DbTankRow[], txList: DbTxRow[]): string | null {
  for (const tank of tanks) {
    const st = computeTankBalance(tank, txList);
    if (st.currentStockKg < -0.0001) {
      return `Operation rejected: ${tank.name} stock would drop below 0 (${fmtKG(st.currentStockKg)} KG).`;
    }
    if (st.currentStockKg > tank.total_capacity_kg + 0.0001) {
      return `Operation rejected: ${tank.name} stock (${fmtKG(st.currentStockKg)} KG) exceeds capacity (${fmtKG(tank.total_capacity_kg)} KG).`;
    }
    for (const m of st.materials) {
      if (m.balanceKg < -0.0001) {
        return `Operation rejected: ${m.materialName} balance in ${tank.name} would become negative (${fmtKG(m.balanceKg)} KG).`;
      }
    }
  }
  return null;
}

function addLiquidAudit(action: string, entityType: string, summary: string, performedBy: string, plantId = 'RIYADH'): void {
  db.prepare(
    `INSERT INTO liquid_audit_logs (plant_id, action, entity_type, summary, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(normalizePlantId(plantId, 'RIYADH'), action, entityType, summary, performedBy, Date.now());
}

export function buildLiquidStoreState(rawPlantId = 'RIYADH') {
  const plantId = normalizePlantId(rawPlantId, 'RIYADH');
  seedLiquidStoreIfEmpty(plantId);

  const rawTanks = db
    .prepare(`SELECT * FROM liquid_tanks WHERE plant_id = ? ORDER BY id ASC`)
    .all(plantId) as DbTankRow[];
  const rawMaterials = db.prepare(`SELECT * FROM liquid_materials ORDER BY id ASC`).all() as DbMaterialRow[];
  const rawTxs = db
    .prepare(`SELECT * FROM liquid_transactions WHERE plant_id = ? ORDER BY tx_date DESC, id DESC`)
    .all(plantId) as DbTxRow[];
  const rawAudits = db
    .prepare(`SELECT * FROM liquid_audit_logs WHERE plant_id = ? ORDER BY id DESC LIMIT 300`)
    .all(plantId) as DbAuditRow[];
  const settingsRow = db.prepare(`SELECT data_json FROM liquid_settings WHERE plant_id = ?`).get(plantId) as
    | { data_json: string }
    | undefined;

  const plantLabel = plantId === 'RIYADH' ? 'Riyadh Plant' : plantId === 'JEDDAH' ? 'Jeddah Plant' : `${plantId} Plant`;
  let settings = {
    facilityName: `Liquid Material Camp Store — ${plantLabel}`,
    theme: 'light' as 'light' | 'dark',
  };
  if (settingsRow) {
    try {
      const parsed = JSON.parse(settingsRow.data_json);
      settings = {
        facilityName: String(parsed.facilityName || '').trim() || settings.facilityName,
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
      };
    } catch {
      // Keep defaults
    }
  }

  return {
    plantId,
    tanks: rawTanks.map((t) => computeTankBalance(t, rawTxs)),
    materials: rawMaterials.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      description: m.description,
      createdAt: m.created_at,
    })),
    transactions: rawTxs.map((tx) => ({
      id: tx.id,
      txCode: tx.tx_code,
      type: tx.type,
      txDate: tx.tx_date,
      tankId: tx.tank_id,
      materialName: tx.material_name,
      quantityKg: tx.quantity_kg,
      quantityMt: tx.quantity_mt,
      referenceNumber: tx.reference_number,
      documentNumber: tx.document_number,
      partyName: tx.party_name,
      vehicleNumber: tx.vehicle_number,
      driverName: tx.driver_name,
      remarks: tx.remarks,
      createdBy: tx.created_by || undefined,
      createdAt: tx.created_at,
    })),
    auditLogs: rawAudits.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entity_type,
      summary: a.summary,
      performedBy: a.performed_by,
      createdAt: a.created_at,
    })),
    settings,
  };
}

export const liquidRouter = express.Router();

// Protect all /api/liquid/* routes strictly
liquidRouter.use(
  requireAuth,
  requirePasswordChanged,
  rejectRestrictedOperators,
  requireAnyPermission(['liquid.view', 'liquid.store', 'liquid.materials'])
);

liquidRouter.get('/state', (req: Request, res: Response) => {
  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, req.query.plantId);
  if (!plantId) {
    res.status(403).json({ error: 'Access denied: You are not authorized to access this plant.' });
    return;
  }
  res.json(buildLiquidStoreState(plantId));
});

liquidRouter.post('/transactions', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const b = req.body || {};
  const type = b.type === 'OUTWARD' ? 'OUTWARD' : b.type === 'INWARD' ? 'INWARD' : null;
  const txDate = String(b.txDate || '').trim();
  const tankId = Number(b.tankId);
  const materialName = upperStr(b.materialName);
  const quantityKg = Number(b.quantityKg);
  const referenceNumber = upperStr(b.referenceNumber);
  const documentNumber = upperStr(b.documentNumber);
  const partyName = upperStr(b.partyName);
  const vehicleNumber = upperStr(b.vehicleNumber);
  const driverName = upperStr(b.driverName);
  const remarks = upperStr(b.remarks);

  if (!type) {
    res.status(400).json({ error: 'Transaction type must be INWARD or OUTWARD.' });
    return;
  }
  if (!txDate) {
    res.status(400).json({ error: 'Transaction date & time is required.' });
    return;
  }
  if (!Number.isInteger(tankId) || tankId <= 0) {
    res.status(400).json({ error: 'Valid tank selection is required.' });
    return;
  }
  if (!materialName) {
    res.status(400).json({ error: 'Material name is required.' });
    return;
  }
  if (!Number.isFinite(quantityKg) || quantityKg <= 0) {
    res.status(400).json({ error: 'Quantity (KG) must be greater than 0.' });
    return;
  }
  if (!referenceNumber) {
    res.status(400).json({ error: 'Reference Number is required.' });
    return;
  }
  if (!partyName) {
    res.status(400).json({ error: type === 'INWARD' ? 'Supplier Name is required.' : 'Customer / Department is required.' });
    return;
  }

  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, b.plantId || req.query.plantId);
  if (!plantId) {
    res.status(403).json({ error: 'Access denied: You are not authorized for this plant.' });
    return;
  }

  const quantityMt = quantityKg / 1000;
  const actorName = req.auth!.user.fullName;

  const result = db.transaction(() => {
    const tankRow = db.prepare(`SELECT * FROM liquid_tanks WHERE id = ?`).get(tankId) as DbTankRow | undefined;
    if (!tankRow) {
      return { errorStatus: 404 as const, error: 'Selected tank was not found.' };
    }
    const tankPlant = normalizePlantId(tankRow.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, tankPlant) || tankPlant !== plantId) {
      return { errorStatus: 403 as const, error: 'Access denied: Selected tank belongs to another plant.' };
    }

    const tanks = db.prepare(`SELECT * FROM liquid_tanks WHERE plant_id = ? ORDER BY id ASC`).all(tankPlant) as DbTankRow[];
    const tank = tanks.find((t) => t.id === tankId)!;

    const existingTxs = db.prepare(`SELECT * FROM liquid_transactions WHERE plant_id = ?`).all(tankPlant) as DbTxRow[];
    const previewList: DbTxRow[] = [
      ...existingTxs,
      {
        id: Number.MAX_SAFE_INTEGER,
        plant_id: tankPlant,
        tx_code: 'PREVIEW',
        type,
        tx_date: txDate,
        tank_id: tankId,
        material_name: materialName,
        quantity_kg: quantityKg,
        quantity_mt: quantityMt,
        reference_number: referenceNumber,
        document_number: documentNumber,
        party_name: partyName,
        vehicle_number: vehicleNumber,
        driver_name: driverName,
        remarks,
        created_by: actorName,
        created_at: Date.now(),
      },
    ];

    const validationErr = validateAllLiquidTanks(tanks, previewList);
    if (validationErr) {
      return { errorStatus: 400 as const, error: validationErr };
    }

    const now = Date.now();
    const maxRow = db.prepare(`SELECT COALESCE(MAX(id), 0) as maxId FROM liquid_transactions`).get() as {
      maxId: number;
    };
    const nextNum = (maxRow.maxId || 0) + 1;
    const prefix = type === 'INWARD' ? 'INW' : 'OUT';
    const plantTag = tankPlant === 'RIYADH' ? '' : `${tankPlant.slice(0, 3)}-`;
    const datePart = txDate.slice(0, 10).replaceAll('-', '') || new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const txCode = `${prefix}-${plantTag}${datePart}-${String(nextNum).padStart(4, '0')}`;

    const info = db
      .prepare(
        `INSERT INTO liquid_transactions (
          plant_id, tx_code, type, tx_date, tank_id, material_name, quantity_kg, quantity_mt,
          reference_number, document_number, party_name, vehicle_number, driver_name, remarks, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tankPlant,
        txCode,
        type,
        txDate,
        tankId,
        materialName,
        quantityKg,
        quantityMt,
        referenceNumber,
        documentNumber,
        partyName,
        vehicleNumber,
        driverName,
        remarks,
        actorName,
        now
      );

    addLiquidAudit(
      'CREATE',
      'TRANSACTION',
      `${type} ${txCode}: ${fmtKG(quantityKg)} KG (${fmtMT(quantityMt)} MT) ${materialName} (${tank.name})`,
      actorName,
      tankPlant
    );

    return { ok: true, id: Number(info.lastInsertRowid), txCode, plantId: tankPlant };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'LIQUID_TX_CREATED',
    targetType: 'liquid_transaction',
    targetId: result.txCode,
    details: `[${result.plantId}] ${type} ${result.txCode}: ${fmtKG(quantityKg)} KG ${materialName}`,
    ipAddress: getClientIp(req),
  });

  res.status(201).json({ state: buildLiquidStoreState(result.plantId), txCode: result.txCode });
});

liquidRouter.put('/transactions/:id', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const txId = Number(req.params.id);
  if (!Number.isInteger(txId) || txId <= 0) {
    res.status(400).json({ error: 'Invalid transaction ID.' });
    return;
  }

  const b = req.body || {};
  const txDate = String(b.txDate || '').trim();
  const tankId = Number(b.tankId);
  const materialName = upperStr(b.materialName);
  const quantityKg = Number(b.quantityKg);
  const referenceNumber = upperStr(b.referenceNumber);
  const documentNumber = upperStr(b.documentNumber);
  const partyName = upperStr(b.partyName);
  const vehicleNumber = upperStr(b.vehicleNumber);
  const driverName = upperStr(b.driverName);
  const remarks = upperStr(b.remarks);

  if (!txDate || !Number.isInteger(tankId) || tankId <= 0 || !materialName || !(quantityKg > 0) || !referenceNumber || !partyName) {
    res.status(400).json({ error: 'Please complete all required transaction fields with valid values.' });
    return;
  }

  const quantityMt = quantityKg / 1000;
  const actorName = req.auth!.user.fullName;

  const result = db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM liquid_transactions WHERE id = ?`).get(txId) as DbTxRow | undefined;
    if (!existing) {
      return { errorStatus: 404 as const, error: 'Transaction record not found.' };
    }
    const txPlant = normalizePlantId(existing.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, txPlant)) {
      return { errorStatus: 403 as const, error: 'Access denied: Transaction belongs to another plant.' };
    }

    const tanks = db.prepare(`SELECT * FROM liquid_tanks WHERE plant_id = ? ORDER BY id ASC`).all(txPlant) as DbTankRow[];
    const tank = tanks.find((t) => t.id === tankId);
    if (!tank) {
      return { errorStatus: 404 as const, error: 'Selected tank not found in this plant.' };
    }

    const nextType = b.type === 'OUTWARD' ? 'OUTWARD' : b.type === 'INWARD' ? 'INWARD' : existing.type;
    const allTxs = db.prepare(`SELECT * FROM liquid_transactions WHERE plant_id = ?`).all(txPlant) as DbTxRow[];
    const previewList = allTxs.map((row) =>
      row.id === txId
        ? {
            ...row,
            type: nextType,
            tx_date: txDate,
            tank_id: tankId,
            material_name: materialName,
            quantity_kg: quantityKg,
            quantity_mt: quantityMt,
            reference_number: referenceNumber,
            document_number: documentNumber,
            party_name: partyName,
            vehicle_number: vehicleNumber,
            driver_name: driverName,
            remarks,
          }
        : row
    );

    const validationErr = validateAllLiquidTanks(tanks, previewList);
    if (validationErr) {
      return { errorStatus: 400 as const, error: validationErr };
    }

    db.prepare(
      `UPDATE liquid_transactions
       SET type = ?, tx_date = ?, tank_id = ?, material_name = ?, quantity_kg = ?, quantity_mt = ?,
           reference_number = ?, document_number = ?, party_name = ?, vehicle_number = ?, driver_name = ?, remarks = ?
       WHERE id = ?`
    ).run(
      nextType,
      txDate,
      tankId,
      materialName,
      quantityKg,
      quantityMt,
      referenceNumber,
      documentNumber,
      partyName,
      vehicleNumber,
      driverName,
      remarks,
      txId
    );

    addLiquidAudit(
      'UPDATE',
      'TRANSACTION',
      `Updated ${existing.tx_code}: ${fmtKG(quantityKg)} KG ${materialName} in ${tank.name}`,
      actorName,
      txPlant
    );

    return { ok: true, txCode: existing.tx_code, plantId: txPlant };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'LIQUID_TX_UPDATED',
    targetType: 'liquid_transaction',
    targetId: result.txCode,
    details: `Updated ${result.txCode}: ${fmtKG(quantityKg)} KG ${materialName}`,
    ipAddress: getClientIp(req),
  });

  res.json({ state: buildLiquidStoreState(result.plantId), txCode: result.txCode });
});

liquidRouter.delete('/transactions/:id', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const txId = Number(req.params.id);
  if (!Number.isInteger(txId) || txId <= 0) {
    res.status(400).json({ error: 'Invalid transaction ID.' });
    return;
  }

  const actorName = req.auth!.user.fullName;

  const result = db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM liquid_transactions WHERE id = ?`).get(txId) as DbTxRow | undefined;
    if (!existing) {
      return { errorStatus: 404 as const, error: 'Transaction record not found.' };
    }
    const txPlant = normalizePlantId(existing.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, txPlant)) {
      return { errorStatus: 403 as const, error: 'Access denied: Transaction belongs to another plant.' };
    }

    const tanks = db.prepare(`SELECT * FROM liquid_tanks WHERE plant_id = ? ORDER BY id ASC`).all(txPlant) as DbTankRow[];
    const allTxs = db.prepare(`SELECT * FROM liquid_transactions WHERE plant_id = ?`).all(txPlant) as DbTxRow[];
    const remaining = allTxs.filter((row) => row.id !== txId);

    const validationErr = validateAllLiquidTanks(tanks, remaining);
    if (validationErr) {
      return { errorStatus: 400 as const, error: validationErr };
    }

    db.prepare(`DELETE FROM liquid_transactions WHERE id = ?`).run(txId);
    addLiquidAudit(
      'DELETE',
      'TRANSACTION',
      `Deleted ${existing.type} ${existing.tx_code} (${fmtKG(existing.quantity_kg)} KG ${existing.material_name})`,
      actorName,
      txPlant
    );

    return { ok: true, txCode: existing.tx_code, plantId: txPlant };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'LIQUID_TX_DELETED',
    targetType: 'liquid_transaction',
    targetId: result.txCode,
    details: `Deleted liquid transaction ${result.txCode}`,
    ipAddress: getClientIp(req),
  });

  res.json({ state: buildLiquidStoreState(result.plantId), txCode: result.txCode });
});

liquidRouter.post('/tanks', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const b = req.body || {};
  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, b.plantId || req.query.plantId);
  if (!plantId) {
    res.status(403).json({ error: 'Access denied: You are not authorized to add tanks for this plant.' });
    return;
  }
  const name = upperStr(b.name);
  const totalCapacityKg = Number(b.totalCapacityKg);
  const depthMeters = Number(b.depthMeters);
  const location = upperStr(b.location) || 'Main Storage Bay';
  const notes = upperStr(b.notes);

  if (!name) {
    res.status(400).json({ error: 'Tank Name is required.' });
    return;
  }
  if (!Number.isFinite(totalCapacityKg) || totalCapacityKg <= 0) {
    res.status(400).json({ error: 'Total Capacity (KG) must be greater than 0.' });
    return;
  }
  if (!Number.isFinite(depthMeters) || depthMeters <= 0) {
    res.status(400).json({ error: 'Tank Depth (Meters) must be greater than 0.' });
    return;
  }

  const existing = db.prepare(`SELECT id FROM liquid_tanks WHERE plant_id = ? AND name = ? COLLATE NOCASE`).get(plantId, name);
  if (existing) {
    res.status(409).json({ error: `Tank "${name}" already exists in ${plantId}.` });
    return;
  }

  const actorName = req.auth!.user.fullName;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO liquid_tanks (plant_id, name, total_capacity_kg, depth_meters, location, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(plantId, name, totalCapacityKg, depthMeters, location, notes, Date.now());

    addLiquidAudit(
      'TANK_CREATE',
      'TANK',
      `Created ${name} (${fmtMT(totalCapacityKg / 1000)} MT, ${depthMeters}m)`,
      actorName,
      plantId
    );
  })();

  res.status(201).json({ state: buildLiquidStoreState(plantId) });
});

liquidRouter.put('/tanks/:id', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const tankId = Number(req.params.id);
  if (!Number.isInteger(tankId) || tankId <= 0) {
    res.status(400).json({ error: 'Invalid tank ID.' });
    return;
  }

  const b = req.body || {};
  const name = upperStr(b.name);
  const totalCapacityKg = Number(b.totalCapacityKg);
  const depthMeters = Number(b.depthMeters);
  const location = upperStr(b.location) || 'Main Storage Bay';
  const notes = upperStr(b.notes);

  if (!name || !(totalCapacityKg > 0) || !(depthMeters > 0)) {
    res.status(400).json({ error: 'Tank Name, Capacity (KG), and Depth (m) must be valid positive values.' });
    return;
  }

  const actorName = req.auth!.user.fullName;
  const result = db.transaction(() => {
    const tank = db.prepare(`SELECT * FROM liquid_tanks WHERE id = ?`).get(tankId) as DbTankRow | undefined;
    if (!tank) {
      return { errorStatus: 404 as const, error: 'Tank record not found.' };
    }
    const tankPlant = normalizePlantId(tank.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, tankPlant)) {
      return { errorStatus: 403 as const, error: 'Access denied: Tank belongs to another plant.' };
    }
    const dup = db
      .prepare(`SELECT id FROM liquid_tanks WHERE plant_id = ? AND name = ? COLLATE NOCASE AND id != ?`)
      .get(tankPlant, name, tankId);
    if (dup) {
      return { errorStatus: 409 as const, error: `Tank "${name}" already exists in ${tankPlant}.` };
    }

    const tankTxs = db.prepare(`SELECT * FROM liquid_transactions WHERE tank_id = ?`).all(tankId) as DbTxRow[];
    const current = computeTankBalance(tank, tankTxs);
    if (totalCapacityKg < current.currentStockKg - 0.0001) {
      return {
        errorStatus: 400 as const,
        error: `Capacity cannot be less than current stock (${fmtKG(current.currentStockKg)} KG).`,
      };
    }

    db.prepare(
      `UPDATE liquid_tanks SET name = ?, total_capacity_kg = ?, depth_meters = ?, location = ?, notes = ? WHERE id = ?`
    ).run(name, totalCapacityKg, depthMeters, location, notes, tankId);

    addLiquidAudit(
      'TANK_UPDATE',
      'TANK',
      `Updated ${name} (${fmtMT(totalCapacityKg / 1000)} MT, ${depthMeters}m)`,
      actorName,
      tankPlant
    );
    return { ok: true, plantId: tankPlant };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  res.json({ state: buildLiquidStoreState(result.plantId) });
});

liquidRouter.delete('/tanks/:id', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const tankId = Number(req.params.id);
  if (!Number.isInteger(tankId) || tankId <= 0) {
    res.status(400).json({ error: 'Invalid tank ID.' });
    return;
  }

  const actorName = req.auth!.user.fullName;
  const result = db.transaction(() => {
    const tank = db.prepare(`SELECT * FROM liquid_tanks WHERE id = ?`).get(tankId) as DbTankRow | undefined;
    if (!tank) {
      return { errorStatus: 404 as const, error: 'Tank record not found.' };
    }
    const tankPlant = normalizePlantId(tank.plant_id, 'RIYADH');
    if (!userCanAccessPlant(req.auth!.user, tankPlant)) {
      return { errorStatus: 403 as const, error: 'Access denied: Tank belongs to another plant.' };
    }
    const tankTxs = db.prepare(`SELECT * FROM liquid_transactions WHERE tank_id = ?`).all(tankId) as DbTxRow[];
    const computed = computeTankBalance(tank, tankTxs);
    if (computed.currentStockKg > 0.0001) {
      return { errorStatus: 400 as const, error: `Cannot delete ${tank.name} while it holds stock.` };
    }
    if (tankTxs.length > 0) {
      return {
        errorStatus: 400 as const,
        error: `Cannot delete ${tank.name} because register transactions reference it.`,
      };
    }

    db.prepare(`DELETE FROM liquid_tanks WHERE id = ?`).run(tankId);
    addLiquidAudit('TANK_DELETE', 'TANK', `Deleted ${tank.name}`, actorName, tankPlant);
    return { ok: true, plantId: tankPlant };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  res.json({ state: buildLiquidStoreState(result.plantId) });
});

liquidRouter.post(
  '/materials',
  requireCsrf,
  requireAnyPermission(['liquid.store', 'liquid.materials']),
  (req: Request, res: Response) => {
  const b = req.body || {};
  const name = upperStr(b.name);
  const code = (upperStr(b.code) || name.slice(0, 8));
  const description = upperStr(b.description);

  if (!name) {
    res.status(400).json({ error: 'Material Name is required.' });
    return;
  }

  const existing = db.prepare(`SELECT id FROM liquid_materials WHERE name = ? COLLATE NOCASE`).get(name);
  if (existing) {
    res.status(409).json({ error: `Material "${name}" already exists.` });
    return;
  }

  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, b.plantId || req.query.plantId) || 'RIYADH';
  const actorName = req.auth!.user.fullName;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO liquid_materials (name, code, description, created_at) VALUES (?, ?, ?, ?)`
    ).run(name, code, description, Date.now());
    addLiquidAudit('CREATE', 'MATERIAL', `Added material ${name} (${code})`, actorName, plantId);
  })();

  res.status(201).json({ state: buildLiquidStoreState(plantId) });
});

liquidRouter.put(
  '/materials/:id',
  requireCsrf,
  requireAnyPermission(['liquid.store', 'liquid.materials']),
  (req: Request, res: Response) => {
  const matId = Number(req.params.id);
  if (!Number.isInteger(matId) || matId <= 0) {
    res.status(400).json({ error: 'Invalid material ID.' });
    return;
  }

  const b = req.body || {};
  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, b.plantId || req.query.plantId) || 'RIYADH';
  const name = upperStr(b.name);
  const code = (upperStr(b.code) || name.slice(0, 8));
  const description = upperStr(b.description);

  if (!name) {
    res.status(400).json({ error: 'Material Name is required.' });
    return;
  }

  const dup = db
    .prepare(`SELECT id FROM liquid_materials WHERE name = ? COLLATE NOCASE AND id != ?`)
    .get(name, matId);
  if (dup) {
    res.status(409).json({ error: `Material "${name}" already exists.` });
    return;
  }

  const actorName = req.auth!.user.fullName;
  const result = db.transaction(() => {
    const old = db.prepare(`SELECT * FROM liquid_materials WHERE id = ?`).get(matId) as DbMaterialRow | undefined;
    if (!old) {
      return { errorStatus: 404 as const, error: 'Material record not found.' };
    }
    if (old.name !== name) {
      db.prepare(`UPDATE liquid_transactions SET material_name = ? WHERE material_name = ? COLLATE NOCASE`).run(
        name,
        old.name
      );
    }
    db.prepare(`UPDATE liquid_materials SET name = ?, code = ?, description = ? WHERE id = ?`).run(
      name,
      code,
      description,
      matId
    );
    addLiquidAudit('UPDATE', 'MATERIAL', `Updated material ${old.name} -> ${name}`, actorName, plantId);
    return { ok: true };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  res.json({ state: buildLiquidStoreState(plantId) });
});

liquidRouter.delete(
  '/materials/:id',
  requireCsrf,
  requireAnyPermission(['liquid.store', 'liquid.materials']),
  (req: Request, res: Response) => {
  const matId = Number(req.params.id);
  if (!Number.isInteger(matId) || matId <= 0) {
    res.status(400).json({ error: 'Invalid material ID.' });
    return;
  }

  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, req.query.plantId || req.body?.plantId) || 'RIYADH';
  const actorName = req.auth!.user.fullName;
  const result = db.transaction(() => {
    const mat = db.prepare(`SELECT * FROM liquid_materials WHERE id = ?`).get(matId) as DbMaterialRow | undefined;
    if (!mat) {
      return { errorStatus: 404 as const, error: 'Material record not found.' };
    }
    const usedRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM liquid_transactions WHERE material_name = ? COLLATE NOCASE`)
      .get(mat.name) as { cnt: number };
    if (usedRow.cnt > 0) {
      return {
        errorStatus: 400 as const,
        error: `Cannot delete "${mat.name}" because ${usedRow.cnt} transaction(s) reference it.`,
      };
    }

    db.prepare(`DELETE FROM liquid_materials WHERE id = ?`).run(matId);
    addLiquidAudit('DELETE', 'MATERIAL', `Deleted material ${mat.name}`, actorName, plantId);
    return { ok: true };
  })();

  if ('errorStatus' in result && result.errorStatus) {
    res.status(result.errorStatus).json({ error: result.error });
    return;
  }

  res.json({ state: buildLiquidStoreState(plantId) });
});

liquidRouter.put('/settings', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const b = req.body || {};
  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, b.plantId || req.query.plantId);
  if (!plantId) {
    res.status(403).json({ error: 'Access denied: You are not authorized to configure settings for this plant.' });
    return;
  }
  const plantLabel = plantId === 'RIYADH' ? 'Riyadh Plant' : plantId === 'JEDDAH' ? 'Jeddah Plant' : `${plantId} Plant`;
  const facilityName = String(b.facilityName ?? '').trim() || `Liquid Material Camp Store — ${plantLabel}`;
  const theme = b.theme === 'dark' ? 'dark' : 'light';

  const nextSettings = { facilityName, theme };
  db.prepare(`INSERT OR REPLACE INTO liquid_settings (plant_id, data_json, updated_at) VALUES (?, ?, ?)`).run(
    plantId,
    JSON.stringify(nextSettings),
    Date.now()
  );

  res.json({ state: buildLiquidStoreState(plantId) });
});

liquidRouter.post('/reset', requireCsrf, requirePermission('liquid.store'), (req: Request, res: Response) => {
  const plantId = resolveAuthorizedPlantForUser(req.auth!.user, req.body?.plantId || req.query.plantId);
  if (!plantId) {
    res.status(403).json({ error: 'Access denied: You are not authorized to reset store data for this plant.' });
    return;
  }
  const actorName = req.auth!.user.fullName;
  resetLiquidStoreToDefault(actorName, plantId);

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'LIQUID_STORE_RESET',
    targetType: 'liquid_store',
    targetId: plantId,
    details: `[${plantId}] Reset Liquid Material Camp Store to default baseline tanks, materials, and opening stock`,
    ipAddress: getClientIp(req),
  });

  res.json({ state: buildLiquidStoreState(plantId) });
});
