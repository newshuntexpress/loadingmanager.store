import {
  TicketRecord,
  DriverMasterRecord,
  MaterialMasterRecord,
  CompanySettings,
  PlantSpecificSettings,
  LoadingSlipItem,
} from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';

export const DEFAULT_PLANTS = [
  { id: 'RIYADH', name: 'Riyadh Plant', code: 'RUH', city: 'Riyadh', isActive: true },
  { id: 'JEDDAH', name: 'Jeddah Plant', code: 'JED', city: 'Jeddah', isActive: true },
];

export const DEFAULT_JEDDAH_SETTINGS: PlantSpecificSettings = {
  companyName: 'ARABIAN WATERPROOFING CO. AWAZEL - JEDDAH',
  companySubtitle: 'Jeddah Plant • Material Dispatch, Gate Queue & Loading Slip Management System',
  logoDataUrl: '',
  storeInchargeSignatureDataUrl: '',
  address: 'Jeddah Industrial City, KSA',
  phone: '',
  email: '',
  gstin: '',
  gates: ['Gate 1', 'Gate 2', 'Gate 3'],
  ticketPrefix: 'AWZ-JED',
};

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: 'ARABIAN WATERPROOFING CO. AWAZEL',
  companySubtitle: 'Material Dispatch, Gate Queue & Loading Slip Management System',
  logoDataUrl: '',
  storeInchargeSignatureDataUrl: '',
  address: 'New industrial city 2 Riyadh KSA 11461',
  phone: '4981604',
  email: 'dispatch@shreebalajilogistics.com',
  gstin: '',
  gates: ['Gate 1', 'Gate 2', 'Gate 4', 'Gate 5', 'Gate 6'],
  ticketPrefix: 'AWZR',
  autoPrintTokenAfterSave: true,
  plants: DEFAULT_PLANTS,
  plantSettingsMap: {
    JEDDAH: { ...DEFAULT_JEDDAH_SETTINGS },
  },
};

export function mergeSettingsWithDefaults(incoming?: Partial<CompanySettings> | null): CompanySettings {
  const baseMap = DEFAULT_SETTINGS.plantSettingsMap || {};
  const incomingMap = incoming?.plantSettingsMap || {};
  const mergedMap: Record<string, PlantSpecificSettings> = {
    ...baseMap,
  };
  for (const [k, v] of Object.entries(incomingMap)) {
    const key = String(k || '').trim().toUpperCase();
    if (!key || !v || typeof v !== 'object') continue;
    mergedMap[key] = {
      ...(baseMap[key] || {}),
      ...v,
    };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...(incoming || {}),
    plantSettingsMap: mergedMap,
  };
}

