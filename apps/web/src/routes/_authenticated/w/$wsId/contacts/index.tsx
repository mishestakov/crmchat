import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Columns3, Search as SearchIcon, Send } from "lucide-react";
import type { Contact, ContactViewMode, Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// q + mode держим в URL (shareable, refresh-friendly). filters/views в UI
// отсутствуют — их концепцию выпилили: заменили на «настройка колонок» (тот же
// флаг properties.showInList, переключаемый через popover рядом с поиском).
type Search = { q?: string; mode?: ContactViewMode };

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
    mode: s.mode === "kanban" ? "kanban" : undefined,
  }),
  component: ContactsList,
});

function ContactsList() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
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

  const contacts = useQuery({
    queryKey: ["contacts", wsId, search.q ?? ""] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts",
        {
          params: {
            path: { wsId },
            query: { q: search.q || undefined },
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

      <div className="flex items-center gap-2">
        <SearchInput
          value={search.q ?? ""}
          onChange={(q) => setSearch({ q: q || undefined })}
        />
        {mode === "list" && (
          <ColumnsMenu wsId={wsId} properties={props} />
        )}
      </div>

      {(properties.isLoading || contacts.isLoading) && <p>Загрузка…</p>}
      {properties.error && (
        <p className="text-red-600">{errorMessage(properties.error)}</p>
      )}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && mode === "list" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white shadow-sm">
          <ListView wsId={wsId} rows={rows} properties={props} />
        </div>
      )}
      {contacts.data && mode === "kanban" && (
        <KanbanView wsId={wsId} rows={rows} properties={props} />
      )}
    </div>
  );
}

