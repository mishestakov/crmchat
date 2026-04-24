import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, Star } from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import { TgChatIframe } from "../../../../../components/tg-chat-iframe";

export const Route = createFileRoute("/_authenticated/w/$wsId/outreach/chat")({
  validateSearch: (s: Record<string, unknown>) => ({
    accountId: typeof s.accountId === "string" ? s.accountId : undefined,
  }),
  component: ChatPage,
});

type Account =
  paths["/v1/workspaces/{wsId}/outreach/accounts"]["get"]["responses"][200]["content"]["application/json"][number];
type Contact =
  paths["/v1/workspaces/{wsId}/contacts/{id}"]["get"]["responses"][200]["content"]["application/json"];

// chatOpened-payload от iframe (apps/tg-client/src/util/crmchat.ts).
type ChatOpenedPayload = {
  type: "chatOpened";
  userId?: string;
  username?: string;
  info?: {
    type: "user" | "group" | "other";
    peerId?: string;
    username?: string;
    fullName?: string;
    description?: string;
  };
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  banned: "bg-red-500",
  frozen: "bg-amber-500",
  unauthorized: "bg-zinc-400",
  offline: "bg-zinc-300",
};

const TG_CLIENT_ORIGIN =
  import.meta.env.VITE_TG_CLIENT_ORIGIN ?? "http://localhost:1234";

function ChatPage() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const accountsQ = useOutreachAccounts(wsId);

  // Resolved account: либо из URL, либо первый active. URL — источник правды.
  // При смене аккаунта navigate({search:{accountId:X}}) — URL обновляется,
  // useEffect ниже синхронизирует на «первый active» если accountId невалиден.
  const accounts = accountsQ.data ?? [];
  const accountFromUrl = accounts.find((a) => a.id === search.accountId);
  const firstActive = accounts.find((a) => a.status === "active");
  const account = accountFromUrl ?? firstActive;

  useEffect(() => {
    if (!accountsQ.data) return;
    // Если в URL accountId не указан или невалиден — записываем дефолтный.
    if (account && account.id !== search.accountId) {
      navigate({
        to: "/w/$wsId/outreach/chat",
        params: { wsId },
        search: { accountId: account.id },
        replace: true,
      });
    }
  }, [accountsQ.data, account, search.accountId, wsId, navigate]);

  // Текущий открытый peer внутри iframe — слушаем chatOpened от tg-client'а.
  const [openedPeer, setOpenedPeer] = useState<ChatOpenedPayload | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== TG_CLIENT_ORIGIN) return;
      if (event.data?.type !== "chatOpened") return;
      setOpenedPeer(event.data as ChatOpenedPayload);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // На смене аккаунта peer обнуляется — iframe ремонтируется, открытый чат
  // больше не актуален.
  useEffect(() => {
    setOpenedPeer(null);
  }, [account?.id]);

  if (accountsQ.isLoading) {
    return <Centered>Загрузка…</Centered>;
  }
  if (accountsQ.error) {
    return <Centered className="text-red-600">{errorMessage(accountsQ.error)}</Centered>;
  }
  if (accounts.length === 0) {
    return (
      <Centered>
        <p className="mb-3">Нет outreach-аккаунтов.</p>
        <Link
          to="/w/$wsId/outreach/accounts"
          params={{ wsId }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Подключить TG-аккаунт
        </Link>
      </Centered>
    );
  }
  if (!account) {
    return <Centered>Не удалось выбрать аккаунт</Centered>;
  }

  return (
    <div className="flex h-screen">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2">
          <AccountSelector
            accounts={accounts}
            selectedId={account.id}
            onChange={(id) =>
              navigate({
                to: "/w/$wsId/outreach/chat",
                params: { wsId },
                search: { accountId: id },
                replace: false,
              })
            }
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <TgChatIframe
            key={account.id}
            wsId={wsId}
            accountId={account.id}
            peer={null}
          />
        </div>
      </div>
      <ChatSidebar wsId={wsId} opened={openedPeer} />
    </div>
  );
}

