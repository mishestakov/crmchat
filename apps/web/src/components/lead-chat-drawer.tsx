import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@repo/core";
import { api } from "../lib/api";
import {
  type AccountRow,
  ChatDrawer,
  ChatPanel,
  type MessageTagKind,
  type MessageTagRef,
} from "./chat-drawer";

// Обёртка над ChatDrawer/ChatPanel для входа из проекта (канбан + таблица
// лидов + лонглист кампаний). После 5A лид всегда указывает на contact
// (создаётся при импорте), поэтому тут только режим contact с историей через
// /contacts/{id}/chat-history.

type LeadShape = {
  id: string;
  contactId: string | null;
  account: { id: string } | null;
};

// Резолв contact + выбор аккаунта — общая часть drawer- и panel-режима.
// null, пока контакт не готов (нет id / грузится / не нашёлся).
function useLeadChat(props: { wsId: string; lead: LeadShape; accounts: AccountRow[] }) {
  const contactQ = useQuery({
    queryKey: ["contact", props.wsId, props.lead.contactId ?? ""] as const,
    enabled: !!props.lead.contactId,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}",
        {
          params: { path: { wsId: props.wsId, id: props.lead.contactId! } },
        },
      );
      if (error) throw error;
      return data as Contact;
    },
  });

  const initialAccountId =
    props.lead.account?.id ?? props.accounts[0]?.id ?? null;
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);

  // На первом рендере аккаунты могут быть ещё не загружены → accountId залипает
  // в null. Подставляем первый, как только они приедут (fix #7).
  useEffect(() => {
    if (accountId) return;
    const fallback = props.lead.account?.id ?? props.accounts[0]?.id ?? null;
    if (fallback) setAccountId(fallback);
  }, [props.accounts, props.lead.account?.id, accountId]);

  if (!accountId || !props.lead.contactId || !contactQ.data) return null;
  return { contact: contactQ.data, accountId, setAccountId };
}

export function LeadChatDrawer(props: {
  wsId: string;
  lead: LeadShape;
  accounts: AccountRow[];
  onClose: () => void;
  // Канбан-режим: смена стадии прямо из чата + ссылка на полную карточку.
  // Стадия — свойство лида (project_item), не контакта, поэтому управление
  // живёт тут, а ChatDrawer лишь рисует переданный стрип в шапке. Нет объекта
  // (контакт/таблица вне канбана) → стрипа нет.
  stageControl?: {
    stages: { id: string; name: string }[];
    currentStageId: string | null;
    onSetStage: (stageId: string | null) => void;
    onOpenFullCard: () => void;
    disabled?: boolean;
  };
}) {
  const chat = useLeadChat(props);
  if (!chat) return null;
  const headerExtra = props.stageControl ? (
    <StageStrip {...props.stageControl} />
  ) : undefined;
  return (
    <ChatDrawer
      wsId={props.wsId}
      contact={chat.contact}
      accountId={chat.accountId}
      accounts={props.accounts}
      onSelectAccount={chat.setAccountId}
      onClose={props.onClose}
      headerExtra={headerExtra}
    />
  );
}

// Полоска под шапкой чата: статус лида (выпадашка стадий проекта) + ссылка на
// полную карточку контакта. "" = «Без стадии». disabled при завершённом проекте.
function StageStrip(props: {
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  onSetStage: (stageId: string | null) => void;
  onOpenFullCard: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2">
      <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
        Статус
        <select
          value={props.currentStageId ?? ""}
          disabled={props.disabled}
          onChange={(e) => props.onSetStage(e.target.value || null)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 disabled:opacity-50"
        >
          <option value="">Без стадии</option>
          {props.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={props.onOpenFullCard}
        className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
      >
        Открыть карточку
      </button>
    </div>
  );
}

// Встроенный режим (без оверлея): для side-by-side рядом с карточкой подбора.
// Закрытие — на родителе, X в шапке скрыт.
export function LeadChatPanel(props: {
  wsId: string;
  lead: LeadShape;
  accounts: AccountRow[];
  onTagMessage?: (kind: MessageTagKind, ref: MessageTagRef) => void;
  taggedKindByMessageId?: Record<string, MessageTagKind>;
  jumpTo?: { messageId: string; nonce: number } | null;
}) {
  const chat = useLeadChat(props);
  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        Загрузка переписки…
      </div>
    );
  }
  return (
    <ChatPanel
      wsId={props.wsId}
      contact={chat.contact}
      accountId={chat.accountId}
      accounts={props.accounts}
      onSelectAccount={chat.setAccountId}
      onTagMessage={props.onTagMessage}
      taggedKindByMessageId={props.taggedKindByMessageId}
      jumpTo={props.jumpTo}
    />
  );
}
