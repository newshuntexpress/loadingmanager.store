import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  getUserProfile,
  testConnection,
  type FirestoreUserProfile,
} from '../firebase';
import {
  deleteGateTicketFromFirestore,
  deleteMaterialFromFirestore,
  importMaterialsBatchToFirestore,
  saveGateTicketToFirestore,
  saveMaterialToFirestore,
  subscribeFirestoreMaterials,
  subscribeFirestoreTickets,
  syncMissingRecordsToFirestore,
} from '../services/firestoreData';
import type { MaterialMasterRecord, TicketRecord } from '../types';

interface FirebaseContextValue {
  firebaseUser: User | null;
  firebaseAuthReady: boolean;
  firestoreProfile: FirestoreUserProfile | null;
  isFirestoreActive: boolean;
  firestoreTickets: TicketRecord[];
  firestoreMaterials: MaterialMasterRecord[];
  firestoreSyncReady: boolean;
  firestoreSyncError: string | null;
  saveTicketToFirestore: (ticket: TicketRecord) => Promise<void>;
  removeTicketFromFirestore: (ticketId: string) => Promise<void>;
  saveMaterialRecordToFirestore: (material: MaterialMasterRecord) => Promise<void>;
  removeMaterialFromFirestore: (materialId: string) => Promise<void>;
  importMaterialsToFirestore: (items: MaterialMasterRecord[]) => Promise<void>;
  syncBackendSnapshotToFirestore: (
    tickets: TicketRecord[],
    materials: MaterialMasterRecord[]
  ) => Promise<void>;
}

const noopAsync = async () => {};

