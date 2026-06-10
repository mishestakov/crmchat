import { useEffect, useRef, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { WS_QK } from "./query-keys";

// Закрытие модалки на ESC. handler пересохраняем в ref, чтобы effect не
// перецеплялся при каждом ререндере вызывающего.
//
// Стек: оверлеи могут лежать друг на друге (карточка канала поверх чата,
// диалог шаблона поверх редактора стадий) — Esc закрывает только верхний
// (смонтированный последним), а не всю стопку разом.
const escStack: { current: () => void }[] = [];

function onWindowEsc(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  escStack[escStack.length - 1]?.current();
}

export function useEscapeKey(handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (escStack.length === 0) {
      window.addEventListener("keydown", onWindowEsc);
    }
    escStack.push(ref);
    return () => {
      const i = escStack.indexOf(ref);
      if (i >= 0) escStack.splice(i, 1);
      if (escStack.length === 0) {
        window.removeEventListener("keydown", onWindowEsc);
      }
    };
  }, []);
}

// Click outside на mousedown. handler в ref — те же причины.
export function useClickOutside(
  elRef: RefObject<HTMLElement | null>,
  handler: () => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (elRef.current && !elRef.current.contains(e.target as Node)) {
        ref.current();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [elRef]);
}

// Роль текущего юзера в workspace'е. Возвращает 'admin' | 'member' | undefined
// (пока запросы грузятся). Кэш `me` и `members` шарится с другими местами.
export function useMyRole(wsId: string): "admin" | "member" | undefined {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/v1/auth/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data;
    },
  });
  const members = useQuery({
    queryKey: WS_QK.members(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{id}/members", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  return members.data?.find((m) => m.id === me.data?.id)?.role;
}

// EventSource-подписка на конкретное событие. url=null → не подключаемся
// (полезно для conditional-стримов). handler в ref, чтобы reconnect не
// триггерился на новый замыкании в родителе.
export function useEventSourceEvent<T = unknown>(
  url: string | null,
  event: string,
  onMessage: (data: T) => void,
): void {
  const cb = useRef(onMessage);
  cb.current = onMessage;
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url, { withCredentials: true });
    const h = (e: MessageEvent) => cb.current(JSON.parse(e.data) as T);
    es.addEventListener(event, h);
    return () => {
      es.removeEventListener(event, h);
      es.close();
    };
  }, [url, event]);
}
