import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import type { ChatPeer } from "../lib/chat-store";

// URL TG-клиента: dev-сервер apps/tg-client живёт на :1234 (webpack-dev-server
// дефолт). Для prod заменить через env при деплое.
const TG_CLIENT_ORIGIN =
  import.meta.env.VITE_TG_CLIENT_ORIGIN ?? "http://localhost:1234";

type Props = {
  wsId: string;
  accountId: string;
  // Identifier лида в TG. Меняется при переключении контакта без ремонта iframe.
  // null/undefined — iframe запускается без auto-открытия чата (full-page mode).
  peer?: ChatPeer | null;
};

export function TgChatIframe({ wsId, accountId, peer }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [authState, setAuthState] = useState<string>();
  const [connectionState, setConnectionState] = useState<string>();
  // isSynced — chat list загружен, можно безопасно openChat. Без этого
  // флага TWA падает на попытке открыть чат когда state ещё пуст.
  const [isSynced, setIsSynced] = useState(false);
  // Латч: iframe мог попросить session ДО того как наш React успел навесить
  // listener / получить session из API. Запоминаем факт запроса; отдельный
  // useEffect ниже отдаст session когда оба готовы.
  const [sessionRequested, setSessionRequested] = useState(false);

  const sessionQ = useQuery({
    queryKey: ["twa-session", wsId, accountId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/twa-session",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const theme =
    typeof document !== "undefined"
      && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";

  // URL iframe'а собирается один раз — переключение peer'а идёт через postMessage,
  // не через изменение src.
  const [iframeUrl] = useState(() => {
    const url = new URL("/", TG_CLIENT_ORIGIN);
    url.searchParams.set("accountId", accountId);
    url.searchParams.set("theme", theme);
    url.searchParams.set("parentOrigin", window.location.origin);
    return url.toString();
  });

  // Listener сообщений от iframe. Whitelist origin.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== TG_CLIENT_ORIGIN) return;
      const { type } = event.data ?? {};

      if (type === "sessionRequest") {
        setSessionRequested(true);
      } else if (type === "sessionRequestFailed") {
        setConnectionState("connectionStateBroken");
      } else if (type === "authState") {
        setAuthState(event.data.state);
      } else if (type === "connectionState") {
        setConnectionState(event.data.state);
      } else if (type === "syncState") {
        setIsSynced(Boolean(event.data.isSynced));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Латч-handler: когда оба готовы (request пришёл + session загружен), шлём
  // sessionResponse. Если session приходит позже request — здесь и срабатывает.
  useEffect(() => {
    if (!sessionRequested || !sessionQ.data) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "sessionResponse", session: sessionQ.data.session },
      TG_CLIENT_ORIGIN,
    );
    setSessionRequested(false);
  }, [sessionRequested, sessionQ.data]);

  // openChat шлём только когда iframe полностью готов: auth=ready + chat list
  // загружен. Без isSynced TWA падает на threadsById undefined.
  useEffect(() => {
    if (!peer) return;
    if (authState !== "authorizationStateReady") return;
    if (!isSynced) return;
    if (!iframeRef.current?.contentWindow) return;
    const msg =
      peer.type === "username"
        ? { type: "openChatByUsername", username: peer.value }
        : { type: "openChat", id: peer.value };
    iframeRef.current.contentWindow.postMessage(msg, TG_CLIENT_ORIGIN);
  }, [peer, authState, isSynced]);

  if (sessionQ.error) {
    return (
      <Centered>
        <div className="text-red-600">{errorMessage(sessionQ.error)}</div>
        <p className="mt-2 text-xs text-zinc-500">
          Проверьте что аккаунт активен и сессия не истекла.
        </p>
      </Centered>
    );
  }

  // Готов = auth прошёл + соединение TG установлено + chat list синкнулся.
  // Только тогда показываем iframe — иначе TWA в процессе init'а перерисовывает
  // layout (sign-in screen → connecting → chats → chat) и юзер видит мигание.
  // Iframe всё равно рендерим под overlay'ем, чтобы он успел инициализироваться.
  const isReady =
    authState === "authorizationStateReady" &&
    connectionState === "connectionStateReady" &&
    isSynced;

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        className={
          "h-full w-full border-0 transition-opacity " +
          (isReady ? "opacity-100" : "opacity-0")
        }
        title="Telegram chat"
      />
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white">
          <Loader2 size={28} className="animate-spin text-emerald-500" />
          <div className="text-sm text-zinc-500">
            {connectionState === "connectionStateBroken"
              ? "Нет коннекта к Telegram"
              : connectionState === "connectionStateConnecting"
              ? "Подключаемся к Telegram…"
              : !authState || authState === "authorizationStateWaitTdlibParameters"
              ? "Загружаем сессию…"
              : !isSynced
              ? "Синхронизируем чаты…"
              : "Загрузка чата…"}
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
      <div className="text-center">{children}</div>
    </div>
  );
}