function AccountSelector({
  accounts,
  selectedId,
  onChange,
}: {
  accounts: Account[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === selectedId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
      >
        {selected ? <AccountRowInline account={selected} /> : "Выберите"}
        <ChevronDown size={14} className="text-zinc-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 min-w-full rounded-lg border border-zinc-200 bg-white shadow-lg">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => {
                // mouseDown — успеть сработать до blur родителя
                e.preventDefault();
                onChange(a.id);
                setOpen(false);
              }}
              className={
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 " +
                (a.id === selectedId ? "bg-zinc-50" : "")
              }
            >
              <AccountRowInline account={a} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRowInline({ account }: { account: Account }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span
        className={
          "h-2 w-2 shrink-0 rounded-full " +
          (STATUS_COLOR[account.status] ?? "bg-zinc-300")
        }
      />
      <span>{account.firstName || account.tgUsername || "Без имени"}</span>
      {account.tgUsername && (
        <span className="text-zinc-500">@{account.tgUsername}</span>
      )}
      {account.hasPremium && (
        <Star size={12} className="fill-amber-400 text-amber-400" />
      )}
    </div>
  );
}

function ChatSidebar({
  wsId,
  opened,
}: {
  wsId: string;
  opened: ChatOpenedPayload | null;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50">
      <div className="flex-1 overflow-y-auto p-3">
        {!opened ? (
          <Empty>Выберите чат слева</Empty>
        ) : opened.info?.type === "group" || opened.info?.type === "other" ? (
          <Empty>Это {opened.info.type === "group" ? "группа" : "канал"}, не лид</Empty>
        ) : (
          <ContactPanel wsId={wsId} opened={opened} />
        )}
      </div>
    </aside>
  );
}

function ContactPanel({
  wsId,
  opened,
}: {
  wsId: string;
  opened: ChatOpenedPayload;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tgUserId = opened.userId || opened.info?.peerId;
  const username = opened.username || opened.info?.username;

  const lookup = useQuery({
    queryKey: ["contact-by-tg", wsId, tgUserId, username],
    queryFn: async () => {
      const { data, error, response } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/lookup/by-tg",
        {
          params: {
            path: { wsId },
            query: {
              tgUserId: tgUserId ?? undefined,
              username: username ?? undefined,
            },
          },
        },
      );
      if (response.status === 404) return null;
      if (error) throw error;
      return data;
    },
    enabled: !!(tgUserId || username),
  });

  const create = useMutation({
    mutationFn: async () => {
      const properties: Record<string, unknown> = {
        full_name: opened.info?.fullName || username || "Без имени",
      };
      if (tgUserId) properties.tg_user_id = tgUserId;
      if (username) properties.telegram_username = username.replace(/^@/, "");
      if (opened.info?.description) {
        properties.description = opened.info.description;
      }
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts",
        { params: { path: { wsId } }, body: { properties } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["contact-by-tg", wsId] });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      navigate({
        to: "/w/$wsId/contacts/$id",
        params: { wsId, id: created.id },
      });
    },
  });

  if (lookup.isLoading) {
    return <Empty>Поиск контакта…</Empty>;
  }
  if (lookup.error) {
    return <Empty className="text-red-600">{errorMessage(lookup.error)}</Empty>;
  }

  const contact = lookup.data;
  if (contact) {
    return <ExistingContactCard wsId={wsId} contact={contact} />;
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-medium">
        {opened.info?.fullName || username || "Без имени"}
      </div>
      {username && (
        <div className="mt-0.5 text-xs text-zinc-500">@{username}</div>
      )}
      {opened.info?.description && (
        <div className="mt-2 text-xs text-zinc-600">{opened.info.description}</div>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Этого контакта ещё нет в CRM.
      </p>
      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {create.isPending ? "Создаём…" : "Создать лид в CRM"}
      </button>
      {create.error && (
        <p className="mt-2 text-xs text-red-600">{errorMessage(create.error)}</p>
      )}
    </div>
  );
}

function ExistingContactCard({
  wsId,
  contact,
}: {
  wsId: string;
  contact: Contact;
}) {
  const props = contact.properties as Record<string, unknown>;
  const fullName =
    typeof props.full_name === "string"
      ? props.full_name
      : "Без имени";
  const username =
    typeof props.telegram_username === "string"
      ? props.telegram_username
      : null;
  const phone = typeof props.phone === "string" ? props.phone : null;
  const description =
    typeof props.description === "string" ? props.description : null;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-medium">{fullName}</div>
      <div className="mt-0.5 text-xs text-zinc-500">
        {username ? `@${username}` : null}
        {username && phone ? " · " : null}
        {phone}
      </div>
      {description && (
        <div className="mt-2 text-xs text-zinc-600">{description}</div>
      )}
      <Link
        to="/w/$wsId/contacts/$id"
        params={{ wsId, id: contact.id }}
        className="mt-3 block w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-center text-sm hover:bg-zinc-50"
      >
        Открыть в CRM
      </Link>
    </div>
  );
}

function Centered({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex h-full items-center justify-center p-8 text-center text-sm " +
        (className ?? "text-zinc-600")
      }
    >
      <div>{children}</div>
    </div>
  );
}

function Empty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex h-full flex-col items-center justify-center text-center text-xs " +
        (className ?? "text-zinc-500")
      }
    >
      <MessageCircle size={20} className="mb-2 text-zinc-400" />
      <p>{children}</p>
    </div>
  );
}
