import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import type { Contact } from "@repo/core";
import { api } from "../../../../../lib/api";
import { formatRelative } from "../../../../../lib/date-utils";
import { errorMessage } from "../../../../../lib/errors";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";

// База контактов — плоский реестр людей, с которыми общаются аккаунты.
// Канбан / стейджи / воронка — на уровне задачи, не здесь:
// контакт ≠ лид-в-задаче.
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
  const qc = useQueryClient();

  // SSE: bumps contact'у unread/lastMessageAt при входящем DM от него
  // (см. apps/api/src/lib/contact-events.ts) и сбрасывает при mark-read.
  // Patch'им cache в-place вместо invalidate — не дёргаем GET всех контактов
  // на каждый чужой message.
  useEventSourceEvent<{
    contactId: string;
    unreadCount: number;
    lastMessageAt: string | null;
  }>(`/v1/workspaces/${wsId}/contact-stream`, "contact", (ev) => {
    let foundInCache = false;
    qc.setQueriesData<Contact[]>(
      { queryKey: ["contacts", wsId] },
      (prev) => {
        if (!prev) return prev;
        let changed = false;
        const next = prev.map((c) => {
          if (c.id !== ev.contactId) return c;
          foundInCache = true;
          if (
            c.unreadCount === ev.unreadCount
            && c.lastMessageAt === ev.lastMessageAt
          )
            return c;
          changed = true;
          return {
            ...c,
            unreadCount: ev.unreadCount,
            lastMessageAt: ev.lastMessageAt,
          };
        });
        return changed ? next : prev;
      },
    );
    if (!foundInCache) {
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
    }
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

  const accounts = useOutreachAccounts(wsId);

  const setSearch = (patch: Partial<Search>) => {
    navigate({
      to: "/w/$wsId/contacts",
      params: { wsId },
      search: (prev) => ({ ...prev, ...patch }) as Search,
      replace: true,
    });
  };

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

      {contacts.isLoading && <p>Загрузка…</p>}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && (
        <TableView wsId={wsId} rows={rows} accounts={accounts.data ?? []} />
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

type AccountRow = {
  id: string;
  firstName: string | null;
  tgUsername: string | null;
  phoneNumber: string | null;
};

function TableView(props: {
  wsId: string;
  rows: Contact[];
  accounts: AccountRow[];
}) {
  const accountById = new Map(props.accounts.map((a) => [a.id, a]));
  // Сортировка по lastMessageAt DESC NULLS LAST: после импорта собеседников
  // юзер сразу видит «свежий ответ сверху», созданные руками без TG-истории —
  // снизу. Совпадает с сортировкой /import-contacts.
  const sorted = props.rows.toSorted((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Имя</th>
            <th className="px-3 py-2 font-medium">@username</th>
            <th className="px-3 py-2 font-medium">Телефон</th>
            <th className="px-3 py-2 font-medium">Последнее сообщение</th>
            <th className="px-3 py-2 font-medium">Закреплён за</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-12 text-center text-zinc-400"
              >
                Контактов пока нет — привяжите Telegram-аккаунт и импортируйте
                собеседников
              </td>
            </tr>
          )}
          {sorted.map((c) => {
            const v = c.properties as Record<string, unknown>;
            const name =
              typeof v.full_name === "string" && v.full_name
                ? v.full_name
                : "—";
            const username =
              typeof v.telegram_username === "string"
                ? v.telegram_username.replace(/^@/, "")
                : null;
            const phone = typeof v.phone === "string" ? v.phone : null;
            const acc = c.primaryAccountId
              ? accountById.get(c.primaryAccountId)
              : null;
            return (
              <tr
                key={c.id}
                className="border-t border-zinc-100 hover:bg-zinc-50"
              >
                <td className="px-3 py-2">
                  <Link
                    to="/w/$wsId/contacts/$id"
                    params={{ wsId: props.wsId, id: c.id }}
                    className="flex items-center gap-2 font-medium text-zinc-900 hover:underline"
                  >
                    <span className="truncate">{name}</span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold leading-5 text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {username ? `@${username}` : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600">{phone ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {c.lastMessageAt ? formatRelative(c.lastMessageAt) : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {acc ? formatAccount(acc) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatAccount(a: AccountRow): string {
  if (a.firstName) return a.firstName;
  if (a.tgUsername) return `@${a.tgUsername}`;
  if (a.phoneNumber) return a.phoneNumber;
  return a.id;
}
