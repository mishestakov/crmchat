import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Channel } from "@repo/core";
import { api } from "../../../../lib/api";
import { parseCsv } from "../../../../lib/csv";
import { formatRelative } from "../../../../lib/date-utils";
import { errorMessage } from "../../../../lib/errors";
import { useOutreachAccounts } from "../../../../lib/outreach-queries";

export const Route = createFileRoute("/_authenticated/w/$wsId/channels")({
  component: ChannelsPage,
});

function ChannelsPage() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();

  const channelsQ = useQuery({
    queryKey: ["channels", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // Drawer админов выбранного канала. Источник истины — channelsQ.data, чтобы
  // при PATCH'е каналов drawer всегда показывал свежий admins[].
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const openChannel =
    openChannelId
      ? channelsQ.data?.find((c) => c.id === openChannelId) ?? null
      : null;

  const accountsQ = useOutreachAccounts(wsId);
  const accountById = new Map(
    (accountsQ.data ?? []).map((a) => [a.id, a]),
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const parsed = parseCsv(text);
      // CSV-схема: колонки channel_url (обяз.), title, admin_username,
      // admin_phone (опц.). Любая из колонок может отсутствовать — мы её
      // просто читаем как undefined.
      const rows = parsed.rows.map((r) => ({
        channel_url: r.channel_url ?? r.url ?? "",
        title: r.title || undefined,
        admin_username: r.admin_username || undefined,
        admin_phone: r.admin_phone || undefined,
      }));
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/import",
        {
          params: { path: { wsId } },
          body: { rows },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      setImportMsg(
        `Импорт: ${res.channelsCreated} новых, ${res.channelsUpdated} обновлено, ` +
          `${res.adminContactsCreated} контактов создано` +
          (res.adminContactsRecognized > 0
            ? ` (${res.adminContactsRecognized} распознано в TG)`
            : "") +
          (res.skippedNoUrl > 0
            ? `, ${res.skippedNoUrl} пропущено без ссылки`
            : ""),
      );
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e) => setImportMsg(`Ошибка: ${errorMessage(e)}`),
  });

  const rows = channelsQ.data ?? [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Каналы</h1>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importMut.mutate(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importMut.isPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {importMut.isPending ? "Импорт…" : "Импортировать CSV"}
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          {importMsg}
        </div>
      )}

      {channelsQ.isLoading && <p>Загрузка…</p>}
      {channelsQ.error && (
        <p className="text-red-600">{errorMessage(channelsQ.error)}</p>
      )}

      {channelsQ.data && (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Ссылка</th>
                <th className="px-3 py-2 font-medium">Админ</th>
                <th className="px-3 py-2 font-medium">Закреплён за</th>
                <th className="px-3 py-2 font-medium">Последнее сообщение</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-12 text-center text-zinc-400"
                  >
                    Каналов пока нет — импортируйте CSV (колонки:
                    channel_url, admin_username)
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const primaryAdmin = c.admins[0];
                const acc = primaryAdmin?.primaryAccountId
                  ? accountById.get(primaryAdmin.primaryAccountId)
                  : null;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setOpenChannelId(c.id)}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {c.title}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {c.link ? (
                        <a
                          href={normalizeHref(c.link)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-emerald-700 hover:underline"
                        >
                          {c.link}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      <AdminCell admins={c.admins} />
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {acc ? formatAccount(acc) : "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {c.lastMessageAt ? formatRelative(c.lastMessageAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openChannel && (
        <ChannelDrawer
          wsId={wsId}
          channel={openChannel}
          onClose={() => setOpenChannelId(null)}
        />
      )}
    </div>
  );
}

// Drawer на 480px справа: показывает админов канала и позволяет добавлять/убирать
// контакты. Поиск по контактам workspace через GET /contacts?q= с debounce.
function ChannelDrawer(props: {
  wsId: string;
  channel: Channel;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const removeMut = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
        {
          params: {
            path: { wsId: props.wsId, id: props.channel.id, contactId },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", props.wsId] });
      qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
    },
  });

  const addMut = useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/admins",
        {
          params: { path: { wsId: props.wsId, id: props.channel.id } },
          body: { contactIds: [contactId] },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", props.wsId] });
      qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
      setAdding(false);
    },
  });

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/20"
        onClick={props.onClose}
      />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[480px] max-w-[90vw] flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0 pr-2">
            <div className="truncate font-medium">{props.channel.title}</div>
            {props.channel.link && (
              <a
                href={normalizeHref(props.channel.link)}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-xs text-emerald-700 hover:underline"
              >
                {props.channel.link}
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-700">
              Админы ({props.channel.admins.length})
            </h3>
            {!adding && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                <Plus size={12} />
                Добавить
              </button>
            )}
          </div>

          {props.channel.admins.length === 0 && !adding && (
            <p className="mb-3 text-sm text-zinc-400">
              Админы пока не привязаны
            </p>
          )}

          <ul className="space-y-1">
            {props.channel.admins.map((a) => (
              <li
                key={a.contactId}
                className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900">
                    {a.fullName || (a.telegramUsername ? `@${a.telegramUsername}` : a.contactId)}
                  </div>
                  {a.telegramUsername && a.fullName && (
                    <div className="truncate text-xs text-zinc-500">
                      @{a.telegramUsername}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeMut.mutate(a.contactId)}
                  disabled={removeMut.isPending}
                  className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  aria-label="Убрать"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>

          {adding && (
            <ContactPicker
              wsId={props.wsId}
              excludeIds={new Set(props.channel.admins.map((a) => a.contactId))}
              onPick={(contactId) => addMut.mutate(contactId)}
              onCancel={() => setAdding(false)}
              loading={addMut.isPending}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function ContactPicker(props: {
  wsId: string;
  excludeIds: Set<string>;
  onPick: (contactId: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // GET /contacts?q= возвращает плоский список; фильтруем уже привязанных
  // на клиенте, чтобы не плодить особый API.
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

function AdminCell({ admins }: { admins: Channel["admins"] }) {
  if (admins.length === 0) return <>—</>;
  const first = admins[0]!;
  const label =
    first.fullName ||
    (first.telegramUsername ? `@${first.telegramUsername}` : first.contactId);
  if (admins.length === 1) return <>{label}</>;
  return (
    <span title={admins.map((a) => a.fullName ?? a.telegramUsername).join(", ")}>
      {label} <span className="text-zinc-400">+{admins.length - 1}</span>
    </span>
  );
}

function formatAccount(a: {
  firstName: string | null;
  tgUsername: string | null;
  phoneNumber: string | null;
  id: string;
}): string {
  return a.firstName || (a.tgUsername ? `@${a.tgUsername}` : a.phoneNumber ?? a.id);
}

// Юзер мог вписать @-имя или t.me/foo без схемы. Делаем кликабельную ссылку
// на t.me — если уже t.me/joinchat/... оставляем как есть.
function normalizeHref(link: string): string {
  if (/^https?:\/\//.test(link)) return link;
  if (link.startsWith("@")) return `https://t.me/${link.slice(1)}`;
  if (link.startsWith("t.me/")) return `https://${link}`;
  return `https://t.me/${link}`;
}
