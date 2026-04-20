import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useUser } from "./useUser";
import { orpc } from "@/lib/orpc";
import { useCurrentWorkspace } from "@/lib/store";

export function useWorkspaceMembers() {
  const user = useUser();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const {
    data: members,
    isPending,
    isError,
  } = useQuery(
    orpc.workspaces.getMembers.queryOptions({
      input: { workspaceId },
      refetchOnWindowFocus: true,
      staleTime: 1000 * 20,
    })
  );

  const me = useMemo(
    () => members?.data?.find((member) => member.userId === user?.id),
    [user?.id, members]
  );
  const membersMap = useMemo(
    () =>
      new Map(members?.data?.map((member) => [member.userId, member]) ?? []),
    [members]
  );
  const workspaceRole = me?.role;

  return {
    me,
    workspaceRole,
    members: members?.data,
    membersMap,
    isPending,
    isError,
  };
}
