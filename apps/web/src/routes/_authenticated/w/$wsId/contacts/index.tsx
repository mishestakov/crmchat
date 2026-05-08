import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import type { Contact } from "@repo/core";
import { SearchInput } from "../../../../../components/search-input";
import { api } from "../../../../../lib/api";
import { formatRelative } from "../../../../../lib/date-utils";
import { errorMessage } from "../../../../../lib/errors";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import {
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  renderMessageEntities,
} from "../../../../../lib/tg-message";

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

type AccountRow = {
  id: string;
  firstName: string | null;
  tgUsername: string | null;
  phoneNumber: string | null;
};

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
            <th className="px-3 py-2 font-medium">Телефон</th>
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
                    className="flex items-center gap-2 font-medium text-zinc-900 hover:underline"
                  >
                    <span className="truncate">{name}</span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold leading-5 text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </a>
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

type ChatMessage = {
  id: string;
  date: string;
  isOutgoing: boolean;
  text: string;
  entities: MessageEntity[];
  mediaThumb: MessageThumb | null;
};

function ChatDrawer(props: {
  wsId: string;
  contact: Contact;
  accountId: string;
  accounts: AccountRow[];
  onSelectAccount: (accountId: string) => void;
  onClose: () => void;
}) {
  const accountById = new Map(props.accounts.map((a) => [a.id, a]));
  const v = props.contact.properties as Record<string, unknown>;
  const contactName =
    typeof v.full_name === "string" && v.full_name ? v.full_name : "—";

  // Esc → закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  // Initial page — через TanStack Query со staleTime=60s: повторное открытие
  // того же drawer'а (закрыл/открыл, переключился обратно) идёт из кэша,
  // без TDLib invoke. Защита от flood-wait при быстрой навигации.
  // Pagination (scroll-up старое) — поверх в локальном state, на смену
  // accountId сбрасывается через useEffect.
  const initialQ = useQuery({
    queryKey: [
      "chat-history",
      props.wsId,
      props.contact.id,
      props.accountId,
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}/chat-history",
        {
          params: {
            path: { wsId: props.wsId, id: props.contact.id },
            query: { accountId: props.accountId, limit: 50 },
          },
        },
      );
      if (error) throw error;
      return data!.messages;
    },
    staleTime: 60_000,
  });

  const [olderPages, setOlderPages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);

  // Reset аккумулятора и флагов на смену accountId. initialQ обновится сам
  // по новому queryKey.
  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
    setLoadMoreError(null);
    setLoadingMore(false);
    didAutoScrollRef.current = false;
  }, [props.accountId]);

  // По td_api.tl §getChatHistory: единственный надёжный сигнал «больше
  // нет» — пустой ответ. Length < limit может быть chunk-границей TDLib.
  useEffect(() => {
    if (initialQ.data && initialQ.data.length === 0) setHasMore(false);
  }, [initialQ.data]);

  // TDLib отдаёт newest-first → разворачиваем в oldest-first для рендера.
  // Старые страницы (prepend от scroll-up) идут перед initial.
  const messages: ChatMessage[] = initialQ.data
    ? [...olderPages, ...initialQ.data.toReversed()]
    : olderPages;

  // После initial load — auto-scroll в самый низ (newest message виден).
  // Один раз на открытие drawer'а; на prepend от scroll-up НЕ скроллим
  // (сохраняем визуальное место юзера в onScroll).
  useEffect(() => {
    if (!initialQ.isSuccess) return;
    if (didAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didAutoScrollRef.current = true;
  }, [initialQ.isSuccess]);

  // Scroll-up подгрузка: только если юзер реально скроллит, не лезем
  // на сервер «на всякий случай».
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!initialQ.isSuccess || !hasMore || loadingMore) return;
    const el = e.currentTarget;
    if (el.scrollTop > 50) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const prevHeight = el.scrollHeight;
    api
      .GET("/v1/workspaces/{wsId}/contacts/{id}/chat-history", {
        params: {
          path: { wsId: props.wsId, id: props.contact.id },
          query: {
            accountId: props.accountId,
            limit: 50,
            before: oldestId,
          },
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const page = data!.messages;
        if (page.length === 0) {
          setHasMore(false);
        } else {
          setOlderPages((prev) => [...page.toReversed(), ...prev]);
          // Сохраняем визуальное место юзера после prepend'а.
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevHeight;
          });
        }
        setLoadingMore(false);
      })
      .catch((e) => {
        setLoadMoreError(e);
        setLoadingMore(false);
      });
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/20"
        onClick={props.onClose}
      />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[480px] max-w-[90vw] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{contactName}</div>
            <div className="text-xs text-zinc-500">
              История переписки (read-only)
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>
        {props.contact.chatAccounts.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2">
            {props.contact.chatAccounts.map((ca) => {
              const acc = accountById.get(ca.accountId);
              const active = ca.accountId === props.accountId;
              return (
                <button
                  type="button"
                  key={ca.accountId}
                  onClick={() => props.onSelectAccount(ca.accountId)}
                  className={
                    "rounded-md px-2 py-1 text-xs font-medium " +
                    (active
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
                  }
                >
                  {acc ? formatAccount(acc) : ca.accountId}
                </button>
              );
            })}
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto bg-zinc-50 p-4"
        >
          {initialQ.isLoading && (
            <p className="text-sm text-zinc-400">Загрузка истории…</p>
          )}
          {initialQ.error && (
            <p className="text-sm text-red-600">
              {errorMessage(initialQ.error)}
            </p>
          )}
          {initialQ.isSuccess && messages.length === 0 && (
            <p className="text-sm text-zinc-400">
              Сообщений нет — этот аккаунт ещё не общался с контактом.
            </p>
          )}
          {messages.length > 0 && (
            <div className="flex flex-col gap-2">
              {loadingMore && (
                <p className="text-center text-xs text-zinc-400">
                  Подгружаем старые…
                </p>
              )}
              {loadMoreError != null && (
                <p className="text-center text-xs text-red-600">
                  {errorMessage(loadMoreError)}
                </p>
              )}
              {!hasMore && !loadingMore && (
                <p className="text-center text-xs text-zinc-400">
                  Это начало переписки
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    "max-w-[80%] overflow-hidden rounded-lg text-sm " +
                    (m.isOutgoing
                      ? "ml-auto bg-emerald-600 text-white"
                      : "mr-auto bg-white text-zinc-900 ring-1 ring-zinc-200")
                  }
                >
                  {m.mediaThumb && <MessageMediaThumb thumb={m.mediaThumb} />}
                  <div className="px-3 py-2">
                    {m.text && (
                      <div className="whitespace-pre-wrap break-words">
                        {renderMessageEntities(m.text, m.entities)}
                      </div>
                    )}
                    <div
                      className={
                        (m.text ? "mt-1 " : "") +
                        "text-[10px] " +
                        (m.isOutgoing ? "text-emerald-100" : "text-zinc-400")
                      }
                    >
                      {formatRelative(m.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function formatAccount(a: AccountRow): string {
  if (a.firstName) return a.firstName;
  if (a.tgUsername) return `@${a.tgUsername}`;
  if (a.phoneNumber) return a.phoneNumber;
  return a.id;
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
