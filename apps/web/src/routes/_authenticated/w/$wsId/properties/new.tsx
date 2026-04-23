import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { PropertyForm } from "./-form";

export const Route = createFileRoute("/_authenticated/w/$wsId/properties/new")({
  component: NewProperty,
});

function NewProperty() {
  const { wsId } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: {
      key: string;
      name: string;
      type: "text" | "single_select" | "multi_select";
      required: boolean;
      showInList: boolean;
      values: { id: string; name: string }[];
    }) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/properties",
        {
          params: { path: { wsId } },
          body: {
            key: input.key,
            name: input.name,
            type: input.type,
            required: input.required,
            showInList: input.showInList,
            ...(input.type === "single_select" || input.type === "multi_select"
              ? { values: input.values }
              : {}),
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties", wsId] });
      router.history.back();
    },
  });

  return (
    <PropertyForm
      mode="create"
      onCancel={() => router.history.back()}
      onSave={(input) => create.mutate(input)}
      saving={create.isPending}
      error={create.error ? errorMessage(create.error) : null}
    />
  );
}
