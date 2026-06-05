import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  outreachAccounts,
  placementClientStatus,
  placementContractStatus,
  placementCreativeStatus,
  placementMetricsStatus,
  type PlacementStepMessages,
  projectItems,
  projects,
  scheduledMessages,
  tgChats,
  tgUsers,
} from "../db/schema.ts";
import { assertProjectAccess } from "../lib/projects-access.ts";
import {
  resolveStickyByTgUserIds,
  resolveWarmTgUserIds,
  resolveProjectAccountIds,
  buildScheduledRows,
  prepareAgencyLeads,
  FINAL_OFFER_MSG_IDX,
  type SchedulingLead,
} from "../lib/project-scheduling.ts";
import { substituteVariables } from "../lib/substitute-variables.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { extractUsername } from "../lib/tg-username.ts";
import {
  detectChannelPlatform,
  fetchProviderPost,
  isProviderPlatform,
} from "../lib/channel-providers/index.ts";
import { errMsg } from "../lib/errors.ts";
import { resolveAdminRecipient } from "../lib/placement-recipient.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import {
  mapChannelHistoryItems,
  readTaggedMessages,
} from "../lib/channel-history.ts";
import {
  buildPostSnapshot,
  type TdContent,
  CreativeMediaSchema,
  mapCreativeMediaList,
  type PostSnapshot,
  PostSnapshotSchema,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
} from "../lib/td-message.ts";
import { respondWithCreativeMedia } from "../lib/creative-media-response.ts";
import { type WorkspaceVars } from "../middleware/assert-member.ts";

// Agency-кампания переиспользует projects (kind='agency') + project_items
// (kind='placement'). Базовые операции над кампанией (создание, бриф, phase,
// активация аутрича, цепочка) живут в projects.ts. Здесь — медиаплан:
// размещения (placements). Аутрич по лонглисту шлёт worker через те же
// scheduled_messages; получатель — админ канала (item.contact_id/username,
// проставляются при добавлении размещения).
//
// Stage:
//   longlist  — shortlisted_at IS NULL  (ещё опрашиваем)
//   shortlist — shortlisted_at NOT NULL (собран, ушёл клиенту на согласование)

const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});
const PlacementParam = WsProjectParam.extend({
  placementId: z.string().min(1).max(64),
});

const ClientStatusSchema = z.enum(placementClientStatus.enumValues);
// Статус коммуникации с блогером — производный из scheduled_messages + ответа.
const ChainStatusSchema = z.enum([
  "not_sent",
  "sent",
  "read",
  "replied",
  "declined",
]);

// Ссылка на помеченное сообщение в чате (договор/креатив/акт). albumId !=null →
// сервер дочитает весь альбом при рендере (media_album_id). Файлы не храним.
const MsgRefSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  albumId: z.string().nullable(),
  accountId: z.string(),
  at: z.iso.datetime(),
});
// Тело пометки (PUT): то же, но без `at` — сервер ставит сам.
const TagBodySchema = MsgRefSchema.omit({ at: true });
const StepMessagesSchema = z.object({
  contract: MsgRefSchema.optional(),
  creative: MsgRefSchema.optional(),
  act: MsgRefSchema.optional(),
});

const PlacementSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        id: z.string(),
        title: z.string(),
        username: z.string().nullable(),
        platform: z.enum(["telegram", "youtube", "tiktok", "dzen", "max"]),
        memberCount: z.number().int().nullable(),
        // Авто-метрики из ленты (этап 16.10): ср.охват + ERR. Живые из
        // channels.meta — на согласовании клиент видит актуальные, а не снимок.
        avgReach: z.number().nullable(),
        err: z.number().nullable(),
        // DM-путь канала (этап 16.8): есть ли личка и сколько звёзд стоит
        // отправка. dmStarCost === 0 → бесплатно (засчитывается готовым
        // контактом для гейта); >0 → менеджер пишет руками; null → ещё не
        // синкали. Источник — channels.meta (sync пишет
        // has_dm / outgoing_paid_message_star_count).
        hasDm: z.boolean(),
        dmStarCost: z.number().int().nullable(),
      })
      .nullable(),
    adminContactId: z.string().nullable(),
    adminUsername: z.string().nullable(),
    hasRecipient: z.boolean(),
    // Готовность контакта для гейта запуска (этап 16.8): у канала есть
    // привязанный админ (живой channel_admins, не снапшот item.contact_id) ИЛИ
    // доступна бесплатная личка (hasDm && dmStarCost===0). Жёсткий гейт
    // требует contactReady=true у всех размещений лонглиста.
    contactReady: z.boolean(),
    // Непрочитанные в переписке с админом (этап 16.10): из contacts.unreadCount,
    // который репликатор держит live. У каналов одного админа — одинаковое.
    unread: z.number().int(),
    // «Тёплый» канал (этап 16.9 п.5): кто-то из аккаунтов команды уже в личном
    // диалоге с админом. Помогает в лонглисте отличить знакомых от холодных.
    teamKnowsAdmin: z.boolean(),
    // Привязанный админ — бот (авторитетно, tg_users.is_bot). Бот = ручной
    // способ: авто-опенер не шлётся, в дровере плашка «напишите вручную».
    adminIsBot: z.boolean(),
    // Аккаунт, через который идёт аутрич этому блогеру (после активации).
    account: z
      .object({
        id: z.string(),
        firstName: z.string().nullable(),
        tgUsername: z.string().nullable(),
      })
      .nullable(),
    chainStatus: ChainStatusSchema,
    // Компактная аутрич-сводка для одного статус-столбца в таблице.
    outreach: z.object({
      totalSteps: z.number().int(), // запланировано сообщений (= шагов цепочки)
      sentCount: z.number().int(), // отправлено
      read: z.boolean(), // прочитано хотя бы одно
      lastSentAt: z.iso.datetime().nullable(),
    }),
    available: z.boolean().nullable(),
    priceAmount: z.number().nullable(),
    // Цена для клиента (null = совпадает с priceAmount).
    clientPrice: z.number().nullable(),
    forecastViews: z.number().int().nullable(),
    forecastErr: z.number().nullable(),
    clientStatus: ClientStatusSchema,
    clientStatusComment: z.string().nullable(),
    shortlistedAt: z.iso.datetime().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    // production (фаза 5)
    finalOfferSentAt: z.iso.datetime().nullable(),
    finalOfferStatus: z.enum(["none", "queued", "sent", "failed"]),
    contractStatus: z.enum(placementContractStatus.enumValues),
    creativeStatus: z.enum(placementCreativeStatus.enumValues),
    creativeRound: z.number().int(),
    scheduledAt: z.iso.datetime().nullable(),
    erid: z.string().nullable(),
    eridAdvertiserData: z.string().nullable(),
    postUrl: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    actReceivedAt: z.iso.datetime().nullable(),
    // помеченные сообщения чата (договор/креатив/акт) + ЕРИД-отправка + коммент
    // клиента к креативу
    stepMessages: StepMessagesSchema.nullable(),
    eridSentAt: z.iso.datetime().nullable(),
    creativeClientComment: z.string().nullable(),
    creativeClientSentAt: z.iso.datetime().nullable(),
    // отчёт (фаза 6) — снимок метрик поста через TDLib
    metricsStatus: z.enum(placementMetricsStatus.enumValues),
    metricsViews: z.number().int().nullable(),
    metricsLikes: z.number().int().nullable(),
    metricsComments: z.number().int().nullable(),
    metricsShares: z.number().int().nullable(),
    metricsCollectedAt: z.iso.datetime().nullable(),
    metricsError: z.string().nullable(),
    postSnapshot: PostSnapshotSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Placement");

