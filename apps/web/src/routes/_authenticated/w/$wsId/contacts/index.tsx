import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  Contact,
  ContactView,
  ContactViewMode,
  Property,
} from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// Все поля optional — иначе любой Link/navigate на этот route потребует
// передавать mode/filters явно. validateSearch ниже всё равно нормализует.
type Search = {
  q?: string;
  mode?: ContactViewMode;
  filters?: string; // JSON-encoded { [propertyKey]: value }
};

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
    mode: s.mode === "kanban" ? "kanban" : undefined,
    filters: typeof s.filters === "string" ? s.filters : undefined,
  }),
  component: ContactsList,
});

function parseFilters(s?: string): Record<string, string> {
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v !== "") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function stringifyFilters(o: Record<string, string>): string | undefined {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== "") filtered[k] = v;
  }
  return Object.keys(filtered).length === 0
    ? undefined
    : JSON.stringify(filtered);
}

function ContactsList() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const filters = parseFilters(search.filters);
  const mode: ContactViewMode = search.mode ?? "list";

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

  const views = useQuery({
    queryKey: ["contact-views", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contact-views",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const contacts = useQuery({
    queryKey: ["contacts", wsId, search.q ?? "", search.filters ?? ""] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts",
        {
          params: {
            path: { wsId },
            query: {
              q: search.q || undefined,
              filters: search.filters || undefined,
            },
          },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const setSearch = (patch: Partial<Search>) => {
    navigate({
      to: "/w/$wsId/contacts",
      params: { wsId },
      search: (prev) => ({ ...prev, ...patch }) as Search,
      replace: true,
    });
  };

  const createView = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contact-views",
        {
          params: { path: { wsId } },
          body: {
            name,
            mode,
            filters: { q: search.q, props: filters },
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-views", wsId] }),
  });

  const deleteView = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/contact-views/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-views", wsId] }),
  });

  const applyView = (v: ContactView) => {
    setSearch({
      q: v.filters.q ?? undefined,
      mode: v.mode,
      filters: stringifyFilters(v.filters.props ?? {}),
    });
  };

  const onSaveView = () => {
    const name = prompt("Название представления:");
    if (name && name.trim()) createView.mutate(name.trim());
  };

  const props = properties.data ?? [];
  const rows = contacts.data ?? [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <div className="flex items-center justify-between gap-3">
        <ModeSwitcher
          mode={mode}
          onSetMode={(m) => setSearch({ mode: m === "list" ? undefined : m })}
        />
        <Link
          to="/w/$wsId/contacts/new"
          params={{ wsId }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Новый
        </Link>
      </div>

      <Toolbar
        q={search.q ?? ""}
        filters={filters}
        properties={props}
        views={views.data ?? []}
        onSetQ={(q) => setSearch({ q: q || undefined })}
        onSetFilters={(f) => setSearch({ filters: stringifyFilters(f) })}
        onApplyView={applyView}
        onSaveView={onSaveView}
        onDeleteView={(id) => {
          if (confirm("Удалить представление?")) deleteView.mutate(id);
        }}
      />

      {(properties.isLoading || contacts.isLoading) && <p>Загрузка…</p>}
      {properties.error && (
        <p className="text-red-600">{errorMessage(properties.error)}</p>
      )}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && mode === "list" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ListView wsId={wsId} rows={rows} properties={props} />
        </div>
      )}
      {contacts.data && mode === "kanban" && (
        <KanbanView wsId={wsId} rows={rows} properties={props} />
      )}
    </div>
  );
}

