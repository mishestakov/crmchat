import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { PropertyForm } from "../-form";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/properties/$propertyId/edit",
)({
  component: EditProperty,
});

function EditProperty() {
  const { wsId, propertyId } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["properties", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/properties",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const property = list.data?.find((p) => p.id === propertyId);

  const update = useMutation({
    mutationFn: async (input: {
      name: string;
      required: boolean;
      showInList: boolean;
      type: "text" | "single_select" | "multi_select";
      values: { id: string; name: string }[];
    }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/properties/{id}",
        {
          params: { path: { wsId, id: propertyId } },
          body: {
            name: input.name,
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

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/properties/{id}",
        { params: { path: { wsId, id: propertyId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties", wsId] });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      router.history.back();
    },
  });

  if (list.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (!property) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">Свойство не найдено</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl">
        <PropertyForm
          mode="edit"
          initial={property}
          onCancel={() => router.history.back()}
          onSave={(input) => update.mutate(input)}
          onDelete={() => {
            if (
              confirm(
                `Удалить «${property.name}»? Значения у контактов тоже будут стёрты.`,
              )
            ) {
              remove.mutate();
            }
          }}
          saving={update.isPending}
          error={update.error ? errorMessage(update.error) : null}
        />
      </div>
    </div>
  );
}
