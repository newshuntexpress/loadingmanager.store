export type TruckStatus = 'waiting' | 'called' | 'under_loading' | 'completed' | 'cancelled';
export type TruckLoadingType = 'local' | 'export' | 'sto';

export interface LoadingSlipItem {
  srNo: number;
  description: string;
  pack: string;
  palletRatio?: string; // Auto-Pallet Ratio e.g. "23" (1 Pallet = 23 Rolls / Qty)
  qty: string;
  pallets: string;
  looseRolls: string;
  remarks?: string;
  isLoaded?: boolean;
  loadedQty?: string;
  loadedAt?: number;
  loadedByName?: string;
}

export interface LoadingSlipData {
  delNoteNumber: string;
  placeName: string;
  items: LoadingSlipItem[];
  totalQty: number;
  totalPallets: number;
  totalLooseRolls: number;
  preparedBy: string;
  checkedBy: string; // Now used for Forklift Operator / Loaded By
  loadedBy?: string;  // Forklift Operator / Loaded By
  storeInchargeUserId?: string; // User ID of Store Incharge who generated/signed the slip
  storeInchargeName?: string; // Logged-in user's full name for Store Incharge Signature
  storeInchargeSignatureDataUrl?: string; // Store Incharge per-user digital signature
  driverSignatureNotes?: string;
  createdAt: string;
  isLocked?: boolean;
  loadingCompletedAt?: number;
  loadingCompletedTime?: string;
  loadingCompletedBy?: string;
}

export interface PlantConfig {
  id: string;
  name: string;
  code: string;
  city?: string;
  isActive: boolean;
}

export interface LoadingAlertNotification {
  id: string;
  ticketId: string;
  ticketNumber: string;
  delNoteNumber: string;
  truckNumber: string;
  gateNumber: string;
  completedBy: string;
  completedTime: string;
  createdAt: number;
  plantId?: string;
}

export interface TicketRecord {
  id: string;
  plantId?: string;           // e.g. 'RIYADH', 'JEDDAH'
  ticketNumber: string;       // e.g. "TK-20261110-001"
  sequenceNumber: number;     // Daily sequence (1, 2, 3...)
  date: string;               // YYYY-MM-DD
  timeIn: string;             // HH:MM:SS
  timeCalled?: string;
  timeLoadingStarted?: string;
  timeCompleted?: string;
  gateNumber: string;         // e.g. "Gate 1", "Gate 2"
  gateSequenceNumber: number; // Position at this specific gate queue
  truckNumber: string;        // e.g. "5275 AXG"
  driverName: string;
  driverPhone: string;        // e.g. "0500000000"
  iqamaNumber?: string;       // ID / Iqama Number
  transporterName: string;
  destinationPlace: string;   // Place / destination name
  loadingType?: TruckLoadingType; // 'local' | 'export' | 'sto'
  delNoteNumber?: string;     // e.g. "A1DD00001" (Mandatory for ticket creation)
  status: TruckStatus;
  loadingSlip?: LoadingSlipData;
  remarks?: string;
  priority?: 'normal' | 'urgent';
  createdAt: number;
  updatedAt: number;
  autoLoadingMinutes?: number;
  autoUnderLoadingAt?: number;
  autoStatusUpdatedAt?: number;
  autoUnderLoadingApplied?: boolean;
  manualStatusOverride?: boolean;
  version?: number;
  createdBy?: string;
  updatedBy?: string;
  driverStatusToken?: string;
}

export interface DriverMasterRecord {
  id: string;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  iqamaNumber?: string;       // ID / Iqama Number
  transporterName: string;
  defaultDestination?: string;
  lastVisited: string;
  tripCount: number;
}

export interface MaterialMasterRecord {
  id: string;
  materialName: string;
  packType: string;
  palletRatio: number;
  remarks?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface PlantSpecificSettings {
  companyName?: string;
  companySubtitle?: string;
  logoDataUrl?: string;
  storeInchargeSignatureDataUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  ticketPrefix?: string;
  gates?: string[];
}

export interface CompanySettings {
  companyName: string;
  companySubtitle: string;
  logoDataUrl?: string;
  storeInchargeSignatureDataUrl?: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  gates: string[]; // ["Gate 1", "Gate 2", "Gate 3", "Gate 4"]
  ticketPrefix: string;
  autoPrintTokenAfterSave?: boolean; // New setting
  sessionIdleMinutes?: number;
  whatsappTemplates?: Record<string, string>;
  plants?: PlantConfig[];
  plantGates?: Record<string, string[]>;
  plantSettingsMap?: Record<string, PlantSpecificSettings>;
}

export interface PublicBranding {
  companyName?: string;
  companySubtitle?: string;
  logoDataUrl?: string;
}

export type UserRoleName =
  | 'admin'
  | 'user'
  | 'mmd_manager'
  | 'view_only'
  | 'forklift_operator'
  | 'liquid_store_operator'
  | 'ex_factory_operator'
  | 'security_guard';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  roleName: UserRoleName | string;
  roleDisplayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  permissions: string[];
  allowedPlants?: string[]; // ['ALL'] or e.g. ['RIYADH', 'JEDDAH']
  defaultPlantId?: string;
  activeSessionCount?: number;
  signatureDataUrl?: string;
}

export interface PermissionOption {
  id: string;
  key: string;
  name: string;
  category: string;
}

export interface RoleOption {
  id: string;
  name: string;
  displayName: string;
  description?: string;
}

export interface AuditLogEntry {
  id: number;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: number;
}

