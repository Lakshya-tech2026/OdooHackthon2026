import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

/**
 * Sanitize and write a document to Firestore when Firebase Auth is active
 */
export async function syncDocToFirestore<T extends { id: string }>(
  collectionName: string,
  item: T,
  opType: OperationType = OperationType.WRITE
): Promise<void> {
  if (!auth.currentUser) return;
  const path = `${collectionName}/${item.id}`;
  try {
    const clean = JSON.parse(JSON.stringify(item));
    await setDoc(doc(db, collectionName, item.id), clean, { merge: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, opType, path);
    }
  }
}

export async function deleteDocFromFirestore(
  collectionName: string,
  docId: string
): Promise<void> {
  if (!auth.currentUser) return;
  const path = `${collectionName}/${docId}`;
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export async function fetchCollectionFromFirestore<T>(
  collectionName: string
): Promise<T[]> {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map((d) => d.data() as T);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.LIST, collectionName);
    }
    return [];
  }
}
