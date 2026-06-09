import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Globe,
  Hash,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pin,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { Contact } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { formatRelative } from "../../../../../../lib/date-utils";
import { useClickOutside } from "../../../../../../lib/hooks";
import { BackButton } from "../../../../../../components/back-button";
import { ActivitySection } from "../-activities-section";
import { ChatDrawer } from "../../../../../../components/chat-drawer";
import { useOutreachAccounts } from "../../../../../../lib/outreach-queries";
import { ChannelDrawer } from "../../../../../../components/channel-drawer";
import { formatMembers } from "../../../../../../components/channel-card";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/$id/")({
  component: ContactDetail,
});

function ContactDetail() {
  const { wsId, id } = Route.useParams();
  const navigate = useNavigate();
  // accountId выбранный для drawer'а; null = drawer закрыт.
  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);
  const qc = useQueryClient();

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
      navigate({ to: "/w/$wsId/channels", params: { wsId } });
    },
  });

  const accountsQ = useOutreachAccounts(wsId);
  const accounts = accountsQ.data ?? [];

  // Какой аккаунт ставится дефолтом при открытии drawer'а: sticky
  // (primary_account_id) → первый из chatAccounts → первый active вообще.
  const defaultDrawerAccountId = useMemo<string | null>(() => {
    const c = contact.data;
    if (!c) return null;
    if (c.primaryAccountId) return c.primaryAccountId;
    if (c.chatAccounts.length > 0) return c.chatAccounts[0]!.accountId;
    return accounts.find((a) => a.status === "active")?.id ?? null;
  }, [contact.data, accounts]);

  const canOpenChat = !!defaultDrawerAccountId;

  // Mark-read не дёргаем при открытии drawer'а — менеджерская privacy: peer
  // не должен видеть «прочитано» от факта что мы посмотрели. Сообщения
  // помечаются прочитанными только при отправке ответа (бэк quick-send
  // вызывает viewMessages сразу после sendMessage).

  // Inline-сохранение одного property из view (Сумма / Стадия / custom). PATCH с
  // { properties: { key: value } } → бэк merge'ит поверх существующего. Пустое
  // значение ("" / null / []) на бэке удаляет ключ — этого мы тут не делаем
  // (для обнуления значения юзер идёт в Edit).
  const patchProperty = useMutation({
    mutationFn: async (args: { key: string; value: unknown }) => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId, id } },
          body: { properties: { [args.key]: args.value } },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => {
      qc.setQueryData(["contact", wsId, id], data);
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
    },
  });

  if (contact.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (contact.error || !contact.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">
          {contact.error ? errorMessage(contact.error) : "Контакт не найден"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-3">
        <ContactView
          contact={contact.data}
          onEdit={() =>
            navigate({
              to: "/w/$wsId/contacts/$id/edit",
              params: { wsId, id },
            })
          }
          onDelete={() => {
            if (confirm("Удалить контакт?")) remove.mutate();
          }}
          onPatch={(key, value) => patchProperty.mutate({ key, value })}
          onOpenChat={() => setDrawerAccountId(defaultDrawerAccountId)}
          canOpenChat={canOpenChat}
        />

        <ContactReachSection
          values={contact.data.properties as Record<string, unknown>}
          onOpenChat={() => setDrawerAccountId(defaultDrawerAccountId)}
          canOpenChat={canOpenChat}
        />

        <ChannelsSection wsId={wsId} contact={contact.data} />

        <ActivitySection wsId={wsId} contactId={id} />
      </div>

      {drawerAccountId && contact.data && (
        <ChatDrawer
          wsId={wsId}
          contact={contact.data}
          accountId={drawerAccountId}
          accounts={accounts}
          onSelectAccount={setDrawerAccountId}
          onClose={() => setDrawerAccountId(null)}
        />
      )}
    </div>
  );
}

function ContactView(props: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (key: string, value: unknown) => void;
  onOpenChat: () => void;
  canOpenChat: boolean;
}) {
  const { contact } = props;
  const values = contact.properties as Record<string, unknown>;
  const fullName = stringValue(values.full_name);
  const description = stringValue(values.description);

  return (
    <>
      <div className="relative rounded-2xl bg-white px-6 pb-5 pt-6 shadow-sm">
        <div className="absolute right-3 top-3">
          <CardMenu onEdit={props.onEdit} onDelete={props.onDelete} />
        </div>
        <div className="flex flex-col items-center">
          <h1 className="text-xl font-semibold">{fullName || "Без имени"}</h1>
          <InlineDescription
            value={description}
            onCommit={(v) => props.onPatch("description", v)}
          />
          <ActionsRow
            values={values}
            onOpenChat={props.onOpenChat}
            canOpenChat={props.canOpenChat}
          />
        </div>
      </div>
    </>
  );
}

