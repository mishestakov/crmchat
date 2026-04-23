import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Property, PropertyType, PropertyValue } from "@repo/core";
import { api } from "../../../../lib/api";
import { errorMessage } from "../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/properties")({
  component: PropertiesSettings,
});

const propertiesKey = (wsId: string) => ["properties", wsId] as const;

function PropertiesSettings() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: propertiesKey(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/properties",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (input: {
      key: string;
      name: string;
      type: PropertyType;
      values?: PropertyValue[];
    }) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/properties",
        { params: { path: { wsId } }, body: input },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertiesKey(wsId) });
      setAdding(false);
    },
  });

  const update = useMutation({
    mutationFn: async (args: {
      id: string;
      patch: { name?: string; values?: PropertyValue[] | null; order?: number };
    }) => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/properties/{id}",
        { params: { path: { wsId, id: args.id } }, body: args.patch },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertiesKey(wsId) });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/properties/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertiesKey(wsId) });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
    },
  });

  // Reorder: один mutation на пару, optimistic update + единый invalidate в onSettled.
  // TODO: Server-side batch endpoint PATCH /properties/reorder { ids[] } убрал бы
  // двойной round-trip и race window. Lexorank — когда появится drag&drop.
  const reorder = useMutation({
    mutationFn: async (args: {
      aId: string;
      aOrder: number;
      bId: string;
      bOrder: number;
    }) => {
      await Promise.all([
        api.PATCH("/v1/workspaces/{wsId}/properties/{id}", {
          params: { path: { wsId, id: args.aId } },
          body: { order: args.aOrder },
        }),
        api.PATCH("/v1/workspaces/{wsId}/properties/{id}", {
          params: { path: { wsId, id: args.bId } },
          body: { order: args.bOrder },
        }),
      ]);
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: propertiesKey(wsId) });
      const prev = qc.getQueryData<Property[]>(propertiesKey(wsId));
      if (prev) {
        const next = prev
          .map((p) =>
            p.id === args.aId
              ? { ...p, order: args.aOrder }
              : p.id === args.bId
                ? { ...p, order: args.bOrder }
                : p,
          )
          .sort((a, b) => a.order - b.order);
        qc.setQueryData(propertiesKey(wsId), next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(propertiesKey(wsId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: propertiesKey(wsId) }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const items = list.data ?? [];
    const a = items[idx];
    const b = items[idx + dir];
    if (!a || !b) return;
    reorder.mutate({
      aId: a.id,
      aOrder: b.order,
      bId: b.id,
      bOrder: a.order,
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Кастомные поля</h1>

      <p className="text-sm text-zinc-500">
        Кастомные поля контактов. <code>key</code> — внутренний идентификатор
        (нельзя поменять), <code>name</code> — отображаемое название.
      </p>

      {list.isLoading && <p>Загрузка…</p>}
      {list.error && (
        <p className="text-red-600">{errorMessage(list.error)}</p>
      )}

      {list.data && (
        <ul className="space-y-2">
          {list.data.map((p, idx) => (
            <li
              key={p.id}
              className="rounded border border-zinc-200 bg-white"
            >
              {editingId === p.id ? (
                <PropertyEditForm
                  property={p}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) => {
                    update.mutate(
                      { id: p.id, patch },
                      { onSuccess: () => setEditingId(null) },
                    );
                  }}
                  saving={update.isPending}
                />
              ) : (
                <PropertyRow
                  property={p}
                  isFirst={idx === 0}
                  isLast={idx === list.data.length - 1}
                  onEdit={() => setEditingId(p.id)}
                  onDelete={() => {
                    if (
                      confirm(
                        `Удалить «${p.name}»? Значения у контактов тоже будут стёрты.`,
                      )
                    ) {
                      remove.mutate(p.id);
                    }
                  }}
                  onUp={() => move(idx, -1)}
                  onDown={() => move(idx, 1)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded border border-zinc-300 bg-white">
          <PropertyCreateForm
            onCancel={() => setAdding(false)}
            onSave={(input) => create.mutate(input)}
            saving={create.isPending}
            error={create.error ? errorMessage(create.error) : null}
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
        >
          + Добавить property
        </button>
      )}
    </div>
  );
}

function PropertyRow(props: {
  property: Property;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const { property: p } = props;
  return (
    <div className="flex items-center justify-between p-3">
      <div>
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-zinc-500">
          {p.key} · {p.type}
          {p.values && p.values.length > 0 && (
            <> · {p.values.map((v) => v.name).join(", ")}</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-sm">
        <IconButton
          onClick={props.onUp}
          disabled={props.isFirst}
          title="Вверх"
        >
          ↑
        </IconButton>
        <IconButton
          onClick={props.onDown}
          disabled={props.isLast}
          title="Вниз"
        >
          ↓
        </IconButton>
        <button
          onClick={props.onEdit}
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
        >
          Изменить
        </button>
        <button
          onClick={props.onDelete}
          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

function IconButton(props: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-30 hover:bg-zinc-50"
    >
      {props.children}
    </button>
  );
}

function PropertyEditForm(props: {
  property: Property;
  onCancel: () => void;
  onSave: (patch: {
    name?: string;
    values?: PropertyValue[] | null;
  }) => void;
  saving: boolean;
}) {
  const { property: p } = props;
  const [name, setName] = useState(p.name);
  const [values, setValues] = useState<PropertyValue[]>(p.values ?? []);
  // ID опций, существовавших на момент открытия формы — у них контакты могут
  // ссылаться по `id` в jsonb. Их редактирование/удаление меняет смысл данных.
  const [protectedIds] = useState<Set<string>>(
    () => new Set(p.values?.map((v) => v.id) ?? []),
  );

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({
          name,
          ...(p.type === "single_select" ? { values } : {}),
        });
      }}
    >
      <div className="text-xs text-zinc-500">
        {p.key} · {p.type} (key и type изменить нельзя)
      </div>
      <input
        className="w-full rounded border border-zinc-300 px-3 py-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {p.type === "single_select" && (
        <ValuesEditor
          values={values}
          onChange={setValues}
          protectedIds={protectedIds}
        />
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.saving}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

function PropertyCreateForm(props: {
  onCancel: () => void;
  onSave: (input: {
    key: string;
    name: string;
    type: PropertyType;
    values?: PropertyValue[];
  }) => void;
  saving: boolean;
  error: string | null;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [values, setValues] = useState<PropertyValue[]>([]);

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({
          key,
          name,
          type,
          ...(type === "single_select" ? { values } : {}),
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-600">
          key (lowercase, цифры, _)
        </span>
        <input
          className="w-full rounded border border-zinc-300 px-3 py-2"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="lead_score"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-600">name</span>
        <input
          className="w-full rounded border border-zinc-300 px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Скоринг лида"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-600">type</span>
        <select
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2"
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType)}
        >
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="single_select">single_select</option>
        </select>
      </label>
      {type === "single_select" && (
        <ValuesEditor
          values={values}
          onChange={setValues}
          protectedIds={new Set()}
        />
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={
            props.saving ||
            !key ||
            !name ||
            (type === "single_select" && values.length === 0)
          }
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Создать
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
      {props.error && (
        <p className="text-sm text-red-600">{props.error}</p>
      )}
    </form>
  );
}

function newOptionId(): string {
  // 8 hex символов из crypto.randomUUID — достаточно для уникальности в рамках
  // одной формы, не зависит от length (которое сжимается при удалении).
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function ValuesEditor(props: {
  values: PropertyValue[];
  onChange: (v: PropertyValue[]) => void;
  protectedIds: Set<string>;
}) {
  const update = (idx: number, patch: Partial<PropertyValue>) => {
    const next = [...props.values];
    next[idx] = { ...next[idx]!, ...patch };
    props.onChange(next);
  };
  const remove = (idx: number) => {
    const v = props.values[idx];
    if (!v) return;
    if (props.protectedIds.has(v.id)) {
      const ok = confirm(
        `Удалить опцию «${v.name || v.id}»? Контакты с этим значением потеряют ссылку (в БД останется сырой id).`,
      );
      if (!ok) return;
    }
    props.onChange(props.values.filter((_, i) => i !== idx));
  };
  const add = () => {
    props.onChange([
      ...props.values,
      { id: `opt_${newOptionId()}`, name: "" },
    ]);
  };
  return (
    <div className="rounded border border-zinc-200 p-2 space-y-2">
      <div className="text-xs text-zinc-500">Опции single_select</div>
      {props.values.map((v, idx) => {
        const isProtected = props.protectedIds.has(v.id);
        return (
          <div key={idx} className="flex gap-2">
            <input
              className="w-1/3 rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
              value={v.id}
              onChange={(e) => update(idx, { id: e.target.value })}
              placeholder="id"
              disabled={isProtected}
              title={
                isProtected
                  ? "id зафиксирован — на него ссылаются контакты"
                  : undefined
              }
            />
            <input
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
              value={v.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              placeholder="отображаемое имя"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded border border-red-300 px-2 py-1 text-sm text-red-700 hover:bg-red-50"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
      >
        + Опция
      </button>
    </div>
  );
}
