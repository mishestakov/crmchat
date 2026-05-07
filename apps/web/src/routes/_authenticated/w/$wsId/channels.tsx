import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
                    className="border-t border-zinc-100 hover:bg-zinc-50"
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
