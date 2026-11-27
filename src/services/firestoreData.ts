import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  DEFAULT_ADMIN_EMAIL,
  getDefaultPermissionsForRole,
  handleFirestoreError,
  OperationType,
  ROLE_DISPLAY_NAME_MAP,
  ALL_PLANT_PERMISSIONS,
} from '../firebase';
import type {
  AuditLogEntry,
  AuthUser,
  CompanySettings,
  ExFactoryEntry,
  LoadingSlipData,
  LoadingSlipItem,
  MaterialMasterRecord,
  TicketRecord,
  TruckLoadingType,
  TruckStatus,
} from '../types';
import { mergeSettingsWithDefaults } from './storage';

const activeWriteLocks = new Map<string, Promise<void>>();

async function withDocLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = activeWriteLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  activeWriteLocks.set(key, chained);
  await prev;
  try {
    return await task();
  } finally {
    release();
    if (activeWriteLocks.get(key) === chained) {
      activeWriteLocks.delete(key);
    }
  }
}

function safeId(raw: string, prefix = 'rec'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  if (cleaned.length >= 1) return cleaned;
  return `${prefix}_${Date.now()}`;
}

function clampStr(raw: unknown, maxLen: number, fallback = ''): string {
  const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  const val = s || fallback;
  return val.slice(0, maxLen);
}

function normalizeDateStr(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeStatus(raw: unknown): TruckStatus {
  switch (raw) {
    case 'waiting':
    case 'called':
    case 'under_loading':
    case 'completed':
    case 'cancelled':
      return raw;
    default:
      return 'waiting';
  }
}

function timestampToMillis(val: unknown, fallback = Date.now()): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function sanitizeLoadingSlip(slip: LoadingSlipData): Record<string, unknown> {
  const safeItems: Array<Record<string, unknown>> = (Array.isArray(slip.items) ? slip.items : [])
    .slice(0, 50)
    .map((item: LoadingSlipItem, idx: number) => {
      const cleanItem: Record<string, unknown> = {
        srNo: Number.isFinite(Number(item.srNo)) ? Number(item.srNo) : idx + 1,
        description: clampStr(item.description, 200),
        pack: clampStr(item.pack, 40),
        qty: clampStr(item.qty, 32),
        pallets: clampStr(item.pallets, 32),
        looseRolls: clampStr(item.looseRolls, 32),
      };
      if (item.palletRatio !== undefined) cleanItem.palletRatio = clampStr(item.palletRatio, 24);
      if (item.remarks !== undefined) cleanItem.remarks = clampStr(item.remarks, 200);
      if (typeof item.isLoaded === 'boolean') cleanItem.isLoaded = item.isLoaded;
      if (item.loadedQty !== undefined) cleanItem.loadedQty = clampStr(item.loadedQty, 32);
      if (typeof item.loadedAt === 'number' && Number.isFinite(item.loadedAt)) {
        cleanItem.loadedAt = item.loadedAt;
      }
      if (item.loadedByName !== undefined) cleanItem.loadedByName = clampStr(item.loadedByName, 120);
      return cleanItem;
    });

  const out: Record<string, unknown> = {
    delNoteNumber: clampStr(slip.delNoteNumber, 64),
    placeName: clampStr(slip.placeName, 160),
    items: safeItems,
    totalQty: Number.isFinite(Number(slip.totalQty)) ? Number(slip.totalQty) : 0,
    totalPallets: Number.isFinite(Number(slip.totalPallets)) ? Number(slip.totalPallets) : 0,
    totalLooseRolls: Number.isFinite(Number(slip.totalLooseRolls)) ? Number(slip.totalLooseRolls) : 0,
    preparedBy: clampStr(slip.preparedBy, 120),
    checkedBy: clampStr(slip.checkedBy, 120),
    createdAt: clampStr(slip.createdAt, 64, new Date().toISOString()),
  };

  if (slip.loadedBy) out.loadedBy = clampStr(slip.loadedBy, 120);
  if (slip.storeInchargeUserId) out.storeInchargeUserId = clampStr(slip.storeInchargeUserId, 128);
  if (slip.storeInchargeName) out.storeInchargeName = clampStr(slip.storeInchargeName, 120);
  if (
    slip.storeInchargeSignatureDataUrl &&
    slip.storeInchargeSignatureDataUrl.length <= 300_000
  ) {
    out.storeInchargeSignatureDataUrl = slip.storeInchargeSignatureDataUrl;
  }
  if (slip.driverSignatureNotes) out.driverSignatureNotes = clampStr(slip.driverSignatureNotes, 500);
  if (typeof slip.isLocked === 'boolean') out.isLocked = slip.isLocked;
  if (typeof slip.loadingCompletedAt === 'number' && Number.isFinite(slip.loadingCompletedAt)) {
    out.loadingCompletedAt = slip.loadingCompletedAt;
  }
  if (slip.loadingCompletedTime) out.loadingCompletedTime = clampStr(slip.loadingCompletedTime, 32);
  if (slip.loadingCompletedBy) out.loadingCompletedBy = clampStr(slip.loadingCompletedBy, 120);

  return out;
}

function buildTicketMutableFields(ticket: TicketRecord, actorLabel: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    plantId: clampStr(ticket.plantId || 'RIYADH', 32, 'RIYADH').toUpperCase(),
    gateNumber: clampStr(ticket.gateNumber, 40, 'Gate 1'),
    gateSequenceNumber: Math.max(0, Math.round(Number(ticket.gateSequenceNumber) || 0)),
    truckNumber: clampStr(ticket.truckNumber, 40, 'UNKNOWN'),
    driverName: clampStr(ticket.driverName, 120, 'DRIVER'),
    status: normalizeStatus(ticket.status),
    isSharedPlant: true,
    updatedBy: clampStr(ticket.updatedBy || actorLabel, 120),
    updatedAt: serverTimestamp(),
  };

  if (ticket.timeCalled !== undefined) fields.timeCalled = clampStr(ticket.timeCalled, 32);
  if (ticket.timeLoadingStarted !== undefined) {
    fields.timeLoadingStarted = clampStr(ticket.timeLoadingStarted, 32);
  }
  if (ticket.timeCompleted !== undefined) fields.timeCompleted = clampStr(ticket.timeCompleted, 32);
  if (ticket.transporterName !== undefined) {
    fields.transporterName = clampStr(ticket.transporterName, 120);
  }
  if (ticket.destinationPlace !== undefined) {
    fields.destinationPlace = clampStr(ticket.destinationPlace, 160);
  }
  if (
    ticket.loadingType === 'local' ||
    ticket.loadingType === 'export' ||
    ticket.loadingType === 'sto'
  ) {
    fields.loadingType = ticket.loadingType;
  }
  if (ticket.delNoteNumber !== undefined) fields.delNoteNumber = clampStr(ticket.delNoteNumber, 64);
  if (ticket.loadingSlip) fields.loadingSlip = sanitizeLoadingSlip(ticket.loadingSlip);
  if (ticket.remarks !== undefined) fields.remarks = clampStr(ticket.remarks, 500);
  if (ticket.priority === 'normal' || ticket.priority === 'urgent') {
    fields.priority = ticket.priority;
  }
  if (typeof ticket.version === 'number' && Number.isFinite(ticket.version)) {
    fields.version = ticket.version;
  }

  return fields;
}

