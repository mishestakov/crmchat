// TG/MAX-чтение каналов: группы аккаунтов, sync, подписки, лента/история,
// превью, метрики. Роуты patch и relation семантически CRUD-ные, но живут
// здесь ради сохранения глобального порядка регистрации (openapi.json 1:1).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { ChannelRelationStatusSchema } from "@repo/core";
import { db } from "../../db/client.ts";
import { median } from "../../lib/median.ts";
import { errMsg } from "../../lib/errors.ts";
import {
  TdMediaThumbSchema,
  TdMessageEntitySchema,
} from "../../lib/td-message.ts";
import {
  fetchChannelHistory,
  mapChannelHistoryItems,
  readChannelPreview,
} from "../../lib/channel-history.ts";
import { respondWithCreativeMedia } from "../../lib/creative-media-response.ts";
import {
  loadChannelPropertyDefs,
  validateEntityProperties,
} from "../../lib/entity-properties.ts";
import {
  isProviderPlatform,
  syncChannelFromProvider,
} from "../../lib/channel-providers/index.ts";
import {
  fetchMaxPosts,
  joinMaxChannel,
  syncChannelFromMax,
} from "../../lib/channel-providers/max.ts";
import {
  channelSubscriptions,
  channelThumbnails,
  channels,
  outreachAccounts,
  projectItems,
  projects,
} from "../../db/schema.ts";
import { assertChannelAccess } from "../../lib/channels-access.ts";
import {
  findSubscribedReaderAccount,
  getOutreachWorkerClient,
} from "../../lib/outreach-account-client.ts";
import { recordChannelRelation } from "../../lib/channel-relation.ts";
import { accountAccessClause } from "../../lib/outreach-access.ts";
import {
  assertRole,
  type WorkspaceRole,
  type WorkspaceVars,
} from "../../middleware/assert-member.ts";
import type { TdClient } from "../../lib/tdlib/client.ts";
import {
  ChannelSchema,
  WsIdParam,
  WsParam,
  joinAdmins,
  pickMaxClient,
} from "./shared.ts";

// Каналы читаются любым outreach-аккаунтом workspace'а — единственный
// TG-actor у нас. Берём первый available active доступный юзеру (RBAC через
// accountAccessClause), поднимаем worker'а если ещё не поднят.
//
// Round-robin / sticky канал→аккаунт не вводим: один аккаунт прочитает
// любой канал, thumbnail/member_count кешируется 24h. Если упрёмся в
// flood-лимиты — добавим выбор по нагрузке.
// Классификация TDLib/MTProto-ошибок resolve'а канала. Permanent = «канала
// действительно нет с точки зрения TG» — пишем в unavailable_*, перестаём
// дёргать TDLib (cooldown-gate ниже). Transient (FLOOD_WAIT, network, 5xx)
// просто throw — не помечаем, пусть юзер ретраит.
//
// Список patterns пополняется по факту: добавляем когда реально увидели в
// проде. core.telegram.org/api/errors имеет ещё CHANNEL_PRIVATE,
// USERNAME_INVALID, PEER_ID_INVALID — добавим если наткнёмся.
const PERMANENT_RESOLVE_PATTERNS = ["chat not found", "username_not_occupied"];

function classifyResolveError(
  e: unknown,
): { permanent: true; reason: string } | { permanent: false } {
  const raw = errMsg(e);
  const low = raw.toLowerCase();
  for (const p of PERMANENT_RESOLVE_PATTERNS) {
    if (low.includes(p)) return { permanent: true, reason: raw };
  }
  return { permanent: false };
}

async function markChannelUnavailable(
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: sql`coalesce(${channels.unavailableSince}, now())`,
      unavailableLastCheckAt: new Date(),
      unavailableReason: reason,
    })
    .where(eq(channels.id, id));
}

// Cooldown между retry-ями TDLib для unavailable-каналов. После провала ждём
// час — потом один шанс. «Нормальные клиенты не долбят туда где не
// существует». Юзер может бэк-флагом ?force=true сбить cooldown, если
// нужна immediate-проверка (кнопка «проверить сейчас» в UI).
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

function isInUnavailableCooldown(
  channel: typeof channels.$inferSelect,
): boolean {
  if (!channel.unavailableLastCheckAt) return false;
  return (
    Date.now() - channel.unavailableLastCheckAt.getTime() <
    UNAVAILABLE_COOLDOWN_MS
  );
}

async function clearChannelUnavailable(id: string): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: null,
      unavailableLastCheckAt: null,
      unavailableReason: null,
    })
    .where(eq(channels.id, id));
}

async function pickOutreachClient(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const [acc] = await db
    .select({ id: outreachAccounts.id, workspaceId: outreachAccounts.workspaceId })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  if (!acc) return null;
  const client = await getOutreachWorkerClient(acc);
  if (!client) return null;
  return { client, accountId: acc.id };
}

