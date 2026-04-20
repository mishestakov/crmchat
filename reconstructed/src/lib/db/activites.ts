import {
  QuerySnapshot,
  type WithFieldValue,
  addDoc,
  collection,
  deleteDoc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { Activity, ActivityWithId, DistributiveOmit } from "@repo/core/types";

import { refs, updateDocument } from ".";
import { auth, firestore } from "../firebase";

export function subscribeToActivities(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<Activity>) => void
) {
  return onSnapshot(
    query(refs.activities(workspaceId), orderBy("createdAt", "asc")),
    handler
  );
}

export async function createActivity(
  activity: WithFieldValue<
    DistributiveOmit<Activity, "createdAt" | "createdBy" | "updatedAt">
  >
) {
  const activityRef = await addDoc(
    collection(
      firestore,
      `workspaces/${activity.workspaceId as string}/activities`
    ),
    {
      ...activity,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser!.uid,
      updatedAt: serverTimestamp(),
    } satisfies WithFieldValue<Activity>
  );
  const doc = await getDoc(activityRef);
  return {
    ...doc.data({ serverTimestamps: "estimate" }),
    id: doc.id,
  } as ActivityWithId;
}

export async function updateTaskCompletionStatus(
  workspaceId: string,
  activityId: string,
  newStatus: boolean
) {
  await updateDocument(refs.activity(workspaceId, activityId), {
    "task.completedAt": newStatus ? serverTimestamp() : null,
    "task.completedBy":
      newStatus && auth.currentUser ? auth.currentUser.uid : null,
  });
}

export async function deleteActivtiy(workspaceId: string, activityId: string) {
  return await deleteDoc(refs.activity(workspaceId, activityId));
}
