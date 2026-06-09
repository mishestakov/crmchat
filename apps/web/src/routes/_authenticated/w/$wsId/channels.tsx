import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Channel, ImportChannelsMapping, Property } from "@repo/core";
import { PLATFORMS, PlatformBadge, type Platform } from "../../../../lib/platforms";
import { api } from "../../../../lib/api";
import { formatMembers } from "../../../../components/channel-card";
import { ChannelDrawer } from "../../../../components/channel-drawer";
import { LeadChatDrawer } from "../../../../components/lead-chat-drawer";
import { SearchInput } from "../../../../components/search-input";
import { TruncationBanner } from "../../../../components/truncation-banner";
import { parseCsv, type ParsedCsv } from "../../../../lib/csv";
import { formatRelative } from "../../../../lib/date-utils";
import { channelDm } from "../../../../lib/channel-dm";
import { errorMessage } from "../../../../lib/errors";
import { useOutreachAccounts } from "../../../../lib/outreach-queries";

// Пилюля DM-бейджа в строке каталога (кликабельная кнопка vs span-плейсхолдер
// при ещё не синкнутом chat_id) — общий класс, чтобы не расходился вид.
const DM_PILL =
  "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200";

// Slot'ы для column-mapping в импорте. value ∈ ImportChannelsMapping ключи +
// 'ignore' + 'property'. Порядок = порядок в select-dropdown'е.
type Slot =
  | "ignore"
  | "title"
  | "link"
  | "memberCount"
  | "description"
  | "adminUsername"
  | "property";

const SLOT_LABELS: Record<Slot, string> = {
  ignore: "— Игнорировать",
  title: "Название",
  link: "Ссылка (идентификатор)",
  memberCount: "Подписчиков",
  description: "Описание",
  adminUsername: "@username админа",
  property: "В свойство…",
};

// Авто-детект слота по ТОЧНОМУ каноническому имени заголовка (как в шаблоне CSV).
// Синонимы убраны намеренно: формат задаёт шаблон, нестандартные заголовки юзер
// маппит вручную. Ключи нормализованы (lower-case, non-alnum → '_').
const AUTO_DETECT: Record<string, Slot> = {
  title: "title",
  link: "link",
  subscribers: "memberCount",
  description: "description",
  admin: "adminUsername",
};

// Канонические заголовки шаблона CSV (кнопка «Скачать шаблон»). Идентификатор —
// полная ссылка (платформа детектится из домена), `@username` колонкой нет.
const TEMPLATE_HEADERS = [
  "link",
  "title",
  "subscribers",
  "description",
  "admin",
];

