import {
  CollectionReference,
  DocumentReference,
  PartialWithFieldValue,
  UpdateData,
  collection,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import {
  Activity,
  AuthSession,
  BulkUpdateState,
  Contact,
  Dialog,
  Organization,
  OutreachList,
  OutreachSequence,
  ReauthState,
  TelegramAccount,
  Timestamp,
  WarmupSession,
  Workspace,
} from "@repo/core/types";

import { firestore } from "../firebase";

export async function updateDocument<
  T extends { id?: string; updatedAt: Timestamp },
>(doc: DocumentReference<T>, data: UpdateData<T>) {
  await updateDoc(doc, {
    ...data,
    id: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function mergeDocument<
  T extends { id?: string; updatedAt: Timestamp },
>(doc: DocumentReference<T>, data: PartialWithFieldValue<T>) {
  await setDoc(
    doc,
    {
      ...data,
      id: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
export const refs = {
  authSession(sessionId: string) {
    return doc(
      firestore,
      "auth-sessions",
      sessionId
    ) as DocumentReference<AuthSession>;
  },

  organizations() {
    return collection(
      firestore,
      "organizations"
    ) as CollectionReference<Organization>;
  },
  organization(organizationId: string) {
    return doc(
      firestore,
      "organizations",
      organizationId
    ) as DocumentReference<Organization>;
  },

  workspaces() {
    return collection(
      firestore,
      "workspaces"
    ) as CollectionReference<Workspace>;
  },
  workspace(workspaceId: string) {
    return doc(
      firestore,
      "workspaces",
      workspaceId
    ) as DocumentReference<Workspace>;
  },

  contacts(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/contacts`
    ) as CollectionReference<Contact>;
  },
  contact(workspaceId: string, contactId: string) {
    return doc(
      firestore,
      "workspaces",
      workspaceId,
      "contacts",
      contactId
    ) as DocumentReference<Contact>;
  },

  activities(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/activities`
    ) as CollectionReference<Activity>;
  },
  activity(workspaceId: string, activityId: string) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/activities`,
      activityId
    ) as DocumentReference<Activity>;
  },

  telegramAccounts(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/telegram-accounts`
    ) as CollectionReference<TelegramAccount>;
  },
  telegramAccount(workspaceId: string, accountId: string) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/telegram-accounts`,
      accountId
    ) as DocumentReference<TelegramAccount>;
  },
  telegramAccountReauthState(
    workspaceId: string,
    accountId: string,
    sessionId: string
  ) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/telegram-accounts/${accountId}/reauth-sessions/${sessionId}`
    ) as DocumentReference<ReauthState>;
  },

  dialogs(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/dialogs`
    ) as CollectionReference<Dialog>;
  },

  warmupSessions(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/warmup-sessions`
    ) as CollectionReference<WarmupSession>;
  },

  outreachLists(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/outreach-lists`
    ) as CollectionReference<OutreachList>;
  },
  outreachList(workspaceId: string, listId: string) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/outreach-lists`,
      listId
    ) as DocumentReference<OutreachList>;
  },

  outreachSequences(workspaceId: string) {
    return collection(
      firestore,
      `workspaces/${workspaceId}/outreach-sequences`
    ) as CollectionReference<OutreachSequence>;
  },
  outreachSequence(workspaceId: string, sequenceId: string) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/outreach-sequences`,
      sequenceId
    ) as DocumentReference<OutreachSequence>;
  },

  bulkUpdateState(workspaceId: string, operationId: string) {
    return doc(
      firestore,
      `workspaces/${workspaceId}/bulk-updates`,
      operationId
    ) as DocumentReference<BulkUpdateState>;
  },
};