export interface ActiveSessionInfo {
  sessionRef: string;
  userId: string;
  username: string;
  fullName: string;
  roleName: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

export interface LiquidTankMaterialBalance {
  materialName: string;
  inwardKg: number;
  outwardKg: number;
  balanceKg: number;
  balanceMt: number;
}

export interface LiquidTankComputed {
  id: number;
  name: string;
  totalCapacityKg: number;
  totalCapacityMt: number;
  depthMeters: number;
  location: string;
  notes: string;
  totalInwardKg: number;
  totalOutwardKg: number;
  currentStockKg: number;
  currentStockMt: number;
  emptyCapacityKg: number;
  emptyCapacityMt: number;
  filledPercentage: number;
  emptyPercentage: number;
  filledMeters: number;
  emptyMeters: number;
  lastTransactionAt: string | null;
  materials: LiquidTankMaterialBalance[];
  productLabel: string;
  createdAt?: number;
}

export interface LiquidMaterial {
  id: number;
  name: string;
  code: string;
  description: string;
  createdAt?: number;
}

export interface LiquidTransaction {
  id: number;
  txCode: string;
  type: 'INWARD' | 'OUTWARD';
  txDate: string;
  tankId: number;
  materialName: string;
  quantityKg: number;
  quantityMt: number;
  referenceNumber: string;
  documentNumber?: string;
  partyName: string;
  vehicleNumber: string;
  driverName?: string;
  remarks: string;
  createdBy?: string;
  createdAt?: number;
}

export interface LiquidAuditLog {
  id: number;
  action: string;
  entityType: string;
  summary: string;
  performedBy: string;
  createdAt: number;
}

export interface LiquidStoreSettings {
  facilityName: string;
  theme: 'light' | 'dark';
}

export interface LiquidStoreState {
  tanks: LiquidTankComputed[];
  materials: LiquidMaterial[];
  transactions: LiquidTransaction[];
  auditLogs: LiquidAuditLog[];
  settings: LiquidStoreSettings;
  plantId?: string;
}

export interface ExFactoryEntry {
  id: string;
  plantId?: string;
  entryDate: string; // YYYY-MM-DD (automatic current date)
  delNoteNumber: string;
  customerName: string;
  loadingType?: TruckLoadingType;
  truckNumber: string;
  driverName: string;
  mobileNumber: string;
  iqamaNumber: string;
  loadingSlip?: LoadingSlipData;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DriverLiveStatusResponse {
  found: boolean;
  expired: boolean;
  expiredAt?: number;
  expiresAt?: number;
  remainingMs?: number;
  serverTimeMs: number;
  message?: string;
  branding?: PublicBranding;
  ticket?: {
    id: string;
    ticketNumber: string;
    delNoteNumber?: string;
    sequenceNumber: number;
    gateNumber: string;
    gateSequenceNumber: number;
    date: string;
    timeIn: string;
    timeCalled?: string;
    timeLoadingStarted?: string;
    timeCompleted?: string;
    truckNumber: string;
    driverName: string;
    driverPhone: string;
    destinationPlace?: string;
    transporterName?: string;
    status: TruckStatus;
    priority?: 'normal' | 'urgent';
    createdAt: number;
    hasLoadingSlip: boolean;
    slipLocked: boolean;
  };
  queue?: {
    gateNumber: string;
    trucksAhead: number;
    queuePosition: number;
    totalActiveAtGate: number;
    currentlyLoadingTruck: string | null;
    nextCalledTruck: string | null;
    waitingCount: number;
    calledCount: number;
    underLoadingCount: number;
  };
}

export interface WhatsAppNotificationLog {
  id: string;
  ticketId: string;
  ticketNumber: string;
  driverName: string;
  driverMobile: string;
  delNoteNumber: string;
  truckNumber: string;
  gateNumber: string;
  queueNumber: number;
  messageType: string;
  deliveryStatus: 'sent' | 'failed' | 'skipped';
  whatsappMessageId: string;
  errorMessage: string;
  driverStatusToken: string;
  messageBody: string;
  attemptCount: number;
  createdAt: number;
  sentAt: number | null;
  updatedAt: number;
}

export interface WhatsAppDispatchOutcome {
  triggered: boolean;
  duplicatePrevented: boolean;
  deliveryStatus: 'sent' | 'failed' | 'skipped';
  whatsappMessageId?: string;
  driverMobile?: string;
  liveStatusUrl: string;
  driverStatusToken: string;
  queueNumber: number;
  gateNumber: string;
  warning?: string;
  errorMessage?: string;
  log?: WhatsAppNotificationLog;
}

export interface DriverTokenStatusResponse {
  found: boolean;
  expired: boolean;
  expiredAt?: number;
  expiresAt?: number;
  remainingMs?: number;
  serverTimeMs: number;
  message?: string;
  branding?: PublicBranding;
  slip?: {
    delNoteNumber: string;
    truckNumber: string;
    gateNumber: string;
    queueNumber: number;
    queuePosition: number;
    trucksAhead: number;
    totalActiveAtGate: number;
    currentlyLoadingTruck: string | null;
    destinationPlace?: string;
    status: TruckStatus;
    statusLabel: string;
    progressPercent: number;
    stepIndex: number;
    totalItemsCount: number;
    loadedItemsCount: number;
    timeIn?: string;
    timeCalled?: string;
    timeLoadingStarted?: string;
    timeCompleted?: string;
    lastUpdatedAt: number;
  };
}