export async function saveGateTicketToFirestore(
  ticket: TicketRecord,
  options?: { createOnly?: boolean }
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = safeId(user.uid, 'usr');
  const ticketId = safeId(ticket.id, 'tk');
  const actorLabel = clampStr(user.displayName || user.email || 'user', 120);

  return withDocLock(`gate_tickets/${ticketId}`, async () => {
    const ticketRef = doc(db, 'gate_tickets', ticketId);
    const piiRef = doc(db, 'gate_tickets', ticketId, 'private', 'driver');
    const mutableFields = buildTicketMutableFields(ticket, actorLabel);
    const driverPhone = clampStr(ticket.driverPhone, 32);
    const iqamaNumber = clampStr(ticket.iqamaNumber, 40);

    let currentOp = OperationType.GET;
    let ticketAlreadyExisted = false;
    let ticketOwnerUid = uid;

    try {
      await runTransaction(db, async (tx) => {
        currentOp = OperationType.GET;
        const existingSnap = await tx.get(ticketRef);

        if (!existingSnap.exists()) {
          currentOp = OperationType.CREATE;
          const createPayload: Record<string, unknown> = {
            id: ticketId,
            ticketNumber: clampStr(ticket.ticketNumber, 64, ticketId),
            sequenceNumber: Math.max(0, Math.round(Number(ticket.sequenceNumber) || 0)),
            date: normalizeDateStr(ticket.date),
            timeIn: clampStr(ticket.timeIn, 32, '00:00:00'),
            ownerUid: uid,
            createdBy: clampStr(ticket.createdBy || actorLabel, 120),
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          const piiPayload: Record<string, unknown> = {
            ticketId,
            ownerUid: uid,
            driverPhone,
            ...(iqamaNumber ? { iqamaNumber } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          tx.set(ticketRef, createPayload);
          tx.set(piiRef, piiPayload);
          ticketOwnerUid = uid;
          ticketAlreadyExisted = false;
          return;
        }

        const existingTicketData = existingSnap.data();
        ticketOwnerUid = clampStr(existingTicketData?.ownerUid || uid, 128);
        ticketAlreadyExisted = true;
        if (options?.createOnly) {
          return;
        }

        const rawExistingPlant =
          typeof existingTicketData?.plantId === 'string'
            ? existingTicketData.plantId.trim().toUpperCase()
            : '';
        const existingPlant =
          typeof existingTicketData?.plantId === 'string' &&
          /^[A-Z0-9_-]{1,32}$/.test(existingTicketData.plantId)
            ? existingTicketData.plantId
            : rawExistingPlant && /^[A-Z0-9_-]{1,32}$/.test(rawExistingPlant)
            ? rawExistingPlant
            : mutableFields.plantId;
        const existingSeqNum = Number(existingTicketData?.sequenceNumber);
        const preservedSeq =
          typeof existingTicketData?.sequenceNumber === 'number' &&
          Number.isFinite(existingSeqNum) &&
          existingSeqNum >= 0
            ? existingTicketData.sequenceNumber
            : Math.max(0, Math.round(Number(ticket.sequenceNumber) || 0));
        const existingCreatedAt = existingTicketData?.createdAt;
        const hasValidCreatedAt =
          Boolean(existingCreatedAt) &&
          typeof existingCreatedAt === 'object' &&
          typeof (existingCreatedAt as { toMillis?: unknown }).toMillis === 'function';

        const rawExistingTicketNum = existingTicketData?.ticketNumber;
        const preservedTicketNumber =
          typeof rawExistingTicketNum === 'string' &&
          rawExistingTicketNum.length >= 1 &&
          rawExistingTicketNum.length <= 64
            ? rawExistingTicketNum
            : clampStr(ticket.ticketNumber, 64, ticketId);

        const rawExistingDate = existingTicketData?.date;
        const preservedDate =
          typeof rawExistingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawExistingDate)
            ? rawExistingDate
            : normalizeDateStr(ticket.date);

        const rawExistingTimeIn = existingTicketData?.timeIn;
        const preservedTimeIn =
          typeof rawExistingTimeIn === 'string' && rawExistingTimeIn.length <= 32
            ? rawExistingTimeIn
            : clampStr(ticket.timeIn, 32, '00:00:00');

        const rawExistingOwner = existingTicketData?.ownerUid;
        const preservedOwnerUid =
          typeof rawExistingOwner === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawExistingOwner)
            ? rawExistingOwner
            : uid;

        const rawExistingCreatedBy = existingTicketData?.createdBy;
        const preservedCreatedByEntry =
          typeof rawExistingCreatedBy === 'string'
            ? {
                createdBy:
                  rawExistingCreatedBy.length <= 120
                    ? rawExistingCreatedBy
                    : clampStr(rawExistingCreatedBy, 120),
              }
            : {};

        const cleanUpdatePayload: Record<string, unknown> = {
          id: ticketId,
          ticketNumber: preservedTicketNumber,
          sequenceNumber: preservedSeq,
          date: preservedDate,
          timeIn: preservedTimeIn,
          ownerUid: preservedOwnerUid,
          ...preservedCreatedByEntry,
          ...mutableFields,
          plantId: existingPlant,
          createdAt: hasValidCreatedAt ? existingCreatedAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        currentOp = OperationType.UPDATE;
        tx.set(ticketRef, cleanUpdatePayload);
      });
    } catch (error) {
      handleFirestoreError(error, currentOp, `gate_tickets/${ticketId}`);
    }

    if (!ticketAlreadyExisted || options?.createOnly) {
      return;
    }

    // Update driver PII subcollection when authorized (ticket owner or admin)
    try {
      const piiSnap = await getDoc(piiRef);
      if (piiSnap.exists()) {
        await updateDoc(piiRef, {
          driverPhone,
          ...(iqamaNumber ? { iqamaNumber } : {}),
          updatedAt: serverTimestamp(),
        });
      } else if (ticketOwnerUid === uid || user.email?.toLowerCase() === DEFAULT_ADMIN_EMAIL) {
        await setDoc(piiRef, {
          ticketId,
          ownerUid: uid,
          driverPhone,
          ...(iqamaNumber ? { iqamaNumber } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-owner operators without PII access still save operational gate ticket updates cleanly
    }
  });
}

export async function deleteGateTicketFromFirestore(ticketId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cleanId = safeId(ticketId, 'tk');
  return withDocLock(`gate_tickets/${cleanId}`, async () => {
    const ticketRef = doc(db, 'gate_tickets', cleanId);
    const piiRef = doc(db, 'gate_tickets', cleanId, 'private', 'driver');

    try {
      try {
        await deleteDoc(piiRef);
      } catch {
        // Subdoc may not exist or caller may lack subdoc delete access
      }
      await deleteDoc(ticketRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `gate_tickets/${cleanId}`);
    }
  });
}

function mapFirestoreDocToTicket(
  docId: string,
  d: Record<string, unknown>,
  fallbackPii?: { driverPhone?: string; iqamaNumber?: string }
): TicketRecord {
  const createdAt = timestampToMillis(d.createdAt);
  const updatedAt = timestampToMillis(d.updatedAt, createdAt);
  const plantId =
    typeof d.plantId === 'string' && d.plantId.trim()
      ? d.plantId.trim().toUpperCase()
      : 'RIYADH';

  return {
    id: String(d.id || docId),
    plantId,
    ticketNumber: String(d.ticketNumber || docId),
    sequenceNumber: Number(d.sequenceNumber || 0),
    date: String(d.date || normalizeDateStr(undefined)),
    timeIn: String(d.timeIn || ''),
    timeCalled: typeof d.timeCalled === 'string' ? d.timeCalled : undefined,
    timeLoadingStarted:
      typeof d.timeLoadingStarted === 'string' ? d.timeLoadingStarted : undefined,
    timeCompleted: typeof d.timeCompleted === 'string' ? d.timeCompleted : undefined,
    gateNumber: String(d.gateNumber || 'Gate 1'),
    gateSequenceNumber: Number(d.gateSequenceNumber || 0),
    truckNumber: String(d.truckNumber || ''),
    driverName: String(d.driverName || ''),
    driverPhone: fallbackPii?.driverPhone || '',
    iqamaNumber: fallbackPii?.iqamaNumber || '',
    transporterName: String(d.transporterName || ''),
    destinationPlace: String(d.destinationPlace || ''),
    loadingType:
      d.loadingType === 'local' || d.loadingType === 'export' || d.loadingType === 'sto'
        ? d.loadingType
        : undefined,
    delNoteNumber: typeof d.delNoteNumber === 'string' ? d.delNoteNumber : undefined,
    status: normalizeStatus(d.status),
    loadingSlip: d.loadingSlip as LoadingSlipData | undefined,
    remarks: typeof d.remarks === 'string' ? d.remarks : undefined,
    priority: d.priority === 'urgent' || d.priority === 'normal' ? d.priority : 'normal',
    version: typeof d.version === 'number' ? d.version : undefined,
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : undefined,
    updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : undefined,
    createdAt,
    updatedAt,
  };
}

export async function getGateTicketFromFirestore(ticketId: string): Promise<TicketRecord | null> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;
  const cleanId = safeId(ticketId, 'tk');
  try {
    let targetDocId = cleanId;
    let docData: Record<string, unknown> | null = null;
    const snap = await getDoc(doc(db, 'gate_tickets', cleanId));
    if (snap.exists()) {
      docData = snap.data() as Record<string, unknown>;
    } else {
      const q = query(
        collection(db, 'gate_tickets'),
        where('isSharedPlant', '==', true),
        where('id', '==', ticketId)
      );
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        targetDocId = qSnap.docs[0].id;
        docData = qSnap.docs[0].data() as Record<string, unknown>;
      }
    }
    if (!docData) return null;
    const rec = mapFirestoreDocToTicket(targetDocId, docData);
    try {
      const piiSnap = await getDoc(doc(db, 'gate_tickets', targetDocId, 'private', 'driver'));
      if (piiSnap.exists()) {
        const pii = piiSnap.data();
        if (typeof pii.driverPhone === 'string') rec.driverPhone = pii.driverPhone;
        if (typeof pii.iqamaNumber === 'string') rec.iqamaNumber = pii.iqamaNumber;
      }
    } catch {
      // Non-owner operator without PII subcollection read access
    }
    return rec;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `gate_tickets/${cleanId}`);
  }
}

export async function listGateTicketsFromFirestore(plantId?: string): Promise<TicketRecord[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  try {
    const q = query(collection(db, 'gate_tickets'), where('isSharedPlant', '==', true));
    const snapshot = await getDocs(q);
    let rawRecords = snapshot.docs.map((docSnap) =>
      mapFirestoreDocToTicket(docSnap.id, docSnap.data() as Record<string, unknown>)
    );
    if (plantId && plantId !== 'ALL') {
      const norm = plantId.trim().toUpperCase();
      rawRecords = rawRecords.filter((rec) => (rec.plantId || 'RIYADH').toUpperCase() === norm);
    }
    await Promise.all(
      rawRecords.map(async (rec) => {
        try {
          const piiSnap = await getDoc(doc(db, 'gate_tickets', rec.id, 'private', 'driver'));
          if (piiSnap.exists()) {
            const pii = piiSnap.data();
            if (typeof pii.driverPhone === 'string' && pii.driverPhone) rec.driverPhone = pii.driverPhone;
            if (typeof pii.iqamaNumber === 'string' && pii.iqamaNumber) rec.iqamaNumber = pii.iqamaNumber;
          }
        } catch {
          // Non-owner operator
        }
      })
    );
    rawRecords.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
    });
    return rawRecords;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'gate_tickets');
  }
}