// Демо-CSV: канонические колонки + ключи каталога, одна пример-строка.
// Заголовки совпадают с AUTO_DETECT → типизированные импортятся без маппинга.
function downloadTemplateCsv(catalog: Property[]) {
  const headers = [...TEMPLATE_HEADERS, ...catalog.map((p) => p.key)];
  const example = [
    "https://t.me/leoday",
    "Леонардо Дайвинчик",
    "5330905",
    "Бот знакомств. По рекламе @futuread",
    "futuread",
    ...catalog.map(() => ""),
  ];
  const csv = [headers.join(","), example.join(",")].join("\n");
  const url = URL.createObjectURL(
    new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-channels-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

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

// Поиск-state в URL (?q=…) — единообразие с /contacts. Юзер открывает
// канал по ссылке и сразу видит свой фильтр; reload не сбрасывает поиск.
//
// Полноценные фильтры (members range, has_dm, etc.) сознательно НЕ
// добавляем пока не появится авто-sync каналов через TDLib (12.7+):
// сейчас memberCount/meta пусты у каналов, импортированных из CSV без
// последующего TG pull'а — фильтр будет отсекать «неполные», создавая
// иллюзию подборщика на неполной выборке.
type ChannelsSearch = { q?: string };

export const Route = createFileRoute("/_authenticated/w/$wsId/channels")({
  validateSearch: (s: Record<string, unknown>): ChannelsSearch => ({
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
  }),
  component: ChannelsPage,
});

// Должен совпадать с CHANNELS_PAGE_LIMIT в apps/api/src/routes/channels.ts —
// при равенстве показываем плашку «уточните поиск».
const PAGE_LIMIT = 1000;

function ChannelsPage() {
  const { wsId } = Route.useParams();
  const urlSearch = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const search = urlSearch.q ?? "";
  const setSearch = (q: string) => {
    navigate({
      to: "/w/$wsId/channels",
      params: { wsId },
      search: () => ({ q: q || undefined }),
      replace: true,
    });
  };

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

  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  // Открыть карточку сразу с раскрытым тредом лички (клик по DM-бейджу строки).
  const [openWithDm, setOpenWithDm] = useState(false);
  // Фильтр по платформе (клиентский — platform всегда задан, в отличие от
  // memberCount/meta, см. коммент к ChannelsSearch). "all" = без фильтра.
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  // Клик по админу в строке → чат с ним (переписка через аккаунт, у кого диалог).
  const [adminChat, setAdminChat] = useState<{
    contactId: string;
    accountId: string | null;
  } | null>(null);

  const accountsQ = useOutreachAccounts(wsId);
  // Каталог кастом-полей канала — для кнопки «Скачать шаблон» (колонки = поля).
  const catalogQ = useQuery({
    queryKey: ["properties", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/properties", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const accountById = new Map(
    (accountsQ.data ?? []).map((a) => [a.id, a]),
  );
  const accountLabel = (id: string) => {
    const a = accountById.get(id);
    return a ? formatAccount(a) : id;
  };

  const allRows = channelsQ.data ?? [];
  const rows =
    platformFilter === "all"
      ? allRows
      : allRows.filter((c) => c.platform === platformFilter);
  // Какие платформы реально присутствуют — чтобы не рисовать пустые вкладки.
  const presentPlatforms = useMemo(() => {
    const set = new Set<Platform>();
    for (const c of allRows) set.add(c.platform);
    return set;
  }, [allRows]);

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
        <h1 className="text-2xl font-semibold">Площадки</h1>
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
            onClick={() => downloadTemplateCsv(catalogQ.data ?? [])}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
          >
            Скачать шаблон
          </button>
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

      {presentPlatforms.size > 1 && (
        <div className="flex items-center gap-1.5">
          <FilterChip
            label="Все"
            active={platformFilter === "all"}
            onClick={() => setPlatformFilter("all")}
          />
          {(Object.keys(PLATFORMS) as Platform[])
            .filter((p) => presentPlatforms.has(p))
            .map((p) => (
              <FilterChip
                key={p}
                label={PLATFORMS[p].label}
                icon={<PlatformBadge platform={p} />}
                active={platformFilter === p}
                onClick={() => setPlatformFilter(p)}
              />
            ))}
        </div>
      )}

      {channelsQ.isLoading && <p>Загрузка…</p>}
      {channelsQ.error && (
        <p className="text-red-600">{errorMessage(channelsQ.error)}</p>
      )}

      {channelsQ.data && rows.length === PAGE_LIMIT && (
        <TruncationBanner shown={PAGE_LIMIT} entity="каналов" />
      )}

      {channelsQ.data && (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Канал</th>
                <th className="px-3 py-2 text-right font-medium">Подписчики</th>
                <th className="px-3 py-2 text-right font-medium">Ср. охват</th>
                <th className="px-3 py-2 text-right font-medium">ERR</th>
                <th className="px-3 py-2 font-medium">Админ</th>
                <th className="px-3 py-2 font-medium">Общались</th>
                <th className="px-3 py-2 font-medium">Последний пост</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-12 text-center text-zinc-400"
                  >
                    {search || platformFilter !== "all"
                      ? "По фильтру ничего не найдено"
                      : "Площадок пока нет — импортируйте CSV или добавьте по ссылке"}
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                // Авто-метрики из ленты (meta пишет /history при открытии
                // карточки). Нет данных — «—», как у подписчиков.
                const meta = (c.meta ?? {}) as Record<string, unknown>;
                const avgReach =
                  typeof meta.avg_reach === "number" ? meta.avg_reach : null;
                const err = typeof meta.err === "number" ? meta.err : null;
                // Последний пост: TG пишет в lastMessageAt, провайдеры (YT) — в
                // meta.lastPostAt (TikTok без дат → null).
                const lastPost =
                  c.lastMessageAt ??
                  (typeof meta.lastPostAt === "string" ? meta.lastPostAt : null);
                // Личка канала: для клика «написать» нужен реальный chat_id
                // (direct_messages_chat_id кладёт sync), а не has_dm-флаг
                // репликатора — иначе откроем тред без чата.
                const { hasDm: hasDmGroup } = channelDm(meta);
                return (
                  <tr
                    key={c.id}
                    onClick={() => {
                      setOpenWithDm(false);
                      setOpenChannelId(c.id);
                    }}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={c.platform} />
                        <span className="font-medium text-zinc-900">
                          {c.title}
                        </span>
                        {hasDmGroup ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenChannelId(c.id);
                              setOpenWithDm(true);
                            }}
                            title="Написать в личку канала"
                            className={DM_PILL + " hover:bg-emerald-100"}
                          >
                            DM
                          </button>
                        ) : (
                          c.meta?.has_dm === true && (
                            <span
                              title="Канал принимает прямые сообщения в личку (синхронизируется)"
                              className={DM_PILL}
                            >
                              DM
                            </span>
                          )
                        )}
                        {c.unavailableSince && (
                          <span
                            title={`${c.unavailableReason ?? "недоступен"} · последняя попытка ${formatRelative(c.unavailableSince)}`}
                            className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 ring-1 ring-zinc-200"
                          >
                            Недоступен
                          </span>
                        )}
                      </div>
                      {c.username && (
                        <a
                          href={PLATFORMS[c.platform].url(c.username)}
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
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                      {avgReach !== null ? formatMembers(avgReach) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                      {err !== null ? `${err}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      <AdminCell admins={c.admins} onOpenChat={setAdminChat} />
                    </td>
                    <td className="px-3 py-2">
                      <ManagerCircles
                        admins={c.admins}
                        labelOf={accountLabel}
                        onOpenChat={setAdminChat}
                      />
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {lastPost ? formatRelative(lastPost) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openChannelId && (
        <ChannelDrawer
          wsId={wsId}
          channelId={openChannelId}
          initialDmOpen={openWithDm}
          onClose={() => {
            setOpenChannelId(null);
            setOpenWithDm(false);
          }}
        />
      )}

      {adminChat && (
        <LeadChatDrawer
          wsId={wsId}
          lead={{
            id: adminChat.contactId,
            contactId: adminChat.contactId,
            account: adminChat.accountId ? { id: adminChat.accountId } : null,
          }}
          accounts={accountsQ.data ?? []}
          onClose={() => setAdminChat(null)}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors " +
        (active
          ? "bg-zinc-900 text-white ring-zinc-900"
          : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function AdminCell({
  admins,
  onOpenChat,
}: {
  admins: Channel["admins"];
  onOpenChat: (chat: { contactId: string; accountId: string | null }) => void;
}) {
  if (admins.length === 0) return <>—</>;
  const first = admins[0]!;
  const label =
    first.fullName ||
    (first.telegramUsername ? `@${first.telegramUsername}` : first.contactId);
  return (
    <span
      title={
        admins.length > 1
          ? admins.map((a) => a.fullName ?? a.telegramUsername).join(", ")
          : undefined
      }
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChat({
            contactId: first.contactId,
            accountId: first.primaryAccountId,
          });
        }}
        className="text-left text-zinc-700 hover:text-emerald-700 hover:underline"
      >
        {label}
      </button>
      {admins.length > 1 && (
        <span className="text-zinc-400"> +{admins.length - 1}</span>
      )}
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

// Кружочки аккаунтов команды, у кого есть личный диалог с админом канала
// (первый админ). Hover → «кто · как давно общались». Это анти-дабл-тач: видно,
// что коллега уже на связи. Закреплённый аккаунт (sticky) — с зелёным кольцом.
function ManagerCircles({
  admins,
  labelOf,
  onOpenChat,
}: {
  admins: Channel["admins"];
  labelOf: (accountId: string) => string;
  onOpenChat: (chat: { contactId: string; accountId: string | null }) => void;
}) {
  const adminContactId = admins[0]?.contactId ?? null;
  const chatAccounts = admins[0]?.chatAccounts ?? [];
  if (chatAccounts.length === 0) return <span className="text-zinc-400">—</span>;
  const primary = admins[0]?.primaryAccountId ?? null;
  return (
    <div className="flex -space-x-1.5">
      {chatAccounts.map((ca) => {
        const label = labelOf(ca.accountId);
        // Кружочек = «ответил». Hover — когда последний раз был контакт.
        const last =
          ca.lastInboundAt && ca.lastOutboundAt
            ? ca.lastInboundAt > ca.lastOutboundAt
              ? ca.lastInboundAt
              : ca.lastOutboundAt
            : ca.lastInboundAt ?? ca.lastOutboundAt;
        const title = last ? `${label} · ${formatRelative(last)}` : label;
        const isPrimary = ca.accountId === primary;
        return (
          <button
            key={ca.accountId}
            type="button"
            title={title}
            onClick={(e) => {
              e.stopPropagation();
              if (adminContactId)
                onOpenChat({ contactId: adminContactId, accountId: ca.accountId });
            }}
            className={
              "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold uppercase ring-2 transition-transform hover:scale-110 " +
              (isPrimary
                ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
                : "bg-teal-100 text-teal-800 ring-white")
            }
          >
            {label.replace(/^@/, "").charAt(0) || "?"}
          </button>
        );
      })}
    </div>
  );
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

  // Платформа не выбирается: идентификатор — ссылка, домен сам её определяет
  // построчно на бэке (t.me / youtube / tiktok). Одна точка истины.

  // Каталог кастом-полей канала — слот «В свойство…» выбирает поле из него
  // (не свободный ключ). Тот же каталог, что в настройках «Поля».
  const catalogQ = useQuery({
    queryKey: ["properties", props.wsId],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/properties", {
        params: { path: { wsId: props.wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const catalog = catalogQ.data ?? [];

  // Init: для каждого header — auto-detect типизированного слота или 'ignore'.
  const [mappings, setMappings] = useState<Record<string, ColMapping>>(() => {
    const init: Record<string, ColMapping> = {};
    const used = new Set<string>();
    for (const h of parsed.headers) {
      const auto = AUTO_DETECT[normalizeHeader(h)];
      // Один типизированный слот — максимум один раз; дубль уводим в 'ignore'.
      if (auto && !used.has(auto)) {
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
        // Дефолт — поле каталога с ключом, совпавшим с заголовком, иначе первое.
        const norm = normalizeHeader(header);
        const match = catalog.find((p) => p.key === norm)?.key;
        next[header] = {
          slot: "property",
          propertyKey: match ?? catalog[0]?.key ?? "",
        };
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

  // Идентификатор — колонка-ссылка (платформа определится из домена на бэке).
  const hasIdentifier = useMemo(() => {
    return Object.values(mappings).some((m) => m.slot === "link");
  }, [mappings]);

  // В одно поле каталога — максимум одна колонка; пустой выбор недопустим.
  const propertyKeyError = useMemo(() => {
    const keys = new Map<string, number>();
    for (const m of Object.values(mappings)) {
      if (m.slot === "property") {
        if (!m.propertyKey) return "Выберите поле каталога для колонки";
        keys.set(m.propertyKey, (keys.get(m.propertyKey) ?? 0) + 1);
      }
    }
    for (const [k, n] of keys) {
      if (n > 1) {
        const name = catalog.find((p) => p.key === k)?.name ?? k;
        return `Поле «${name}» выбрано для двух колонок`;
      }
    }
    return null;
  }, [mappings, catalog]);

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
            <h2 className="text-lg font-semibold">Импорт площадок</h2>
            <p className="text-xs text-zinc-500">
              {props.fileName} · {parsed.rows.length.toLocaleString("ru-RU")} строк ·{" "}
              {parsed.headers.length} колонок
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => downloadTemplateCsv(catalog)}
              className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              Скачать шаблон
            </button>
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitMut.isPending}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
            >
              <X size={18} />
            </button>
          </div>
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
                          <select
                            value={m.propertyKey}
                            onChange={(e) => setPropertyKey(h, e.target.value)}
                            className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                          >
                            {catalog.length === 0 && (
                              <option value="">— нет полей в каталоге —</option>
                            )}
                            {catalog.map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.name}
                              </option>
                            ))}
                          </select>
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
                Нужна колонка «Ссылка» — она же идентификатор (платформа
                определится из ссылки).
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