// Сидит на properties.description, UX-смысл — «памятка для коллег». Бэк
// удаляет ключ при "" — кнопка-крестик использует это для one-click clear.
function InlineDescription(props: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const commit = () => {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next !== props.value) props.onCommit(next);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={3}
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setDraft(null);
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder="Памятка для коллег — например, «не беспокоить до января»"
        className="mt-3 w-full resize-none rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-zinc-800 focus:border-amber-500 focus:outline-none"
      />
    );
  }

  if (!props.value) {
    return (
      <button
        type="button"
        onClick={() => setDraft("")}
        className="mt-3 inline-flex w-full items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-left text-xs text-zinc-400 hover:border-amber-300 hover:bg-amber-50 hover:text-zinc-600"
      >
        <Pin size={12} />
        Памятка для коллег — например, «не беспокоить до января»
      </button>
    );
  }

  return (
    <div className="mt-3 flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-zinc-800">
      <Pin size={12} className="mt-1 shrink-0 text-amber-600" />
      <button
        type="button"
        onClick={() => setDraft(props.value)}
        title="Изменить памятку"
        className="flex-1 whitespace-pre-wrap text-left"
      >
        {props.value}
      </button>
      <button
        type="button"
        onClick={() => props.onCommit("")}
        title="Удалить памятку"
        aria-label="Удалить памятку"
        className="shrink-0 rounded p-0.5 text-amber-600/70 hover:bg-amber-100 hover:text-zinc-700"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function ActionsRow(props: {
  values: Record<string, unknown>;
  onOpenChat: () => void;
  canOpenChat: boolean;
}) {
  const hasTgIdentity =
    !!stringValue(props.values.telegram_username) ||
    !!stringValue(props.values.tg_user_id);
  const chatDisabled = !props.canOpenChat || !hasTgIdentity;

  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={props.onOpenChat}
        disabled={chatDisabled}
        title={chatDisabled ? "Нет TG-идентификатора" : "Открыть чат"}
        className={
          "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium " +
          (chatDisabled
            ? "cursor-not-allowed bg-zinc-100 text-zinc-400"
            : "bg-emerald-600 text-white hover:bg-emerald-700")
        }
      >
        <MessageCircle size={15} />
        {chatDisabled ? "Нет TG-аккаунта" : "Написать"}
      </button>
    </div>
  );
}

// Каналы связи; клик по строке = primary action: TG → наш chat drawer,
// остальное — нативные mailto:/tel:/external.
type ReachRow = {
  kind: "telegram" | "email" | "phone" | "url";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  onClick: () => void;
  disabled?: boolean;
};

