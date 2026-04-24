import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useTgChat } from "../lib/chat-store";
import { OUTREACH_QK } from "../lib/query-keys";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { TgChatIframe } from "./tg-chat-iframe";

// Глобально-смонтированный TG-чат. Один на всю CRM-сессию пока живёт layout.
//
// Управляется ChatProvider:
//   - mounted = последняя пара (account, peer) — служит как «памятка» для iframe.
//   - visible = open/close модала.
//
// Iframe рендерится после первого open и больше НЕ размонтируется (только
// скрывается через `hidden`). Это сохраняет MTProto-соединение между
// открытиями — экономит handshake'и и щадит outreach-аккаунт от подозрительной
// активности.
//
// Если в будущем добавим account-switcher (открывать чат от разных outreach-
// аккаунтов) — `key={accountId}` ремонтирует iframe при смене account, потому
// что один TG-клиент = одна сессия. Смена контакта (peer) — без ремонта.
export function TgChatHost() {
  const { mounted, visible, close } = useTgChat();

  // ESC закрывает модал — стандартный UX. Backdrop-click НЕ закрываем: легко
  // случайно тапнуть мимо контента и потерять открытый чат.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, close]);

  return (
    <div
      className={
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 " +
        (visible ? "" : "hidden")
      }
    >
      <div className="flex h-[85vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
          <div className="text-sm font-medium">Telegram-чат</div>
          <button
            type="button"
            onClick={close}
            className="text-zinc-400 hover:text-zinc-700"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {/* iframe рендерим только после первого open — до этого его нет смысла грузить */}
          {mounted && (
            <TgChatIframe
              key={mounted.accountId}
              wsId={mounted.wsId}
              accountId={mounted.accountId}
              peer={mounted.peer}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Хелпер компонент для контакт-detail и других мест: запрашивает первый
// active outreach-аккаунт workspace и открывает чат с переданным peer.
// Пока без account-switcher; continuity-of-identity (выбирать тот аккаунт что
// писал лиду первым) — следующим заходом, нужен link contact ↔ outreach_lead.
export function useOpenChat(wsId: string) {
  const { open } = useTgChat();
  const accounts = useQuery({
    queryKey: OUTREACH_QK.accounts(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const activeAccount = accounts.data?.find((a) => a.status === "active");

  return {
    isReady: !accounts.isLoading,
    activeAccount,
    error: accounts.error ? errorMessage(accounts.error) : null,
    openChat: (peer: { username?: string | null; tgUserId?: string | null }) => {
      if (!activeAccount) return;
      const p = peer.username
        ? { type: "username" as const, value: peer.username.replace(/^@/, "") }
        : peer.tgUserId
          ? { type: "id" as const, value: peer.tgUserId }
          : null;
      if (!p) return;
      open({ wsId, accountId: activeAccount.id, peer: p });
    },
  };
}