const CreatePlacementBody = z
  .object({
    channelId: z.string().min(1).max(64),
  })
  .openapi("CreatePlacement");

const UpdatePlacementBody = z
  .object({
    available: z.boolean().nullable().optional(),
    priceAmount: z.number().nonnegative().nullable().optional(),
    clientPrice: z.number().nonnegative().nullable().optional(),
    forecastViews: z.number().int().nonnegative().nullable().optional(),
    forecastErr: z.number().nonnegative().nullable().optional(),
    clientStatus: ClientStatusSchema.optional(),
    // true → добавить в шортлист (проставить shortlisted_at=now), false → вернуть
    // в лонглист (сбросить). Явная кнопка «В шортлист» у менеджера.
    shortlisted: z.boolean().optional(),
    // production (фаза 5)
    contractStatus: z.enum(placementContractStatus.enumValues).optional(),
    creativeStatus: z.enum(placementCreativeStatus.enumValues).optional(),
    creativeRound: z.number().int().min(0).optional(),
    scheduledAt: z.iso.datetime().nullable().optional(),
    erid: z.string().max(200).nullable().optional(),
    eridAdvertiserData: z.string().max(500).nullable().optional(),
    postUrl: z.string().max(500).nullable().optional(),
    publishedAt: z.iso.datetime().nullable().optional(),
    actReceivedAt: z.iso.datetime().nullable().optional(),
    eridSentAt: z.iso.datetime().nullable().optional(),
    creativeClientComment: z.string().max(2000).nullable().optional(),
  })
  .openapi("UpdatePlacement");

// Чтение помеченного сообщения (договор/креатив/акт) для инлайн-рендера в
// гармошке и превью в Вертолёте. Альбом = несколько messageIds → getMessages.
const StepKindParam = PlacementParam.extend({
  kind: z.enum(["contract", "creative", "act"]),
});
const TaggedPostSchema = z
  .object({
    id: z.string(),
    date: z.iso.datetime(),
    text: z.string(),
    entities: z.array(TdMessageEntitySchema),
    mediaThumb: TdMediaThumbSchema.nullable(),
    views: z.number().nullable(),
    forwards: z.number().nullable(),
    replies: z.number().nullable(),
    reactions: z.array(z.object({ emoji: z.string(), count: z.number() })),
    isForwarded: z.boolean(),
  })
  .openapi("TaggedMessage");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Производный статус цепочки. repliedAt и факт отправки — источник истины
// аутрича; available=false — ручная отметка отказа.
function chainStatus(
  repliedAt: Date | null,
  available: boolean | null,
  sentCount: number,
  read: boolean,
): z.infer<typeof ChainStatusSchema> {
  // Ручной отказ менеджера перебивает авто-статус: блогер мог ответить
  // («дорого/не интересно»), но «Отказ» — финальное решение, строка должна
  // уйти из лонглиста независимо от repliedAt.
  if (available === false) return "declined";
  if (repliedAt) return "replied";
  if (read) return "read";
  if (sentCount > 0) return "sent";
  return "not_sent";
}

// Аутрич-сводка по item'ам из scheduled_messages, одним запросом.
async function outreachByItem(itemIds: string[]) {
  const map = new Map<
    string,
    {
      totalSteps: number;
      sentCount: number;
      read: boolean;
      lastSentAt: Date | null;
      accountId: string | null;
      // статус финального оффера (msg_idx=FINAL_OFFER_MSG_IDX), отдельно от
      // холодной цепочки. null = оффер не ставился.
      finalOffer: string | null;
    }
  >();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({
      itemId: scheduledMessages.itemId,
      accountId: scheduledMessages.accountId,
      status: scheduledMessages.status,
      messageIdx: scheduledMessages.messageIdx,
      sentAt: scheduledMessages.sentAt,
      readAt: scheduledMessages.readAt,
    })
    .from(scheduledMessages)
    .where(inArray(scheduledMessages.itemId, itemIds));
  // приоритет статуса оффера при нескольких попытках: sent > pending > failed.
  const offerRank = (s: string) =>
    s === "sent" ? 3 : s === "pending" ? 2 : s === "failed" ? 1 : 0;
  for (const r of rows) {
    const e = map.get(r.itemId) ?? {
      totalSteps: 0,
      sentCount: 0,
      read: false,
      lastSentAt: null as Date | null,
      accountId: null as string | null,
      finalOffer: null as string | null,
    };
    if (r.messageIdx === FINAL_OFFER_MSG_IDX) {
      if (e.finalOffer === null || offerRank(r.status) > offerRank(e.finalOffer)) {
        e.finalOffer = r.status;
      }
      // accountId берём и отсюда: у shortlist-direct размещения финальный оффер
      // может быть единственным сообщением, и это его «липкий» аккаунт DM.
      e.accountId ??= r.accountId;
      map.set(r.itemId, e);
      continue; // в счётчики холодной цепочки финальный оффер не мешаем
    }
    e.totalSteps += 1;
    if (r.status === "sent") e.sentCount += 1;
    if (r.readAt) e.read = true;
    if (r.sentAt && (!e.lastSentAt || r.sentAt > e.lastSentAt)) {
      e.lastSentAt = r.sentAt;
    }
    e.accountId ??= r.accountId;
    map.set(r.itemId, e);
  }
  return map;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      query: z.object({
        // longlist (опрос, shortlisted_at IS NULL) | shortlist (собранные) | all
        stage: z.enum(["longlist", "shortlist", "all"]).default("all"),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(PlacementSchema) } },
        description: "Placements (медиаплан)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { stage } = c.req.valid("query");
    await assertProjectAccess(projectId, wsId, userId, role);

    const stageClause =
      stage === "longlist"
        ? sql`${projectItems.shortlistedAt} IS NULL`
        : stage === "shortlist"
          ? sql`${projectItems.shortlistedAt} IS NOT NULL`
          : undefined;

    const rows = await db
      .select(placementColumns())
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          stageClause,
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    const outreach = await outreachByItem(rows.map((r) => r.id));
    const accounts = await loadAccounts(
      [...outreach.values()].map((o) => o.accountId),
    );
    return c.json(rows.map((r) => serializePlacement(r, outreach, accounts)));
  },
);