// Выбор аккаунта для чтения канала. Приоритет: любой подписанный аккаунт
// workspace'a (для приватных каналов это единственный способ + позволяет
// команде читать через коллегин аккаунт). Fallback — мой собственный
// аккаунт (для публичных каналов работает без подписки, как раньше).
async function pickChannelReader(
  channelId: string,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const subscribed = await findSubscribedReaderAccount(wsId, channelId);
  if (subscribed) {
    const client = await getOutreachWorkerClient(subscribed);
    if (client) return { client, accountId: subscribed.id };
  }
  return pickOutreachClient(wsId, userId, role);
}

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// TDLib chat object (нужные поля) для live-листинга групп.
type TdChatLite = {
  id: number;
  title: string;
  type: { _: string; is_channel?: boolean };
};

function isGroupChatType(t: TdChatLite["type"] | undefined): boolean {
  if (!t) return false;
  // Группа = basicGroup или supergroup-не-канал. Broadcast-канал (is_channel=
  // true), привата, секретные — не группы.
  return (
    t._ === "chatTypeBasicGroup" ||
    (t._ === "chatTypeSupergroup" && t.is_channel === false)
  );
}

// Проверка «chat_id — доступная аккаунту группа» (для валидации привязки).
// getChat — offline для юзер-аккаунта (td_api.tl §getChat), один in-memory вызов.
async function isAccessibleGroup(
  client: TdClient,
  chatId: number,
): Promise<boolean> {
  try {
    const ch = (await client.invoke({
      _: "getChat",
      chat_id: chatId,
    } as never)) as TdChatLite;
    return isGroupChatType(ch.type);
  } catch {
    return false;
  }
}

// Live-листинг групп аккаунта (этап 16.9 ревизия): без реплики в БД, и при этом
// БЕЗ единого MTProto-запроса — поэтому безопасно дёргать на поиск (флуда нет).
// Ресерч по исходникам TDLib (github.com/tdlib/td), чтобы вывод не потерялся:
//   • searchChats → Requests.cpp:3325 → MessagesManager::search_dialogs
//     (MessagesManager.cpp:14146): `dialogs_hints_.search(query, limit)` по
//     IN-MEMORY структуре + `promise.set_value(Unit())` синхронно — НИ ОДНОГО
//     сетевого запроса (td_api.tl: «This is an offline method»). Пустой query →
//     search_recently_found_dialogs (тоже локально).
//   • getChat для юзер-аккаунта — offline (td_api.tl §getChat: «offline method
//     if the current user is not a bot»), читает локальный Dialog.
//   • Сетевой вызов есть только у searchChatsOnServer (НЕ используем) и loadChats
//     (грузит чат-лист — это делает реплитор один раз на bootstrap, не на поиск).
// Отсюда: RAM-кэш всех групп — оверинжиниринг (нет сети → нечем флудить); поиск
// идёт прямо по offline-индексу TDLib, данные всегда актуальные.
async function listAccountGroups(
  client: TdClient,
  query: string,
): Promise<{ chatId: string; title: string }[]> {
  const res = (await client.invoke({
    _: "searchChats",
    query,
    limit: 50,
  } as never)) as { chat_ids?: number[] };
  const ids = res.chat_ids ?? [];
  const chats = await Promise.all(
    ids.map((cid) =>
      client
        .invoke({ _: "getChat", chat_id: cid } as never)
        .then((ch: unknown) => ch as TdChatLite)
        .catch(() => null),
    ),
  );
  const out: { chatId: string; title: string }[] = [];
  for (const ch of chats) {
    if (ch && isGroupChatType(ch.type)) {
      out.push({ chatId: String(ch.id), title: ch.title || "Без названия" });
    }
  }
  return out;
}

// Группы, в которых состоят доступные пользователю аккаунты (этап 16.9) —
// источник для пикера «привязать группу как способ связи». Читается LIVE
// через TDLib (без таблицы tg_groups): порядок main-list сохраняем, дедуп по
// chat_id (первый аккаунт-участник в порядке перебора).
const AccountGroupSchema = z
  .object({
    chatId: z.string(),
    title: z.string().nullable(),
    accountId: z.string(),
  })
  .openapi("AccountGroup");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/account-groups",
    tags: ["channels"],
    request: {
      params: WsParam,
      query: z.object({ q: z.string().max(128).optional() }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.array(AccountGroupSchema) },
        },
        description: "Groups the workspace accounts are members of",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const { q } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const accts = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(accountAccessClause(wsId, userId, role))
      .orderBy(outreachAccounts.createdAt);

    const seen = new Set<string>();
    const out: { chatId: string; title: string; accountId: string }[] = [];
    for (const a of accts) {
      if (out.length >= 50) break;
      const client = await getOutreachWorkerClient({ id: a.id, workspaceId: wsId });
      if (!client) continue;
      const groups = await listAccountGroups(client, q ?? "").catch(() => []);
      for (const g of groups) {
        if (seen.has(g.chatId)) continue;
        seen.add(g.chatId);
        out.push({ chatId: g.chatId, title: g.title, accountId: a.id });
      }
    }
    return c.json(out.slice(0, 50));
  },
);

// Окно расчёта охвата/ERR: до 500 постов И не старше 3 месяцев (sparse-каналы
// иначе тянут год-назад-посты со стухшей аудиторией). Глубокий проход по ленте
// делаем раз в сутки на канал (TTL по meta.metrics_at), не на каждое открытие.
const METRICS_MAX_POSTS = 500;
const METRICS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const METRICS_TTL_MS = 24 * 60 * 60 * 1000;

