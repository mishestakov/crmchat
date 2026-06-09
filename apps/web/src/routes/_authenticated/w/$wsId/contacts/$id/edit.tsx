import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CONTACT_FIELD_DEFS, type Contact } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { PropertyFields } from "../../../../../../components/property-fields";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/contacts/$id/edit",
)({
  component: EditContact,
});

function EditContact() {
  const { wsId, id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const contact = useQuery({
    queryKey: ["contact", wsId, id],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
      return data;
    },
  });

  if (contact.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (contact.error || !contact.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">
          {contact.error ? errorMessage(contact.error) : "Контакт не найден"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl">
        <EditForm
          wsId={wsId}
          id={id}
          contact={contact.data}
          onCancel={() =>
            navigate({
              to: "/w/$wsId/contacts/$id",
              params: { wsId, id },
            })
          }
          onSaved={(saved) => {
            qc.setQueryData(["contact", wsId, id], saved);
            qc.invalidateQueries({ queryKey: ["contacts", wsId] });
            navigate({
              to: "/w/$wsId/contacts/$id",
              params: { wsId, id },
            });
          }}
        />
      </div>
    </div>
  );
}

function EditForm(props: {
  wsId: string;
  id: string;
  contact: Contact;
  onCancel: () => void;
  onSaved: (saved: Contact) => void;
}) {
  const { contact, wsId, id } = props;

  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(contact.properties as Record<string, unknown>) }),
  );

  const save = useMutation({
    mutationFn: async () => {
      // Локальное состояние — подмножество ключей контакта (инициализировано из
      // contact.properties, апдейтится только через PropertyFields). "" / [] в
      // payload бэкенд интерпретирует как «удалить ключ» — то, что нам нужно.
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId, id } },
          body: { properties: values },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => props.onSaved(data),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PropertyFields
        fields={CONTACT_FIELD_DEFS}
        values={values}
        onChange={setValues}
        alwaysShownKeys={["full_name", "description"]}
      />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        {save.error && (
          <span className="text-sm text-red-600">
            {errorMessage(save.error)}
          </span>
        )}
      </div>
    </form>
  );
}