// ── Доливка размещений в активную кампанию ──────────────────────────────────
// Если кампания уже active/paused, новые размещения должны сразу пойти в аутрич
// по общей цепочке (project.messages), независимо от уже запущенных волн —
// offset'ы цепочки считаются от now(). Это та же доливка, что в BD (этап 12.5
// project-imports): переиспользуем общие хелперы project-scheduling.
//
// dolivkaAccountsOrThrow вызывается ДО вставки размещений: если кампания активна,
// но слать нечем (нет цепочки/аккаунтов) — 400 без частичного состояния. Для
// draft возвращает null (доливки нет, /activate запланирует всех разом).
async function dolivkaAccountsOrThrow(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<string[] | null> {
  if (project.status !== "active" && project.status !== "paused") return null;
  if (project.messages.length === 0) {
    throw new HTTPException(400, {
      message: "У кампании нет цепочки сообщений — нечего слать новым блогерам",
    });
  }
  const accountIds = await resolveProjectAccountIds(wsId, project);
  if (accountIds.length === 0) {
    throw new HTTPException(400, {
      message: "Нет активных Telegram-аккаунтов для доливки",
    });
  }
  return accountIds;
}

type InsertedPlacement = {
  id: string;
  channelId: string | null;
  username: string | null;
  tgUserId: string | null;
  properties: unknown;
};

async function scheduleDolivka(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  accountIds: string[];
  inserted: InsertedPlacement[];
}) {
  // Agency: один опенер на админа + {{каналы}} + пропуск админов с уже начатым
  // тредом (этап 16.8). BD: только размещения с адресатом (без получателя
  // аутрич некуда слать — менеджер привяжет позже).
  let leads: SchedulingLead[];
  if (opts.project.kind === "agency") {
    leads = await prepareAgencyLeads({
      projectId: opts.project.id,
      leads: opts.inserted.map((p) => ({
        id: p.id,
        username: p.username,
        tgUserId: p.tgUserId,
        properties: (p.properties ?? {}) as Record<string, unknown>,
      })),
      skipContacted: true,
    });
  } else {
    leads = opts.inserted
      .filter((p) => p.tgUserId !== null || p.username !== null)
      .map((p) => ({
        id: p.id,
        username: p.username,
        tgUserId: p.tgUserId,
        properties: (p.properties ?? {}) as Record<string, unknown>,
      }));
  }
  if (leads.length === 0) return;

  const tgUserIds = leads
    .map((l) => l.tgUserId)
    .filter((x): x is string => x !== null);
  const priorByTgUserId = await resolveStickyByTgUserIds(opts.wsId, tgUserIds);
  const warmTgUserIds = await resolveWarmTgUserIds(opts.wsId, tgUserIds);

  const rows = buildScheduledRows({
    wsId: opts.wsId,
    project: opts.project,
    accountIds: opts.accountIds,
    leads,
    baseTime: new Date(),
    priorByTgUserId,
    warmTgUserIds,
  });
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(scheduledMessages).values(rows.slice(i, i + CHUNK));
  }
}

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: CreatePlacementBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: PlacementSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { channelId } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    // До вставки: на активной кампании проверяем, что доливку есть чем слать.
    const dolivkaAccounts = await dolivkaAccountsOrThrow(wsId, project);

    const [channel] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.workspaceId, wsId)))
      .limit(1);
    if (!channel) throw new HTTPException(404, { message: "channel not found" });

    const admin = await resolveAdminRecipient(channelId);
    const [row] = await db
      .insert(projectItems)
      .values({
        workspaceId: wsId,
        projectId,
        kind: "placement",
        channelId,
        contactId: admin.contactId,
        username: admin.username,
        tgUserId: admin.tgUserId,
      })
      .returning();

    if (dolivkaAccounts && row) {
      await scheduleDolivka({
        wsId,
        project,
        accountIds: dolivkaAccounts,
        inserted: [row],
      });
    }

    const placement = await loadPlacement(row!.id);
    return c.json(placement!, 201);
  },
);

