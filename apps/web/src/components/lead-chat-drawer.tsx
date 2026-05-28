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
}) {
  const chat = useLeadChat(props);
  if (!chat) return null;
  return (
    <ChatDrawer
      wsId={props.wsId}
      contact={chat.contact}
      accountId={chat.accountId}
      accounts={props.accounts}
      onSelectAccount={chat.setAccountId}
      onClose={props.onClose}
    />
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
    />
  );
}
