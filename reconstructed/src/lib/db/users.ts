import {
  type UpdateData,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { User } from "@repo/core/types";

import { firestore } from "../firebase";

export async function updateUser(userId: string, data: UpdateData<User>) {
  const userRef = doc(firestore, "users", userId);

  await updateDoc(userRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}
