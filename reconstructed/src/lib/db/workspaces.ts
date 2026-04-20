import {
  QuerySnapshot,
  UpdateData,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { omit } from "radashi";

import {
  Property,
  View,
  Workspace,
  WorkspaceObjectType,
  WorkspaceWithId,
} from "@repo/core/types";

import { refs, updateDocument } from ".";

export function subscribeToUserWorkspaces(
  userId: string,
  handler: (snapshot: QuerySnapshot<Workspace>) => void
) {
  return onSnapshot(
    query(
      refs.workspaces(),
      where("members" satisfies keyof Workspace, "array-contains", userId),
      orderBy("name" satisfies keyof Workspace, "asc")
    ),
    handler
  );
}

export async function updateWorkspace(
  id: string,
  data: UpdateData<WorkspaceWithId>
) {
  await updateDocument(refs.workspace(id), omit(data, ["id"]));
}

export async function updateProperties(
  workspaceId: string,
  objectType: WorkspaceObjectType,
  properties: Property[]
) {
  await updateDocument(refs.workspace(workspaceId), {
    [`properties.${objectType}`]: properties,
  });
}

export async function updateViews(
  workspaceId: string,
  objectType: WorkspaceObjectType,
  views: View[]
) {
  await updateDocument(refs.workspace(workspaceId), {
    [`views.${objectType}`]: views,
  });
}
