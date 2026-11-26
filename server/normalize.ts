export function upperStr(val: unknown): string {
  return String(val ?? '').trim().toUpperCase();
}

const STANDARD_PACK_MAP = new Map<string, string>(
  ['Can', 'Drum', 'Board', 'EA', 'KG', 'Rolls', 'Pallet', 'Box'].map((opt) => [opt.toUpperCase(), opt])
);

function normalizePack(val: unknown): string {
  const raw = String(val ?? '').trim();
  if (!raw) return '';
  return STANDARD_PACK_MAP.get(raw.toUpperCase()) ?? raw.toUpperCase();
}

function trimStr(val: unknown): string {
  return String(val ?? '').trim();
}

export function normalizePlantId(val: unknown, fallback = 'RIYADH'): string {
  const clean = upperStr(val).replace(/[^A-Z0-9_-]/g, '');
  if (!clean) return fallback;
  if (clean === 'ALL') return fallback;
  return clean.slice(0, 32);
}

export function normalizeAllowedPlants(raw: unknown, roleName?: string): string[] {
  if (roleName === 'admin') return ['ALL'];
  if (!Array.isArray(raw)) return ['RIYADH', 'JEDDAH'];
  const cleaned: string[] = [];
  for (const item of raw) {
    const code = upperStr(item).replace(/[^A-Z0-9_-]/g, '');
    if (!code) continue;
    if (code === 'ALL') return ['ALL'];
    if (!cleaned.includes(code)) cleaned.push(code.slice(0, 32));
  }
  return cleaned.length > 0 ? cleaned : ['RIYADH'];
}

export function normalizePlantsList(raw: unknown): Array<{ id: string; name: string; code: string; city?: string; isActive: boolean }> {
  const defaults = [
    { id: 'RIYADH', name: 'Riyadh Plant', code: 'RUH', city: 'Riyadh', isActive: true },
    { id: 'JEDDAH', name: 'Jeddah Plant', code: 'JED', city: 'Jeddah', isActive: true },
  ];
  if (!Array.isArray(raw) || raw.length === 0) return defaults;
  const map = new Map<string, { id: string; name: string; code: string; city?: string; isActive: boolean }>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = normalizePlantId(obj.id || obj.code || obj.name, '');
    if (!id) continue;
    const name = trimStr(obj.name) || `${id.charAt(0)}${id.slice(1).toLowerCase()} Plant`;
    const code = upperStr(obj.code || id.slice(0, 4)).replace(/[^A-Z0-9_-]/g, '') || id.slice(0, 4);
    const city = trimStr(obj.city) || undefined;
    map.set(id, {
      id,
      name: name.slice(0, 80),
      code: code.slice(0, 12),
      ...(city ? { city: city.slice(0, 60) } : {}),
      isActive: obj.isActive !== false,
    });
  }
  for (const def of defaults) {
    if (!map.has(def.id)) {
      map.set(def.id, def);
    }
  }
  return Array.from(map.values());
}

export function normalizeLoadingType(val: unknown): 'local' | 'export' | 'sto' | undefined {
  const upper = upperStr(val);
  if (upper === 'EXPORT') return 'export';
  if (upper === 'STO') return 'sto';
  if (upper === 'LOCAL') return 'local';
  return undefined;
}

