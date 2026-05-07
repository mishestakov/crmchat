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
  onCancel: () => void;
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
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X size={14} />
        </button>
      </div>
      {debounced.length === 0 && (
        <p className="text-xs text-zinc-500">Введите запрос для поиска</p>
      )}
      {debounced.length > 0 && contactsQ.isLoading && (
        <p className="text-xs text-zinc-500">Поиск…</p>
      )}
      {debounced.length > 0 && contactsQ.data && results.length === 0 && (
        <p className="text-xs text-zinc-500">Ничего не найдено</p>
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
