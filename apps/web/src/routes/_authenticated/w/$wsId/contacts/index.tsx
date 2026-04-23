import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Coins,
  Repeat2,
  Search as SearchIcon,
  Send,
} from "lucide-react";
import type { Contact, Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// list-view выпилен — продуктово не несёт ценности (см. donor list-view.tsx —
// тот же ContactCardRoot, только в один столбец). У нас один view = kanban.
type Search = { q?: string };

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
  }),
  component: ContactsList,
});

function ContactsList() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

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
      <div className="flex items-center gap-3">
        <SearchInput
          value={search.q ?? ""}
          onChange={(q) => setSearch({ q: q || undefined })}
        />
        <Link
          to="/w/$wsId/contacts/new"
          params={{ wsId }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Новый
        </Link>
      </div>

      {(properties.isLoading || contacts.isLoading) && <p>Загрузка…</p>}
      {properties.error && (
        <p className="text-red-600">{errorMessage(properties.error)}</p>
      )}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && (
        <KanbanView wsId={wsId} rows={rows} properties={props} />
      )}
    </div>
  );
}

function SearchInput(props: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(props.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setLocal(props.value);
  }, [props.value]);

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
          if (e.key === "Enter") onChangeRef.current(local);
          else if (e.key === "Escape") setLocal(props.value);
        }}
        placeholder="Поиск по имени или Telegram…"
        className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
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
  const groupProp = properties.find((p) => p.key === "stage");

  const move = useMutation({
    mutationFn: async (args: { id: string; value: string }) => {
      if (!groupProp) return;
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId, id: args.id } },
          body: { properties: { [groupProp.key]: args.value } },
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
          Стадии воронки задаются в свойстве «Стадия». Добавьте опции там.
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

  // displayedProperties — поля с showInList=true, отображаются бейджами на
  // карточке (через • разделитель). Stage оттуда выкинут — он и так колонка.
  const displayedProperties = properties.filter(
    (p) => p.showInList && p.key !== "stage" && p.key !== "full_name",
  );

  const buckets = new Map<string, Contact[]>();
  for (const v of groupProp.values) buckets.set(v.id, []);
  for (const r of rows) {
    const v = (r.properties as Record<string, unknown>)[groupProp.key];
    if (typeof v === "string" && buckets.has(v)) buckets.get(v)!.push(r);
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
          displayedProperties={displayedProperties}
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
  displayedProperties: Property[];
  onOpen: (id: string) => void;
  onDrop: (contactId: string) => void;
}) {
  const [over, setOver] = useState(false);
  // Total amount колонки — сумма всех contact.properties.amount в этой стадии.
  // Показывается в заголовке (как у донора), даёт быструю оценку «вес» воронки.
  const totalAmount = props.rows.reduce((acc, r) => {
    const v = (r.properties as Record<string, unknown>).amount;
    return acc + (typeof v === "number" && Number.isFinite(v) ? v : 0);
  }, 0);

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
        "flex min-w-[260px] flex-1 flex-col self-stretch overflow-hidden rounded-xl p-3 transition-colors " +
        (over ? "bg-zinc-300 ring-2 ring-zinc-400" : "bg-zinc-200")
      }
    >
      <div className="mb-2 flex items-baseline gap-2 px-1 text-sm">
        <span className="font-medium">{props.title}</span>
        <span className="text-zinc-500">{props.rows.length}</span>
        {totalAmount > 0 && (
          <span className="ml-auto text-xs text-zinc-500">
            {formatCompactNumber(totalAmount)}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {props.rows.map((r) => (
          <ContactCard
            key={r.id}
            contact={r}
            displayedProperties={props.displayedProperties}
            onOpen={() => props.onOpen(r.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ContactCard(props: {
  contact: Contact;
  displayedProperties: Property[];
  onOpen: () => void;
}) {
  const v = props.contact.properties as Record<string, unknown>;
  const name = typeof v.full_name === "string" ? v.full_name : null;
  const tg =
    typeof v.telegram_username === "string"
      ? v.telegram_username.replace(/^@/, "")
      : null;
  const next = props.contact.nextStep;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", props.contact.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={props.onOpen}
      className="cursor-pointer rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm hover:bg-zinc-50 active:cursor-grabbing"
    >
      <div className="font-medium">{name ?? "—"}</div>
      {tg && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
          <Send size={11} className="text-sky-500" />@{tg}
        </div>
      )}
      {next && <NextStepLine next={next} />}
      <DisplayedPropertiesRow
        contact={props.contact}
        properties={props.displayedProperties}
      />
    </div>
  );
}

function NextStepLine({ next }: { next: NonNullable<Contact["nextStep"]> }) {
  const date = new Date(next.date);
  const overdue = date.getTime() < Date.now();
  const today = isSameDay(date, new Date());
  const label = today
    ? "Сегодня"
    : `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  return (
    <div className="mt-1 flex items-start gap-1 text-xs">
      <Bell
        size={11}
        className={"mt-0.5 shrink-0 " + (overdue ? "text-red-500" : "text-zinc-400")}
      />
      <span className={overdue ? "text-red-600" : "text-zinc-500"}>
        {label}
      </span>
      {next.repeat !== "none" && (
        <Repeat2 size={11} className="mt-0.5 shrink-0 text-zinc-400" />
      )}
      <span className="truncate text-zinc-600">· {next.text}</span>
    </div>
  );
}

function DisplayedPropertiesRow(props: {
  contact: Contact;
  properties: Property[];
}) {
  const values = props.contact.properties as Record<string, unknown>;
  const items: React.ReactNode[] = [];
  for (const p of props.properties) {
    const raw = values[p.key];
    const node = renderBadge(p, raw);
    if (node) items.push(<span key={p.id}>{node}</span>);
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      {items.map((node, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-300">·</span>}
          {node}
        </span>
      ))}
    </div>
  );
}

function renderBadge(p: Property, raw: unknown): React.ReactNode {
  if (p.type === "number") {
    if (typeof raw !== "number" || raw === 0) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-zinc-700">
        <Coins size={11} className="text-zinc-400" />
        {formatCompactNumber(raw)}
      </span>
    );
  }
  if (p.type === "single_select" && p.values) {
    const opt = p.values.find((v) => v.id === raw);
    if (!opt) return null;
    return (
      <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-700">
        {opt.name}
      </span>
    );
  }
  if (p.type === "multi_select" && Array.isArray(raw)) {
    const opts = raw
      .map((id) =>
        typeof id === "string" ? p.values?.find((v) => v.id === id) : null,
      )
      .filter((o): o is { id: string; name: string } => !!o);
    if (opts.length === 0) return null;
    const limit = 2;
    return (
      <span className="flex flex-wrap items-center gap-1">
        {opts.slice(0, limit).map((o) => (
          <span
            key={o.id}
            className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-700"
          >
            {o.name}
          </span>
        ))}
        {opts.length > limit && (
          <span className="text-zinc-500">+{opts.length - limit}</span>
        )}
      </span>
    );
  }
  // text/email/tel/url/textarea/user_select — у донора не выводятся как бейджи
  // (нет понятного формата), у нас то же — через подпись на карточке отдельно.
  return null;
}

function formatCompactNumber(value: number): string {
  if (value === 0) return "0";
  const tiers = [
    { t: 1e9, s: "B" },
    { t: 1e6, s: "M" },
    { t: 1e3, s: "K" },
  ];
  for (const { t, s } of tiers) {
    if (value >= t) return (value / t).toFixed(1).replace(/\.0$/, "") + s;
  }
  return value.toString();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