// Массовое добавление: по одному URL/@username на строку. Канал, которого нет
// в базе, заводим болванкой (title=@username) — реальные title/подписчики
// подтянет ленивый sync при первом открытии ChannelDrawer. Получателя
// (контакт админа) резолвим, если он уже привязан; нет — размещение без
// получателя (привязать можно в сайдбаре канала).
const BulkPlacementsBody = z
  .object({
    identifiers: z.array(z.string().min(1).max(200)).min(1).max(300),
  })
  .openapi("BulkPlacements");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: BulkPlacementsBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              added: z.number().int(),
              channelsCreated: z.number().int(),
              skippedInvalid: z.number().int(),
              skippedDuplicate: z.number().int(),
            }),
          },
        },
        description: "Bulk add result",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { identifiers } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    // До вставки: на активной кампании проверяем, что доливку есть чем слать.
    const dolivkaAccounts = await dolivkaAccountsOrThrow(wsId, project);

    // Платформу детектим на КАЖДУЮ строку: ссылка YouTube/TikTok → провайдер-
    // канал (профиль резолвит ленивый sync), иначе TG @username (как раньше).
    // Ключ дедупа — platform + нормализованный идентификатор.
    type ParsedAdd =
      | { platform: "telegram"; key: string; uname: string }
      | {
          platform: "youtube" | "tiktok" | "dzen" | "max";
          key: string;
          link: string;
        };
    let skippedInvalid = 0;
    const seen = new Set<string>();
    const adds: ParsedAdd[] = [];
    for (const raw of identifiers) {
      const platform = detectChannelPlatform(raw);
      let entry: ParsedAdd | null;
      if (platform === "telegram") {
        const uname = extractUsername(raw);
        if (!uname) {
          skippedInvalid++;
          continue;
        }
        entry = { platform, key: `telegram:${uname}`, uname };
      } else {
        const link = raw.trim();
        entry = { platform, key: `${platform}:${link.toLowerCase()}`, link };
      }
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      adds.push(entry);
    }

    let added = 0;
    let channelsCreated = 0;
    let skippedDuplicate = 0;
    const insertedItems: InsertedPlacement[] = [];

    for (const a of adds) {
      // find-or-create канал: TG по lower(username), провайдер по lower(link).
      const matchCh =
        a.platform === "telegram"
          ? sql`lower(${channels.username}) = ${a.uname}`
          : sql`lower(${channels.link}) = ${a.link.toLowerCase()}`;
      let [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, wsId),
            eq(channels.platform, a.platform),
            matchCh,
          ),
        )
        .limit(1);
      if (!ch) {
        const [created] = await db
          .insert(channels)
          .values(
            a.platform === "telegram"
              ? {
                  workspaceId: wsId,
                  title: `@${a.uname}`,
                  username: a.uname,
                  platform: "telegram",
                  createdBy: userId,
                }
              : {
                  workspaceId: wsId,
                  // title — заглушка по ссылке; sync провайдера перезапишет.
                  title: a.link,
                  link: a.link,
                  platform: a.platform,
                  createdBy: userId,
                },
          )
          .onConflictDoNothing()
          .returning({ id: channels.id });
        if (created) {
          ch = created;
          channelsCreated++;
        } else {
          // Параллельная вставка того же канала — берём существующий.
          [ch] = await db
            .select({ id: channels.id })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                eq(channels.platform, a.platform),
                matchCh,
              ),
            )
            .limit(1);
        }
      }
      if (!ch) continue;

      const [existing] = await db
        .select({ id: projectItems.id })
        .from(projectItems)
        .where(
          and(
            eq(projectItems.projectId, projectId),
            eq(projectItems.channelId, ch.id),
            eq(projectItems.kind, "placement"),
          ),
        )
        .limit(1);
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      // У провайдер-каналов нет TG-админа (общение по DM/почте — отдельно).
      const admin =
        a.platform === "telegram"
          ? await resolveAdminRecipient(ch.id)
          : { contactId: null, username: null, tgUserId: null };
      const [ins] = await db
        .insert(projectItems)
        .values({
          workspaceId: wsId,
          projectId,
          kind: "placement",
          channelId: ch.id,
          contactId: admin.contactId,
          username: admin.username,
          tgUserId: admin.tgUserId,
        })
        .returning();
      if (ins) insertedItems.push(ins);
      added++;
    }

    // Доливка: новые размещения на активной кампании сразу уходят в аутрич.
    if (dolivkaAccounts) {
      await scheduleDolivka({
        wsId,
        project,
        accountIds: dolivkaAccounts,
        inserted: insertedItems,
      });
    }

    // Скан канала ленивый — подтянется при открытии (ChannelCard auto-sync),
    // авто-скан на добавлении убрали ради меньшего флуда (этап 16.10).
    return c.json({ added, channelsCreated, skippedInvalid, skippedDuplicate });
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: {
      params: PlacementParam,
      body: {
        content: { "application/json": { schema: UpdatePlacementBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: PlacementSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    const body = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [updated] = await db
      .update(projectItems)
      .set({
        ...(body.available !== undefined && { available: body.available }),
        ...(body.priceAmount !== undefined && {
          priceAmount:
            body.priceAmount === null ? null : String(body.priceAmount),
        }),
        ...(body.clientPrice !== undefined && {
          clientPrice:
            body.clientPrice === null ? null : String(body.clientPrice),
        }),
        ...(body.forecastViews !== undefined && {
          forecastViews: body.forecastViews,
        }),
        ...(body.forecastErr !== undefined && {
          forecastErr:
            body.forecastErr === null ? null : String(body.forecastErr),
        }),
        // Смена статуса менеджером — это новое решение: сбрасываем коммент
        // (он принадлежал прежнему статусу клиента) и обновляем отметку
        // времени, чтобы comment/at не рассинхронизировались со статусом.
        ...(body.clientStatus !== undefined && {
          clientStatus: body.clientStatus,
          clientStatusComment: null,
          clientStatusAt: new Date(),
        }),
        ...(body.shortlisted !== undefined && {
          shortlistedAt: body.shortlisted ? new Date() : null,
        }),
        // production: enum/text/int/jsonb — прямое копирование (null валиден).
        ...pickDefined(body, [
          "contractStatus",
          "creativeStatus",
          "creativeRound",
          "erid",
          "eridAdvertiserData",
          "postUrl",
          "creativeClientComment",
        ]),
        ...(body.scheduledAt !== undefined && {
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        }),
        ...(body.publishedAt !== undefined && {
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
        }),
        ...(body.actReceivedAt !== undefined && {
          actReceivedAt: body.actReceivedAt
            ? new Date(body.actReceivedAt)
            : null,
        }),
        ...(body.eridSentAt !== undefined && {
          eridSentAt: body.eridSentAt ? new Date(body.eridSentAt) : null,
        }),
        // Переход в client_review = «отправили клиенту» → стампим время сервером
        // (для подсветки «креатив правлен после отправки»).
        ...(body.creativeStatus === "client_review" && {
          creativeClientSentAt: new Date(),
        }),
      })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (!updated) throw new HTTPException(404, { message: "placement not found" });

    const placement = await loadPlacement(placementId);
    return c.json(placement!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: { params: PlacementParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .delete(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "placement not found" });
    }
    return c.body(null, 204);
  },
);

// Подтверждение — разовая рассылка approved-блогерам «вы выбраны». БЕЗ
// follow-up-пингов. Отправку НЕ делаем здесь синхронно: кладём по одному
// scheduled_messages на блогера, и тот же worker, что шлёт BD-цепочки,
// отправляет их с human-flow (typing, паузы), проверяя status/cooldown
// аккаунта. Аккаунт — sticky (тот же менеджер блогеру) либо round-robin по

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/final-offer",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ text: z.string().min(1).max(4000) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ scheduled: z.number().int() }),
          },
        },
        description: "Queued for worker",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { text } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);

    // approved + в шортлисте + есть кого адресовать (worker резолвит
    // username → tg_user_id лениво, так что username достаточно).
    const rows = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        tgUserId: projectItems.tgUserId,
        properties: projectItems.properties,
      })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          eq(projectItems.clientStatus, "approved"),
          isNotNull(projectItems.shortlistedAt),
          sql`(${projectItems.username} IS NOT NULL OR ${projectItems.tgUserId} IS NOT NULL)`,
          // Не дублируем оффер: пропускаем тех, кому он уже отправлен или в
          // очереди (повторный «оповестить» добивает только оставшихся/неудачных).
          sql`NOT EXISTS (
            SELECT 1 FROM ${scheduledMessages}
            WHERE ${scheduledMessages.itemId} = ${projectItems.id}
              AND ${scheduledMessages.messageIdx} = ${FINAL_OFFER_MSG_IDX}
              AND ${scheduledMessages.status} IN ('sent', 'pending')
          )`,
        ),
      );
    if (rows.length === 0) {
      throw new HTTPException(400, {
        message: "Все одобренные блогеры уже оповещены",
      });
    }

    // active-аккаунты проекта (round-robin) + sticky-continuity.
    const accountIds = await resolveProjectAccountIds(wsId, project);
    if (accountIds.length === 0) {
      throw new HTTPException(400, {
        message: "Нет активных Telegram-аккаунтов для рассылки",
      });
    }
    const tgUserIds = rows
      .map((r) => r.tgUserId)
      .filter((x): x is string => x !== null);
    const sticky = await resolveStickyByTgUserIds(wsId, tgUserIds);

    let rr = 0;
    const now = new Date();
    const scheduled = rows.map((pl) => {
      const stickyAcc = pl.tgUserId ? sticky.get(pl.tgUserId) : undefined;
      // sticky берём только если аккаунт ещё активен; иначе round-robin.
      const accountId =
        stickyAcc && accountIds.includes(stickyAcc)
          ? stickyAcc
          : accountIds[rr++ % accountIds.length]!;
      return {
        workspaceId: wsId,
        projectId,
        itemId: pl.id,
        accountId,
        messageIdx: FINAL_OFFER_MSG_IDX,
        text: substituteVariables(text, {
          username: pl.username,
          properties: pl.properties as Record<string, string>,
        }),
        sendAt: now,
      };
    });

    await db.transaction(async (tx) => {
      const CHUNK = 1000;
      for (let i = 0; i < scheduled.length; i += CHUNK) {
        await tx.insert(scheduledMessages).values(scheduled.slice(i, i + CHUNK));
      }
      // ВНИМАНИЕ: finalOfferSentAt = «поставлено в очередь», НЕ «доставлено».
      // Для реального статуса доставки используйте finalOfferStatus (none/
      // queued/sent/failed), считаемый из scheduled_messages. Это поле — лишь
      // отметка факта запуска рассылки.
      await tx
        .update(projectItems)
        .set({ finalOfferSentAt: now })
        .where(
          inArray(
            projectItems.id,
            rows.map((r) => r.id),
          ),
        );
      // Worker берёт pending только при project.status='active'.
      if (project.status !== "active") {
        await tx
          .update(projects)
          .set({
            status: "active",
            activatedAt: project.activatedAt ?? now,
            updatedAt: now,
          })
          .where(eq(projects.id, projectId));
      }
    });

    return c.json({ scheduled: scheduled.length });
  },
);