export function subscribeFirestoreTickets(
  onData: (tickets: TicketRecord[]) => void,
  onError?: (err: Error) => void,
  fallbackDriverPiiById?: Map<string, { driverPhone?: string; iqamaNumber?: string }>,
  allowedPlants?: string[]
): Unsubscribe {
  const q = query(collection(db, 'gate_tickets'), where('isSharedPlant', '==', true));
  const piiCache = new Map<string, { driverPhone: string; iqamaNumber: string; updatedAtMs: number }>();

  return onSnapshot(
    q,
    async (snapshot) => {
      let rawRecords = snapshot.docs.map((docSnap) =>
        mapFirestoreDocToTicket(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
          fallbackDriverPiiById?.get(docSnap.id)
        )
      );

      if (
        Array.isArray(allowedPlants) &&
        allowedPlants.length > 0 &&
        !allowedPlants.includes('ALL')
      ) {
        const allowSet = new Set(allowedPlants.map((p) => p.toUpperCase()));
        rawRecords = rawRecords.filter((rec) =>
          allowSet.has((rec.plantId || 'RIYADH').toUpperCase())
        );
      }

      // Best-effort hydrate driver PII for records where user is owner or admin
      await Promise.all(
        rawRecords.map(async (rec) => {
          const cached = piiCache.get(rec.id);
          if (cached && cached.updatedAtMs >= rec.updatedAt) {
            if (cached.driverPhone) rec.driverPhone = cached.driverPhone;
            if (cached.iqamaNumber) rec.iqamaNumber = cached.iqamaNumber;
            return;
          }
          try {
            const piiSnap = await getDoc(doc(db, 'gate_tickets', rec.id, 'private', 'driver'));
            if (piiSnap.exists()) {
              const pii = piiSnap.data();
              const phone = typeof pii.driverPhone === 'string' ? pii.driverPhone : '';
              const iqama = typeof pii.iqamaNumber === 'string' ? pii.iqamaNumber : '';
              if (phone) rec.driverPhone = phone;
              if (iqama) rec.iqamaNumber = iqama;
              piiCache.set(rec.id, {
                driverPhone: phone,
                iqamaNumber: iqama,
                updatedAtMs: rec.updatedAt,
              });
            }
          } catch {
            // Expected for non-owners viewing shared plant queue
          }
        })
      );

      rawRecords.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
      });

      onData(rawRecords);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'gate_tickets');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function saveMaterialToFirestore(
  material: MaterialMasterRecord,
  options?: { createOnly?: boolean }
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = safeId(user.uid, 'usr');
  const materialId = safeId(material.id, 'mat');
  const actorLabel = clampStr(user.displayName || user.email || 'user', 120);

  return withDocLock(`materials/${materialId}`, async () => {
    const ref = doc(db, 'materials', materialId);
    const ratio = Number(material.palletRatio);
    const safeRatio = Number.isFinite(ratio) && ratio > 0 && ratio <= 10000 ? ratio : 1;
    const mutableFields: Record<string, unknown> = {
      materialName: clampStr(material.materialName, 160, 'MATERIAL'),
      packType: clampStr(material.packType, 40, 'Rolls'),
      palletRatio: safeRatio,
      isSharedPlant: true,
      updatedBy: clampStr(material.updatedBy || actorLabel, 120),
      updatedAt: serverTimestamp(),
    };
    if (material.remarks !== undefined) {
      mutableFields.remarks = clampStr(material.remarks, 300);
    }

    let currentOp = OperationType.GET;
    try {
      await runTransaction(db, async (tx) => {
        currentOp = OperationType.GET;
        const snap = await tx.get(ref);

        if (!snap.exists()) {
          currentOp = OperationType.CREATE;
          tx.set(ref, {
            id: materialId,
            ownerUid: uid,
            createdBy: clampStr(material.createdBy || actorLabel, 120),
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (options?.createOnly) {
          return;
        }

        currentOp = OperationType.UPDATE;
        tx.update(ref, mutableFields);
      });
    } catch (error) {
      handleFirestoreError(error, currentOp, `materials/${materialId}`);
    }
  });
}

export async function deleteMaterialFromFirestore(materialId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cleanId = safeId(materialId, 'mat');
  return withDocLock(`materials/${cleanId}`, async () => {
    try {
      await deleteDoc(doc(db, 'materials', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `materials/${cleanId}`);
    }
  });
}

export async function importMaterialsBatchToFirestore(
  items: MaterialMasterRecord[]
): Promise<void> {
  for (const item of items) {
    await saveMaterialToFirestore(item);
  }
}

export function subscribeFirestoreMaterials(
  onData: (materials: MaterialMasterRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'materials'), where('isSharedPlant', '==', true));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: MaterialMasterRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAt = timestampToMillis(d.createdAt);
        const updatedAt = timestampToMillis(d.updatedAt, createdAt);
        return {
          id: String(d.id || docSnap.id),
          materialName: String(d.materialName || ''),
          packType: String(d.packType || 'Rolls'),
          palletRatio: Number(d.palletRatio || 1),
          remarks: typeof d.remarks === 'string' ? d.remarks : '',
          createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
          updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : '',
          createdAt,
          updatedAt,
        };
      });
      list.sort((a, b) => a.materialName.localeCompare(b.materialName));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'materials');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * One-time safe backfill: when an authenticated Firebase user signs in and Firestore
 * has fewer/no records compared to existing SQLite backend records, push missing items
 * cleanly into Firestore without overwriting existing Firestore documents.
 */
export async function syncMissingRecordsToFirestore(
  backendTickets: TicketRecord[],
  backendMaterials: MaterialMasterRecord[]
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  try {
    const existingTicketsSnap = await getDocs(
      query(collection(db, 'gate_tickets'), where('isSharedPlant', '==', true))
    );
    const existingTicketIds = new Set(existingTicketsSnap.docs.map((d) => d.id));
    for (const tk of backendTickets) {
      const id = safeId(tk.id, 'tk');
      if (!existingTicketIds.has(id)) {
        await saveGateTicketToFirestore(tk, { createOnly: true }).catch(() => {});
      }
    }
  } catch {
    // Best-effort initial backfill
  }

  try {
    const existingMaterialsSnap = await getDocs(
      query(collection(db, 'materials'), where('isSharedPlant', '==', true))
    );
    const existingMaterialIds = new Set(existingMaterialsSnap.docs.map((d) => d.id));
    for (const mat of backendMaterials) {
      const id = safeId(mat.id, 'mat');
      if (!existingMaterialIds.has(id)) {
        await saveMaterialToFirestore(mat, { createOnly: true }).catch(() => {});
      }
    }
  } catch {
    // Best-effort initial backfill
  }
}

export async function listAuthorizedUsersFromFirestore(): Promise<AuthUser[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  try {
    const snap = await getDocs(collection(db, 'authorized_users'));
    const list: AuthUser[] = snap.docs.map((docSnap) => {
      const d = docSnap.data();
      const roleName = typeof d.roleName === 'string' ? d.roleName : 'user';
      const createdAt = timestampToMillis(d.createdAt);
      const updatedAt = timestampToMillis(d.updatedAt, createdAt);
      const allowedPlants =
        roleName === 'admin'
          ? ['ALL']
          : Array.isArray(d.allowedPlants) && d.allowedPlants.length > 0
          ? d.allowedPlants.map((p: unknown) => String(p).trim().toUpperCase()).filter(Boolean)
          : ['RIYADH'];
      const defaultPlantId =
        typeof d.defaultPlantId === 'string' && d.defaultPlantId.trim()
          ? d.defaultPlantId.trim().toUpperCase()
          : allowedPlants.includes('ALL')
          ? 'RIYADH'
          : allowedPlants[0] || 'RIYADH';
      const permissions =
        roleName === 'admin'
          ? [...ALL_PLANT_PERMISSIONS]
          : Array.isArray(d.permissions) && d.permissions.length > 0
          ? d.permissions.map((p: unknown) => String(p))
          : [...getDefaultPermissionsForRole(roleName)];
      return {
        id: String(d.id || docSnap.id),
        username: String(d.username || docSnap.id),
        fullName: String(d.displayName || d.username || 'User'),
        email: typeof d.email === 'string' ? d.email : '',
        roleId: `role_${roleName}`,
        roleName,
        roleDisplayName: ROLE_DISPLAY_NAME_MAP[roleName] || 'User / Operator',
        isActive: d.isActive !== false,
        mustChangePassword: false,
        lastLoginAt: null,
        signatureDataUrl: typeof d.signatureDataUrl === 'string' ? d.signatureDataUrl : '',
        createdBy: typeof d.authorizedBy === 'string' ? d.authorizedBy : null,
        createdAt,
        updatedAt,
        permissions,
        allowedPlants,
        defaultPlantId,
      };
    });
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'authorized_users');
  }
}

