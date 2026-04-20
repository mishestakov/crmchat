import {
  QuerySnapshot,
  UpdateData,
  type WithFieldValue,
  addDoc,
  collection,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { Contact, ContactWithId } from "@repo/core/types";

import { refs, updateDocument } from ".";
import { auth, firestore } from "../firebase";

export function subscribeToContacts(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<Contact>) => void
) {
  return onSnapshot(
    query(refs.contacts(workspaceId), orderBy("createdAt", "asc")),
    handler
  );
}

export async function createContact(
  contact: WithFieldValue<
    Omit<Contact, "createdAt" | "createdBy" | "updatedAt">
  >
) {
  const contactRef = await addDoc(
    collection(
      firestore,
      `workspaces/${contact.workspaceId as string}/contacts`
    ),
    {
      ...contact,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser!.uid,
      updatedAt: serverTimestamp(),
    } satisfies WithFieldValue<Contact>
  );
  const doc = await getDoc(contactRef);
  return {
    ...doc.data({ serverTimestamps: "estimate" }),
    id: doc.id,
  } as ContactWithId;
}

export async function updateContact(
  workspaceId: string,
  contactId: string,
  data: UpdateData<Contact>
) {
  await updateDocument(refs.contact(workspaceId, contactId), data);
}

export async function findContactById(
  workspaceIds: string[],
  contactId: string
): Promise<ContactWithId | undefined> {
  const results = await Promise.allSettled(
    workspaceIds.map(async (workspaceId) => {
      const snapshot = await getDoc(refs.contact(workspaceId, contactId));
      if (snapshot.exists()) {
        return { ...snapshot.data(), id: snapshot.id };
      }
      return null;
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }
  return undefined;
}

// helper function to create test contacts
export async function createTestContacts(workspaceId: string, count = 50) {
  const contacts: Array<WithFieldValue<Contact>> = Array.from({
    length: count,
  }).map((_, index) => ({
    workspaceId,
    ownerId: auth.currentUser!.uid,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser!.uid,
    updatedAt: serverTimestamp(),
    fullName: `Test User ${index + 1}`,
  }));

  // Let's add some logging to debug
  console.log(`Attempting to create ${contacts.length} contacts...`);

  const createdContacts = await Promise.all(
    contacts.map(async (contact) => {
      try {
        const result = await createContact(contact);
        console.log(`Created contact: ${result.fullName}`);
        return result;
      } catch (error) {
        console.error(`Failed to create contact:`, error);
        throw error;
      }
    })
  );

  console.log(`Successfully created ${createdContacts.length} contacts`);
  return createdContacts;
}

export async function getContactsCount(workspaceId: string): Promise<number> {
  const snapshot = await getCountFromServer(
    collection(firestore, `workspaces/${workspaceId}/contacts`)
  );

  return snapshot.data().count;
}

export async function moveContacts(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  contactIds: string[]
) {
  const batch = writeBatch(firestore);

  for (const contactId of contactIds) {
    const sourceContactRef = refs.contact(sourceWorkspaceId, contactId);
    const targetContactRef = refs.contact(targetWorkspaceId, contactId);

    const contactSnap = await getDoc(sourceContactRef);
    if (!contactSnap.exists()) continue;

    const contactData = contactSnap.data();

    batch.set(targetContactRef, {
      ...contactData,
      workspaceId: targetWorkspaceId,
      updatedAt: serverTimestamp(),
    });

    batch.delete(sourceContactRef);

    const activitiesSnap = await getDocs(
      query(
        refs.activities(sourceWorkspaceId),
        where("contactId", "==", contactId)
      )
    );

    for (const activityDoc of activitiesSnap.docs) {
      const activityData = activityDoc.data();
      const sourceActivityRef = refs.activity(
        sourceWorkspaceId,
        activityDoc.id
      );
      const targetActivityRef = refs.activity(
        targetWorkspaceId,
        activityDoc.id
      );

      batch.set(targetActivityRef, {
        ...activityData,
        workspaceId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });

      batch.delete(sourceActivityRef);
    }
  }

  await batch.commit();
}