// Фаза «Отчёт»: ставит в очередь снятие метрик для всех опубликованных
// размещений (есть post_url). metrics-worker разбирает pending по 1 за tick
// (троттл 10с/100 в час) — TDLib openChat+viewMessages, не bulk-pull.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/collect-metrics",
    tags: ["campaigns"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ queued: z.number().int() }),
          },
        },
        description: "Queued for metrics-worker",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);

    // Только одобренный шортлист с постом — ровно то, что показывает экран
    // отчёта. Без этого фильтра воркер жёг бы часовой лимит на размещения,
    // которых в отчёте не видно (не-approved / не-shortlist с post_url).
    const queued = await db
      .update(projectItems)
      .set({ metricsStatus: "pending", metricsError: null })
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          eq(projectItems.clientStatus, "approved"),
          isNotNull(projectItems.shortlistedAt),
          isNotNull(projectItems.postUrl),
        ),
      )
      .returning({ id: projectItems.id });
    if (queued.length === 0) {
      throw new HTTPException(400, {
        message: "Нет опубликованных постов для снятия статистики",
      });
    }
    return c.json({ queued: queued.length });
  },
);

// Колонки placement-строки (общие для list/load).
function placementColumns() {
  return {
    id: projectItems.id,
    available: projectItems.available,
    priceAmount: projectItems.priceAmount,
    clientPrice: projectItems.clientPrice,
    forecastViews: projectItems.forecastViews,
    forecastErr: projectItems.forecastErr,
    clientStatus: projectItems.clientStatus,
    clientStatusComment: projectItems.clientStatusComment,
    shortlistedAt: projectItems.shortlistedAt,
    repliedAt: projectItems.repliedAt,
    finalOfferSentAt: projectItems.finalOfferSentAt,
    contractStatus: projectItems.contractStatus,
    creativeStatus: projectItems.creativeStatus,
    creativeRound: projectItems.creativeRound,
    scheduledAt: projectItems.scheduledAt,
    erid: projectItems.erid,
    eridAdvertiserData: projectItems.eridAdvertiserData,
    postUrl: projectItems.postUrl,
    publishedAt: projectItems.publishedAt,
    actReceivedAt: projectItems.actReceivedAt,
    stepMessages: projectItems.stepMessages,
    eridSentAt: projectItems.eridSentAt,
    creativeClientComment: projectItems.creativeClientComment,
    creativeClientSentAt: projectItems.creativeClientSentAt,
    metricsStatus: projectItems.metricsStatus,
    metricsViews: projectItems.metricsViews,
    metricsLikes: projectItems.metricsLikes,
    metricsComments: projectItems.metricsComments,
    metricsShares: projectItems.metricsShares,
    metricsCollectedAt: projectItems.metricsCollectedAt,
    metricsError: projectItems.metricsError,
    postSnapshot: projectItems.postSnapshot,
    createdAt: projectItems.createdAt,
    contactId: projectItems.contactId,
    username: projectItems.username,
    tgUserId: projectItems.tgUserId,
    channelId: channels.id,
    channelTitle: channels.title,
    channelUsername: channels.username,
    channelPlatform: channels.platform,
    channelMembers: channels.memberCount,
    // Авто-метрики из ленты (meta пишет /history): ср.охват + ERR. Живые.
    channelAvgReach: sql<number | null>`(${channels.meta} ->> 'avg_reach')::int`,
    channelErr: sql<number | null>`(${channels.meta} ->> 'err')::float8`,
    // Бесплатная личка канала: есть DM-группа (direct_messages_chat_id кладёт
    // сам sync) — НЕ has_dm, который пишет репликатор асинхронно (этап 16.8).
    channelHasDm: sql<boolean>`coalesce(${channels.meta} ->> 'direct_messages_chat_id', '0') <> '0'`,
    channelDmStarCost: sql<
      number | null
    >`(${channels.meta} ->> 'outgoing_paid_message_star_count')::int`,
    // Живой признак «у канала есть привязанный админ» — не зависит от снапшота
    // item.contact_id (админа могли привязать уже после создания размещения).
    channelHasAdmin: sql<boolean>`exists (select 1 from ${channelAdmins} where ${channelAdmins.channelId} = ${channels.id})`,
    // Явно выбранный способ связи (группа / личка-канала) в meta.contact_method
    // (этап 16.9): тоже готовый контакт.
    channelMethodSet: sql<boolean>`(${channels.meta} -> 'contact_method' ->> 'kind') is not null`,
    adminUsername: sql<
      string | null
    >`${contacts.properties} ->> 'telegram_username'`,
    unread: contacts.unreadCount,
    // «Команда уже в контакте с этим админом» (этап 16.9 п.5): админ нам
    // ОТВЕТИЛ хотя бы раз через любой аккаунт воркспейса (has_inbound — тот же
    // сигнал, что у кружочков в /channels, чтобы лонглист и таблица не
    // расходились). Не «мы написали» и не пустой openChat.
    teamKnowsAdmin: sql<boolean>`exists (
      select 1 from ${tgChats}
      join ${outreachAccounts} on ${outreachAccounts.id} = ${tgChats.accountId}
      where ${tgChats.peerUserId} = (${contacts.properties} ->> 'tg_user_id')
        and ${outreachAccounts.workspaceId} = ${channels.workspaceId}
        and ${tgChats.hasInbound} = true
    )`,
    // Привязанный админ-контакт — бот (этап 16.9): авторитетно из tg_users.is_bot
    // по tg_user_id контакта (НЕ суффикс @…bot). Фронт показывает «бот — вручную»
    // и считает канал ручным (бот = не авто-рассылка).
    adminIsBot: sql<boolean>`coalesce((
      select ${tgUsers.isBot} from ${tgUsers}
      where ${tgUsers.userId} = (${contacts.properties} ->> 'tg_user_id')
    ), false)`,
  };
}