export async function writeAuditLogToFirestore(entry: {
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const actorUsername = clampStr(
    user.email?.split('@')[0] || user.displayName || 'admin',
    64,
    'admin'
  );
  try {
    await setDoc(doc(db, 'audit_logs', id), {
      id,
      ownerUid: safeId(user.uid, 'usr'),
      actorUsername,
      actorRole: 'admin',
      action: clampStr(entry.action, 64, 'ADMIN_ACTION'),
      targetType: clampStr(entry.targetType, 32, 'user'),
      targetId: clampStr(entry.targetId || '', 128),
      details: clampStr(entry.details || '', 500),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit trail write
  }
}

export async function listAuditLogsFromFirestore(params?: {
  action?: string;
  search?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  try {
    const snap = await getDocs(collection(db, 'audit_logs'));
    let logs: AuditLogEntry[] = snap.docs.map((docSnap, idx) => {
      const d = docSnap.data();
      const createdAt = timestampToMillis(d.createdAt);
      const numericId =
        typeof d.numericId === 'number' && Number.isFinite(d.numericId)
          ? d.numericId
          : createdAt * 100 + (idx % 100);
      return {
        id: numericId,
        actorUserId: typeof d.ownerUid === 'string' ? d.ownerUid : null,
        actorUsername: String(d.actorUsername || 'admin'),
        action: String(d.action || ''),
        targetType: typeof d.targetType === 'string' ? d.targetType : null,
        targetId: typeof d.targetId === 'string' ? d.targetId : null,
        details: typeof d.details === 'string' ? d.details : null,
        ipAddress: 'firebase-cloud',
        createdAt,
      };
    });
    if (params?.action) {
      logs = logs.filter((l) => l.action === params.action);
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      logs = logs.filter(
        (l) =>
          (l.actorUsername || '').toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          (l.details || '').toLowerCase().includes(q)
      );
    }
    logs.sort((a, b) => b.createdAt - a.createdAt);
    return logs.slice(0, params?.limit || 150);
  } catch {
    return [];
  }
}

export async function getPlantSettingsFromFirestore(): Promise<CompanySettings | null> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;
  try {
    const snap = await getDoc(doc(db, 'plant_settings', 'active'));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (typeof data?.settingsJson === 'string' && data.settingsJson.trim()) {
      return mergeSettingsWithDefaults(JSON.parse(data.settingsJson) as Partial<CompanySettings>);
    }
    return null;
  } catch {
    return null;
  }
}

export async function listMaterialsFromFirestore(): Promise<MaterialMasterRecord[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  try {
    const q = query(collection(db, 'materials'), where('isSharedPlant', '==', true));
    const snapshot = await getDocs(q);
    const list: MaterialMasterRecord[] = snapshot.docs.map((docSnap) => {
      const d = docSnap.data();
      const createdAt = timestampToMillis(d.createdAt);
      const updatedAt = timestampToMillis(d.updatedAt, createdAt);
      return {
        id: String(d.id || docSnap.id),
        materialName: String(d.materialName || ''),
        packType: String(d.packType || 'Rolls'),
        palletRatio: Number(d.palletRatio || 1),
        remarks: typeof d.remarks === 'string' ? d.remarks : '',
        createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
        updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : '',
        createdAt,
        updatedAt,
      };
    });
    list.sort((a, b) => a.materialName.localeCompare(b.materialName));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'materials');
  }
}

function normalizeExFactoryLoadingType(raw: unknown): TruckLoadingType {
  return raw === 'export' || raw === 'sto' ? raw : 'local';
}

export async function listExFactoryEntriesFromFirestore(plantId?: string): Promise<ExFactoryEntry[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  try {
    const q = query(collection(db, 'ex_factory_entries'), where('isSharedPlant', '==', true));
    const snapshot = await getDocs(q);
    let entries: ExFactoryEntry[] = snapshot.docs.map((docSnap) => {
      const d = docSnap.data();
      const createdAt = timestampToMillis(d.createdAt);
      const updatedAt = timestampToMillis(d.updatedAt, createdAt);
      return {
        id: String(d.id || docSnap.id),
        plantId: typeof d.plantId === 'string' && d.plantId.trim() ? d.plantId.trim().toUpperCase() : 'RIYADH',
        entryDate: normalizeDateStr(d.entryDate),
        delNoteNumber: String(d.delNoteNumber || ''),
        customerName: String(d.customerName || ''),
        loadingType: normalizeExFactoryLoadingType(d.loadingType),
        truckNumber: String(d.truckNumber || ''),
        driverName: typeof d.driverName === 'string' ? d.driverName : '',
        mobileNumber: typeof d.mobileNumber === 'string' ? d.mobileNumber : '',
        iqamaNumber: typeof d.iqamaNumber === 'string' ? d.iqamaNumber : '',
        ...(d.loadingSlip && typeof d.loadingSlip === 'object'
          ? { loadingSlip: d.loadingSlip as LoadingSlipData }
          : {}),
        createdBy: typeof d.createdBy === 'string' ? d.createdBy : undefined,
        updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : undefined,
        createdAt,
        updatedAt,
      };
    });
    if (plantId && plantId !== 'ALL') {
      const norm = plantId.trim().toUpperCase();
      entries = entries.filter((e) => (e.plantId || 'RIYADH').toUpperCase() === norm);
    }
    entries.sort((a, b) => {
      if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return entries;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'ex_factory_entries');
  }
}

export async function saveExFactoryEntryToFirestore(entry: ExFactoryEntry): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = safeId(user.uid, 'usr');
  const entryId = safeId(entry.id, 'exf');
  const actorLabel = clampStr(user.displayName || user.email || 'user', 120);

  return withDocLock(`ex_factory_entries/${entryId}`, async () => {
    const ref = doc(db, 'ex_factory_entries', entryId);
    const mutableFields: Record<string, unknown> = {
      plantId: clampStr(entry.plantId || 'RIYADH', 32, 'RIYADH').toUpperCase(),
      entryDate: normalizeDateStr(entry.entryDate),
      delNoteNumber: clampStr(entry.delNoteNumber, 64, entryId),
      customerName: clampStr(entry.customerName, 160, 'CUSTOMER'),
      loadingType: normalizeExFactoryLoadingType(entry.loadingType),
      truckNumber: clampStr(entry.truckNumber, 40, 'UNKNOWN'),
      driverName: clampStr(entry.driverName, 120),
      mobileNumber: clampStr(entry.mobileNumber, 32),
      iqamaNumber: clampStr(entry.iqamaNumber, 40),
      isSharedPlant: true,
      updatedBy: clampStr(entry.updatedBy || actorLabel, 120),
      updatedAt: serverTimestamp(),
      ...(entry.loadingSlip ? { loadingSlip: sanitizeLoadingSlip(entry.loadingSlip) } : {}),
    };

    let currentOp = OperationType.GET;
    try {
      await runTransaction(db, async (tx) => {
        currentOp = OperationType.GET;
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          currentOp = OperationType.CREATE;
          tx.set(ref, {
            id: entryId,
            ownerUid: uid,
            createdBy: clampStr(entry.createdBy || actorLabel, 120),
            ...mutableFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return;
        }
        const existingData = snap.data();
        const rawExPlant =
          typeof existingData?.plantId === 'string' ? existingData.plantId.trim().toUpperCase() : '';
        const existingPlant =
          typeof existingData?.plantId === 'string' &&
          /^[A-Z0-9_-]{1,32}$/.test(existingData.plantId)
            ? existingData.plantId
            : rawExPlant && /^[A-Z0-9_-]{1,32}$/.test(rawExPlant)
            ? rawExPlant
            : mutableFields.plantId;
        const existingCreatedAt = existingData?.createdAt;
        const hasValidCreatedAt =
          Boolean(existingCreatedAt) &&
          typeof existingCreatedAt === 'object' &&
          typeof (existingCreatedAt as { toMillis?: unknown }).toMillis === 'function';
        const rawExOwner = existingData?.ownerUid;
        const preservedExOwner =
          typeof rawExOwner === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawExOwner)
            ? rawExOwner
            : uid;

        currentOp = OperationType.UPDATE;
        tx.set(ref, {
          id: entryId,
          ownerUid: preservedExOwner,
          ...(typeof existingData?.createdBy === 'string'
            ? {
                createdBy:
                  existingData.createdBy.length <= 120
                    ? existingData.createdBy
                    : clampStr(existingData.createdBy, 120),
              }
            : {}),
          ...mutableFields,
          plantId: existingPlant,
          createdAt: hasValidCreatedAt ? existingCreatedAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      handleFirestoreError(error, currentOp, `ex_factory_entries/${entryId}`);
    }
  });
}

export async function deleteExFactoryEntryFromFirestore(entryId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const cleanId = safeId(entryId, 'exf');
  return withDocLock(`ex_factory_entries/${cleanId}`, async () => {
    try {
      await deleteDoc(doc(db, 'ex_factory_entries', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `ex_factory_entries/${cleanId}`);
    }
  });
}

export async function savePlantSettingsToFirestore(settings: CompanySettings): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const ref = doc(db, 'plant_settings', 'active');
  const actor = clampStr(user.displayName || user.email || 'admin', 120);
  const serialized = JSON.stringify(settings).slice(0, 350000);
  try {
    const snap = await getDoc(ref);
    await setDoc(ref, {
      id: 'active',
      ownerUid: safeId(user.uid, 'usr'),
      companyName: clampStr(settings.companyName, 160, 'Arabian Waterproofing Industries'),
      companySubtitle: clampStr(settings.companySubtitle, 160, 'Gate Pass & Loading Slip Portal'),
      settingsJson: serialized,
      updatedBy: actor,
      createdAt: snap.exists() ? snap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking sync when Firestore settings rules or network aren't ready
  }
}

