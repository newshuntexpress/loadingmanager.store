import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { db, logAudit } from './db.ts';
import { syncMissingMaterialsFromLoadingSlip } from './materials.ts';
import { upperStr, normalizeLoadingSlip, normalizeLoadingType } from './normalize.ts';
import {
  getClientIp,
  requireAuth,
  requireCsrf,
  requirePasswordChanged,
  requirePermission,
  requireAnyPermission,
} from './security.ts';

interface DbExFactoryRow {
  id: string;
  entry_date: string;
  del_note_number: string;
  customer_name: string;
  loading_type?: string | null;
  truck_number: string;
  driver_name: string;
  mobile_number: string;
  iqama_number: string;
  loading_slip_json: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}

function getTodayPlantDateString(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function parseSlipJson(raw: string | null | undefined): Record<string, any> | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return normalizeLoadingSlip(parsed);
    }
  } catch {
    // Ignore malformed JSON
  }
  return undefined;
}

function mapRow(r: DbExFactoryRow) {
  const loadingSlip = parseSlipJson(r.loading_slip_json);
  const loadingType = normalizeLoadingType(r.loading_type) || 'local';
  return {
    id: r.id,
    entryDate: r.entry_date,
    delNoteNumber: upperStr(r.del_note_number),
    customerName: upperStr(r.customer_name),
    loadingType,
    truckNumber: upperStr(r.truck_number),
    driverName: upperStr(r.driver_name),
    mobileNumber: upperStr(r.mobile_number),
    iqamaNumber: upperStr(r.iqama_number),
    ...(loadingSlip ? { loadingSlip } : {}),
    createdBy: r.created_by || undefined,
    updatedBy: r.updated_by || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rejectRestrictedOperators(req: Request, res: Response, next: NextFunction): void {
  const roleName = req.auth?.user.roleName;
  if (roleName === 'forklift_operator' || roleName === 'liquid_store_operator' || roleName === 'security_guard') {
    logAudit({
      actorUserId: req.auth?.user.id,
      actorUsername: req.auth?.user.username,
      action: 'UNAUTHORIZED_ACCESS',
      targetType: 'ex_factory',
      targetId: `${req.method} ${req.originalUrl}`,
      details: `Restricted operator (${roleName}) denied access to Ex-Factory section`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({
      error: 'Access denied: Your account is restricted from accessing the Ex-Factory section.',
    });
    return;
  }
  next();
}

export const exFactoryRouter = express.Router();

exFactoryRouter.use(
  requireAuth,
  requirePasswordChanged,
  rejectRestrictedOperators,
  requireAnyPermission(['ex_factory.view', 'ex_factory.create', 'ex_factory.update', 'ex_factory.delete'])
);

exFactoryRouter.get('/', requirePermission('ex_factory.view'), (_req: Request, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM ex_factory_entries ORDER BY entry_date DESC, created_at DESC`)
    .all() as DbExFactoryRow[];
  res.json({ entries: rows.map(mapRow) });
});

exFactoryRouter.post('/', requirePermission('ex_factory.create'), requireCsrf, (req: Request, res: Response) => {
  const b = req.body || {};
  const rawDate = String(b.entryDate || '').trim();
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayPlantDateString();
  const delNoteNumber = upperStr(b.delNoteNumber);
  const customerName = upperStr(b.customerName);
  const loadingType = normalizeLoadingType(b.loadingType) || 'local';
  const truckNumber = upperStr(b.truckNumber);
  const driverName = upperStr(b.driverName);
  const mobileNumber = upperStr(b.mobileNumber);
  const iqamaNumber = upperStr(b.iqamaNumber);

  if (!delNoteNumber) {
    res.status(400).json({ error: 'Del Note No. is required.' });
    return;
  }
  if (!customerName) {
    res.status(400).json({ error: 'Customer Name is required.' });
    return;
  }
  if (!truckNumber) {
    res.status(400).json({ error: 'Truck No. is required.' });
    return;
  }

  const now = Date.now();
  const id = `exf-${now}-${crypto.randomBytes(3).toString('hex')}`;
  const actor = req.auth!.user.username;

  db.prepare(
    `INSERT INTO ex_factory_entries (
      id, entry_date, del_note_number, customer_name, loading_type, truck_number, driver_name, mobile_number, iqama_number, loading_slip_json,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
  ).run(
    id,
    entryDate,
    delNoteNumber,
    customerName,
    loadingType,
    truckNumber,
    driverName,
    mobileNumber,
    iqamaNumber,
    actor,
    actor,
    now,
    now
  );

  const created = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow;

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: actor,
    action: 'EX_FACTORY_CREATED',
    targetType: 'ex_factory',
    targetId: delNoteNumber,
    details: `Saved Ex-Factory entry DN: ${delNoteNumber}, Customer: ${customerName}, Truck: ${truckNumber}`,
    ipAddress: getClientIp(req),
  });

  res.status(201).json({ entry: mapRow(created) });
});

exFactoryRouter.put('/:id', requirePermission('ex_factory.update'), requireCsrf, (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  const existing = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Ex-Factory entry not found.' });
    return;
  }

  const b = req.body || {};
  const rawDate = String(b.entryDate || '').trim();
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : existing.entry_date;
  const delNoteNumber = upperStr(b.delNoteNumber);
  const customerName = upperStr(b.customerName);
  const loadingType = normalizeLoadingType(b.loadingType) || normalizeLoadingType(existing.loading_type) || 'local';
  const truckNumber = upperStr(b.truckNumber);
  const driverName = upperStr(b.driverName);
  const mobileNumber = upperStr(b.mobileNumber);
  const iqamaNumber = upperStr(b.iqamaNumber);

  if (!delNoteNumber || !customerName || !truckNumber) {
    res.status(400).json({ error: 'Del Note No., Customer Name, and Truck No. are required.' });
    return;
  }

  const now = Date.now();
  const actor = req.auth!.user.username;

  db.prepare(
    `UPDATE ex_factory_entries
     SET entry_date = ?, del_note_number = ?, customer_name = ?, loading_type = ?, truck_number = ?,
         driver_name = ?, mobile_number = ?, iqama_number = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`
  ).run(entryDate, delNoteNumber, customerName, loadingType, truckNumber, driverName, mobileNumber, iqamaNumber, actor, now, id);

  const updated = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow;

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: actor,
    action: 'EX_FACTORY_UPDATED',
    targetType: 'ex_factory',
    targetId: delNoteNumber,
    details: `Updated Ex-Factory entry DN: ${delNoteNumber}, Customer: ${customerName}, Truck: ${truckNumber}`,
    ipAddress: getClientIp(req),
  });

  res.json({ entry: mapRow(updated) });
});