type TdHistMsg = {
  id: number;
  date: number;
  is_pinned?: boolean;
  interaction_info?: {
    view_count?: number;
    forward_count?: number;
    reply_info?: { reply_count?: number };
    reactions?: { reactions?: { total_count: number }[] };
  };
};

// Авто-метрики канала из ленты (этап 16.10): ср. охват = медиана просмотров по
// последним ~15 постам (без закрепа), ERR (by reach) = медиана по постам
// (реакции+репосты+комменты)/просмотры × 100. Чистая функция: считается из уже
// полученной /history-ленты (отдельного TDLib-вызова не нужно). Мало данных → null.
function metricsFromMessages(
  msgs: TdHistMsg[],
): { avgReach: number; err: number; sample: number } | null {
  // Только посты за последние 3 месяца: sparse-канал мог набрать 500 постов за
  // год — старую аудиторию в охват не берём (даже если fetch их зацепил).
  const minDateSec = (Date.now() - METRICS_WINDOW_MS) / 1000;
  const posts = msgs.filter(
    (m) =>
      !m.is_pinned &&
      m.date >= minDateSec &&
      typeof m.interaction_info?.view_count === "number" &&
      m.interaction_info.view_count > 0,
  );
  if (posts.length < 3) return null;
  // Считаем по всему окну (до 500 постов / 3 месяца), а не по 15 новейшим:
  // у частопостящих каналов 15 постов = пара часов, охват скакал. Медиана
  // робастна к выбросам.
  const recent = posts;
  // recent.length ≥ 3 здесь → median не вернёт null, но ?? 0 для типа.
  const avgReach = median(recent.map((m) => m.interaction_info!.view_count!)) ?? 0;
  const ers = recent.map((m) => {
    const ii = m.interaction_info!;
    const reactions = (ii.reactions?.reactions ?? []).reduce(
      (sum, r) => sum + r.total_count,
      0,
    );
    const eng =
      reactions + (ii.forward_count ?? 0) + (ii.reply_info?.reply_count ?? 0);
    return ii.view_count! > 0 ? eng / ii.view_count! : 0;
  });
  const err = (median(ers) ?? 0) * 100;
  return {
    avgReach: Math.round(avgReach),
    err: Math.round(err * 10) / 10,
    sample: recent.length,
  };
}

// Ядро sync'а карточки канала из TG: резолв (searchPublicChat/getChat →
// getSupergroupFullInfo) + запись типизированных колонок и meta. Дёргается
// HTTP-ручкой /sync и ленивым авто-синком в ChannelCard при открытии канала.
// Бросает при TDLib-провале (permanent → помечает канал unavailable).
// Возвращает обновлённую raw-строку channels (без joinAdmins-сериализации).
async function syncChannelFromTg(
  channel: typeof channels.$inferSelect,
  tdClient: TdClient,
): Promise<typeof channels.$inferSelect> {
  const id = channel.id;
  type TdChat = {
    id: number;
    title: string;
    type: { _: string; supergroup_id?: number; is_channel?: boolean };
    photo?: { minithumbnail?: { data: string } };
  };
  type TdSupergroupFullInfo = {
    description: string;
    member_count: number;
    linked_chat_id: number;
    direct_messages_chat_id: number;
    gift_count: number;
    outgoing_paid_message_star_count: number;
    photo?: { minithumbnail?: { data: string } };
  };

  // searchPublicChat — единственный способ зарегистрировать публичный чат в
  // TDLib-state без подписки. Только после него getSupergroupFullInfo и
  // getChatHistory получают chat (см. td_api.tl §searchPublicChat, §getChat —
  // offline-only). getChat(externalId) — fallback для каналов без @username.
  let tdChat: TdChat;
  try {
    tdChat = channel.username
      ? ((await tdClient.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never)) as TdChat)
      : ((await tdClient.invoke({
          _: "getChat",
          chat_id: Number(channel.externalId),
        } as never)) as TdChat);
  } catch (e) {
    const cls = classifyResolveError(e);
    if (cls.permanent) await markChannelUnavailable(id, cls.reason);
    throw new HTTPException(404, {
      message: `Telegram lookup failed: ${errMsg(e)}`,
    });
  }

  if (tdChat.type._ !== "chatTypeSupergroup" || !tdChat.type.supergroup_id) {
    throw new HTTPException(400, {
      message: `chat ${tdChat.id} is not a supergroup (got ${tdChat.type._})`,
    });
  }

  const supergroupId = tdChat.type.supergroup_id;
  // Race-fix: searchPublicChat выше эмитит updateSupergroup, replicator кладёт
  // patch в channelMetaBuf и взводит flush на 500ms. Если getSupergroupFullInfo
  // затянется и flush выстрелит до финального UPDATE — flush не найдёт row по
  // meta->>'supergroup_id'. Кладём supergroup_id заранее, чтобы flush попал.
  await db
    .update(channels)
    .set({
      meta: sql`${channels.meta} || ${JSON.stringify({ supergroup_id: String(supergroupId) })}::jsonb`,
    })
    .where(eq(channels.id, id));

  // getSupergroup НЕ вызываем — его поля (boost_level, has_dm, …) прилетают как
  // updateSupergroup в tg-replicator.ts. FullInfo без явного invoke не приходит.
  let tdFull: TdSupergroupFullInfo;
  try {
    tdFull = (await tdClient.invoke({
      _: "getSupergroupFullInfo",
      supergroup_id: supergroupId,
    } as never)) as TdSupergroupFullInfo;
  } catch (e) {
    const cls = classifyResolveError(e);
    if (cls.permanent) await markChannelUnavailable(id, cls.reason);
    throw new HTTPException(404, {
      message: `Telegram lookup failed: ${errMsg(e)}`,
    });
  }

  // Только свои поля; nice-to-have от updateSupergroup доедут merge'ем.
  const metaPatch: Record<string, unknown> = {
    supergroup_id: String(supergroupId),
    linked_chat_id: tdFull.linked_chat_id || null,
    direct_messages_chat_id: tdFull.direct_messages_chat_id || null,
    gift_count: tdFull.gift_count,
    outgoing_paid_message_star_count: tdFull.outgoing_paid_message_star_count,
  };

  const description = tdFull.description || null;
  const externalIdNew = String(tdChat.id);

  // Thumbnail: chat.photo.minithumbnail.data приходит как base64-строка. Нет
  // аватара — поле photo отсутствует, прежний кеш не сносим.
  const minithumb =
    tdChat.photo?.minithumbnail?.data ?? tdFull.photo?.minithumbnail?.data;
  const [[updated]] = await Promise.all([
    db
      .update(channels)
      .set({
        externalId: externalIdNew,
        title: tdChat.title || channel.title,
        description,
        memberCount: tdFull.member_count,
        meta: sql`${channels.meta} || ${JSON.stringify(metaPatch)}::jsonb`,
        syncedAt: new Date(),
        updatedAt: new Date(),
        unavailableSince: null,
        unavailableLastCheckAt: null,
        unavailableReason: null,
      })
      .where(eq(channels.id, id))
      .returning(),
    minithumb
      ? db
          .insert(channelThumbnails)
          .values({ channelId: id, b64: minithumb })
          .onConflictDoUpdate({
            target: channelThumbnails.channelId,
            set: { b64: minithumb, updatedAt: new Date() },
          })
      : Promise.resolve(),
  ]);
  return updated!;
}

