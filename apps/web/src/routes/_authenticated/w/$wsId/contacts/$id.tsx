import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Property } from "@repo/core";
import { api } from "../../../../../lib/api";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/$id")({
  component: ContactDetail,
});

function ContactDetail() {
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

  const [base, setBase] = useState({
    name: "",
    email: "",
    phone: "",
    telegramUsername: "",
  });
  const [props, setProps] = useState<Record<string, string>>({});

  // Заливаем форму данными контакта один раз при первом успешном fetch.
  useEffect(() => {
    if (!contact.data) return;
    setBase({
      name: contact.data.name ?? "",
      email: contact.data.email ?? "",
      phone: contact.data.phone ?? "",
      telegramUsername: contact.data.telegramUsername ?? "",
    });
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      contact.data.properties as Record<string, unknown>,
    )) {
      p[k] = v == null ? "" : String(v);
    }
    setProps(p);
  }, [contact.data?.id]);

  const save = useMutation({
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
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["contact", wsId, id], data);
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/contacts/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      navigate({ to: "/w/$wsId/contacts", params: { wsId } });
    },
  });

  if (contact.isLoading || properties.isLoading) {
    return <div className="mx-auto max-w-xl p-8">Загрузка…</div>;
  }
  if (contact.error) {
    return (
      <div className="mx-auto max-w-xl p-8 text-red-600">
        {String(contact.error)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/w/$wsId/contacts"
          params={{ wsId }}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Назад
        </Link>
        <button
          onClick={() => {
            if (confirm("Удалить контакт?")) remove.mutate();
          }}
          disabled={remove.isPending}
          className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Удалить
        </button>
      </div>

      <h1 className="text-2xl font-semibold">{base.name || "Без имени"}</h1>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
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

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
          >
            Сохранить
          </button>
          {save.isSuccess && !save.isPending && (
            <span className="text-sm text-green-700">Сохранено</span>
          )}
          {save.error && (
            <span className="text-sm text-red-600">{String(save.error)}</span>
          )}
        </div>
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
