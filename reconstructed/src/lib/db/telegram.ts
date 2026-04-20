import { subDays } from "date-fns";
import {
  DocumentSnapshot,
  QuerySnapshot,
  Timestamp,
  deleteDoc,
  getDocs,
  limit,
  onSnapshot,
  or,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import {
  Contact,
  Dialog,
  ReauthState,
  TelegramAccount,
  WarmupSession,
  WarmupSessionWithId,
} from "@repo/core/types";

import { refs } from ".";

export function subscribeToTelegramAccounts(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<TelegramAccount>) => void
) {
  return onSnapshot(
    query(refs.telegramAccounts(workspaceId), orderBy("createdAt", "asc")),
    handler
  );
}

export function subscribeToLatestWarmupSessions(
  workspaceId: string,
  accountId: string,
  handler: (snapshot: QuerySnapshot<WarmupSession>) => void
) {
  return onSnapshot(
    query(
      refs.warmupSessions(workspaceId),
      where("accountId", "==", accountId),
      where("executionDate", ">=", subDays(new Date(), 7)),
      orderBy("executionDate", "asc")
    ),
    handler
  );
}

export async function getNextWarmupSession(
  workspaceId: string,
  accountId: string
): Promise<WarmupSessionWithId | null> {
  const snapshot = await getDocs(
    query(
      refs.warmupSessions(workspaceId),
      where("accountId", "==", accountId),
      where("status", "==", "pending"),
      where("executionDate", ">=", Timestamp.now()),
      orderBy("executionDate", "asc"),
      limit(1)
    )
  );

  const doc = snapshot.docs[0];

  if (!doc) {
    return null;
  }

  return {
    ...doc.data(),
    id: doc.id,
  };
}

export async function deleteTelegramAccount(
  workspaceId: string,
  accountId: string
) {
  await deleteDoc(refs.telegramAccount(workspaceId, accountId));
}

export function subscribeToTelegramAccountReauthState(
  workspaceId: string,
  accountId: string,
  sessionId: string,
  handler: (snapshot: DocumentSnapshot<ReauthState>) => void
) {
  return onSnapshot(
    refs.telegramAccountReauthState(workspaceId, accountId, sessionId),
    handler
  );
}

export function subscribeToUnreadDialogs(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<Dialog>) => void
) {
  const q = query(refs.dialogs(workspaceId), where("unread", "==", true));
  return onSnapshot(q, handler);
}

export async function getDialogsForContact(
  workspaceId: string,
  contact: Contact
) {
  if (!contact.telegram?.id && !contact.telegram?.usernameNormalized) {
    return [];
  }

  const snapshot = await getDocs(
    query(
      refs.dialogs(workspaceId),
      or(
        where("peerId", "==", contact.telegram?.id ?? "_nope_"),
        where(
          "usernamesNormalized",
          "array-contains",
          contact.telegram?.usernameNormalized ?? "_nope_"
        )
      )
    )
  );

  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}
