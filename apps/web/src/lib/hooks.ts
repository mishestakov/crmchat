import { useEffect, useRef, type RefObject } from "react";

// Закрытие модалки на ESC. handler пересохраняем в ref, чтобы effect не
// перецеплялся при каждом ререндере вызывающего.
export function useEscapeKey(handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