function SearchInput(props: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(props.value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Свежий callback в ref — чтобы debounce effect не пересоздавал setTimeout при
  // каждом рендере только потому что родитель передал новый props.onChange.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  // Синхронизируемся с внешним значением (back-button, apply-view etc.) — но не
  // затираем то что юзер сейчас печатает. Гейт по activeElement.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setLocal(props.value);
  }, [props.value]);

  // 500 мс после последнего keystroke → пушим в URL. Пока юзер печатает, таймер
  // сбрасывается. `local === props.value` — нечего коммитить.
  useEffect(() => {
    if (local === props.value) return;
    const t = setTimeout(() => onChangeRef.current(local), 500);
    return () => clearTimeout(t);
  }, [local, props.value]);

  return (
    <div className="relative flex-1">
      <SearchIcon
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
      />
      <input
        ref={inputRef}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          // Enter = коммит сейчас (без ожидания 500мс), Escape = откат к URL.
          if (e.key === "Enter") onChangeRef.current(local);
          else if (e.key === "Escape") setLocal(props.value);
        }}
        placeholder="Поиск по имени, email, телефону…"
        className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function ColumnsMenu(props: { wsId: string; properties: Property[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Управляем всеми properties кроме full_name (он фикс-колонка таблицы — без
  // имени строка нечитаема). Internal (phone/email/url/...) тоже togglable, чтобы
  // юзер мог вытащить, например, телефон в список.
  const togglable = props.properties.filter((p) => p.key !== "full_name");

  const toggle = useMutation({
    mutationFn: async (args: { id: string; showInList: boolean }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/properties/{id}",
        {
          params: { path: { wsId: props.wsId, id: args.id } },
          body: { showInList: args.showInList },
        },
      );
      if (error) throw error;
    },
    onMutate: async (args) => {
      // Оптимистично: дёргаем кэш properties, иначе чекбокс мигает между кликом
      // и refetch'ем (особенно по сети с лагом).
      await qc.cancelQueries({ queryKey: ["properties", props.wsId] });
      const prev = qc.getQueryData<Property[]>(["properties", props.wsId]);
      qc.setQueryData<Property[]>(["properties", props.wsId], (cached) =>
        cached?.map((p) =>
          p.id === args.id ? { ...p, showInList: args.showInList } : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev) qc.setQueryData(["properties", props.wsId], ctx.prev);
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["properties", props.wsId] }),
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
      >
        <Columns3 size={14} className="text-zinc-500" />
        Колонки
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {togglable.length === 0 ? (
            <p className="px-3 py-3 text-xs text-zinc-500">
              Нет полей для отображения.
            </p>
          ) : (
            togglable.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50"
              >
                <input
                  type="checkbox"
                  checked={p.showInList}
                  onChange={(e) =>
                    toggle.mutate({ id: p.id, showInList: e.target.checked })
                  }
                  className="h-4 w-4 accent-emerald-600"
                />
                <span>{p.name}</span>
              </label>
            ))
          )}
        </div>
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

function ListView(props: {
  wsId: string;
  rows: Contact[];
  properties: Property[];
}) {
  const navigate = useNavigate();
  const { wsId, rows, properties } = props;
  // full_name всегда первая колонка (как «Имя»); остальные — любые properties
  // (custom + internal phone/email/...) с включённым showInList.
  // Управление showInList — popover «Колонки» в тулбаре.
  const visibleProps = properties.filter(
    (p) => p.showInList && p.key !== "full_name",
  );
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="bg-zinc-50 text-zinc-500">
        <tr className="text-left">
          <th className="px-5 py-3 font-normal">Имя</th>
          {visibleProps.map((p) => (
            <th key={p.id} className="px-5 py-3 font-normal">
              {p.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={1 + visibleProps.length}
              className="px-5 py-6 text-center text-zinc-500"
            >
              Пока пусто
            </td>
          </tr>
        )}
        {rows.map((r) => {
          const v = r.properties as Record<string, unknown>;
          const name = typeof v.full_name === "string" ? v.full_name : null;
          return (
            <tr
              key={r.id}
              onClick={() =>
                navigate({
                  to: "/w/$wsId/contacts/$id",
                  params: { wsId, id: r.id },
                })
              }
              className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
            >
              <td className="px-5 py-3">{name ?? "—"}</td>
              {visibleProps.map((p) => (
                <td key={p.id} className="px-5 py-3">
                  {renderValue(p, v[p.key])}
                </td>
              ))}
            </tr>
          );
        })}
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
  // Канбан фиксированно строится на preset `stage` — он internal+required, юзер
  // не может его удалить, тип не меняется → канбан никогда «не сломается».
  // Когда понадобится несколько канбанов / выбор поля — делаем как в доноре через
  // contact_views.pipelineProperty.
  const groupProp = properties.find((p) => p.key === "stage");

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

  // Канбан = flat map options → колонки. Никаких unassigned/«Без значения»:
  // stage required, POST дефолтит на первую опцию, cleanup переводит на оставшуюся
  // — контакт всегда в одной из существующих колонок.
  const buckets = new Map<string, Contact[]>();
  for (const v of groupProp.values) buckets.set(v.id, []);
  for (const r of rows) {
    const v = (r.properties as Record<string, unknown>)[groupProp.key];
    if (typeof v === "string" && buckets.has(v)) {
      buckets.get(v)!.push(r);
    }
    // Контакт со stage вне известных опций молчаливо не отображается. По
    // инвариантам сюда никто попасть не должен — если попал, баг в API.
  }

  const onOpen = (id: string) =>
    navigate({
      to: "/w/$wsId/contacts/$id",
      params: { wsId, id },
    });

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-1 pb-3 pt-1">
      {groupProp.values.map((v) => (
        <Column
          key={v.id}
          title={v.name}
          rows={buckets.get(v.id) ?? []}
          onOpen={onOpen}
          onDrop={(id) => move.mutate({ id, value: v.id })}
        />
      ))}
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
        {props.rows.map((r) => {
          const v = r.properties as Record<string, unknown>;
          const name = typeof v.full_name === "string" ? v.full_name : null;
          const tg =
            typeof v.telegram_username === "string"
              ? v.telegram_username.replace(/^@/, "")
              : null;
          return (
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
              <div className="font-medium">{name ?? "—"}</div>
              {tg && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                  <Send size={11} className="text-sky-500" />@{tg}
                </div>
              )}
            </div>
          );
        })}
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
  if (p.type === "number" && typeof raw === "number") {
    return raw.toLocaleString("ru-RU");
  }
  return String(raw);
}
