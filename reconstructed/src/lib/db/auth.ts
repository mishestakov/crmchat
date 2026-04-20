import { addHours } from "date-fns";
import {
  DocumentSnapshot,
  Timestamp,
  deleteField,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { AuthSession } from "@repo/core/types";

import { refs } from ".";

export async function createWebAuthSession(
  sessionId: string,
  distinctId: string | undefined
) {
  await setDoc(refs.authSession(sessionId), {
    id: sessionId,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(addHours(new Date(), 1)),
    distinctId,
  });
}

export async function invalidateWebAuthSession(sessionId: string) {
  await updateDoc(refs.authSession(sessionId), {
    expiresAt: serverTimestamp(),
    token: deleteField(),
  });
}

export function subscribeToAuthSession(
  sessionId: string,
  handler: (snapshot: DocumentSnapshot<AuthSession>) => void
) {
  return onSnapshot(refs.authSession(sessionId), handler);
}
