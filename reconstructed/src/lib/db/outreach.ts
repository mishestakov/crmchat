import { QuerySnapshot, onSnapshot, orderBy, query } from "firebase/firestore";

import { OutreachList, OutreachSequence } from "@repo/core/types";

import { refs } from ".";

export function subscribeToOutreachLists(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<OutreachList>) => void
) {
  return onSnapshot(
    query(refs.outreachLists(workspaceId), orderBy("createdAt", "asc")),
    handler
  );
}

export function subscribeToOutreachSequences(
  workspaceId: string,
  handler: (snapshot: QuerySnapshot<OutreachSequence>) => void
) {
  return onSnapshot(
    query(refs.outreachSequences(workspaceId), orderBy("createdAt", "asc")),
    handler
  );
}
