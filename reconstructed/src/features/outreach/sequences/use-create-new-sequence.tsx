import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { OutreachListWithId } from "@repo/core/types";

import { api, orpc } from "@/lib/orpc";
import { useCurrentWorkspace } from "@/lib/store";

type CreateSequenceInput = Parameters<typeof api.outreach.sequences.create>[0];

export function useCreateSequenceForList() {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { mutateAsync: createSequence } = useMutation(
    orpc.outreach.sequences.create.mutationOptions()
  );

  const createSequenceForList = async (
    list: Omit<OutreachListWithId, "createdAt" | "updatedAt">
  ) => {
    // getInputSchemaForCreate strips readonly fields at runtime, but the TS
    // type still includes them. Cast through the extracted input type.
    const { data: sequence } = await createSequence({
      params: { workspaceId },
      body: {
        name: list.name,
        listId: list.id,
        messages: [],
      },
    } as unknown as CreateSequenceInput);
    navigate({
      to: "/w/$workspaceId/outreach/sequences/$id",
      params: { workspaceId, id: sequence.id },
      replace: true,
    });
  };

  return createSequenceForList;
}
