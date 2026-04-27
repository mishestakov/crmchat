import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Globe,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Send,
  StickyNote,
  X,
} from "lucide-react";
import type { Contact, Property } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  ActivitiesList,
  NoteModal,
  ReminderModal,
} from "../-activities-section";
import { useOpenChat } from "../../../../../../components/tg-chat-host";
import { TgChatIframe } from "../../../../../../components/tg-chat-iframe";
import type { ChatPeer } from "../../../../../../lib/chat-store";

type Search = { chat?: boolean };

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/$id/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    chat: s.chat === true || s.chat === "true" ? true : undefined,
  }),
  component: ContactDetail,
});

// Identity-properties: рендерятся специально в верхней карточке (имя по центру,
// описание подписью, email/url/tel/telegram → соц.иконки). Остальные (amount,
// stage, custom_*) идут отдельным блоком с inline-edit.
const IDENTITY_KEYS = new Set([
  "full_name",
  "description",
  "email",
  "phone",
  "url",
  "telegram_username",
]);

function ContactDetail() {
  const { wsId, id } = Route.useParams();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isChatOpen = search.chat ?? false;
  const setChatOpen = (next: boolean) => {
    void navigate({
      to: "/w/$wsId/contacts/$id",
      params: { wsId, id },
      search: { chat: next ? true : undefined },
      replace: true,
    });
  };
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

  const [adding, setAdding] = useState<"note" | "reminder" | null>(null);
  const chat = useOpenChat(wsId);

  const peer = useMemo<ChatPeer | null>(() => {
    const v = (contact.data?.properties ?? {}) as Record<string, unknown>;
    const username = stringValue(v.telegram_username);
    if (username) {
      return { type: "username", value: username.replace(/^@/, "") };
    }
    const tgUserId = stringValue(v.tg_user_id);
    if (tgUserId) return { type: "id", value: tgUserId };
    return null;
  }, [contact.data]);

  const canOpenChat = !!chat.activeAccount && !!peer;

  // Если чат открыт по URL, но нет аккаунта/peer — авто-снимаем флаг, чтобы
  // не висеть в split-режиме без iframe'а (например, удалили username у контакта).
  useEffect(() => {
    if (isChatOpen && !canOpenChat) setChatOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatOpen, canOpenChat]);

  // Mark-read: дёргаем messages.ReadHistory через активный outreach-аккаунт.
  // Бэк не обновляет БД сам — TG сервер разошлёт UpdateReadHistoryInbox на
  // listener, тот обновит unread_count и эмитит SSE-событие, канбан моментально
  // гасит badge во всех открытых вкладках. Оптимистично патчим cache, чтобы
  // не ждать round-trip TG → listener → SSE (~200-500ms).
  const markRead = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/read",
        {
          params: { path: { wsId, id } },
          body: { accountId },
        },
      );
      if (error) throw error;
    },
    onMutate: () => {
      qc.setQueriesData<Contact[]>(
        { queryKey: ["contacts", wsId] },
        (prev) =>
          prev?.map((c) =>
            c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c,
          ),
      );
      qc.setQueryData<Contact>(["contact", wsId, id], (prev) =>
        prev && prev.unreadCount > 0 ? { ...prev, unreadCount: 0 } : prev,
      );
    },
  });

  const unread = contact.data?.unreadCount ?? 0;
  const activeAccountId = chat.activeAccount?.id;
  useEffect(() => {
    if (isChatOpen && unread > 0 && activeAccountId) {
      markRead.mutate(activeAccountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatOpen, unread, id, activeAccountId]);

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

  if (contact.isLoading || properties.isLoading) {
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

  const props_ = properties.data ?? [];

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div
        className={
          isChatOpen
            ? "mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-start"
            : "mx-auto max-w-xl space-y-3"
        }
      >
        <div
          className={
            isChatOpen
              ? "hidden w-full shrink-0 space-y-3 md:block md:max-w-md"
              : "space-y-3"
          }
        >
          <ContactView
            contact={contact.data}
            properties={props_}
            isChatOpen={isChatOpen}
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
            onAddNote={() => setAdding("note")}
            onAddReminder={() => setAdding("reminder")}
            onToggleChat={() => setChatOpen(!isChatOpen)}
            canOpenChat={canOpenChat}
          />

          <ActivitiesList wsId={wsId} contactId={id} />
        </div>

        {isChatOpen && chat.activeAccount && peer && (
          <div className="sticky top-3 flex h-[calc(100vh-7rem)] w-full flex-col md:flex-1">
            <div className="mb-2 flex items-center justify-between md:hidden">
              <span className="text-sm font-medium">Telegram-чат</span>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="text-zinc-400 hover:text-zinc-700"
                aria-label="Закрыть чат"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden rounded-2xl bg-white shadow-sm">
              <TgChatIframe
                wsId={wsId}
                accountId={chat.activeAccount.id}
                peer={peer}
                onChatRead={() => markRead.mutate(chat.activeAccount!.id)}
              />
            </div>
          </div>
        )}
      </div>

      {adding === "note" && (
        <NoteModal
          wsId={wsId}
          contactId={id}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "reminder" && (
        <ReminderModal
          wsId={wsId}
          contactId={id}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function ContactView(props: {
  contact: Contact;
  properties: Property[];
  isChatOpen: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (key: string, value: unknown) => void;
  onAddNote: () => void;
  onAddReminder: () => void;
  onToggleChat: () => void;
  canOpenChat: boolean;
}) {
  const { contact, properties, isChatOpen } = props;
  const values = contact.properties as Record<string, unknown>;
  const fullName = stringValue(values.full_name);
  const description = stringValue(values.description);
  const nonIdentityProps = properties.filter((p) => !IDENTITY_KEYS.has(p.key));

  return (
    <>
      <div className="relative rounded-2xl bg-white px-6 pb-5 pt-6 shadow-sm">
        <div className="absolute right-3 top-3">
          <CardMenu onEdit={props.onEdit} onDelete={props.onDelete} />
        </div>
        <div className="flex flex-col items-center text-center">
          <h1 className="text-xl font-semibold">{fullName || "Без имени"}</h1>
          {description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-500">
              {description}
            </p>
          )}
          <SocialRow values={values} />
        </div>
      </div>

      {nonIdentityProps.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {nonIdentityProps.map((p, i) => (
            <div
              key={p.id}
              className={
                "flex items-center justify-between gap-3 px-5 py-2.5 text-sm " +
                (i < nonIdentityProps.length - 1
                  ? "border-b border-zinc-100"
                  : "")
              }
            >
              <span className="text-zinc-500">{p.name}</span>
              <div className="min-w-0 flex-1 max-w-[60%]">
                <InlineEdit
                  property={p}
                  value={values[p.key]}
                  onCommit={(v) => props.onPatch(p.key, v)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 divide-x divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm">
        <ActionButton
          icon={<StickyNote size={20} />}
          label="Добавить заметку"
          onClick={props.onAddNote}
        />
        <ActionButton
          icon={<Bell size={20} />}
          label="Добавить напоминание"
          onClick={props.onAddReminder}
        />
        <ActionButton
          icon={<MessageCircle size={20} />}
          label={isChatOpen ? "Закрыть чат" : "Открыть чат"}
          disabled={
            !props.canOpenChat
            || (!values.telegram_username && !values.tg_user_id)
          }
          onClick={props.onToggleChat}
        />
      </div>
    </>
  );
}

function SocialRow({ values }: { values: Record<string, unknown> }) {
  const links: { href: string; icon: React.ReactNode; bg: string }[] = [];
  const email = stringValue(values.email);
  const phone = stringValue(values.phone);
  const tg = stringValue(values.telegram_username);
  const url = stringValue(values.url);

  if (email) {
    links.push({
      href: `mailto:${email}`,
      icon: <Mail size={14} />,
      bg: "bg-zinc-500",
    });
  }
  if (phone) {
    links.push({
      href: `tel:${phone}`,
      icon: <Phone size={14} />,
      bg: "bg-zinc-500",
    });
  }
  if (tg) {
    const u = tg.replace(/^@/, "");
    links.push({
      href: `https://t.me/${u}`,
      icon: <Send size={14} />,
      bg: "bg-sky-500",
    });
  }
  if (url) {
    links.push({
      href: url,
      icon: <Globe size={14} />,
      bg: "bg-zinc-500",
    });
  }
  if (links.length === 0) return null;
  return (
    <div className="mt-3 flex justify-center gap-2">
      {links.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className={
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:opacity-90 " +
            l.bg
          }
        >
          {l.icon}
        </a>
      ))}
    </div>
  );
}

function ActionButton(props: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        "flex flex-col items-center justify-center gap-1.5 px-3 py-4 text-center text-xs leading-tight " +
        (props.disabled
          ? "cursor-not-allowed text-zinc-400"
          : "text-zinc-700 hover:bg-zinc-50")
      }
    >
      <span className={props.disabled ? "text-zinc-300" : "text-emerald-600"}>
        {props.icon}
      </span>
      {props.label}
    </button>
  );
}

function CardMenu(props: { onEdit: () => void; onDelete: () => void }) {
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

// Inline-редактор для одного property в view-карточке. Селект/multi-select коммитят
// сразу onChange (один клик = один запрос); text/number — onBlur и Enter (типичный
// паттерн «нажал Enter, ушёл — сохранили»). Visual: разное для типов, но всегда
// очевидно «кликабельно».
function InlineEdit(props: {
  property: Property;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const { property: p, value, onCommit } = props;

  if (p.type === "single_select") {
    return (
      <div className="relative">
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onCommit(e.target.value)}
          className="w-full appearance-none rounded-md border border-zinc-200 bg-white py-1 pl-2 pr-7 text-right text-sm hover:border-zinc-400 focus:border-emerald-500 focus:outline-none"
        >
          {!p.required && <option value="">—</option>}
          {p.values?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
        />
      </div>
    );
  }

  if (p.type === "multi_select") {
    const arr = Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {(p.values ?? []).map((o) => {
          const selected = arr.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              onClick={() =>
                onCommit(
                  selected ? arr.filter((x) => x !== o.id) : [...arr, o.id],
                )
              }
              className={
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors " +
                (selected
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")
              }
            >
              {o.name}
            </button>
          );
        })}
      </div>
    );
  }

  if (p.type === "number") {
    return (
      <InlineInput
        kind="number"
        value={value}
        onCommit={onCommit as (v: unknown) => void}
      />
    );
  }

  // text / textarea / email / tel / url / user_select — общий text input.
  return (
    <InlineInput
      kind="text"
      htmlType={
        p.type === "email"
          ? "email"
          : p.type === "tel"
            ? "tel"
            : p.type === "url"
              ? "url"
              : "text"
      }
      value={value}
      onCommit={onCommit as (v: unknown) => void}
    />
  );
}

const inlineInputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-right text-sm hover:border-zinc-400 focus:border-emerald-500 focus:outline-none";

// Единый inline-input для text/email/tel/url/number. Раздваивались только initial
// (string vs number→string), commit (отдать строку vs распарсить в number) и
// htmlType — параметризуем эти три точки и живём в одном компоненте.
function InlineInput(props: {
  kind: "text" | "number";
  htmlType?: "text" | "email" | "tel" | "url";
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const { kind, value, onCommit } = props;
  const initial =
    kind === "number"
      ? typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : ""
      : typeof value === "string"
        ? value
        : "";
  const [local, setLocal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Cинхронизируемся с внешним value (после успешного PATCH / других источников)
  // — НО не затираем то, что юзер сейчас печатает: если этот input в фокусе,
  // ждём blur. Иначе при PATCH поля A терялся набираемый текст в поле B.
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setLocal(initial);
  }, [initial]);

  const commit = () => {
    if (local === initial) return;
    if (kind === "number") {
      if (local === "") {
        onCommit("");
        return;
      }
      const n = Number(local);
      if (Number.isFinite(n)) onCommit(n);
    } else {
      onCommit(local);
    }
  };

  return (
    <input
      ref={ref}
      type={kind === "number" ? "number" : props.htmlType ?? "text"}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setLocal(initial);
      }}
      className={inlineInputClass}
    />
  );
}
