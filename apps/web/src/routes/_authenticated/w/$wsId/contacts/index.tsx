import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useMemo, useState } from "react";
import type { Contact } from "@repo/core";
import {
  type AccountRow,
  ChatDrawer,
  formatAccount,
} from "../../../../../components/chat-drawer";
import { NextStepLine } from "../../../../../components/next-step-line";
import { SearchInput } from "../../../../../components/search-input";
import { UnreadBadge } from "../../../../../components/unread-badge";
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

// Должен совпадать с CONTACTS_PAGE_LIMIT в apps/api/src/routes/contacts.ts —
// при равенстве показываем плашку «уточните поиск».
const CONTACTS_PAGE_LIMIT = 1000;

function ContactsList() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Для drawer'а правой панели — id контакта + выбранный аккаунт. null = закрыт.
  const [drawer, setDrawer] = useState<{
    contact: Contact;
    accountId: string;
  } | null>(null);

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
  // Стабильные ссылки для memo(TableView): открытие/закрытие drawer'а
  // не должно ре-рендерить таблицу с сотнями <Link>.
  const accountsForTable = accounts.data ?? EMPTY_ACCOUNTS;
  const onOpenChat = useCallback((contact: Contact, accountId: string) => {
    setDrawer({ contact, accountId });
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <SearchInput
        value={search.q ?? ""}
        onChange={(q) => setSearch({ q: q || undefined })}
        placeholder="Поиск по имени или Telegram…"
      />

      {contacts.isLoading && <p>Загрузка…</p>}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && rows.length === CONTACTS_PAGE_LIMIT && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Показаны первые {CONTACTS_PAGE_LIMIT.toLocaleString("ru-RU")} контактов.
          Уточните поиск, чтобы увидеть остальные.
        </div>
      )}

      {contacts.data && (
        <TableView
          wsId={wsId}
          rows={rows}
          accounts={accountsForTable}
          onOpenChat={onOpenChat}
        />
      )}

      {drawer && (
        <ChatDrawer
          wsId={wsId}
          contact={drawer.contact}
          accountId={drawer.accountId}
          accounts={accounts.data ?? []}
          onSelectAccount={(accountId) =>
            setDrawer({ contact: drawer.contact, accountId })
          }
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

const EMPTY_ACCOUNTS: AccountRow[] = [];

const TableView = memo(function TableView(props: {
  wsId: string;
  rows: Contact[];
  accounts: AccountRow[];
  onOpenChat: (contact: Contact, accountId: string) => void;
}) {
  const navigate = useNavigate();
  // Мемо чтобы не пересчитывать на каждый родительский render (drawer state и
  // т.п.). Сортировка — lastMessageAt DESC NULLS LAST.
  const accountById = useMemo(
    () => new Map(props.accounts.map((a) => [a.id, a])),
    [props.accounts],
  );
  const sorted = useMemo(
    () =>
      props.rows.toSorted((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      }),
    [props.rows],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Имя</th>
            <th className="px-3 py-2 font-medium">@username</th>
            <th className="px-3 py-2 font-medium">Напомнить</th>
            <th className="px-3 py-2 font-medium">Последнее сообщение</th>
            <th className="px-3 py-2 font-medium">Закреплён за</th>
            <th className="px-3 py-2 font-medium">Кто общался</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={6}
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
            const acc = c.primaryAccountId
              ? accountById.get(c.primaryAccountId)
              : null;
            return (
              <tr
                key={c.id}
                className="border-t border-zinc-100 hover:bg-zinc-50"
              >
                <td className="px-3 py-2">
                  {/* Нативный <a> вместо <Link>: TanStack Router'овский Link
                      на 600+ строках субскрайбит router-context на каждой
                      строке + готовит prefetch-on-hover, что давало ~1с лаг
                      на mount таблицы. href сохраняем для middle-click /
                      Cmd+click; обычный клик перехватываем в navigate(). */}
                  <a
                    href={`/w/${props.wsId}/contacts/${c.id}`}
                    onClick={(e) => {
                      if (
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.button !== 0
                      )
                        return;
                      e.preventDefault();
                      void navigate({
                        to: "/w/$wsId/contacts/$id",
                        params: { wsId: props.wsId, id: c.id },
                      });
                    }}
                    className="flex min-w-0 items-center gap-2 font-medium text-zinc-900 hover:underline"
                  >
                    <span className="block max-w-[280px] truncate" title={name}>
                      {name}
                    </span>
                    <UnreadBadge count={c.unreadCount} />
                  </a>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {username ? `@${username}` : "—"}
                </td>
                <td className="px-3 py-2">
                  {c.nextStep ? (
                    <NextStepLine next={c.nextStep} />
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {c.lastMessageAt ? formatRelative(c.lastMessageAt) : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {acc ? formatAccount(acc) : "—"}
                </td>
                <td className="px-3 py-2">
                  <ChatAccountsCell
                    contact={c}
                    accountById={accountById}
                    onOpen={(accId) => props.onOpenChat(c, accId)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

function ChatAccountsCell(props: {
  contact: Contact;
  accountById: Map<string, AccountRow>;
  onOpen: (accountId: string) => void;
}) {
  if (props.contact.chatAccounts.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {props.contact.chatAccounts.map((ca) => {
        const acc = props.accountById.get(ca.accountId);
        const replied = ca.lastInboundAt !== null;
        const label = acc ? accountInitials(acc) : "?";
        const tooltip =
          (acc ? formatAccount(acc) : ca.accountId) +
          (replied
            ? ` · ответил ${formatRelative(ca.lastInboundAt!)}`
            : ca.lastOutboundAt
              ? ` · только наши, последнее ${formatRelative(ca.lastOutboundAt)}`
              : "");
        return (
          <button
            type="button"
            key={ca.accountId}
            onClick={() => props.onOpen(ca.accountId)}
            title={tooltip}
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium hover:ring-2 hover:ring-emerald-300 " +
              (replied
                ? "bg-emerald-100 text-emerald-800"
                : "bg-zinc-100 text-zinc-500")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function accountInitials(a: AccountRow): string {
  if (a.firstName) {
    return a.firstName
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || a.firstName[0]!.toUpperCase();
  }
  if (a.tgUsername) return a.tgUsername[0]!.toUpperCase();
  return "?";
}
