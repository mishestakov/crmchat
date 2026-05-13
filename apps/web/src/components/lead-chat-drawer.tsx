import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@repo/core";
import { api } from "../lib/api";
import { type AccountRow, ChatDrawer } from "./chat-drawer";

// Обёртка над ChatDrawer для входа из проекта (канбан + таблица лидов).
// После 5A лид всегда указывает на contact (создаётся при импорте), поэтому
// тут только режим contact с историей через /contacts/{id}/chat-history.

type LeadShape = {
  id: string;
  contactId: string | null;
  account: { id: string } | null;
};

export function LeadChatDrawer(props: {
  wsId: string;
  lead: LeadShape;
  accounts: AccountRow[];
  onClose: () => void;
}) {
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
  if (!accountId) return null;
  if (!props.lead.contactId) return null;
  if (contactQ.isLoading) return null;
  if (!contactQ.data) return null;

  return (
    <ChatDrawer
      wsId={props.wsId}
      contact={contactQ.data}
      accountId={accountId}
      accounts={props.accounts}
      onSelectAccount={setAccountId}
      onClose={props.onClose}
    />
  );
}
