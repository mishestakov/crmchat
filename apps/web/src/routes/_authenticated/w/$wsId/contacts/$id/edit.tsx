import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Contact, Property } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/contacts/$id/edit",
)({
  component: EditContact,
});

const OPTIONAL_BASE_FIELDS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Телефон" },
  { key: "telegramUsername", label: "Telegram" },
] as const;

type BaseFieldKey = (typeof OPTIONAL_BASE_FIELDS)[number]["key"];

function EditContact() {
  const { wsId, id } = Route.useParams();
  const navigate = useNavigate();
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

  if (contact.isLoading || properties.isLoading) {
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
        <ContactEditForm
          wsId={wsId}
          id={id}
          contact={contact.data}
          properties={properties.data ?? []}
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

function ContactEditForm(props: {
  wsId: string;
  id: string;
  contact: Contact;
  properties: Property[];
  onCancel: () => void;
  onSaved: (saved: Contact) => void;
}) {
  const { contact, properties, wsId, id } = props;

  const [base, setBase] = useState({
    name: contact.name ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    telegramUsername: contact.telegramUsername ?? "",
  });
  const [propsState, setPropsState] = useState<
    Record<string, string | string[]>
  >(() => {
    const p: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(
      contact.properties as Record<string, unknown>,
    )) {
      if (v == null) p[k] = "";
      else if (Array.isArray(v))
        p[k] = v.filter((x): x is string => typeof x === "string");
      else p[k] = String(v);
    }
    return p;
  });
  const [revealed, setRevealed] = useState<Set<BaseFieldKey>>(() => {
    const r = new Set<BaseFieldKey>();
    for (const f of OPTIONAL_BASE_FIELDS) {
      if (contact[f.key]) r.add(f.key);
    }
    return r;
  });

  const save = useMutation({
    mutationFn: async () => {
      const propsClean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(propsState)) {
        if (Array.isArray(v)) propsClean[k] = v;
        else if (v !== "") propsClean[k] = v;
        else propsClean[k] = null;
      }
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId, id } },
          body: {
            name: base.name || null,
            email: base.email || null,
            phone: base.phone || null,
            telegramUsername: base.telegramUsername || null,
            properties: propsClean,
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => props.onSaved(data),
  });

  const hiddenFields = OPTIONAL_BASE_FIELDS.filter((f) => !revealed.has(f.key));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <FormRow
          label="Имя"
          value={base.name}
          onChange={(v) => setBase({ ...base, name: v })}
          autoFocus
        />
        {OPTIONAL_BASE_FIELDS.filter((f) => revealed.has(f.key)).map((f) => (
          <FormRow
            key={f.key}
            label={f.label}
            value={base[f.key]}
            onChange={(v) => setBase({ ...base, [f.key]: v })}
          />
        ))}
        {hiddenFields.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3">
            {hiddenFields.map((f) => (
              <button
                type="button"
                key={f.key}
                onClick={() => setRevealed((s) => new Set([...s, f.key]))}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
              >
                + {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {properties.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {properties.map((p, i) => (
            <PropertyEditRow
              key={p.id}
              property={p}
              value={propsState[p.key]}
              onChange={(v) => setPropsState({ ...propsState, [p.key]: v })}
              isLast={i === properties.length - 1}
            />
          ))}
        </div>
      )}

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

function FormRow(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 px-5 py-2.5 text-sm not-last:border-b not-last:border-zinc-100">
      <span className="w-28 shrink-0 text-zinc-500">{props.label}</span>
      <input
        autoFocus={props.autoFocus}
        className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 hover:border-zinc-300 focus:border-emerald-500 focus:outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function PropertyEditRow(props: {
  property: Property;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  isLast: boolean;
}) {
  const { property: p, value, onChange } = props;
  return (
    <div
      className={
        "flex items-start gap-3 px-5 py-2.5 text-sm " +
        (props.isLast ? "" : "border-b border-zinc-100")
      }
    >
      <span className="w-28 shrink-0 pt-1.5 text-zinc-500">{p.name}</span>
      <div className="flex-1">
        {p.type === "single_select" ? (
          <select
            className="w-full rounded border border-transparent bg-transparent px-2 py-1 hover:border-zinc-300 focus:border-emerald-500 focus:outline-none"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">—</option>
            {p.values?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : p.type === "multi_select" ? (
          <MultiSelect
            options={p.values ?? []}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
        ) : (
          <input
            type="text"
            className="w-full rounded border border-transparent bg-transparent px-2 py-1 hover:border-zinc-300 focus:border-emerald-500 focus:outline-none"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function MultiSelect(props: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {props.options.map((o) => {
        const selected = props.value.includes(o.id);
        return (
          <button
            type="button"
            key={o.id}
            onClick={() =>
              props.onChange(
                selected
                  ? props.value.filter((x) => x !== o.id)
                  : [...props.value, o.id],
              )
            }
            className={
              "rounded-full border px-3 py-0.5 text-xs transition-colors " +
              (selected
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")
            }
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
