import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { BackButton } from "../../../../../components/back-button";
import { ContactFormFields } from "./-contact-form-fields";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/new")({
  component: NewContact,
});

function NewContact() {
  const { wsId } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();

  const properties = useQuery({
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

  const [values, setValues] = useState<Record<string, unknown>>({});

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts",
        {
          params: { path: { wsId } },
          body: { properties: values },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      // back, чтобы сохранить mode/q/filters (если пришли из канбана —
      // вернёмся в канбан, а не сбросимся на дефолт-список).
      router.history.back();
    },
  });

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold">Новый контакт</h1>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ContactFormFields
            properties={properties.data ?? []}
            values={values}
            onChange={setValues}
          />

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Создать
            </button>
            {create.error && (
              <span className="text-sm text-red-600">
                {errorMessage(create.error)}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