export function normalizeLoadingSlip<T extends Record<string, any> | undefined>(slip: T): T {
  if (!slip || typeof slip !== 'object') return slip;
  const items = Array.isArray(slip.items)
    ? slip.items.map((item: any, idx: number) => ({
        ...item,
        srNo: item.srNo ?? idx + 1,
        description: upperStr(item.description),
        pack: normalizePack(item.pack),
        qty: item.qty !== undefined && item.qty !== null ? upperStr(item.qty) : '',
        loadedQty: item.loadedQty !== undefined && item.loadedQty !== null ? upperStr(item.loadedQty) : undefined,
        pallets: item.pallets !== undefined && item.pallets !== null ? upperStr(item.pallets) : '',
        looseRolls: item.looseRolls !== undefined && item.looseRolls !== null ? upperStr(item.looseRolls) : '',
        palletRatio: item.palletRatio !== undefined && item.palletRatio !== null ? upperStr(item.palletRatio) : undefined,
        remarks: upperStr(item.remarks),
        loadedByName: item.loadedByName !== undefined ? trimStr(item.loadedByName) : undefined,
      }))
    : undefined;

  return {
    ...slip,
    ...(slip.delNoteNumber !== undefined ? { delNoteNumber: upperStr(slip.delNoteNumber) } : {}),
    ...(slip.placeName !== undefined ? { placeName: upperStr(slip.placeName) } : {}),
    ...(slip.remarks !== undefined ? { remarks: upperStr(slip.remarks) } : {}),
    ...(slip.preparedBy !== undefined ? { preparedBy: trimStr(slip.preparedBy) } : {}),
    ...(slip.forkliftOperatorName !== undefined ? { forkliftOperatorName: trimStr(slip.forkliftOperatorName) } : {}),
    ...(slip.verifiedBy !== undefined ? { verifiedBy: trimStr(slip.verifiedBy) } : {}),
    ...(slip.checkedBy !== undefined ? { checkedBy: trimStr(slip.checkedBy) } : {}),
    ...(slip.storeInchargeUserId !== undefined ? { storeInchargeUserId: trimStr(slip.storeInchargeUserId) } : {}),
    ...(slip.storeInchargeName !== undefined ? { storeInchargeName: trimStr(slip.storeInchargeName) } : {}),
    ...(slip.loadedBy !== undefined ? { loadedBy: trimStr(slip.loadedBy) } : {}),
    ...(slip.loadingCompletedTime !== undefined ? { loadingCompletedTime: trimStr(slip.loadingCompletedTime) } : {}),
    ...(slip.loadingCompletedBy !== undefined ? { loadingCompletedBy: trimStr(slip.loadingCompletedBy) } : {}),
    ...(items ? { items } : {}),
  } as T;
}

export function normalizeTicketRecord<T extends Record<string, any>>(ticket: T): T {
  if (!ticket || typeof ticket !== 'object') return ticket;
  return {
    ...ticket,
    plantId: normalizePlantId(ticket.plantId, 'RIYADH'),
    ...(ticket.ticketNumber !== undefined ? { ticketNumber: upperStr(ticket.ticketNumber) } : {}),
    ...(ticket.delNoteNumber !== undefined ? { delNoteNumber: upperStr(ticket.delNoteNumber) } : {}),
    ...(ticket.truckNumber !== undefined ? { truckNumber: upperStr(ticket.truckNumber) } : {}),
    ...(ticket.driverName !== undefined ? { driverName: upperStr(ticket.driverName) } : {}),
    ...(ticket.driverPhone !== undefined ? { driverPhone: upperStr(ticket.driverPhone) } : {}),
    ...(ticket.iqamaNumber !== undefined ? { iqamaNumber: upperStr(ticket.iqamaNumber) } : {}),
    ...(ticket.transporterName !== undefined ? { transporterName: upperStr(ticket.transporterName) } : {}),
    ...(ticket.destinationPlace !== undefined ? { destinationPlace: upperStr(ticket.destinationPlace) } : {}),
    ...(normalizeLoadingType(ticket.loadingType) !== undefined
      ? { loadingType: normalizeLoadingType(ticket.loadingType) }
      : {}),
    ...(ticket.gateNumber !== undefined ? { gateNumber: trimStr(ticket.gateNumber) } : {}),
    ...(ticket.remarks !== undefined ? { remarks: upperStr(ticket.remarks) } : {}),
    ...(ticket.timeIn !== undefined ? { timeIn: trimStr(ticket.timeIn) } : {}),
    ...(ticket.timeCalled !== undefined ? { timeCalled: trimStr(ticket.timeCalled) } : {}),
    ...(ticket.timeLoadingStarted !== undefined ? { timeLoadingStarted: trimStr(ticket.timeLoadingStarted) } : {}),
    ...(ticket.timeCompleted !== undefined ? { timeCompleted: trimStr(ticket.timeCompleted) } : {}),
    ...(ticket.timeLoadingCompleted !== undefined ? { timeLoadingCompleted: trimStr(ticket.timeLoadingCompleted) } : {}),
    ...(ticket.timeOut !== undefined ? { timeOut: trimStr(ticket.timeOut) } : {}),
    ...(ticket.createdBy !== undefined ? { createdBy: trimStr(ticket.createdBy) } : {}),
    ...(ticket.updatedBy !== undefined ? { updatedBy: trimStr(ticket.updatedBy) } : {}),
    ...(ticket.completedBy !== undefined ? { completedBy: trimStr(ticket.completedBy) } : {}),
    ...(ticket.releasedBy !== undefined ? { releasedBy: trimStr(ticket.releasedBy) } : {}),
    ...(ticket.loadingSlip !== undefined ? { loadingSlip: normalizeLoadingSlip(ticket.loadingSlip) } : {}),
  } as T;
}

