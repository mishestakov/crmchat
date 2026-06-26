import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../lib/api";

// Поиск + выбор существующего контакта workspace'а. GET /contacts?q=
// возвращает плоский список; фильтруем уже-привязанных на клиенте,
// чтобы не плодить особый API.
export function ContactPicker(props: {
  wsId: string;
  excludeIds: Set<string>;
  onPick: (contactId: string) => void;
  // Если задан — при пустом поиске показываем «создать по @username».
  onCreateByUsername?: (username: string) => void;
  // Если задан — рисуем крестик-отмену (для inline-add). В постоянно открытом
  // пикере (резолвер лонглиста) отмена не нужна — крестик не показываем.
  onCancel?: () => void;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 500);
    return () => clearTimeout(t);
  }, [q]);

  const contactsQ = useQuery({
    queryKey: ["contacts", props.wsId, debounced] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts",
        {
          params: {
            path: { wsId: props.wsId },
            query: { q: debounced || undefined },
          },
        },
      );
      if (error) throw error;
      return data;
    },
    enabled: debounced.length > 0,
  });

  const results = (contactsQ.data ?? []).filter(
    (c) => !props.excludeIds.has(c.id),
  );

  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск контакта по имени или @"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
        />
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {debounced.length === 0 && (
        <p className="text-xs text-zinc-500">Введите запрос для поиска</p>
      )}
      {debounced.length > 0 && contactsQ.isLoading && (
        <p className="text-xs text-zinc-500">Поиск…</p>
      )}
      {debounced.length > 0 && contactsQ.data && results.length === 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">Ничего не найдено</p>
          {props.onCreateByUsername &&
            (() => {
              const uname = debounced.replace(/^@/, "").trim();
              if (!uname) return null;
              // MAX-ссылка max.ru/u/<token> — сырой URL «стрёмный»: имя достанется
              // только при создании (резолв на сервере), поэтому показываем чистый
              // лейбл. Уже привязанный контакт находится поиском по max_link (выше)
              // и показывается по имени в results.
              const isMaxLink = /max\.ru\/u\//i.test(uname);
              const label = isMaxLink
                ? "Создать MAX-контакт по ссылке"
                : `Создать контакт ${uname.includes("/") ? uname : `@${uname}`}`;
              return (
                <button
                  type="button"
                  onClick={() => props.onCreateByUsername!(uname)}
                  disabled={props.loading}
                  className="w-full rounded-md bg-emerald-600 px-2 py-1.5 text-left text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  + {label}
                </button>
              );
            })()}
        </div>
      )}
      {results.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((c) => {
            const v = c.properties as Record<string, unknown>;
            const name = typeof v.full_name === "string" ? v.full_name : "—";
            const username =
              typeof v.telegram_username === "string"
                ? v.telegram_username
                : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => props.onPick(c.id)}
                  disabled={props.loading}
                  className="flex w-full items-center justify-between rounded-md bg-white px-2 py-1.5 text-left text-sm hover:bg-emerald-100 disabled:opacity-50"
                >
                  <span className="truncate font-medium text-zinc-900">
                    {name}
                  </span>
                  {username && (
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">
                      @{username}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