// Pull свежей карточки канала из TG. Lazy: фронт дёргает при открытии
// drawer'а если synced_at IS NULL или > 24h.
//
// Цепочка:
//   - если есть external_id → getChat(id)
//   - иначе по username → searchPublicChat(username) → Chat (с id)
//   - getSupergroup + getSupergroupFullInfo (только chatTypeSupergroup;
//     private/group/bot → 400)
// Запись: типизированные колонки + meta (REPLACE целиком) + synced_at.
// properties и admins не трогаем. Thumbnail (chat.photo.minithumbnail) →
// channel_thumbnails.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/sync",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      // ?force=true — кнопка «проверить сейчас» в UI: пропустить cooldown-gate
      // и сходить в TDLib даже если канал помечен недоступным <1h назад.
      query: z.object({ force: z.coerce.boolean().optional() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel synced from TG",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    // YouTube/TikTok: внешний HTTP-провайдер (не TDLib, аккаунт не нужен).
    // Кэш = synced_at, TTL 1ч: свежий канал не дёргаем в апиху, если не force.
    if (isProviderPlatform(channel.platform)) {
      const SYNC_TTL_MS = 60 * 60 * 1000;
      const fresh =
        !force &&
        channel.syncedAt != null &&
        Date.now() - channel.syncedAt.getTime() < SYNC_TTL_MS;
      const row = fresh ? channel : await syncChannelFromProvider(channel);
      const [serialized] = await joinAdmins([row]);
      return c.json(serialized!);
    }

    // MAX: читается через аккаунт-сессию (как TG), но подписка не нужна —
    // публичные каналы видны любому авторизованному MAX-аккаунту workspace'а.
    if (channel.platform === "max") {
      const picked = await pickMaxClient(wsId, userId, role);
      if (!picked) {
        throw new HTTPException(412, {
          message:
            "no active MAX account available — connect one in /outreach/accounts/new",
        });
      }
      const updated = await syncChannelFromMax(
        channel,
        picked.client,
        picked.accountId,
      );
      const [serialized] = await joinAdmins([updated]);
      return c.json(serialized!);
    }

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: `sync supported only for platform=telegram (got ${channel.platform})`,
      });
    }
    if (!channel.externalId && !channel.username) {
      throw new HTTPException(400, {
        message: "channel has neither external_id nor username; nothing to look up",
      });
    }
    // Cooldown-gate: канал помечен недоступным <1h назад → не идём в TDLib,
    // если только не передали ?force=true (кнопка «проверить сейчас» в UI).
    if (!force && isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    const picked = await pickOutreachClient(wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    const updated = await syncChannelFromTg(channel, tdClient);
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// Вступить в закрытый MAX-канал (кнопка «Вступить»): CHAT_JOIN по ссылке →
// channel_subscriptions, затем re-sync (теперь участник → подтянутся reach/посты,
// mx_pending снимется). Аккаунт MAX выбираем сами (pickMaxClient).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/max-subscribe",
    tags: ["channels"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Joined MAX channel (subscribed or pending approval)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "max") {
      throw new HTTPException(400, { message: "только для MAX-каналов" });
    }
    const picked = await pickMaxClient(wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, { message: "нет активного MAX-аккаунта" });
    }
    await joinMaxChannel(picked.client, channel, picked.accountId);
    const updated = await syncChannelFromMax(
      channel,
      picked.client,
      picked.accountId,
    );
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// Подписать аккаунт workspace'a на канал. Публичный канал (есть @) идёт
// через joinChat(chat_id); приватный (только invite-link типа t.me/+abc)
// — через joinChatByInviteLink. Read history после подписки идёт через
// этот аккаунт (см. GET /channels/{id}/history). Команда видит подписки
// друг друга — один подписанный = читают все.
//
// `INVITE_REQUEST_SENT` (закрытый канал, нужно подтверждение админа) →
// сохраняем status=pending, read через такой аккаунт ещё не работает.
const SubscribeBody = z.object({ accountId: z.string().min(1).max(64) });

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/subscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Subscribed (or pending approval)" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "subscribe supported only for platform=telegram",
      });
    }
    // Право подписки = право write через аккаунт. Member может подписать
    // только свои аккаунты, admin — любой в workspace'е.
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
          eq(outreachAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    // Резолв chat_id перед joinChat. Для импортированных каналов externalId
    // может быть null (CSV без явного chat_id) — в этом случае идём через
    // searchPublicChat (public) или joinChatByInviteLink (private, который
    // сам возвращает Chat с id). После резолва сохраняем externalId — без
    // этого getChatHistory упадёт на NaN.
    let resolvedChatId: number | null = channel.externalId
      ? Number(channel.externalId)
      : null;
    let status: "subscribed" | "pending" = "subscribed";
    try {
      if (channel.username && !resolvedChatId) {
        const tdChat = (await client.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      }
      if (resolvedChatId) {
        await client.invoke({
          _: "joinChat",
          chat_id: resolvedChatId,
        } as never);
      } else if (channel.link) {
        const tdChat = (await client.invoke({
          _: "joinChatByInviteLink",
          invite_link: channel.link,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      } else {
        throw new HTTPException(400, {
          message: "channel has neither @username nor invite link",
        });
      }
    } catch (e) {
      const msg = errMsg(e);
      // TDLib возвращает специальное сообщение когда канал требует одобрения
      // (см. td_api.tl §joinChat: «May return an error with a message
      // INVITE_REQUEST_SENT if only a join request was created»).
      if (msg.includes("INVITE_REQUEST_SENT")) {
        status = "pending";
      } else {
        throw new HTTPException(400, { message: msg });
      }
    }

    if (resolvedChatId && !channel.externalId) {
      await db
        .update(channels)
        .set({ externalId: String(resolvedChatId) })
        .where(eq(channels.id, id));
    }

    await db
      .insert(channelSubscriptions)
      .values({ accountId, channelId: id, status })
      .onConflictDoUpdate({
        target: [channelSubscriptions.accountId, channelSubscriptions.channelId],
        set: { status, subscribedAt: new Date() },
      });

    return c.body(null, 204);
  },
);

// Отписать аккаунт. Если других подписанных нет — приватный канал станет
// недоступен для read'a команды. UX-предупреждение делается на фронте.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/unsubscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Unsubscribed" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (client && channel.externalId) {
      try {
        await client.invoke({
          _: "leaveChat",
          chat_id: Number(channel.externalId),
        } as never);
      } catch (e) {
        // Если уже не подписан в TG — продолжаем чистить нашу запись.
        console.error(`[channels/unsubscribe] leaveChat:`, errMsg(e));
      }
    }
    await db
      .delete(channelSubscriptions)
      .where(
        and(
          eq(channelSubscriptions.accountId, accountId),
          eq(channelSubscriptions.channelId, id),
        ),
      );

    return c.body(null, 204);
  },
);

