import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Channel, ImportChannelsMapping } from "@repo/core";
import { api } from "../../../../lib/api";
import { ChannelCard, formatMembers } from "../../../../components/channel-card";
import { SearchInput } from "../../../../components/search-input";
import { parseCsv, type ParsedCsv } from "../../../../lib/csv";
import { formatRelative } from "../../../../lib/date-utils";
import { errorMessage } from "../../../../lib/errors";
import { useOutreachAccounts } from "../../../../lib/outreach-queries";

// Slot'ы для column-mapping в импорте. value ∈ ImportChannelsMapping ключи +
// 'ignore' + 'property'. Порядок = порядок в select-dropdown'е.
type Slot =
  | "ignore"
  | "title"
  | "username"
  | "externalId"
  | "link"
  | "memberCount"
  | "description"
  | "adminUsername"
  | "property";

const SLOT_LABELS: Record<Slot, string> = {
  ignore: "— Игнорировать",
  title: "Название",
  username: "@username канала",
  externalId: "ID канала (chat_id)",
  link: "Ссылка",
  memberCount: "Подписчиков",
  description: "Описание",
  adminUsername: "@username админа",
  property: "В свойство…",
};

// Авто-детект слота по имени CSV-заголовка. Ключи нормализованы
// (lower-case, non-alnum → '_'); сравниваем нормализованный header'ом.
const AUTO_DETECT: Record<string, Slot> = {
  title: "title",
  name: "title",
  channel_name: "title",
  username: "username",
  channel_username: "username",
  handle: "username",
  chat_id: "externalId",
  channel_id: "externalId",
  id: "externalId",
  external_id: "externalId",
  subscribers: "memberCount",
  member_count: "memberCount",
  members: "memberCount",
  followers: "memberCount",
  description: "description",
  desc: "description",
  about: "description",
  admin_username: "adminUsername",
  admin: "adminUsername",
  owner: "adminUsername",
  link: "link",
  url: "link",
  channel_url: "link",
};

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Маппинг одной колонки. Для slot='property' юзер задаёт ключ внутри
// channels.properties (например 'er', 'niche').
type ColMapping =
  | { slot: Exclude<Slot, "property"> }
  | { slot: "property"; propertyKey: string };

export const Route = createFileRoute("/_authenticated/w/$wsId/channels")({
  component: ChannelsPage,
});

// Должен совпадать с CHANNELS_PAGE_LIMIT в apps/api/src/routes/channels.ts —
// при равенстве показываем плашку «уточните поиск».
const PAGE_LIMIT = 1000;

