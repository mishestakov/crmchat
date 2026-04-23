import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { BackButton } from "../../../../../components/back-button";

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

  const [base, setBase] = useState({
    name: "",
    email: "",
    phone: "",
    telegramUsername: "",
  });
  const [props, setProps] = useState<Record<string, string | string[]>>({});

  const create = useMutation({
    mutationFn: async () => {
      const propsClean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (Array.isArray(v)) {
          if (v.length > 0) propsClean[k] = v;
        } else if (v !== "") {
          propsClean[k] = v;
        }
      }
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts",
        {
          params: { path: { wsId } },
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
      return data;
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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
        <Field
          label="Имя"
          value={base.name}
          onChange={(v) => setBase({ ...base, name: v })}
        />
        <Field
          label="Email"
          value={base.email}
          onChange={(v) => setBase({ ...base, email: v })}
        />
        <Field
          label="Телефон"
          value={base.phone}
          onChange={(v) => setBase({ ...base, phone: v })}
        />
        <Field
          label="Telegram"
          value={base.telegramUsername}
          onChange={(v) => setBase({ ...base, telegramUsername: v })}
        />

        {properties.data?.map((p) => (
          <PropertyField
            key={p.id}
            property={p}
            value={props[p.key]}
            onChange={(v) => setProps({ ...props, [p.key]: v })}
          />
        ))}

          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Создать
          </button>
          {create.error && (
            <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
          )}
        </form>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-600">{props.label}</span>
      <input
        className="w-full rounded border border-zinc-300 px-3 py-2"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function PropertyField(props: {
  property: Property;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const { property: p, value, onChange } = props;
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-600">{p.name}</span>
      {p.type === "single_select" ? (
        <select
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2"
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
        <MultiSelectField
          options={p.values ?? []}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      ) : (
        <input
          type="text"
          className="w-full rounded border border-zinc-300 px-3 py-2"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function MultiSelectField(props: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
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
              "rounded-full border px-3 py-1 text-sm transition-colors " +
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