async function loadAccounts(ids: (string | null)[]) {
  const real = [...new Set(ids.filter((x): x is string => x !== null))];
  const map = new Map<
    string,
    { id: string; firstName: string | null; tgUsername: string | null }
  >();
  if (real.length === 0) return map;
  const rows = await db
    .select({
      id: outreachAccounts.id,
      firstName: outreachAccounts.firstName,
      tgUsername: outreachAccounts.externalUsername,
    })
    .from(outreachAccounts)
    .where(inArray(outreachAccounts.id, real));
  for (const a of rows) map.set(a.id, a);
  return map;
}

async function loadPlacement(itemId: string) {
  const [row] = await db
    .select(placementColumns())
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(eq(projectItems.id, itemId))
    .limit(1);
  if (!row) return null;
  const outreach = await outreachByItem([itemId]);
  const accounts = await loadAccounts(
    [...outreach.values()].map((o) => o.accountId),
  );
  return serializePlacement(row, outreach, accounts);
}

function serializePlacement(
  row: {
    id: string;
    available: boolean | null;
    priceAmount: string | null;
    clientPrice: string | null;
    forecastViews: number | null;
    forecastErr: string | null;
    clientStatus: (typeof placementClientStatus.enumValues)[number];
    clientStatusComment: string | null;
    shortlistedAt: Date | null;
    repliedAt: Date | null;
    finalOfferSentAt: Date | null;
    contractStatus: (typeof placementContractStatus.enumValues)[number];
    creativeStatus: (typeof placementCreativeStatus.enumValues)[number];
    creativeRound: number;
    scheduledAt: Date | null;
    erid: string | null;
    eridAdvertiserData: string | null;
    postUrl: string | null;
    publishedAt: Date | null;
    actReceivedAt: Date | null;
    stepMessages: PlacementStepMessages | null;
    eridSentAt: Date | null;
    creativeClientComment: string | null;
    creativeClientSentAt: Date | null;
    metricsStatus: (typeof placementMetricsStatus.enumValues)[number];
    metricsViews: number | null;
    metricsLikes: number | null;
    metricsComments: number | null;
    metricsShares: number | null;
    metricsCollectedAt: Date | null;
    metricsError: string | null;
    postSnapshot: PostSnapshot | null;
    createdAt: Date;
    contactId: string | null;
    username: string | null;
    tgUserId: string | null;
    channelId: string | null;
    channelTitle: string | null;
    channelUsername: string | null;
    channelPlatform: "telegram" | "youtube" | "tiktok" | "dzen" | "max" | null;
    channelMembers: number | null;
    channelAvgReach: number | null;
    channelErr: number | null;
    channelHasDm: boolean;
    channelDmStarCost: number | null;
    channelHasAdmin: boolean;
    channelMethodSet: boolean;
    adminUsername: string | null;
    unread: number | null;
    teamKnowsAdmin: boolean;
    adminIsBot: boolean;
  },
  outreachMap: Awaited<ReturnType<typeof outreachByItem>>,
  accountMap: Awaited<ReturnType<typeof loadAccounts>>,
) {
  const o = outreachMap.get(row.id) ?? {
    totalSteps: 0,
    sentCount: 0,
    read: false,
    lastSentAt: null,
    accountId: null,
    finalOffer: null as string | null,
  };
  const account = o.accountId ? accountMap.get(o.accountId) ?? null : null;
  return {
    id: row.id,
    channel: row.channelId
      ? {
          id: row.channelId,
          title: row.channelTitle ?? "—",
          username: row.channelUsername,
          // channelId есть ⇒ канал реальный ⇒ platform (notNull) не null.
          platform: row.channelPlatform!,
          memberCount: row.channelMembers,
          avgReach: row.channelAvgReach,
          err: row.channelErr,
          hasDm: row.channelHasDm,
          dmStarCost: row.channelDmStarCost,
        }
      : null,
    adminContactId: row.contactId,
    adminUsername: row.adminUsername,
    // Есть кого адресовать аутричем/оффером (worker резолвит username→tgUserId
    // лениво) — UI считает получателей по этому флагу, как и backend.
    hasRecipient: row.username !== null || row.tgUserId !== null,
    // Готовность для гейта: привязан админ ИЛИ бесплатная личка канала.
    contactReady:
      row.channelHasAdmin ||
      row.channelMethodSet ||
      (row.channelHasDm && row.channelDmStarCost === 0),
    unread: row.unread ?? 0,
    teamKnowsAdmin: row.teamKnowsAdmin,
    adminIsBot: row.adminIsBot,
    account,
    chainStatus: chainStatus(row.repliedAt, row.available, o.sentCount, o.read),
    outreach: {
      totalSteps: o.totalSteps,
      sentCount: o.sentCount,
      read: o.read,
      lastSentAt: o.lastSentAt?.toISOString() ?? null,
    },
    available: row.available,
    priceAmount: row.priceAmount === null ? null : Number(row.priceAmount),
    clientPrice: row.clientPrice === null ? null : Number(row.clientPrice),
    forecastViews: row.forecastViews,
    forecastErr: row.forecastErr === null ? null : Number(row.forecastErr),
    clientStatus: row.clientStatus,
    clientStatusComment: row.clientStatusComment,
    shortlistedAt: row.shortlistedAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    finalOfferSentAt: row.finalOfferSentAt?.toISOString() ?? null,
    // Реальный статус доставки финального оффера (из scheduled_messages), а не
    // факт постановки в очередь: none | queued | sent | failed. cancelled (старое
    // до фикса) → none, чтобы можно было переотправить.
    finalOfferStatus: (o.finalOffer === "sent"
      ? "sent"
      : o.finalOffer === "pending"
        ? "queued"
        : o.finalOffer === "failed"
          ? "failed"
          : "none") as "none" | "queued" | "sent" | "failed",
    contractStatus: row.contractStatus,
    creativeStatus: row.creativeStatus,
    creativeRound: row.creativeRound,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    erid: row.erid,
    eridAdvertiserData: row.eridAdvertiserData,
    postUrl: row.postUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    actReceivedAt: row.actReceivedAt?.toISOString() ?? null,
    stepMessages: row.stepMessages ?? null,
    eridSentAt: row.eridSentAt?.toISOString() ?? null,
    creativeClientComment: row.creativeClientComment,
    creativeClientSentAt: row.creativeClientSentAt?.toISOString() ?? null,
    metricsStatus: row.metricsStatus,
    metricsViews: row.metricsViews,
    metricsLikes: row.metricsLikes,
    metricsComments: row.metricsComments,
    metricsShares: row.metricsShares,
    metricsCollectedAt: row.metricsCollectedAt?.toISOString() ?? null,
    metricsError: row.metricsError,
    postSnapshot: row.postSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
    tags: ["agency"],
    request: { params: StepKindParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              messages: z.array(TaggedPostSchema),
              // media (full-res дескрипторы) для превью креатива у менеджера;
              // байты — отдельным step-media роутом. Для договора (документ) пусто.
              media: z.array(CreativeMediaSchema),
              // Когда сообщение последний раз отредактировано (макс по альбому),
              // null если не правилось. Фронт сравнивает с creativeClientSentAt.
              editDate: z.iso.datetime().nullable(),
            }),
          },
        },
        description: "Помеченное сообщение чата (рендер на лету, альбом учтён)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId, kind } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const [row] = await db
      .select({ stepMessages: projectItems.stepMessages })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .limit(1);
    const ref = row?.stepMessages?.[kind];
    if (!ref) return c.json({ messages: [], media: [], editDate: null });
    const client = await getOutreachWorkerClient({
      id: ref.accountId,
      workspaceId: wsId,
    });
    if (!client) return c.json({ messages: [], media: [], editDate: null });
    const msgs = await readTaggedMessages(client, ref);
    const media = mapCreativeMediaList(msgs);
    // edit_date (unix, 0 = не редактировалось) — макс по альбому.
    const maxEdit = msgs.reduce((acc, m) => {
      const e = (m as { edit_date?: number }).edit_date ?? 0;
      return e > acc ? e : acc;
    }, 0);
    const editDate = maxEdit > 0 ? new Date(maxEdit * 1000).toISOString() : null;
    return c.json({ messages: mapChannelHistoryItems(msgs), media, editDate });
  },
);

