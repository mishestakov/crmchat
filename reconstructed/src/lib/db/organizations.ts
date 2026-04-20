import {
  QuerySnapshot,
  UpdateData,
  documentId,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { omit } from "radashi";

import { Organization, OrganizationWithId } from "@repo/core/types";

import { refs, updateDocument } from ".";

export function subscribeToOrganizations(
  ids: string[],
  handler: (snapshot: QuerySnapshot<Organization>) => void
) {
  return onSnapshot(
    query(
      refs.organizations(),
      where(documentId(), "in", ids),
      orderBy(documentId())
    ),
    handler
  );
}

export async function updateOrganization(
  id: string,
  data: UpdateData<OrganizationWithId>
) {
  await updateDocument(refs.organization(id), omit(data, ["id"]));
}