export function resolveSettingsForPlant(
  settings: CompanySettings,
  plantId?: string
): CompanySettings {
  const normPlant = (plantId || 'RIYADH').trim().toUpperCase();
  if (!normPlant || normPlant === 'ALL' || normPlant === 'RIYADH') {
    const ruhOverride = settings.plantSettingsMap?.RIYADH;
    if (!ruhOverride) return settings;
    return {
      ...settings,
      companyName: ruhOverride.companyName?.trim() || settings.companyName,
      companySubtitle:
        ruhOverride.companySubtitle !== undefined ? ruhOverride.companySubtitle : settings.companySubtitle,
      logoDataUrl: ruhOverride.logoDataUrl || settings.logoDataUrl,
      storeInchargeSignatureDataUrl:
        ruhOverride.storeInchargeSignatureDataUrl || settings.storeInchargeSignatureDataUrl,
      address: ruhOverride.address !== undefined ? ruhOverride.address : settings.address,
      phone: ruhOverride.phone !== undefined ? ruhOverride.phone : settings.phone,
      email: ruhOverride.email !== undefined ? ruhOverride.email : settings.email,
      gstin: ruhOverride.gstin !== undefined ? ruhOverride.gstin : settings.gstin,
      ticketPrefix: ruhOverride.ticketPrefix?.trim().toUpperCase() || settings.ticketPrefix,
      gates:
        Array.isArray(ruhOverride.gates) && ruhOverride.gates.length > 0
          ? ruhOverride.gates
          : settings.gates,
    };
  }

  const storedOverride = settings.plantSettingsMap?.[normPlant];
  const fallbackOverride = normPlant === 'JEDDAH' ? DEFAULT_JEDDAH_SETTINGS : undefined;
  const override: PlantSpecificSettings | undefined = storedOverride
    ? { ...(fallbackOverride || {}), ...storedOverride }
    : fallbackOverride;

  const matchedPlant = settings.plants?.find((p) => p.id.toUpperCase() === normPlant);
  const plantCode = (
    matchedPlant?.code ||
    (normPlant === 'JEDDAH' ? 'JED' : normPlant.slice(0, 3))
  )
    .trim()
    .toUpperCase();

  const defaultCustomPrefix = (() => {
    const rawBase = (settings.ticketPrefix || 'AWZR').trim().toUpperCase() || 'AWZ';
    const root = rawBase === 'AWZR' ? 'AWZ' : rawBase;
    return root.endsWith(`-${plantCode}`) ? root : `${root}-${plantCode}`;
  })();

  return {
    ...settings,
    companyName:
      override?.companyName?.trim() ||
      (matchedPlant ? `${settings.companyName} - ${matchedPlant.name.toUpperCase()}` : settings.companyName),
    companySubtitle:
      override?.companySubtitle !== undefined
        ? override.companySubtitle
        : matchedPlant
        ? `${matchedPlant.name} • ${settings.companySubtitle}`
        : settings.companySubtitle,
    logoDataUrl: override?.logoDataUrl || settings.logoDataUrl,
    storeInchargeSignatureDataUrl:
      override?.storeInchargeSignatureDataUrl || settings.storeInchargeSignatureDataUrl,
    address:
      override?.address !== undefined
        ? override.address
        : matchedPlant?.city
        ? `${matchedPlant.city}, KSA`
        : settings.address,
    phone: override?.phone !== undefined ? override.phone : settings.phone,
    email: override?.email !== undefined ? override.email : settings.email,
    gstin: override?.gstin !== undefined ? override.gstin : settings.gstin,
    ticketPrefix: override?.ticketPrefix?.trim().toUpperCase() || defaultCustomPrefix,
    gates:
      Array.isArray(override?.gates) && override.gates.length > 0
        ? override.gates
        : Array.isArray(settings.plantGates?.[normPlant]) && settings.plantGates![normPlant].length > 0
        ? settings.plantGates![normPlant]
        : settings.gates,
  };
}

export function formatTicketNumberWithPlant(
  settings: CompanySettings,
  date: string,
  nextSeq: number,
  plantId?: string
): string {
  const effective = resolveSettingsForPlant(settings, plantId);
  const dateFormatted = date.replace(/-/g, '');
  const seqStr = String(nextSeq).padStart(3, '0');
  const prefix = (effective.ticketPrefix || 'AWZR').trim().toUpperCase() || 'TK';
  return `${prefix}-${dateFormatted}-${seqStr}`;
}

