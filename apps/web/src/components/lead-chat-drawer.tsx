import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Contact } from "@repo/core";
import { api } from "../lib/api";
import { type AccountRow, ChatDrawer } from "./chat-drawer";

// Обёртка над ChatDrawer для входа из проекта (канбан + таблица лидов).
// Резолвит Contact по contactId либо переключается в режим lead-no-contact.
// Если у лида нет ни contactId, ни tg_user_id, но есть @username — авто-
// дёргает /resolve-tg на mount: бэк делает searchPublicChat через любой
// outreach-аккаунт и пишет id в project_items.tg_user_id. После этого drawer
// перерисовывается в lead-no-contact с резолвенным id. Без username
// (только phone и т.п.) показываем заглушку — quick-send недоступен.

type LeadShape = {
  id: string;
  contactId: string | null;
  tgUserId: string | null;
  username: string | null;
  phone: string | null;
  account: { id: string } | null;
};

export function LeadChatDrawer(props: {
  wsId: string;
  projectId: string;
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

  // Локальный override tgUserId — после resolve-tg обновляем тут, чтобы не
  // ждать рефетча leads-таблицы и сразу перейти к compose'у.
  const [resolvedTgUserId, setResolvedTgUserId] = useState<string | null>(
    props.lead.tgUserId,
  );
  const resolveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/leads/{leadId}/resolve-tg",
        {
          params: {
            path: {
              wsId: props.wsId,
              projectId: props.projectId,
              leadId: props.lead.id,
            },
          },
        },
      );
      if (error) throw error;
      return data!.tgUserId;
    },
    onSuccess: (tgUserId) => setResolvedTgUserId(tgUserId),
  });

  const needsResolve =
    !props.lead.contactId && !resolvedTgUserId && !!props.lead.username;
  useEffect(() => {
    if (needsResolve && resolveMut.isIdle) {
      resolveMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsResolve]);

  const initialAccountId =
    props.lead.account?.id ?? props.accounts[0]?.id ?? null;
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  if (!accountId) return null;

  // Contact-ветка — стандартный drawer с историей.
  if (props.lead.contactId) {
    if (contactQ.isLoading) return null;
    if (!contactQ.data) return null;
    return (
      <ChatDrawer
        wsId={props.wsId}
        target={{ kind: "contact", contact: contactQ.data }}
        accountId={accountId}
        accounts={props.accounts}
        onSelectAccount={setAccountId}
        onClose={props.onClose}
      />
    );
  }

  // Резолвим tg_user_id — показываем неблокирующий loader-баннер.
  if (resolveMut.isPending) {
    return (
      <Backdrop onClose={props.onClose}>
        Резолвим Telegram-ID для @{props.lead.username}…
      </Backdrop>
    );
  }

  // Резолв упал или дал null — peer без публичного @ или удалён.
  if (resolveMut.isError || (resolveMut.isSuccess && !resolvedTgUserId)) {
    return (
      <Backdrop onClose={props.onClose}>
        Не нашли Telegram-аккаунт по @{props.lead.username}. Возможно
        приватный профиль, удалённый аккаунт или ошибка в username — quick
        send недоступен.
      </Backdrop>
    );
  }

  // Без username — резолвить нечего, показываем старую заглушку.
  if (!resolvedTgUserId) {
    return (
      <Backdrop onClose={props.onClose}>
        У лида нет @username — quick send недоступен. Подождите первой
        авто-отправки или активируйте проект.
      </Backdrop>
    );
  }

  const displayName =
    props.lead.username
      ? `@${props.lead.username}`
      : props.lead.phone ?? "(без identifier)";

  return (
    <ChatDrawer
      wsId={props.wsId}
      target={{
        kind: "lead-no-contact",
        tgUserId: resolvedTgUserId,
        displayName,
        hint: "Контакт ещё не привязан. Ручная отправка остановит авто-цепочку этого проекта для лида.",
      }}
      accountId={accountId}
      accounts={props.accounts}
      onSelectAccount={setAccountId}
      onClose={props.onClose}
    />
  );
}

function Backdrop(props: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30"
      onClick={props.onClose}
    >
      <div
        className="max-w-sm rounded-lg bg-white p-5 text-sm text-zinc-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
        <div className="mt-3 text-right">
          <button
            type="button"
            onClick={props.onClose}
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