function ModeSwitcher(props: {
  mode: ContactViewMode;
  onSetMode: (m: ContactViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 text-sm">
      <button
        onClick={() => props.onSetMode("list")}
        className={
          "rounded-md px-3 py-1 " +
          (props.mode === "list"
            ? "bg-zinc-900 text-white"
            : "text-zinc-700")
        }
      >
        Список
      </button>
      <button
        onClick={() => props.onSetMode("kanban")}
        className={
          "rounded-md px-3 py-1 " +
          (props.mode === "kanban"
            ? "bg-zinc-900 text-white"
            : "text-zinc-700")
        }
      >
        Воронка
      </button>
    </div>
  );
}

function Toolbar(props: {
  q: string;
  filters: Record<string, string>;
  properties: Property[];
  views: ContactView[];
  onSetQ: (q: string) => void;
  onSetFilters: (f: Record<string, string>) => void;
  onApplyView: (v: ContactView) => void;
  onSaveView: () => void;
  onDeleteView: (id: string) => void;
}) {
  const [showFilters, setShowFilters] = useState(
    Object.keys(props.filters).length > 0,
  );

  const addFilter = (key: string) => {
    if (!key || key in props.filters) return;
    props.onSetFilters({ ...props.filters, [key]: "" });
  };
  const setFilterValue = (key: string, value: string) => {
    props.onSetFilters({ ...props.filters, [key]: value });
  };
  const removeFilter = (key: string) => {
    const next = { ...props.filters };
    delete next[key];
    props.onSetFilters(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={props.q}
          onChange={(e) => props.onSetQ(e.target.value)}
          placeholder="Поиск…"
          className="flex-1 min-w-[180px] rounded border border-zinc-300 px-3 py-1.5 text-sm"
        />

        <button
          onClick={() => setShowFilters((s) => !s)}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Фильтр{Object.keys(props.filters).length > 0 && ` (${Object.keys(props.filters).length})`}
        </button>

        <select
          value=""
          onChange={(e) => {
            const v = props.views.find((x) => x.id === e.target.value);
            if (v) props.onApplyView(v);
            e.target.value = "";
          }}
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Представления…</option>
          {props.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <button
          onClick={props.onSaveView}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Сохранить
        </button>
      </div>

      {showFilters && (
        <div className="rounded-2xl bg-white p-4 shadow-sm space-y-2">
          {Object.entries(props.filters).map(([key, value]) => {
            const def = props.properties.find((p) => p.key === key);
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <div className="w-32 truncate text-zinc-600">
                  {def?.name ?? key}
                </div>
                {def?.type === "single_select" ? (
                  <select
                    value={value}
                    onChange={(e) => setFilterValue(key, e.target.value)}
                    className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1"
                  >
                    <option value="">— любое —</option>
                    {def.values?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={value}
                    onChange={(e) => setFilterValue(key, e.target.value)}
                    className="flex-1 rounded border border-zinc-300 px-2 py-1"
                  />
                )}
                <button
                  onClick={() => removeFilter(key)}
                  className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  ×
                </button>
              </div>
            );
          })}
          <select
            value=""
            onChange={(e) => addFilter(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">+ Добавить фильтр…</option>
            {props.properties
              .filter((p) => !(p.key in props.filters))
              .map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {props.views.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
          {props.views.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-0.5"
            >
              {v.name}
              <button
                onClick={() => props.onDeleteView(v.id)}
                className="text-red-600"
                title="Удалить"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ListView(props: {
  wsId: string;
  rows: Contact[];
  properties: Property[];
}) {
  const navigate = useNavigate();
  const { wsId, rows, properties } = props;
  // Только properties, помеченные «Отображать в списке».
  const visibleProps = properties.filter((p) => p.showInList);
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-zinc-300 text-left">
          <th className="py-2 pr-4">Имя</th>
          <th className="py-2 pr-4">Email</th>
          <th className="py-2 pr-4">Телефон</th>
          <th className="py-2 pr-4">Telegram</th>
          {visibleProps.map((p) => (
            <th key={p.id} className="py-2 pr-4">
              {p.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={4 + visibleProps.length}
              className="py-4 text-zinc-500"
            >
              Пока пусто
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <tr
            key={r.id}
            onClick={() =>
              navigate({
                to: "/w/$wsId/contacts/$id",
                params: { wsId, id: r.id },
              })
            }
            className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50"
          >
            <td className="py-2 pr-4">{r.name ?? "—"}</td>
            <td className="py-2 pr-4">{r.email ?? "—"}</td>
            <td className="py-2 pr-4">{r.phone ?? "—"}</td>
            <td className="py-2 pr-4">{r.telegramUsername ?? "—"}</td>
            {visibleProps.map((p) => (
              <td key={p.id} className="py-2 pr-4">
                {renderValue(p, (r.properties as Record<string, unknown>)[p.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KanbanView(props: {
  wsId: string;
  rows: Contact[];
  properties: Property[];
}) {
  const { wsId, rows, properties } = props;
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Группирующее свойство = первый single_select в порядке properties (как у донора).
  // Селектор «по какому свойству строить воронку» — отдельный шаг.
  const groupProp = properties.find((p) => p.type === "single_select");

  // Native HTML5 drag&drop: на карточку — setData(id), на колонку — drop
  // → PATCH groupProp.key. Без сторонних либ; для kanban с десятками карточек хватает.
  const move = useMutation({
    mutationFn: async (args: { id: string; value: string | null }) => {
      if (!groupProp) return;
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId, id: args.id } },
          // null → backend удаляет ключ → карточка попадёт в "Без значения"
          body: {
            properties: { [groupProp.key]: args.value as string },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
    },
  });

  if (!groupProp || !groupProp.values || groupProp.values.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center text-sm shadow-sm">
        <p className="mb-2 font-medium">Воронка не настроена</p>
        <p className="mb-4 text-zinc-500">
          Для воронки нужно хотя бы одно свойство типа <code>single_select</code>{" "}
          с опциями. Создайте его в «Кастомные поля».
        </p>
        <Link
          to="/w/$wsId/properties"
          params={{ wsId }}
          className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          → Кастомные поля
        </Link>
      </div>
    );
  }

  const buckets = new Map<string, Contact[]>();
  for (const v of groupProp.values) buckets.set(v.id, []);
  const unassigned: Contact[] = [];
  for (const r of rows) {
    const v = (r.properties as Record<string, unknown>)[groupProp.key];
    if (typeof v === "string" && buckets.has(v)) {
      buckets.get(v)!.push(r);
    } else {
      unassigned.push(r);
    }
  }

  const onOpen = (id: string) =>
    navigate({
      to: "/w/$wsId/contacts/$id",
      params: { wsId, id },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      <div className="text-xs text-zinc-500">
        Группировка: <strong>{groupProp.name}</strong>
      </div>
      <div className="flex flex-1 min-h-0 gap-4 overflow-x-auto px-1 pb-3 pt-1">
        {groupProp.values.map((v) => (
          <Column
            key={v.id}
            title={v.name}
            rows={buckets.get(v.id) ?? []}
            onOpen={onOpen}
            onDrop={(id) => move.mutate({ id, value: v.id })}
          />
        ))}
        <Column
          title="Без значения"
          rows={unassigned}
          onOpen={onOpen}
          onDrop={(id) => move.mutate({ id, value: null })}
        />
      </div>
    </div>
  );
}

function Column(props: {
  title: string;
  rows: Contact[];
  onOpen: (id: string) => void;
  onDrop: (contactId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) props.onDrop(id);
      }}
      className={
        "flex min-w-[240px] flex-1 flex-col self-stretch overflow-hidden rounded-xl p-3 transition-colors " +
        (over ? "bg-zinc-300 ring-2 ring-zinc-400" : "bg-zinc-200")
      }
    >
      <div className="mb-2 px-1 text-sm font-medium">
        {props.title} <span className="text-zinc-500">{props.rows.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {props.rows.map((r) => (
          <div
            key={r.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", r.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => props.onOpen(r.id)}
            className="cursor-pointer rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm hover:bg-zinc-50 active:cursor-grabbing"
          >
            <div className="font-medium">{r.name ?? "—"}</div>
            {r.email && (
              <div className="text-xs text-zinc-500">{r.email}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderValue(p: Property, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (p.type === "single_select" && p.values) {
    const opt = p.values.find((v) => v.id === raw);
    return opt?.name ?? String(raw);
  }
  if (p.type === "multi_select" && Array.isArray(raw)) {
    if (raw.length === 0) return "—";
    return raw
      .map((id) =>
        typeof id === "string"
          ? p.values?.find((v) => v.id === id)?.name ?? id
          : String(id),
      )
      .join(", ");
  }
  return String(raw);
}