// PATCH /channels/{id} — редактирование «наших» полей.
// - username: админ переименовал канал, мы поправили @ и заново резолвим. На
//   смене сбрасываем unavailable_*-флаги, чтобы next sync не упёрся в cooldown
//   (новый @ — это логически уже другой чат).
// - properties: значения кастом-полей канала (ниша, cpc/cpa-бакет и т.п.).
//   Валидируются против каталога; null/""/[] удаляют ключ, остальное мерджится.
const PatchChannelSchema = z.object({
  username: z.string().min(1).max(64).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: PatchChannelSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel updated",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const channel = await assertChannelAccess(id, wsId);
    const body = c.req.valid("json");

    // Юзер может ввести «@channelname» или «channelname» — нормализуем.
    let nextUsername = channel.username;
    if (body.username !== undefined) {
      nextUsername = body.username
        ? body.username.replace(/^@/, "").trim() || null
        : null;
    }
    const usernameChanged = nextUsername !== channel.username;

    // properties: валидируем по каталогу канала и мерджим поверх существующих
    // (null/""/[] → удалить ключ). Не трогаем, если в body их нет.
    let nextProperties = channel.properties;
    if (body.properties !== undefined) {
      const merged = { ...channel.properties };
      for (const [k, v] of Object.entries(body.properties)) {
        if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          delete merged[k];
        }
      }
      const defs = await loadChannelPropertyDefs(wsId);
      Object.assign(merged, validateEntityProperties(defs, body.properties));
      nextProperties = merged;
    }

    const [updated] = await db
      .update(channels)
      .set({
        username: nextUsername,
        properties: nextProperties,
        updatedAt: new Date(),
        // Username сменился — сбрасываем флаг недоступности и forced
        // повторный resolve. Делаем здесь, не в frontend, чтобы инвариант
        // «новый @ = новый канал к проверке» не зависел от UI.
        ...(usernameChanged
          ? {
              unavailableSince: null,
              unavailableLastCheckAt: null,
              unavailableReason: null,
              syncedAt: null,
            }
          : {}),
      })
      .where(eq(channels.id, id))
      .returning();
    const [serialized] = await joinAdmins([updated!]);
    return c.json(serialized!);
  },
);

