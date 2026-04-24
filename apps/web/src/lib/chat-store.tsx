import { createContext, useCallback, useContext, useState } from "react";

// Глобальное состояние «какой TG-чат сейчас открыт». Намеренно вне TanStack
// Query — это UI-state модала, а не серверные данные.
//
// Семантика «mounted» vs «visible»:
//   - `mounted` — последняя пара (accountId, peer), для которой mount'или iframe.
//     Не очищается при close — чтобы iframe оставался жив в DOM.
//   - `visible` — показываем ли overlay сейчас.
// Это ключевая оптимизация под TG-ресурсы: один MTProto handshake за всю
// сессию работы с одним outreach-аккаунтом, переключение чатов = postMessage.

export type ChatPeer =
  | { type: "username"; value: string }
  | { type: "id"; value: string };

export type ChatMounted = {
  wsId: string;
  accountId: string;
  peer: ChatPeer;
};

type ChatStore = {
  mounted: ChatMounted | null;
  visible: boolean;
  open: (m: ChatMounted) => void;
  close: () => void;
};

const Ctx = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState<ChatMounted | null>(null);
  const [visible, setVisible] = useState(false);

  const open = useCallback((m: ChatMounted) => {
    setMounted(m);
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);

  return (
    <Ctx.Provider value={{ mounted, visible, open, close }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTgChat(): ChatStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTgChat must be used inside <ChatProvider>");
  return v;
}