function ChannelsPage() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");

  const channelsQ = useQuery({
    queryKey: ["channels", wsId, search] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels",
        {
          params: {
            path: { wsId },
            query: { q: search || undefined },
          },
        },
      );
      if (error) throw error;
      return data;
    },
    placeholderData: (prev) => prev,
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

  const rows = channelsQ.data ?? [];

  // CSV-импорт: парсим локально → открываем wizard. Wizard сам делает POST.
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingCsv, setPendingCsv] = useState<{
    fileName: string;
    parsed: ParsedCsv;
  } | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const onFile = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setImportMsg("Файл пуст или не содержит данных");
        return;
      }
      setPendingCsv({ fileName: f.name, parsed });
      setImportMsg(null);
    } catch (e) {
      setImportMsg(`Не смог прочитать CSV: ${errorMessage(e)}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

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
              if (f) void onFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Импортировать CSV
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          {importMsg}
        </div>
      )}

      {pendingCsv && (
        <ImportWizard
          wsId={wsId}
          fileName={pendingCsv.fileName}
          parsed={pendingCsv.parsed}
          onClose={() => setPendingCsv(null)}
          onSuccess={(text) => {
            setPendingCsv(null);
            setImportMsg(text);
            qc.invalidateQueries({ queryKey: ["channels", wsId] });
            qc.invalidateQueries({ queryKey: ["contacts", wsId] });
          }}
        />
      )}

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Поиск по названию или @username…"
      />

      {channelsQ.isLoading && <p>Загрузка…</p>}
      {channelsQ.error && (
        <p className="text-red-600">{errorMessage(channelsQ.error)}</p>
      )}

      {channelsQ.data && rows.length === PAGE_LIMIT && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Показаны первые {PAGE_LIMIT.toLocaleString("ru-RU")} каналов. Уточните
          поиск, чтобы увидеть остальные.
        </div>
      )}

      {channelsQ.data && (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Канал</th>
                <th className="px-3 py-2 text-right font-medium">Подписчики</th>
                <th className="px-3 py-2 font-medium">Админ</th>
                <th className="px-3 py-2 font-medium">Закреплён за</th>
                <th className="px-3 py-2 font-medium">Последний пост</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-12 text-center text-zinc-400"
                  >
                    {search
                      ? "По запросу ничего не найдено"
                      : "Каналов пока нет — импортируйте CSV"}
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
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-900">{c.title}</div>
                      {c.username && (
                        <a
                          href={`https://t.me/${c.username}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-zinc-500 hover:text-emerald-700 hover:underline"
                        >
                          @{c.username}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                      {formatMembers(c.memberCount)}
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

// Drawer на 560px справа: top-bar (close) + список админов канала с
// add/remove + ChannelCard (header/sync/history) занимает остаток высоты.
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
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[560px] max-w-[95vw] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-xs">
          <button
            type="button"
            onClick={props.onClose}
            className="text-zinc-500 hover:text-zinc-700"
          >
            ← Закрыть
          </button>
        </div>
        <div className="border-b border-zinc-200 px-4 py-3">
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
            <p className="text-sm text-zinc-400">Админы пока не привязаны</p>
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
        <ChannelCard wsId={props.wsId} channel={props.channel} />
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
    const t = setTimeout(() => setDebounced(q.trim()), 500);
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

// CSV-import wizard: модалка с превью топ-10 строк × select-маппинг на
// каждую колонку. Auto-detect знакомых заголовков, юзер правит через select.
// Identifying-маппинг (externalId или username) — обязателен, иначе нечем
// дедуплицировать. Свободные колонки → properties под заданным ключом.
function ImportWizard(props: {
  wsId: string;
  fileName: string;
  parsed: ParsedCsv;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const { parsed } = props;

  // Init: для каждого header — auto-detect или 'ignore'. Используем заголовок
  // как ключ state'а; все равенство по строке.
  const [mappings, setMappings] = useState<Record<string, ColMapping>>(() => {
    const init: Record<string, ColMapping> = {};
    const used = new Set<string>();
    for (const h of parsed.headers) {
      const norm = normalizeHeader(h);
      const auto = AUTO_DETECT[norm];
      // Один слот используем максимум один раз — если auto-detect триггернул
      // дважды (две колонки 'username' и 'channel_username'), вторую делаем
      // 'ignore', юзер выберет вручную.
      if (auto && auto !== "property" && !used.has(auto)) {
        init[h] = { slot: auto } as ColMapping;
        used.add(auto);
      } else {
        init[h] = { slot: "ignore" } as ColMapping;
      }
    }
    return init;
  });

  const setSlot = (header: string, slot: Slot) => {
    setMappings((m) => {
      const next = { ...m };
      if (slot === "property") {
        // Дефолтный propertyKey = нормализованный header (er, niche, ...).
        next[header] = { slot: "property", propertyKey: normalizeHeader(header) };
      } else {
        next[header] = { slot } as ColMapping;
      }
      return next;
    });
  };

  const setPropertyKey = (header: string, propertyKey: string) => {
    setMappings((m) => ({ ...m, [header]: { slot: "property", propertyKey } }));
  };

  // Какие slot'ы уже заняты (кроме текущей колонки) — чтобы не дать выбрать
  // дважды один типизированный слот.
  const usedSlots = useMemo(() => {
    const used = new Map<string, string>(); // slot → header
    for (const [h, m] of Object.entries(mappings)) {
      if (m.slot !== "ignore" && m.slot !== "property") {
        used.set(m.slot, h);
      }
    }
    return used;
  }, [mappings]);

  // Identifying-маппинг для дедупа.
  const hasIdentifier = useMemo(() => {
    return Object.values(mappings).some(
      (m) => m.slot === "externalId" || m.slot === "username",
    );
  }, [mappings]);

  // Дубль-ключи в свойствах — недопустимы.
  const propertyKeyError = useMemo(() => {
    const keys = new Map<string, number>();
    for (const m of Object.values(mappings)) {
      if (m.slot === "property") {
        if (!m.propertyKey.trim()) return "У свойства должен быть ключ";
        if (!/^[a-z0-9_]+$/i.test(m.propertyKey)) {
          return `Ключ свойства «${m.propertyKey}» содержит недопустимые символы (только a-z, 0-9, _)`;
        }
        keys.set(m.propertyKey, (keys.get(m.propertyKey) ?? 0) + 1);
      }
    }
    for (const [k, n] of keys) {
      if (n > 1) return `Ключ свойства «${k}» использован дважды`;
    }
    return null;
  }, [mappings]);

  const submitMut = useMutation({
    mutationFn: async () => {
      // Собираем body: {rows: всё CSV, mapping: slot→header + properties}.
      const apiMapping: ImportChannelsMapping = {};
      const properties: Record<string, string> = {};
      for (const [header, m] of Object.entries(mappings)) {
        if (m.slot === "ignore") continue;
        if (m.slot === "property") {
          properties[m.propertyKey] = header;
        } else {
          apiMapping[m.slot] = header;
        }
      }
      if (Object.keys(properties).length > 0) apiMapping.properties = properties;

      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/import",
        {
          params: { path: { wsId: props.wsId } },
          body: {
            rows: parsed.rows,
            mapping: apiMapping,
            platform: "telegram",
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res) => {
      const parts = [
        `${res.channelsCreated} новых`,
        `${res.channelsUpdated} обновлено`,
      ];
      if (res.channelsSyncSkipped > 0) {
        parts.push(`${res.channelsSyncSkipped} актуализированы из TG (только свойства)`);
      }
      if (res.adminContactsCreated > 0) {
        parts.push(
          `${res.adminContactsCreated} контактов создано` +
            (res.adminContactsRecognized > 0
              ? ` (${res.adminContactsRecognized} распознано в TG)`
              : ""),
        );
      }
      if (res.skippedNoIdentifier > 0) {
        parts.push(`${res.skippedNoIdentifier} строк без идентификатора пропущено`);
      }
      props.onSuccess(`Импорт: ${parts.join(", ")}`);
    },
  });

  // Esc — закрыть. Ctrl+Enter — отправить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitMut.isPending) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, submitMut.isPending]);

  const previewRows = parsed.rows.slice(0, 10);
  const canSubmit = hasIdentifier && !propertyKeyError && !submitMut.isPending;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/40"
        onClick={() => !submitMut.isPending && props.onClose()}
      />
      <div className="fixed inset-x-0 top-1/2 z-50 mx-auto max-h-[85vh] w-[min(1100px,95vw)] -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Импорт каналов</h2>
            <p className="text-xs text-zinc-500">
              {props.fileName} · {parsed.rows.length.toLocaleString("ru-RU")} строк ·{" "}
              {parsed.headers.length} колонок
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={submitMut.isPending}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-auto p-4">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-2 font-medium">CSV-колонка</th>
                <th className="px-2 py-2 font-medium">Превью</th>
                <th className="px-2 py-2 font-medium">→ В поле канала</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((h) => {
                const m = mappings[h]!;
                const samples = previewRows
                  .map((r) => r[h])
                  .filter((v): v is string => !!v && v.length > 0);
                return (
                  <tr key={h} className="border-t border-zinc-100 align-top">
                    <td className="px-2 py-2 font-medium text-zinc-900">{h}</td>
                    <td className="px-2 py-2 text-xs text-zinc-500">
                      <div className="max-h-24 overflow-hidden">
                        {samples.length === 0 && <span className="italic">—</span>}
                        {samples.slice(0, 5).map((s, i) => (
                          <div key={i} className="truncate" title={s}>
                            {s}
                          </div>
                        ))}
                        {samples.length > 5 && (
                          <div className="text-zinc-400">
                            +{samples.length - 5} ещё
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={m.slot}
                          onChange={(e) => setSlot(h, e.target.value as Slot)}
                          className="w-56 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                        >
                          {(Object.keys(SLOT_LABELS) as Slot[]).map((slot) => {
                            const occupiedBy = usedSlots.get(slot);
                            const disabled =
                              slot !== "ignore" &&
                              slot !== "property" &&
                              occupiedBy !== undefined &&
                              occupiedBy !== h;
                            return (
                              <option key={slot} value={slot} disabled={disabled}>
                                {SLOT_LABELS[slot]}
                                {disabled ? ` (занят: ${occupiedBy})` : ""}
                              </option>
                            );
                          })}
                        </select>
                        {m.slot === "property" && (
                          <input
                            type="text"
                            value={m.propertyKey}
                            onChange={(e) => setPropertyKey(h, e.target.value)}
                            placeholder="ключ (er, niche…)"
                            className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-3">
          <div className="text-xs text-zinc-600">
            {!hasIdentifier && (
              <span className="text-amber-700">
                Нужна колонка-идентификатор: «ID канала» или «@username канала».
              </span>
            )}
            {hasIdentifier && propertyKeyError && (
              <span className="text-red-700">{propertyKeyError}</span>
            )}
            {hasIdentifier && !propertyKeyError && (
              <span>
                CSV не затрёт типизированные поля каналов, уже актуализированных
                из TG — только свойства.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {submitMut.error && (
              <span className="text-xs text-red-700">
                {errorMessage(submitMut.error)}
              </span>
            )}
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitMut.isPending}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={() => submitMut.mutate()}
              disabled={!canSubmit}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitMut.isPending
                ? "Импорт…"
                : `Импортировать ${parsed.rows.length.toLocaleString("ru-RU")} строк`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