// Статус взаимодействия по каналу (глобальный, следует за каналом по всем
// проектам) — смена статуса + комментарий-причина. Append-only: каждое
// нажатие добавляет запись в relationHistory и обновляет relationStatus
// (снимок). Доступно member'у. Запись без смены статуса = просто комментарий
// (status повторяет текущий).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/relation",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              status: ChannelRelationStatusSchema,
              note: z.string().max(2000).nullable(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Relation status recorded",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    await assertChannelAccess(id, wsId);
    const { status, note } = c.req.valid("json");
    const updated = await recordChannelRelation(id, status, note, c.get("userId"));
    // Канал мог исчезнуть между assertChannelAccess и UPDATE (гонка с удалением) —
    // returning() придёт пустым. Без гарда joinAdmins([undefined]) упал бы 500.
    if (!updated) throw new HTTPException(404, { message: "канал не найден" });
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// История канала: последние N сообщений (plain-text), через personal-TDLib.
// Не-текст (фото/видео/forward) → "[медиа]"; этого достаточно для оценки
// активности канала, full-render медиа — отдельная задача.
//
// Pagination: from_message_id=0 на первой странице (TDLib возвращает с
// last сообщения). На дальнейших передаём id последнего полученного.
const ChannelHistoryQuery = z.object({
  // string, не number: MAX-id сообщений > MAX_SAFE_INTEGER (≈1.16e17) — coerce
  // в number валит валидацию (too_big) и теряет точность. regex ^\d+$ держит
  // инвариант «неотрицательное целое» на краю (режет abc/-5 → 400), но без
  // safe-int-кэпа. TG-ветка парсит Number() сама, MAX-ветка отдаёт [].
  fromMessageId: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ChannelHistoryReaction = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
});
const ChannelHistoryItem = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
  // full-res дескриптор (фото/видео-постер); байты — через post-media роут по
  // id сообщения. null если медиа нет. Блюр-thumb остаётся placeholder'ом.
  media: z
    .object({
      kind: z.enum(["photo", "video"]),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable(),
  // Прямой CDN-URL медиа (MAX). TG отдаёт байты через post-media/{id} прокси,
  // поэтому для TG здесь null — рендер выбирает источник по наличию mediaUrl.
  mediaUrl: z.string().nullable(),
  // messageInteractionInfo (td_api.tl:2730). У постов в каналах view_count
  // почти всегда есть; forward_count и replies — опционально (репост только
  // если кто-то форварднул, replies — только если у канала есть linked-чат).
  views: z.number().int().nonnegative().nullable(),
  forwards: z.number().int().nonnegative().nullable(),
  replies: z.number().int().nonnegative().nullable(),
  // Только реакции на стандартные emoji. Custom-emoji (premium) и paid-reactions
  // скипаем — без download custom-emoji не отрендерим, они станут '?'.
  reactions: z.array(ChannelHistoryReaction),
  isForwarded: z.boolean(),
});
const ChannelHistoryResponse = z.object({
  messages: z.array(ChannelHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/history",
    tags: ["channels"],
    request: { params: WsIdParam, query: ChannelHistoryQuery },
    responses: {
      200: {
        content: {
          "application/json": { schema: ChannelHistoryResponse },
        },
        description: "Last N messages of the channel (plain-text)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { fromMessageId, limit } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    // MAX: лента постов через CHAT_HISTORY (тот же контракт ответа, что TG).
    // Пагинация по времени пока не делаем — на 2-й странице (fromMessageId)
    // отдаём пусто. v1: последние N постов.
    if (channel.platform === "max") {
      if (!channel.externalId) {
        throw new HTTPException(412, {
          message: "channel not synced yet — POST /sync first",
        });
      }
      if (fromMessageId) return c.json({ messages: [] });
      const picked = await pickMaxClient(wsId, userId, role);
      if (!picked) {
        throw new HTTPException(412, {
          message: "no active MAX account available",
        });
      }
      const messages = await fetchMaxPosts(picked.client, channel.externalId, limit);
      return c.json({ messages });
    }

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "history supported only for platform=telegram",
      });
    }
    if (!channel.externalId) {
      throw new HTTPException(412, {
        message:
          "channel not synced yet — POST /sync first (resolves chat_id from username)",
      });
    }
    if (isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    // Приватный канал (нет @username) можно прочитать только подписанным
    // аккаунтом — TDLib без подписки отдаст «Chat not found». Явный 412
    // с маркером, чтобы фронт показал плашку «Подписаться».
    if (!channel.username) {
      const [anySub] = await db
        .select({ accountId: channelSubscriptions.accountId })
        .from(channelSubscriptions)
        .innerJoin(
          outreachAccounts,
          eq(outreachAccounts.id, channelSubscriptions.accountId),
        )
        .where(
          and(
            eq(channelSubscriptions.channelId, id),
            eq(channelSubscriptions.status, "subscribed"),
            eq(outreachAccounts.workspaceId, wsId),
            eq(outreachAccounts.status, "active"),
          ),
        )
        .limit(1);
      if (!anySub) {
        throw new HTTPException(412, {
          message: "subscription required to read private channel",
        });
      }
    }

    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    const chatId = Number(channel.externalId);

    // Прогрев state'а на каждый запрос: searchPublicChat кладёт чат в TDLib
    // memory state (см. td_api.tl §searchPublicChat — гарантирует updateNewChat
    // до возврата). Без него getChatHistory упадёт «Chat not found» в холодной
    // сессии (после рестарта api). Если username нет — пропускаем, надеемся
    // что чат уже зарегистрирован (например через подписку юзера).
    if (channel.username) {
      try {
        await tdClient.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never);
      } catch (e) {
        const cls = classifyResolveError(e);
        if (cls.permanent) await markChannelUnavailable(id, cls.reason);
        throw new HTTPException(404, {
          message: `Telegram lookup failed: ${errMsg(e)}`,
        });
      }
    }

    // Сетевое чтение ленты (openChat → backfill-loop getChatHistory → closeChat)
    // вынесено в lib/channel-history.fetchChannelHistory — тот же код тянет
    // превью канала. Здесь оборачиваем классификацией ошибок: permanent →
    // помечаем канал недоступным, иначе 404.
    // Вариант Б: глубокий проход по ленте (до 500 постов / 3 месяца) ради метрик
    // делаем только когда они устарели (раз в сутки на канал по meta.metrics_at),
    // иначе тянем ленту обычной порцией. Метрики считаем лишь на первой странице.
    const isFirstPage = fromMessageId === undefined;
    const metaAt = (channel.meta as Record<string, unknown>).metrics_at;
    const parsedAt = typeof metaAt === "string" ? Date.parse(metaAt) : NaN;
    // Нет маркера или он битый (NaN) → считаем устаревшим, надо пройтись.
    const metricsStale =
      !Number.isFinite(parsedAt) || Date.now() - parsedAt > METRICS_TTL_MS;
    const deepMetrics = isFirstPage && metricsStale;

    let aggregated;
    try {
      aggregated = await fetchChannelHistory(tdClient, {
        chatId,
        limit: deepMetrics ? METRICS_MAX_POSTS : limit,
        maxAgeMs: deepMetrics ? METRICS_WINDOW_MS : undefined,
        fromMessageId: fromMessageId ? Number(fromMessageId) : undefined,
      });
    } catch (e) {
      const cls = classifyResolveError(e);
      if (cls.permanent) await markChannelUnavailable(id, cls.reason);
      throw new HTTPException(404, {
        message: `history fetch failed: ${errMsg(e)}`,
      });
    }

    // Дошли сюда — TDLib отдал историю, канал точно доступен. Сбрасываем
    // unavailable-флаг, если ранее был выставлен (например, прошлый sync
    // упал, юзер переподключил аккаунт, теперь чат резолвится).
    if (channel.unavailableSince) {
      await clearChannelUnavailable(id);
    }

    // Фронту отдаём первые limit; при глубоком проходе набрали больше — это
    // только для расчёта охвата, лента остаётся постраничной.
    const items = mapChannelHistoryItems(aggregated.slice(0, limit), {
      withMedia: true,
    });

    // Авто-метрики из этой же ленты (этап 16.10) — без отдельного TDLib-вызова.
    // Пишем в meta: центр и правый рельс показывают, «Согласован» снапшотит в
    // прогноз. Только при deepMetrics (первая страница + устаревшие метрики).
    const metrics = deepMetrics ? metricsFromMessages(aggregated) : null;
    if (deepMetrics) {
      // metrics_at — TTL-маркер «когда последний раз глубоко проходили». Пишем
      // ВСЕГДА при deepMetrics, даже если метрик не набралось (sparse-канал:
      // постов в окне меньше порога → metricsFromMessages === null). Иначе
      // metricsStale остаётся true и мы лезем в глубокий проход на КАЖДОМ
      // открытии первой страницы. Маркер = «проверили, до TTL не лезем снова».
      const patch: Record<string, unknown> = {
        metrics_at: new Date().toISOString(),
      };
      if (metrics) {
        patch.avg_reach = metrics.avgReach;
        patch.err = metrics.err;
        patch.metrics_sample = metrics.sample;
      }
      await db
        .update(channels)
        .set({ meta: sql`${channels.meta} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(channels.id, id));
    }

    return c.json({ messages: items });
  },
);

// История размещений канала (срез 4): агрегат project_items по channelId через
// ВСЕ кампании воркспейса — «за сколько этот канал размещали раньше». Канал —
// накопительный актив (единый источник цены = placement, отдельной сущности
// истории нет), поэтому просто читаем прошлые сделки. Показываем только те, где
// была цена; текущее размещение исключаем через excludeId.
const PlacementHistoryItem = z.object({
  placementId: z.string(),
  projectId: z.string(),
  campaignName: z.string(),
  // publishedAt ?? scheduledAt ?? createdAt — когда размещение было/заведено.
  date: z.iso.datetime(),
  priceAmount: z.number().nullable(),
  // Условия сделки — чтобы «подставить» в новом размещении тянуло не только цену.
  surchargePercent: z.number().nullable(),
  bloggerVat: z.boolean(),
  format: z.string().nullable(),
  // Чем закончилось прошлое размещение: отказ (кто + причина) → менеджер видит
  // «в прошлый раз блогер отказался / нам было дорого» при заводе нового.
  declineBy: z.enum(["blogger", "us"]).nullable(),
  declineNote: z.string().nullable(),
});
const PlacementHistoryResponse = z.object({
  items: z.array(PlacementHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/placement-history",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        // Исключить текущее размещение (чтобы своя же строка не попала в историю).
        excludeId: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: PlacementHistoryResponse },
        },
        description: "Past placements of this channel across campaigns",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { excludeId, limit } = c.req.valid("query");
    await assertChannelAccess(id, wsId);
    const dateExpr = sql`COALESCE(${projectItems.publishedAt}, ${projectItems.scheduledAt}, ${projectItems.createdAt})`;
    const rows = await db
      .select({
        placementId: projectItems.id,
        projectId: projectItems.projectId,
        campaignName: projects.name,
        priceAmount: projectItems.priceAmount,
        surchargePercent: projectItems.surchargePercent,
        bloggerVat: projectItems.bloggerVat,
        format: projectItems.format,
        declineBy: projectItems.declineBy,
        declineNote: projectItems.declineNote,
        publishedAt: projectItems.publishedAt,
        scheduledAt: projectItems.scheduledAt,
        createdAt: projectItems.createdAt,
      })
      .from(projectItems)
      .innerJoin(projects, eq(projects.id, projectItems.projectId))
      .where(
        and(
          eq(projectItems.channelId, id),
          eq(projectItems.workspaceId, wsId),
          // Показываем размещения с ценой (история расценок) ИЛИ отказы — «в
          // прошлый раз отказался сам / нам было дорого» важно и без цены.
          or(
            isNotNull(projectItems.priceAmount),
            eq(projectItems.available, false),
          ),
          excludeId ? ne(projectItems.id, excludeId) : undefined,
        ),
      )
      .orderBy(desc(dateExpr))
      .limit(limit);
    const items = rows.map((r) => ({
      placementId: r.placementId,
      projectId: r.projectId,
      campaignName: r.campaignName,
      date: (r.publishedAt ?? r.scheduledAt ?? r.createdAt).toISOString(),
      priceAmount: r.priceAmount === null ? null : Number(r.priceAmount),
      surchargePercent:
        r.surchargePercent === null ? null : Number(r.surchargePercent),
      bloggerVat: r.bloggerVat,
      format: r.format,
      // text-колонка → enum (на запись валидируется, в БД только blogger/us/null).
      declineBy: (r.declineBy ?? null) as "blogger" | "us" | null,
      declineNote: r.declineNote,
    }));
    return c.json({ items });
  },
);

// Байты медиа поста канала (full-res) — плейн-роут (бинарь). Скачиваем on-demand
// по messageId (фронт берёт его из ленты), не храним. Блюр-thumb на фронте —
// мгновенный placeholder, это грузится лениво поверх.
app.get(
  "/v1/workspaces/:wsId/channels/:id/post-media/:messageId",
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const id = c.req.param("id");
    const messageId = c.req.param("messageId");
    const channel = await assertChannelAccess(id, wsId);
    if (!channel.externalId) {
      throw new HTTPException(404, { message: "not synced" });
    }
    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) throw new HTTPException(404, { message: "no reader" });
    // БЕЗ searchPublicChat-прогрева: картинку грузят из уже открытой ленты
    // (/history его сделал), чат зарегистрирован в сессии. Холодный прямой
    // доступ (без ленты) — редкость, просто не отдаст медиа (фронт → блюр).
    return respondWithCreativeMedia(
      picked.client,
      { chatId: String(channel.externalId), messageId, albumId: null },
      0,
    );
  },
);

// Бережный предпросмотр канала (этап 16.10): посты ТОЛЬКО из локального кэша
// TDLib (only_local) — ноль MTProto-запросов, не флудим на согласовании. Пусто,
// Предпросмотр канала (этап 16.10): лёгкая версия /history без метрик. Тянет
// ленту с сервера (readChannelPreview), т.к. only_local отдавал 1 пост из-за
// per-account кэша. Ошибка → [] (дровер не падает). Те же посты видит клиент.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/preview",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelHistoryResponse } },
        description: "Channel posts feed (network read, errors → empty)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { limit } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "telegram" || !channel.externalId) {
      return c.json({ messages: [] });
    }
    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) return c.json({ messages: [] });
    const msgs = await readChannelPreview(picked.client, {
      chatId: Number(channel.externalId),
      username: channel.username,
      limit,
    });
    return c.json({ messages: mapChannelHistoryItems(msgs) });
  },
);

export { isAccessibleGroup };
export default app;