function ContactReachSection(props: {
  values: Record<string, unknown>;
  onOpenChat: () => void;
  canOpenChat: boolean;
}) {
  const { values } = props;
  const rows: ReachRow[] = [];

  const tgUsername = stringValue(values.telegram_username);
  if (tgUsername) {
    rows.push({
      kind: "telegram",
      icon: Send,
      label: "Telegram",
      value: `@${tgUsername.replace(/^@/, "")}`,
      onClick: props.onOpenChat,
      disabled: !props.canOpenChat,
    });
  }
  const email = stringValue(values.email);
  if (email) {
    rows.push({
      kind: "email",
      icon: Mail,
      label: "Email",
      value: email,
      onClick: () => {
        window.location.href = `mailto:${email}`;
      },
    });
  }
  const phone = stringValue(values.phone);
  if (phone) {
    const tel = phone.replace(/[^\d+]/g, "");
    rows.push({
      kind: "phone",
      icon: Phone,
      label: "Телефон",
      value: phone,
      onClick: () => {
        window.location.href = `tel:${tel}`;
      },
    });
  }
  const url = stringValue(values.url);
  if (url) {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    rows.push({
      kind: "url",
      icon: Globe,
      label: "Сайт",
      value: url,
      onClick: () => {
        window.open(href, "_blank", "noopener,noreferrer");
      },
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-3 text-sm font-medium text-zinc-700">
        Связь
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <tr
                key={r.kind}
                onClick={r.disabled ? undefined : r.onClick}
                className={
                  "border-t border-zinc-100 first:border-t-0 " +
                  (r.disabled
                    ? "cursor-not-allowed text-zinc-400"
                    : "cursor-pointer hover:bg-zinc-50")
                }
              >
                <td className="px-5 py-2 text-zinc-500">
                  <span className="inline-flex items-center gap-2">
                    <Icon size={14} className="text-zinc-400" />
                    {r.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-zinc-900">
                  {r.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CardMenu(props: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => {
    if (open) setOpen(false);
  });
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onEdit();
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
          >
            Редактировать
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-50"
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}

function stringValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return "";
}

// Каналы где контакт записан админом. Источник — contact.channels (subquery
// в /contacts/{id}); полный Channel догружается ChannelDrawer'ом по клику.
function ChannelsSection(props: { wsId: string; contact: Contact }) {
  const { wsId, contact } = props;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);

  const removeMut = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
        {
          params: { path: { wsId, id: channelId, contactId: contact.id } },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", wsId, contact.id] });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
    },
  });

  const addMut = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/admins",
        {
          params: { path: { wsId, id: channelId } },
          body: { contactIds: [contact.id] },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", wsId, contact.id] });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      setAdding(false);
    },
  });

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <Hash size={14} className="text-zinc-400" />
            Каналы ({contact.channels.length})
          </span>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <Plus size={12} />
              Привязать
            </button>
          )}
        </div>

        {contact.channels.length === 0 && !adding && (
          <p className="px-5 py-3 text-sm text-zinc-400">
            Контакт не записан админом ни одного канала
          </p>
        )}

        {contact.channels.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-5 py-2 font-medium">Канал</th>
                <th className="px-3 py-2 text-right font-medium">
                  Подписчики
                </th>
                <th className="px-3 py-2 font-medium">Последний пост</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {contact.channels.map((ch) => (
                <tr
                  key={ch.id}
                  onClick={() => setOpenChannelId(ch.id)}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                >
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">
                        {ch.title}
                      </span>
                      {ch.hasDm && (
                        <span
                          title="Канал принимает прямые сообщения в личку"
                          className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200"
                        >
                          DM
                        </span>
                      )}
                      {ch.unavailableSince && (
                        <span
                          title="Telegram не отдаёт этот канал"
                          className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 ring-1 ring-zinc-200"
                        >
                          Недоступен
                        </span>
                      )}
                    </div>
                    {ch.username && (
                      <span className="text-xs text-zinc-500">
                        @{ch.username}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                    {formatMembers(ch.memberCount)}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {ch.lastMessageAt ? formatRelative(ch.lastMessageAt) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <ChannelRowMenu
                      onUnlink={() => {
                        if (
                          confirm(
                            `Отвязать канал «${ch.title}» от контакта?`,
                          )
                        ) {
                          removeMut.mutate(ch.id);
                        }
                      }}
                      disabled={removeMut.isPending}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {adding && (
          <div className="px-5 py-3">
            <ChannelPicker
              wsId={wsId}
              excludeIds={new Set(contact.channels.map((ch) => ch.id))}
              onPick={(id) => addMut.mutate(id)}
              onCancel={() => setAdding(false)}
              loading={addMut.isPending}
            />
          </div>
        )}
      </div>

      {openChannelId && (
        <ChannelDrawer
          wsId={wsId}
          channelId={openChannelId}
          onClose={() => setOpenChannelId(null)}
        />
      )}
    </>
  );
}

// Меню действий для строки канала. Portal с position:fixed — обёртка таблицы
// имеет overflow-hidden (нужен для скруглённых углов), он клипал бы обычный
// absolute-popover. Stop-propagation на triggere — без него клик по кнопке
// всплыл бы на <tr> и открыл drawer.
function ChannelRowMenu(props: { onUnlink: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={props.disabled}
        aria-label="Действия с каналом"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && anchor &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: anchor.top, right: anchor.right }}
            className="fixed z-50 w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onUnlink();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-50"
            >
              Отвязать от контакта
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ChannelPicker(props: {
  wsId: string;
  excludeIds: Set<string>;
  onPick: (channelId: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const channelsQ = useQuery({
    queryKey: ["channels", props.wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels",
        { params: { path: { wsId: props.wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const term = q.trim().toLowerCase();
  const all = channelsQ.data ?? [];
  const filtered = all.filter((c) => {
    if (props.excludeIds.has(c.id)) return false;
    if (!term) return true;
    if (c.title.toLowerCase().includes(term)) return true;
    if (c.link && c.link.toLowerCase().includes(term)) return true;
    return false;
  });

  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск канала по названию или ссылке"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X size={14} />
        </button>
      </div>
      {channelsQ.isLoading && (
        <p className="text-xs text-zinc-500">Загрузка…</p>
      )}
      {channelsQ.data && filtered.length === 0 && (
        <p className="text-xs text-zinc-500">
          {all.length === 0
            ? "Каналов в воркспейсе ещё нет"
            : "Ничего не найдено"}
        </p>
      )}
      {filtered.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((ch) => (
            <li key={ch.id}>
              <button
                type="button"
                onClick={() => props.onPick(ch.id)}
                disabled={props.loading}
                className="flex w-full items-center justify-between rounded-md bg-white px-2 py-1.5 text-left text-sm hover:bg-emerald-100 disabled:opacity-50"
              >
                <span className="truncate font-medium text-zinc-900">
                  {ch.title}
                </span>
                {ch.link && (
                  <span className="ml-2 shrink-0 truncate text-xs text-zinc-500">
                    {ch.link}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
