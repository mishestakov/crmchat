import { useCallback, useEffect, useRef, useState } from "react";

// Черновик сообщения per-chat в localStorage. Дроп-ин замена useState("") в
// родителе композера: набранный текст переживает случайное закрытие чата/дровера
// (клик вне диалога → unmount), восстанавливается при возврате и чистится при
// успешной отправке — clear().
//
// Пишем СИНХРОННО на каждое изменение, без debounce. Боль, которую чиним, —
// текст пропадает при резком уходе из чата, а unmount может случиться в любой
// момент; при debounce последние символы перед ним не успели бы записаться —
// ровно тот же баг. Значение короткое, setItem дешёвый — джанка нет.
//
// Скоуп — этот браузер (localStorage), намеренно НЕ телеграмный draft: TG-аккаунты
// общие на агентство, нативный draft протекал бы в клиент и коллизил между
// операторами. localStorage к тому же одинаково работает для TG/MAX/будущих
// каналов — один механизм на все.
const PREFIX = "chat-draft:";

function read(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return ""; // приватный режим / storage отключён — просто без черновика
  }
}

function write(key: string, value: string): void {
  try {
    // Пустой ИЛИ состоящий только из пробелов черновик не храним — сразу
    // removeItem. Иначе whitespace-only черновик залипал бы: отправить нельзя
    // (composer гейтит по trim), а сам он не чистится. Значение кладём как есть
    // (не trim'нутое) — внутренние переводы строк сохраняем.
    if (value.trim()) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* quota / приватный режим — черновик не сохранится, это не критично */
  }
}

export function useChatDraft(key: string): {
  text: string;
  setText: (v: string | ((prev: string) => string)) => void;
  clear: () => void;
} {
  const [text, setTextState] = useState(() => read(key));
  // Рефы, чтобы setText/clear писали в АКТУАЛЬНЫЕ ключ/текст без пересоздания
  // колбэков (стабильный onChange → не дёргаем композер лишними ре-рендерами).
  const keyRef = useRef(key);
  const textRef = useRef(text);
  textRef.current = text;

  // Смена чата (key) без размонтирования — например переключение контакта в
  // дровере: подгружаем черновик нового чата. keyRef синхроним до setTextState,
  // чтобы последующая запись ушла уже в новый ключ.
  useEffect(() => {
    keyRef.current = key;
    const next = read(key);
    textRef.current = next; // держим ref в паре с state — иначе setText в тот же
    setTextState(next); //     тик считал бы next от текста прошлого чата
  }, [key]);

  const setText = useCallback((v: string | ((prev: string) => string)) => {
    const next = typeof v === "function" ? v(textRef.current) : v;
    textRef.current = next;
    write(keyRef.current, next);
    setTextState(next);
  }, []);

  const clear = useCallback(() => {
    textRef.current = "";
    write(keyRef.current, "");
    setTextState("");
  }, []);

  return { text, setText, clear };
}
