import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import type {
  LoadingSlipData,
  LoadingSlipItem,
  MaterialMasterRecord,
  TicketRecord,
  TruckStatus,
} from '../types';

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
  if (ticket.loadingType === 'local' || ticket.loadingType === 'export') {
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

export async function saveGateTicketToFirestore(ticket: TicketRecord): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = safeId(user.uid, 'usr');
  const ticketId = safeId(ticket.id, 'tk');
  const actorLabel = clampStr(user.displayName || user.email || 'user', 120);
  const ticketRef = doc(db, 'gate_tickets', ticketId);
  const piiRef = doc(db, 'gate_tickets', ticketId, 'private', 'driver');

  let existingSnap;
  try {
    existingSnap = await getDoc(ticketRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `gate_tickets/${ticketId}`);
  }

  const mutableFields = buildTicketMutableFields(ticket, actorLabel);
  const driverPhone = clampStr(ticket.driverPhone, 32);
  const iqamaNumber = clampStr(ticket.iqamaNumber, 40);

  if (!existingSnap.exists()) {
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

    try {
      const batch = writeBatch(db);
      batch.set(ticketRef, createPayload);
      batch.set(piiRef, piiPayload);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `gate_tickets/${ticketId}`);
    }
    return;
  }

  try {
    await updateDoc(ticketRef, mutableFields);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `gate_tickets/${ticketId}`);
  }

  // Update driver PII subcollection when authorized (ticket owner or admin)
  try {
    const piiSnap = await getDoc(piiRef);
    const existingTicketData = existingSnap.data();
    const ticketOwnerUid = clampStr(existingTicketData?.ownerUid || uid, 128);
    if (piiSnap.exists()) {
      await updateDoc(piiRef, {
        driverPhone,
        ...(iqamaNumber ? { iqamaNumber } : {}),
        updatedAt: serverTimestamp(),
      });
    } else if (ticketOwnerUid === uid) {
      await setDoc(piiRef, {
        ticketId,
        ownerUid: ticketOwnerUid,
        driverPhone,
        ...(iqamaNumber ? { iqamaNumber } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-owner operators without PII access still save operational gate ticket updates cleanly
  }
}

export async function deleteGateTicketFromFirestore(ticketId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cleanId = safeId(ticketId, 'tk');
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
}

export function subscribeFirestoreTickets(
  onData: (tickets: TicketRecord[]) => void,
  onError?: (err: Error) => void,
  fallbackDriverPiiById?: Map<string, { driverPhone?: string; iqamaNumber?: string }>
): Unsubscribe {
  const q = query(collection(db, 'gate_tickets'), where('isSharedPlant', '==', true));
  const piiCache = new Map<string, { driverPhone: string; iqamaNumber: string; updatedAtMs: number }>();

  return onSnapshot(
    q,
    async (snapshot) => {
      const rawRecords = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAt = timestampToMillis(d.createdAt);
        const updatedAt = timestampToMillis(d.updatedAt, createdAt);
        const fallbackPii = fallbackDriverPiiById?.get(docSnap.id);

        const rec: TicketRecord = {
          id: String(d.id || docSnap.id),
          ticketNumber: String(d.ticketNumber || docSnap.id),
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
            d.loadingType === 'local' || d.loadingType === 'export' ? d.loadingType : undefined,
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
        return rec;
      });

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

export async function saveMaterialToFirestore(material: MaterialMasterRecord): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = safeId(user.uid, 'usr');
  const materialId = safeId(material.id, 'mat');
  const actorLabel = clampStr(user.displayName || user.email || 'user', 120);
  const ref = doc(db, 'materials', materialId);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `materials/${materialId}`);
  }

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

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        id: materialId,
        ownerUid: uid,
        createdBy: clampStr(material.createdBy || actorLabel, 120),
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `materials/${materialId}`);
    }
    return;
  }

  try {
    await updateDoc(ref, mutableFields);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `materials/${materialId}`);
  }
}

export async function deleteMaterialFromFirestore(materialId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cleanId = safeId(materialId, 'mat');
  try {
    await deleteDoc(doc(db, 'materials', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `materials/${cleanId}`);
  }
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
 * has fewer/no records compared to existing SQLite/WordPress records, push missing items
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
        await saveGateTicketToFirestore(tk).catch(() => {});
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
        await saveMaterialToFirestore(mat).catch(() => {});
      }
    }
  } catch {
    // Best-effort initial backfill
  }
}