// Байты медиа помеченного сообщения (full-res превью у менеджера) — плейн-роут
// (бинарь). idx — индекс сообщения в альбоме; скачиваем on-demand, не храним.
app.get(
  "/v1/workspaces/:wsId/projects/:projectId/placements/:placementId/step-media/:kind/:idx",
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const projectId = c.req.param("projectId");
    const placementId = c.req.param("placementId");
    const kind = c.req.param("kind") as "contract" | "creative" | "act";
    const idx = Number(c.req.param("idx"));
    await assertProjectAccess(projectId, wsId, userId, role);
    const [row] = await db
      .select({ stepMessages: projectItems.stepMessages })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .limit(1);
    const ref = row?.stepMessages?.[kind];
    if (!ref) throw new HTTPException(404, { message: "not found" });
    const client = await getOutreachWorkerClient({
      id: ref.accountId,
      workspaceId: wsId,
    });
    if (!client) throw new HTTPException(404, { message: "not found" });
    return respondWithCreativeMedia(client, ref, idx);
  },
);

// Пометить сообщение чата как договор/креатив/акт (атомарный merge в jsonb —
// без read-modify-write, чтобы быстрые двойные пометки не затирали друг друга).
app.openapi(
  createRoute({
    method: "put",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
    tags: ["agency"],
    request: {
      params: StepKindParam,
      body: {
        content: { "application/json": { schema: TagBodySchema } },
        required: true,
      },
    },
    responses: { 204: { description: "Tagged" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId, kind } = c.req.valid("param");
    const ref = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);
    const patch = { [kind]: { ...ref, at: new Date().toISOString() } };
    const [row] = await db
      .update(projectItems)
      .set({
        stepMessages: sql`COALESCE(${projectItems.stepMessages}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        // Пометили креатив → он «на нашей проверке» (вертолёт). Делаем тем же
        // UPDATE, чтобы тег и статус не рассинхронились (атомарно, без отдельного
        // запроса с фронта). Не трогаем, если уже ушёл дальше (у клиента/одобрен).
        ...(kind === "creative" && {
          creativeStatus: sql`CASE WHEN ${projectItems.creativeStatus} IN ('none','awaiting') THEN 'internal_review'::placement_creative_status ELSE ${projectItems.creativeStatus} END`,
        }),
      })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (!row) throw new HTTPException(404, { message: "placement not found" });
    return c.body(null, 204);
  },
);

// Снять пометку (атомарно — удаляем ключ из jsonb).
app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
    tags: ["agency"],
    request: { params: StepKindParam },
    responses: { 204: { description: "Untagged" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId, kind } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const [row] = await db
      .update(projectItems)
      .set({ stepMessages: sql`${projectItems.stepMessages} - ${kind}` })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (!row) throw new HTTPException(404, { message: "placement not found" });
    return c.body(null, 204);
  },
);

// Вставка ссылки на пост: резолвим через TDLib, проверяем что пост в этом канале,
// снимаем снапшот СРАЗУ (текст+тамбнейл+метрики+id) — страховка, если блогер
// удалит пост до отчёта. Файлы не храним: full-res тянем on-demand пока пост жив.
const CapturePostBody = z
  .object({ url: z.string().min(1).max(500) })
  .openapi("CapturePost");
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/capture-post",
    tags: ["agency"],
    request: {
      params: PlacementParam,
      body: {
        content: { "application/json": { schema: CapturePostBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ snapshot: PostSnapshotSchema }) },
        },
        description: "Снимок поста снят и сохранён",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    const { url } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);
    const [row] = await db
      .select({
        externalId: channels.externalId,
        platform: channels.platform,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "placement not found" });

    // Провайдер-площадки (YouTube/TikTok): без TDLib — бьём по конкретному видео
    // напрямую. Парсинг id по платформе канала = проверка соответствия площадки
    // (не youtube-ссылка на youtube-канале → 422). Снимок отдаём сразу; точные
    // метрики позже снимет воркер (как у TG).
    if (row.platform && isProviderPlatform(row.platform)) {
      let post: Awaited<ReturnType<typeof fetchProviderPost>>;
      try {
        post = await fetchProviderPost(row.platform, url);
      } catch (e) {
        throw new HTTPException(422, {
          message: `Не похоже на пост ${row.platform}: ${errMsg(e)}`,
        });
      }
      // Сверяем автора видео с каналом — нельзя приклеить чужой пост. Fail-
      // closed: не можем подтвердить (канал не синкан → нет external_id, или
      // провайдер не отдал автора) — отказываем, а не пропускаем втихую.
      if (!row.externalId) {
        throw new HTTPException(422, {
          message:
            "Канал ещё не синхронизирован — откройте его карточку, чтобы подтянуть профиль, затем вставьте ссылку",
        });
      }
      if (post.metrics.authorExternalId !== row.externalId) {
        throw new HTTPException(422, {
          message: "Ссылка не из этого канала — проверьте, что пост вышел тут",
        });
      }
      // Дата выхода — сразу реальная из видео (не заглушка-now() в расчёте на
      // воркер): COALESCE бережёт уже проставленную/ручную, иначе real|now.
      const pubDate = post.metrics.publishedAt
        ? new Date(post.metrics.publishedAt)
        : null;
      await db
        .update(projectItems)
        .set({
          postUrl: post.effectiveUrl,
          publishedAt: pubDate
            ? sql`COALESCE(${projectItems.publishedAt}, ${pubDate})`
            : sql`COALESCE(${projectItems.publishedAt}, now())`,
          postSnapshot: post.snapshot,
        })
        .where(eq(projectItems.id, placementId));
      return c.json({ snapshot: post.snapshot });
    }

    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          eq(outreachAccounts.platform, "telegram"),
          eq(outreachAccounts.status, "active"),
        ),
      )
      .orderBy(outreachAccounts.createdAt)
      .limit(1);
    if (!acc) {
      throw new HTTPException(412, { message: "нет активного аккаунта Telegram" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
    const link = (await client.invoke({
      _: "getMessageLinkInfo",
      url,
    } as never)) as {
      chat_id?: number;
      message?: {
        id?: number;
        chat_id?: number;
        content?: TdContent;
        interaction_info?: {
          view_count?: number;
          forward_count?: number;
          reactions?: {
            reactions?: { type: { _: string; emoji?: string }; total_count: number }[];
          };
        };
      } | null;
    };
    const message = link.message;
    if (!message?.id) {
      throw new HTTPException(422, {
        message: "Пост недоступен (приватный канал, удалён или нет доступа)",
      });
    }
    const postChatId = Number(message.chat_id || link.chat_id);
    if (row.externalId && postChatId !== Number(row.externalId)) {
      throw new HTTPException(422, {
        message: "Ссылка не из этого канала — проверьте, что пост вышел тут",
      });
    }
    const snapshot = buildPostSnapshot({
      messageId: String(message.id),
      chatId: String(postChatId),
      content: message.content,
      info: message.interaction_info ?? null,
      capturedAt: new Date().toISOString(),
    });
    await db
      .update(projectItems)
      .set({
        postUrl: url,
        // первый раз — фиксируем время выхода; повторная вставка не перетирает.
        publishedAt: sql`COALESCE(${projectItems.publishedAt}, now())`,
        postSnapshot: snapshot,
      })
      .where(eq(projectItems.id, placementId));
    return c.json({ snapshot });
  },
);

export default app;
