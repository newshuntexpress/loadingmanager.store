import {
  TicketRecord,
  DriverMasterRecord,
  MaterialMasterRecord,
  CompanySettings,
  LoadingSlipItem,
} from '../types';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType } from '../utils/loadingType';

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
};

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
      cacheDefaultSettings = { ...DEFAULT_SETTINGS, ...payload.defaultSettings };
    }
    if (payload.settings) {
      cacheSettings = { ...DEFAULT_SETTINGS, ...payload.settings };
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
    cacheDefaultSettings = { ...DEFAULT_SETTINGS, ...settings };
    cacheSettings = { ...DEFAULT_SETTINGS, ...settings };
  },

  getSettings(): CompanySettings {
    return cacheSettings;
  },

  saveSettings(settings: CompanySettings): void {
    cacheSettings = { ...DEFAULT_SETTINGS, ...settings };
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

  // Calculate Next Daily Sequence for a specific date
  getNextDailySequence(date: string): number {
    const tickets = this.getTickets();
    const dayTickets = tickets.filter((t) => t.date === date);
    if (dayTickets.length === 0) return 1;
    const maxSeq = Math.max(...dayTickets.map((t) => t.sequenceNumber || 0));
    return maxSeq + 1;
  },

  // Generate Automatic Ticket Number
  generateTicketNumber(date: string, nextSeq: number): string {
    const settings = this.getSettings();
    const dateFormatted = date.replace(/-/g, '');
    const seqStr = String(nextSeq).padStart(3, '0');
    return `${settings.ticketPrefix}-${dateFormatted}-${seqStr}`;
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
      resolveLoadingType(t) === 'export' ? 'EXPORT' : 'LOCAL',
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