export function getTodayDateString(): string {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

export function getCurrentTimeString(): string {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
}

export function createEmpty8Rows(): LoadingSlipItem[] {
  return Array.from({ length: 8 }, (_, i) => ({
    srNo: i + 1,
    description: '',
    pack: '',
    palletRatio: '23',
    qty: '',
    pallets: '',
    looseRolls: '',
    remarks: '',
  }));
}

// In-memory cache synchronized with authenticated backend API (wiped on logout)
let cacheTickets: TicketRecord[] = [];
let cacheDrivers: DriverMasterRecord[] = [];
let cacheMaterials: MaterialMasterRecord[] = [];
let cacheSettings: CompanySettings = DEFAULT_SETTINGS;
let cacheDefaultSettings: CompanySettings = DEFAULT_SETTINGS;

// STORAGE & CACHE API
export const StorageService = {
  hydrateFromServer(payload: {
    tickets?: TicketRecord[];
    drivers?: DriverMasterRecord[];
    materials?: MaterialMasterRecord[];
    settings?: CompanySettings | null;
    defaultSettings?: CompanySettings | null;
  }): void {
    if (payload.tickets) {
      cacheTickets = payload.tickets.map((t) => ({
        ...t,
        driverPhone: formatSaudiPhoneNumber(t.driverPhone),
      }));
    }
    if (payload.drivers) {
      cacheDrivers = payload.drivers.map((d) => ({
        ...d,
        driverPhone: formatSaudiPhoneNumber(d.driverPhone),
      }));
    }
    if (payload.materials) {
      cacheMaterials = payload.materials.map((m) => ({
        ...m,
        materialName: (m.materialName || '').trim().toUpperCase(),
      }));
    }
    if (payload.defaultSettings) {
      cacheDefaultSettings = mergeSettingsWithDefaults(payload.defaultSettings);
    }
    if (payload.settings) {
      cacheSettings = mergeSettingsWithDefaults(payload.settings);
    }
  },

  clearCache(): void {
    cacheTickets = [];
    cacheDrivers = [];
    cacheMaterials = [];
    cacheSettings = DEFAULT_SETTINGS;
    cacheDefaultSettings = DEFAULT_SETTINGS;
  },

  getDefaultSettings(): CompanySettings {
    return cacheDefaultSettings;
  },

  saveAsDefaultSettings(settings: CompanySettings): void {
    const merged = mergeSettingsWithDefaults(settings);
    cacheDefaultSettings = merged;
    cacheSettings = merged;
  },

  getSettings(): CompanySettings {
    return cacheSettings;
  },

  saveSettings(settings: CompanySettings): void {
    cacheSettings = mergeSettingsWithDefaults(settings);
  },

  getTickets(): TicketRecord[] {
    return cacheTickets;
  },

  saveTickets(tickets: TicketRecord[]): void {
    cacheTickets = tickets.map((t) => ({
      ...t,
      driverPhone: formatSaudiPhoneNumber(t.driverPhone),
    }));
  },

  getDrivers(): DriverMasterRecord[] {
    return cacheDrivers;
  },

  saveDrivers(drivers: DriverMasterRecord[]): void {
    cacheDrivers = drivers.map((d) => ({
      ...d,
      driverPhone: formatSaudiPhoneNumber(d.driverPhone),
    }));
  },

  getMaterials(): MaterialMasterRecord[] {
    return cacheMaterials;
  },

  saveMaterials(materials: MaterialMasterRecord[]): void {
    cacheMaterials = materials.map((m) => ({
      ...m,
      materialName: (m.materialName || '').trim().toUpperCase(),
    }));
  },

  mergeMaterialsCache(added: MaterialMasterRecord[]): void {
    if (!added || added.length === 0) return;
    const map = new Map<string, MaterialMasterRecord>();
    for (const item of cacheMaterials) {
      map.set((item.materialName || '').trim().toUpperCase(), item);
    }
    for (const item of added) {
      const key = (item.materialName || '').trim().toUpperCase();
      if (key) {
        map.set(key, { ...item, materialName: key });
      }
    }
    cacheMaterials = Array.from(map.values()).sort((a, b) =>
      a.materialName.localeCompare(b.materialName)
    );
  },

  // Save or update driver in master
  updateDriverMaster(
    truckNumber: string,
    driverName: string,
    driverPhone: string,
    transporterName: string,
    destination?: string,
    iqamaNumber?: string
  ): void {
    if (!truckNumber.trim()) return;
    const cleanTruck = truckNumber.trim().toUpperCase();
    const cleanPhone = formatSaudiPhoneNumber(driverPhone);
    const drivers = this.getDrivers();
    const existingIndex = drivers.findIndex((d) => d.truckNumber.toUpperCase() === cleanTruck);

    if (existingIndex >= 0) {
      drivers[existingIndex] = {
        ...drivers[existingIndex],
        driverName: driverName.trim().toUpperCase() || drivers[existingIndex].driverName,
        driverPhone: cleanPhone || drivers[existingIndex].driverPhone,
        iqamaNumber: iqamaNumber?.trim().toUpperCase() || drivers[existingIndex].iqamaNumber,
        transporterName: transporterName.trim().toUpperCase() || drivers[existingIndex].transporterName,
        defaultDestination: destination?.trim().toUpperCase() || drivers[existingIndex].defaultDestination,
        lastVisited: getTodayDateString(),
        tripCount: (drivers[existingIndex].tripCount || 1) + 1,
      };
    } else {
      drivers.unshift({
        id: 'drv-' + Date.now(),
        truckNumber: cleanTruck,
        driverName: driverName.trim().toUpperCase(),
        driverPhone: cleanPhone,
        iqamaNumber: iqamaNumber?.trim().toUpperCase(),
        transporterName: transporterName.trim().toUpperCase(),
        defaultDestination: destination?.trim().toUpperCase(),
        lastVisited: getTodayDateString(),
        tripCount: 1,
      });
    }
    this.saveDrivers(drivers);
  },

  // Calculate Next Daily Sequence for a specific date & optional plant
  getNextDailySequence(date: string, plantId?: string): number {
    const tickets = this.getTickets();
    const normPlant = plantId && plantId !== 'ALL' ? plantId.trim().toUpperCase() : null;
    const dayTickets = tickets.filter((t) => {
      if (t.date !== date) return false;
      if (!normPlant) return true;
      return (t.plantId || 'RIYADH').toUpperCase() === normPlant;
    });
    if (dayTickets.length === 0) return 1;
    const maxSeq = Math.max(...dayTickets.map((t) => t.sequenceNumber || 0));
    return maxSeq + 1;
  },

  // Generate Automatic Ticket Number
  generateTicketNumber(date: string, nextSeq: number, plantId?: string): string {
    return formatTicketNumberWithPlant(this.getSettings(), date, nextSeq, plantId);
  },

  // Calculate current gate queue position for a ticket
  getGateQueueInfo(gateNumber: string, date: string, currentTicketId?: string): {
    currentLoading?: TicketRecord;
    calledTruck?: TicketRecord;
    waitingQueue: TicketRecord[];
    myPositionAtGate: number;
    aheadCount: number;
  } {
    const normGate = gateNumber.trim().toUpperCase();
    const tickets = this.getTickets().filter(
      (t) => t.date === date && (t.gateNumber || '').trim().toUpperCase() === normGate
    );
    const currentLoading = tickets.find((t) => t.status === 'under_loading');
    const calledTruck = tickets.find((t) => t.status === 'called');
    const waitingQueue = tickets
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    let myPositionAtGate = 1;
    let aheadCount = 0;

    if (currentTicketId) {
      const current = tickets.find((t) => t.id === currentTicketId);
      if (current) {
        if (current.status === 'under_loading') {
          myPositionAtGate = 0; // Currently loading
          aheadCount = 0;
        } else if (current.status === 'called') {
          myPositionAtGate = 1; // Called, at the gate
          aheadCount = 0;
        } else if (current.status === 'waiting') {
          const indexInWaiting = waitingQueue.findIndex((t) => t.id === currentTicketId);
          // Count active trucks ahead (under loading + called)
          const activeAhead = (currentLoading ? 1 : 0) + (calledTruck ? 1 : 0);
          myPositionAtGate = activeAhead + (indexInWaiting >= 0 ? indexInWaiting + 1 : waitingQueue.length + 1);
          aheadCount = activeAhead + (indexInWaiting >= 0 ? indexInWaiting : waitingQueue.length);
        } else {
          myPositionAtGate = 0;
          aheadCount = 0;
        }
      }
    } else {
      // For a new prospective ticket at this gate
      const activeAhead = (currentLoading ? 1 : 0) + (calledTruck ? 1 : 0);
      aheadCount = activeAhead + waitingQueue.length;
      myPositionAtGate = aheadCount + 1;
    }

    return {
      currentLoading,
      calledTruck,
      waitingQueue,
      myPositionAtGate,
      aheadCount,
    };
  },

  // Add a new ticket
  addTicket(data: Omit<TicketRecord, 'id' | 'createdAt' | 'updatedAt'>): TicketRecord {
    const tickets = this.getTickets();
    const formattedPhone = formatSaudiPhoneNumber(data.driverPhone);
    const newRecord: TicketRecord = {
      ...data,
      driverPhone: formattedPhone,
      id: 'tkt-' + Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      loadingSlip: data.loadingSlip || (data.delNoteNumber ? {
        delNoteNumber: data.delNoteNumber,
        placeName: data.destinationPlace || '',
        preparedBy: '',
        checkedBy: '',
        items: createEmpty8Rows(),
        totalQty: 0,
        totalPallets: 0,
        totalLooseRolls: 0,
        createdAt: data.date,
      } : undefined),
    };

    tickets.unshift(newRecord);
    this.saveTickets(tickets);

    // Auto-save to driver master
    this.updateDriverMaster(
      data.truckNumber,
      data.driverName,
      formattedPhone,
      data.transporterName,
      data.destinationPlace,
      data.iqamaNumber
    );

    return newRecord;
  },

  // Update existing ticket
  updateTicket(id: string, updates: Partial<TicketRecord>): TicketRecord | null {
    const tickets = this.getTickets();
    const idx = tickets.findIndex((t) => t.id === id);
    if (idx === -1) return null;

    const formattedUpdates = {
      ...updates,
      ...(updates.driverPhone ? { driverPhone: formatSaudiPhoneNumber(updates.driverPhone) } : {}),
      updatedAt: Date.now(),
    };

    const updated = {
      ...tickets[idx],
      ...formattedUpdates,
    };
    tickets[idx] = updated;
    this.saveTickets(tickets);

    // Auto update driver master if truck/driver modified
    if (updated.truckNumber) {
      this.updateDriverMaster(
        updated.truckNumber,
        updated.driverName,
        updated.driverPhone,
        updated.transporterName,
        updated.destinationPlace,
        updated.iqamaNumber
      );
    }

    return updated;
  },

  deleteTicket(id: string): void {
    const tickets = this.getTickets().filter((t) => t.id !== id);
    this.saveTickets(tickets);
  },

  restoreTicket(ticket: TicketRecord): void {
    const tickets = this.getTickets();
    if (!tickets.some((t) => t.id === ticket.id)) {
      tickets.push(ticket);
      this.saveTickets(tickets);
    }
  },

  // Export to CSV
  exportToCSV(tickets: TicketRecord[], dateStr?: string): void {
    const headers = [
      'Ticket No',
      'Daily Seq',
      'Date',
      'Time In',
      'Time Called',
      'Time Loading Started',
      'Time Completed',
      'Gate No',
      'Gate Seq No',
      'Truck No',
      'Driver Name',
      'Driver Phone',
      'ID / Iqama No',
      'Transporter',
      'Destination Place',
      'Loading Type',
      'Status',
      'Del Note No',
      'Forklift Operator / Loaded By',
      'Total Qty',
      'Total Pallets',
      'Total Loose Rolls',
      'Remarks',
    ];

    const formatStatus = (s: string) =>
      String(s || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const rows = tickets.map((t) => [
      t.ticketNumber,
      t.sequenceNumber,
      t.date,
      t.timeIn,
      t.timeCalled || '',
      t.timeLoadingStarted || '',
      t.timeCompleted || '',
      t.gateNumber,
      t.gateSequenceNumber,
      `"${t.truckNumber}"`,
      `"${t.driverName}"`,
      `"${t.driverPhone}"`,
      `"${t.iqamaNumber || ''}"`,
      `"${t.transporterName || ''}"`,
      `"${t.destinationPlace || ''}"`,
      resolveLoadingType(t).toUpperCase(),
      formatStatus(t.status),
      t.loadingSlip?.delNoteNumber || '',
      `"${t.loadingSlip?.loadedBy || t.loadingSlip?.checkedBy || ''}"`,
      t.loadingSlip?.totalQty || '',
      t.loadingSlip?.totalPallets || '',
      t.loadingSlip?.totalLooseRolls || '',
      `"${t.remarks || ''}"`,
    ]);

    const csvBody = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Loading_Tickets_${dateStr || getTodayDateString()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
};
