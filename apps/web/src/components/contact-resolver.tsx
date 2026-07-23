import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel } from "@repo/core";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { channelDm } from "../lib/channel-dm";
import { ContactPicker } from "./contact-picker";

// Резолвер / смена способа связи канала (этап 16.8): суджест-чипы @ из
// описания, поиск/создание контакта, «в личку (0⭐)», группа аккаунта. Любой
// выбор идёт через set-admin — глобально по каналу (healPlacementRecipients
// обновит project_items во всех проектах). Общий для агентского лонглиста
// (PlacementPane) и BD draft-списка (LeadPrepDrawer).
export function ContactResolver({
  wsId,
  channelId,
  channel,
  onResolved,
  onClose,
  headerAction,
}: {
  wsId: string;
  channelId: string | null;
  channel: Channel | null;
  // После успешного назначения: парент инвалидирует свой список
  // (placements/leads). Канал и каталог каналов резолвер инвалидирует сам.
  onResolved?: () => void;
  // Режим «сменить» (способ связи уже есть): рисует «← назад», вызывается
  // и после успешного назначения.
  onClose?: () => void;
  // Слот справа в шапке — кнопка удаления из списка (у каждого флоу своя).
  headerAction?: React.ReactNode;
}) {
  const qc = useQueryClient();

  const setAdmin = useMutation({
    mutationFn: async (body: {
      contactId?: string;
      username?: string;
      maxLink?: string;
      dm?: boolean;
      group?: { chatId: string; accountId: string };
      external?: { label: string; link?: string };
    }) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/set-admin",
        { params: { path: { wsId, id: channelId! } }, body },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel", wsId, channelId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      // set-admin всегда перенаводит project_items (healPlacementRecipients) →
      // карточки лидов/канбан устаревают. Префикс без projectId: рефетчатся
      // только смонтированные запросы (текущий проект). Раньше карточного пути
      // (chat-drawer) этой инвалидации не было → требовался F5.
      qc.invalidateQueries({ queryKey: ["project-leads", wsId] });
      onResolved?.();
      onClose?.();
    },
  });

  const suggestions = useMemo(
    () => extractHandles(channel?.description ?? "", channel?.username ?? null),
    [channel?.description, channel?.username],
  );

  // Личка канала по direct_messages_chat_id (синкается на скане), не по has_dm.
  // Стоимость null = ещё не синкали → не утверждаем «бесплатно».
  const { hasDm: hasDmGroup, starCost: dmStar } = channelDm(channel?.meta);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-4 py-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mb-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            ← назад
          </button>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900">
              {onClose ? "Сменить контакт" : "Контакт админа"}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Кого слушаем по этому каналу. Меняется глобально — у канала во всех
              кампаниях.
            </p>
          </div>
          {/* Удаление канала — всегда вверху справа (как в режиме с контактом),
              чтобы кнопка не «прыгала» верх-иконкой / низ-футером. */}
          {headerAction}
        </div>
      </div>

      {/* Без channelId назначать некуда (канал удалён, left-join → null):
          set-admin ушёл бы на /channels/null. Оставляем только headerAction
          (удалить из списка). */}
      {!channelId ? (
        <p className="px-4 py-3 text-xs text-zinc-400">
          Канал недоступен — контакт назначить нельзя. Удалите строку из
          списка.
        </p>
      ) : (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Личка канала — всегда видна с ценой (этап 16.9). Бесплатно → авто;
            платно → вручную. Неизвестна (не синкали) → сначала открой ленту. */}
        {hasDmGroup && (
          <div
            className={
              "rounded-lg border px-3 py-2 text-xs " +
              (dmStar === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800")
            }
          >
            <p>
              {dmStar === 0
                ? "У канала открыта личка — писать можно бесплатно."
                : dmStar !== null
                  ? `В личку канала: ${dmStar}⭐ за сообщение (авторассылка не идёт, вручную).`
                  : "У канала есть личка — стоимость уточняется (откройте ленту канала)."}
            </p>
            {dmStar !== null && (
              <button
                type="button"
                onClick={() => setAdmin.mutate({ dm: true })}
                disabled={setAdmin.isPending}
                className={
                  "mt-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 " +
                  (dmStar === 0
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-amber-600 hover:bg-amber-700")
                }
              >
                {dmStar === 0
                  ? "Использовать личку канала"
                  : "Использовать личку (вручную)"}
              </button>
            )}
          </div>
        )}

        {/* Группа аккаунта (этап 16.9): из диалогов подключённых аккаунтов. */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Группа аккаунта
          </div>
          <GroupPicker
            wsId={wsId}
            loading={setAdmin.isPending}
            onPick={(chatId, accountId) =>
              setAdmin.mutate({ group: { chatId, accountId } })
            }
          />
        </div>

        {/* Внешний способ — нет адаптера (Instagram/VK/WhatsApp/почта/…).
            Авторассылки нет, ведём стадиями + заметками контакта. */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Внешний способ (нет адаптера)
          </div>
          <ExternalPicker
            loading={setAdmin.isPending}
            onSet={(label, link) =>
              setAdmin.mutate({
                external: { label, ...(link ? { link } : {}) },
              })
            }
          />
        </div>

        {suggestions.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Возможные контакты из описания
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setAdmin.mutate({ username: h })}
                  disabled={setAdmin.isPending}
                  title="Назначить админом канала"
                  className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  + @{h}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {onClose ? "Другой контакт" : "Привязать контакт"}
          </div>
          <ContactPicker
            wsId={wsId}
            excludeIds={new Set()}
            onPick={(contactId) => setAdmin.mutate({ contactId })}
            // MAX-ссылка max.ru/u/<token> длиннее 64 → поле maxLink (модель
            // получателя для ЛС в MAX), как в списке админов channel-card.
            onCreateByUsername={(input) =>
              /max\.ru\/u\//i.test(input)
                ? setAdmin.mutate({ maxLink: input })
                : setAdmin.mutate({ username: input })
            }
            loading={setAdmin.isPending}
          />
        </div>

        {setAdmin.error && (
          <p className="text-xs text-red-600">{errorMessage(setAdmin.error)}</p>
        )}
      </div>
      )}
    </div>
  );
}

// Внешний способ связи (нет адаптера): свободный лейбл + опц. ссылка. Пишет
// contact_method.kind='external' — авторассылки нет, лид в «Написать вручную»,
// прогресс ведётся стадиями канбана + заметками контакта (activities).
function ExternalPicker({
  onSet,
  loading,
}: {
  onSet: (label: string, link: string) => void;
  loading: boolean;
}) {
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");
  const ok = label.trim().length > 0;
  return (
    <div className="space-y-1.5 rounded-md border border-zinc-200 bg-zinc-50/40 p-2">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={80}
        placeholder="Напр.: Instagram @blogger, почта a@b.ru"
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        maxLength={256}
        placeholder="Ссылка (необязательно): https://…"
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <button
        type="button"
        disabled={!ok || loading}
        onClick={() => onSet(label.trim(), link.trim())}
        className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        Задать внешний способ
      </button>
    </div>
  );
}

// Пикер групп аккаунта (этап 16.9): поиск по группам, в которых состоят
// аккаунты воркспейса (tg_groups). Выбор → привязка группы как способа связи;
// account_id нужен, чтобы потом читать/писать через аккаунт-участника (G3).
function GroupPicker({
  wsId,
  onPick,
  loading,
}: {
  wsId: string;
  onPick: (chatId: string, accountId: string) => void;
  loading: boolean;
}) {
  // Поиск групп БЕЗОПАСЕН для MTProto, поэтому RAM-кэш всех групп не нужен (нечем
  // флудить). Почему (ресерч по исходникам TDLib, github.com/tdlib/td):
  //   • /account-groups зовёт searchChats + getChat;
  //   • searchChats → MessagesManager::search_dialogs (MessagesManager.cpp:14146)
  //     ищет по in-memory `dialogs_hints_` и резолвит promise синхронно —
  //     td_api.tl прямо: «This is an offline method». Ноль сетевых запросов;
  //   • getChat для юзер-аккаунта — тоже offline (td_api.tl §getChat);
  //   • единственный сетевой вызов — loadChats, и его делает реплитор ОДИН раз
  //     на bootstrap, не на поиск (searchChatsOnServer мы не используем).
  // Дебаунс 500мс — лишь чтобы не гонять offline-поиск + IPC к воркеру на каждую
  // букву (латентность), не ради защиты от флуда.
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 500);
    return () => clearTimeout(t);
  }, [q]);
  const groupsQ = useQuery({
    queryKey: ["account-groups", wsId, debounced] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/account-groups",
        { params: { path: { wsId }, query: { q: debounced || undefined } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const groups = groupsQ.data ?? [];
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/40 p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск группы аккаунта"
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
      />
      {groups.length === 0 ? (
        <p className="mt-1.5 text-xs text-zinc-500">
          {groupsQ.isLoading
            ? "Загрузка…"
            : "Группы не найдены — подтянутся по мере репликации аккаунта."}
        </p>
      ) : (
        <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
          {groups.map((g) => (
            <li key={g.chatId}>
              <button
                type="button"
                onClick={() => onPick(g.chatId, g.accountId)}
                disabled={loading}
                className="w-full truncate rounded-md bg-white px-2 py-1.5 text-left text-sm hover:bg-emerald-100 disabled:opacity-50"
              >
                {g.title ?? "Без названия"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Кандидаты-контакты из текста (описание канала): @username и t.me/username.
// Только суджест — менеджер подтверждает кликом, молча в channel_admins не
// пишем (ложные срабатывания: партнёрские каналы, упоминания).
// Служебные пути t.me — это не username'ы (joinchat/addstickers/proxy/…), их в
// кандидаты не берём, иначе клик создаёт мусорный контакт (fix #8).
const RESERVED_TME_PATHS = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "proxy",
  "socks",
  "share",
  "setlanguage",
  "confirmphone",
  "login",
  "contact",
  "iv",
  "bg",
]);

export function extractHandles(
  text: string,
  ownUsername: string | null,
): string[] {
  const own = ownUsername?.toLowerCase() ?? null;
  const out = new Set<string>();
  const re = /(?:@|t\.me\/|telegram\.me\/)([a-zA-Z0-9_]{4,32})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const h = m[1]!.toLowerCase();
    if (h === own) continue;
    if (RESERVED_TME_PATHS.has(h)) continue; // служебные ссылки t.me
    // Боты (@…bot) теперь валидный способ связи (ручной, этап 16.9) — предлагаем.
    out.add(h);
  }
  return [...out].slice(0, 8);
}