export function normalizeDriverRecord<T extends Record<string, any>>(driver: T): T {
  if (!driver || typeof driver !== 'object') return driver;
  return {
    ...driver,
    ...(driver.truckNumber !== undefined ? { truckNumber: upperStr(driver.truckNumber) } : {}),
    ...(driver.driverName !== undefined ? { driverName: upperStr(driver.driverName) } : {}),
    ...(driver.driverPhone !== undefined ? { driverPhone: upperStr(driver.driverPhone) } : {}),
    ...(driver.iqamaNumber !== undefined ? { iqamaNumber: upperStr(driver.iqamaNumber) } : {}),
    ...(driver.transporterName !== undefined ? { transporterName: upperStr(driver.transporterName) } : {}),
    ...(driver.defaultDestination !== undefined ? { defaultDestination: upperStr(driver.defaultDestination) } : {}),
  } as T;
}

const ALLOWED_WHATSAPP_TEMPLATE_IDS = new Set([
  'gate_call',
  'token_generated',
  'under_loading',
  'completed_dispatch',
  'loading_slip_generated',
]);

export function normalizeWhatsAppTemplates(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_WHATSAPP_TEMPLATE_IDS.has(key)) continue;
    if (typeof val !== 'string') continue;
    const normalized = val.replace(/\r\n/g, '\n').slice(0, 4000);
    if (normalized.trim().length > 0) {
      result[key] = normalized;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizePlantSettingsMap(raw: unknown): Record<string, Record<string, unknown>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const plantId = normalizePlantId(rawKey, '');
    if (!plantId || !rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) continue;
    const obj = rawVal as Record<string, unknown>;
    const entry: Record<string, unknown> = {};
    if (obj.companyName !== undefined) entry.companyName = trimStr(obj.companyName).slice(0, 180);
    if (obj.companySubtitle !== undefined) entry.companySubtitle = trimStr(obj.companySubtitle).slice(0, 220);
    if (typeof obj.logoDataUrl === 'string' && obj.logoDataUrl.trim()) entry.logoDataUrl = obj.logoDataUrl.trim();
    if (typeof obj.storeInchargeSignatureDataUrl === 'string' && obj.storeInchargeSignatureDataUrl.trim()) {
      entry.storeInchargeSignatureDataUrl = obj.storeInchargeSignatureDataUrl.trim();
    }
    if (obj.address !== undefined) entry.address = trimStr(obj.address).slice(0, 300);
    if (obj.phone !== undefined) entry.phone = trimStr(obj.phone).slice(0, 80);
    if (obj.email !== undefined) entry.email = trimStr(obj.email).slice(0, 120);
    if (obj.gstin !== undefined) entry.gstin = trimStr(obj.gstin).slice(0, 80);
    if (obj.ticketPrefix !== undefined) {
      const pfx = upperStr(obj.ticketPrefix);
      if (pfx) entry.ticketPrefix = pfx.slice(0, 24);
    }
    if (Array.isArray(obj.gates)) {
      entry.gates = obj.gates.map((g: unknown) => trimStr(g)).filter(Boolean);
    }
    result[plantId] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizeSettingsRecord<T extends Record<string, any>>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const normalizedTemplates =
    settings.whatsappTemplates !== undefined ? normalizeWhatsAppTemplates(settings.whatsappTemplates) : undefined;
  const normalizedPlantSettingsMap =
    settings.plantSettingsMap !== undefined ? normalizePlantSettingsMap(settings.plantSettingsMap) : undefined;
  const rest = { ...settings };
  delete rest.whatsappTemplates;
  delete rest.plantSettingsMap;
  return {
    ...rest,
    ...(settings.companyName !== undefined ? { companyName: trimStr(settings.companyName) } : {}),
    ...(settings.companySubtitle !== undefined ? { companySubtitle: trimStr(settings.companySubtitle) } : {}),
    ...(settings.address !== undefined ? { address: trimStr(settings.address) } : {}),
    ...(settings.phone !== undefined ? { phone: trimStr(settings.phone) } : {}),
    ...(settings.email !== undefined ? { email: trimStr(settings.email) } : {}),
    ...(settings.gstin !== undefined ? { gstin: trimStr(settings.gstin) } : {}),
    ...(settings.ticketPrefix !== undefined ? { ticketPrefix: upperStr(settings.ticketPrefix) || 'TK' } : {}),
    ...(Array.isArray(settings.gates)
      ? { gates: settings.gates.map((g: unknown) => trimStr(g)).filter(Boolean) }
      : {}),
    plants: normalizePlantsList(settings.plants),
    ...(normalizedPlantSettingsMap ? { plantSettingsMap: normalizedPlantSettingsMap } : {}),
    ...(normalizedTemplates ? { whatsappTemplates: normalizedTemplates } : {}),
  } as T;
}