const FirebaseContext = createContext<FirebaseContextValue>({
  firebaseUser: null,
  firebaseAuthReady: false,
  firestoreProfile: null,
  isFirestoreActive: false,
  firestoreTickets: [],
  firestoreMaterials: [],
  firestoreSyncReady: false,
  firestoreSyncError: null,
  saveTicketToFirestore: noopAsync,
  removeTicketFromFirestore: noopAsync,
  saveMaterialRecordToFirestore: noopAsync,
  removeMaterialFromFirestore: noopAsync,
  importMaterialsToFirestore: noopAsync,
  syncBackendSnapshotToFirestore: noopAsync,
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState<boolean>(false);
  const [firestoreProfile, setFirestoreProfile] = useState<FirestoreUserProfile | null>(null);
  const [firestoreTickets, setFirestoreTickets] = useState<TicketRecord[]>([]);
  const [firestoreMaterials, setFirestoreMaterials] = useState<MaterialMasterRecord[]>([]);
  const [ticketsReady, setTicketsReady] = useState<boolean>(false);
  const [materialsReady, setMaterialsReady] = useState<boolean>(false);
  const [firestoreSyncError, setFirestoreSyncError] = useState<string | null>(null);

  const fallbackDriverPiiRef = useRef<
    Map<string, { driverPhone?: string; iqamaNumber?: string }>
  >(new Map());
  const syncedTicketVersionsRef = useRef<Map<string, number>>(new Map());
  const syncedMaterialVersionsRef = useRef<Map<string, number>>(new Map());
  const lastPushedTicketUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedMaterialUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const syncSnapshotInFlightRef = useRef<Promise<void> | null>(null);

  const isFirestoreActive = Boolean(
    firebaseAuthReady && firebaseUser && firebaseUser.emailVerified
  );
  const firestoreSyncReady = isFirestoreActive && ticketsReady && materialsReady;

  useEffect(() => {
    let active = true;
    let initialAuthHandled = false;
    void testConnection();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      const isInitialEvent = !initialAuthHandled;
      initialAuthHandled = true;
      setFirebaseUser(user);
      setFirebaseAuthReady(true);

      if (user) {
        if (!isInitialEvent) {
          void testConnection();
        }
        void getUserProfile(user.uid)
          .then((profile) => {
            if (active) setFirestoreProfile(profile);
          })
          .catch(() => {
            if (active) setFirestoreProfile(null);
          });
      } else {
        setFirestoreProfile(null);
        setFirestoreTickets([]);
        setFirestoreMaterials([]);
        setTicketsReady(false);
        setMaterialsReady(false);
        setFirestoreSyncError(null);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Attach real-time Firestore listeners only once authenticated & verified
  useEffect(() => {
    if (!firebaseAuthReady || !firebaseUser || !firebaseUser.emailVerified) {
      return;
    }

    setFirestoreSyncError(null);

    const unsubTickets = subscribeFirestoreTickets(
      (list) => {
        const nextMap = new Map<string, number>();
        list.forEach((t) => nextMap.set(t.id, t.updatedAt || 0));
        syncedTicketVersionsRef.current = nextMap;
        setFirestoreTickets(list);
        setTicketsReady(true);
      },
      (err) => {
        setFirestoreSyncError(err.message);
        setTicketsReady(true);
      },
      fallbackDriverPiiRef.current
    );

    const unsubMaterials = subscribeFirestoreMaterials(
      (list) => {
        const nextMap = new Map<string, number>();
        list.forEach((m) => nextMap.set(m.id, m.updatedAt || 0));
        syncedMaterialVersionsRef.current = nextMap;
        setFirestoreMaterials(list);
        setMaterialsReady(true);
      },
      (err) => {
        setFirestoreSyncError(err.message);
        setMaterialsReady(true);
      }
    );

    return () => {
      unsubTickets();
      unsubMaterials();
    };
  }, [firebaseAuthReady, firebaseUser]);

  const saveTicketToFirestore = useCallback(async (ticket: TicketRecord) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    if (ticket.driverPhone || ticket.iqamaNumber) {
      fallbackDriverPiiRef.current.set(ticket.id, {
        driverPhone: ticket.driverPhone,
        iqamaNumber: ticket.iqamaNumber,
      });
    }
    try {
      await saveGateTicketToFirestore(ticket);
    } catch (err) {
      console.error('Firestore ticket save error:', err);
    }
  }, []);

  const removeTicketFromFirestore = useCallback(async (ticketId: string) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    fallbackDriverPiiRef.current.delete(ticketId);
    try {
      await deleteGateTicketFromFirestore(ticketId);
    } catch (err) {
      console.error('Firestore ticket delete error:', err);
    }
  }, []);

  const saveMaterialRecordToFirestore = useCallback(async (material: MaterialMasterRecord) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    try {
      await saveMaterialToFirestore(material);
    } catch (err) {
      console.error('Firestore material save error:', err);
    }
  }, []);

  const removeMaterialFromFirestore = useCallback(async (materialId: string) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    try {
      await deleteMaterialFromFirestore(materialId);
    } catch (err) {
      console.error('Firestore material delete error:', err);
    }
  }, []);

  const importMaterialsToFirestore = useCallback(async (items: MaterialMasterRecord[]) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    try {
      await importMaterialsBatchToFirestore(items);
    } catch (err) {
      console.error('Firestore material import error:', err);
    }
  }, []);

  const syncBackendSnapshotToFirestore = useCallback(
    async (backendTickets: TicketRecord[], backendMaterials: MaterialMasterRecord[]) => {
      backendTickets.forEach((tk) => {
        if (tk.driverPhone || tk.iqamaNumber) {
          fallbackDriverPiiRef.current.set(tk.id, {
            driverPhone: tk.driverPhone,
            iqamaNumber: tk.iqamaNumber,
          });
        }
      });

      if (!auth.currentUser || !auth.currentUser.emailVerified) return;

      if (syncSnapshotInFlightRef.current) {
        await syncSnapshotInFlightRef.current;
        return;
      }

      const run = (async () => {
        // Initial seed if Firestore doesn't have these records yet
        await syncMissingRecordsToFirestore(backendTickets, backendMaterials);

        // Push any backend records whose backend updatedAt advanced since our last push
        // and is newer than Firestore's copy (guards against container/server clock skew)
        for (const tk of backendTickets) {
          const backendUpdatedAt = tk.updatedAt || 0;
          const lastPushed = lastPushedTicketUpdatedAtRef.current.get(tk.id) ?? 0;
          const fsUpdatedAt = syncedTicketVersionsRef.current.get(tk.id);
          if (
            fsUpdatedAt !== undefined &&
            backendUpdatedAt > lastPushed &&
            backendUpdatedAt > fsUpdatedAt + 2000
          ) {
            lastPushedTicketUpdatedAtRef.current.set(tk.id, backendUpdatedAt);
            await saveGateTicketToFirestore(tk).catch(() => {});
          }
        }
        for (const mat of backendMaterials) {
          const backendUpdatedAt = mat.updatedAt || 0;
          const lastPushed = lastPushedMaterialUpdatedAtRef.current.get(mat.id) ?? 0;
          const fsUpdatedAt = syncedMaterialVersionsRef.current.get(mat.id);
          if (
            fsUpdatedAt !== undefined &&
            backendUpdatedAt > lastPushed &&
            backendUpdatedAt > fsUpdatedAt + 2000
          ) {
            lastPushedMaterialUpdatedAtRef.current.set(mat.id, backendUpdatedAt);
            await saveMaterialToFirestore(mat).catch(() => {});
          }
        }
      })();

      syncSnapshotInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (syncSnapshotInFlightRef.current === run) {
          syncSnapshotInFlightRef.current = null;
        }
      }
    },
    []
  );

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        firebaseAuthReady,
        firestoreProfile,
        isFirestoreActive,
        firestoreTickets,
        firestoreMaterials,
        firestoreSyncReady,
        firestoreSyncError,
        saveTicketToFirestore,
        removeTicketFromFirestore,
        saveMaterialRecordToFirestore,
        removeMaterialFromFirestore,
        importMaterialsToFirestore,
        syncBackendSnapshotToFirestore,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  return useContext(FirebaseContext);
}
