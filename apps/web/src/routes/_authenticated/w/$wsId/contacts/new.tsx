import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/new")({
  component: NewContact,
});

function NewContact() {
  const { wsId } = Route.useParams();
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

  const [base, setBase] = useState({
    name: "",
    email: "",
    phone: "",
    telegramUsername: "",
  });
  const [props, setProps] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: async () => {
      const propsClean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (v === "") continue;
        const def = properties.data?.find((p) => p.key === k);
        if (def?.type === "number") {
          const n = Number(v);
          if (!Number.isFinite(n)) {
            throw new Error(`Поле "${def.name}": ожидается число`);
          }
          propsClean[k] = n;
        } else propsClean[k] = v;
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
      navigate({ to: "/w/$wsId/contacts", params: { wsId } });
    },
  });

  return (
    <div className="mx-auto max-w-xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Новый контакт</h1>
        <Link
          to="/w/$wsId/contacts"
          params={{ wsId }}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Назад
        </Link>
      </div>

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
            property={p as Property}
            value={props[p.key] ?? ""}
            onChange={(v) => setProps({ ...props, [p.key]: v })}
          />
        ))}

        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
        >
          Создать
        </button>
        {create.error && (
          <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
        )}
      </form>
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
  value: string;
  onChange: (v: string) => void;
}) {
  const { property: p, value, onChange } = props;
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-600">{p.name}</span>
      {p.type === "single_select" ? (
        <select
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {p.values?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={p.type === "number" ? "number" : "text"}
          className="w-full rounded border border-zinc-300 px-3 py-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