exFactoryRouter.put(
  '/:id/loading-slip',
  requireAnyPermission(['ex_factory.update', 'ex_factory.create']),
  requireCsrf,
  (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    const existing = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ex-Factory entry not found.' });
      return;
    }

    const b = req.body || {};
    const rawSlip = b.loadingSlip;
    if (!rawSlip || typeof rawSlip !== 'object' || Array.isArray(rawSlip)) {
      res.status(400).json({ error: 'Loading slip payload is required.' });
      return;
    }

    const slipDelNote = upperStr(rawSlip.delNoteNumber || existing.del_note_number);
    const slipPlace = upperStr(rawSlip.placeName);
    if (!slipDelNote) {
      res.status(400).json({ error: 'Delivery Note Number is required on loading slip.' });
      return;
    }
    if (!slipPlace) {
      res.status(400).json({ error: 'Destination Place is required on loading slip.' });
      return;
    }

    const nextTruck = b.truckNumber !== undefined ? upperStr(b.truckNumber) || existing.truck_number : existing.truck_number;
    const nextDriver = b.driverName !== undefined ? upperStr(b.driverName) : existing.driver_name;
    const nextMobile = b.mobileNumber !== undefined ? upperStr(b.mobileNumber) : existing.mobile_number;

    const normalizedSlip = normalizeLoadingSlip({
      ...rawSlip,
      delNoteNumber: slipDelNote,
      placeName: slipPlace,
      storeInchargeUserId: req.auth!.user.id,
      storeInchargeName: req.auth!.user.fullName,
      storeInchargeSignatureDataUrl: req.auth!.user.signatureDataUrl || '',
    });

    const now = Date.now();
    const actor = req.auth!.user.username;

    db.prepare(
      `UPDATE ex_factory_entries
       SET del_note_number = ?, truck_number = ?, driver_name = ?, mobile_number = ?,
           loading_slip_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      slipDelNote,
      nextTruck,
      nextDriver,
      nextMobile,
      JSON.stringify(normalizedSlip),
      actor,
      now,
      id
    );

    const autoSavedMaterials = syncMissingMaterialsFromLoadingSlip(normalizedSlip.items, actor);

    const updated = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow;

    logAudit({
      actorUserId: req.auth!.user.id,
      actorUsername: actor,
      action: 'EX_FACTORY_SLIP_SAVED',
      targetType: 'ex_factory',
      targetId: slipDelNote,
      details: `Saved Ex-Factory loading slip for DN ${slipDelNote} (${nextTruck}, Qty: ${normalizedSlip.totalQty || 0}, Pallets: ${normalizedSlip.totalPallets || 0})`,
      ipAddress: getClientIp(req),
    });

    res.json({
      entry: mapRow(updated),
      ...(autoSavedMaterials.length > 0 ? { autoSavedMaterials } : {}),
    });
  }
);

exFactoryRouter.delete('/:id', requirePermission('ex_factory.delete'), requireCsrf, (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  const existing = db.prepare(`SELECT * FROM ex_factory_entries WHERE id = ?`).get(id) as DbExFactoryRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Ex-Factory entry not found.' });
    return;
  }

  db.prepare(`DELETE FROM ex_factory_entries WHERE id = ?`).run(id);

  logAudit({
    actorUserId: req.auth!.user.id,
    actorUsername: req.auth!.user.username,
    action: 'EX_FACTORY_DELETED',
    targetType: 'ex_factory',
    targetId: existing.del_note_number,
    details: `Deleted Ex-Factory entry DN: ${existing.del_note_number} (${existing.truck_number})`,
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true });
});
