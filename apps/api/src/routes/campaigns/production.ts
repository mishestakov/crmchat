// Продакшн размещения: помеченные сообщения чата (договор/креатив/акт) с
// рендером и медиа, вставка ссылки на пост со снапшотом (capture-post) и
// согласование креатива через Google-док (collect/freeze).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { channels, outreachAccounts, projectItems } from "../../db/schema.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import {
  fetchProviderPost,
  isProviderPlatform,
} from "../../lib/channel-providers/index.ts";
import { errMsg } from "../../lib/errors.ts";
import { getOutreachWorkerClient } from "../../lib/outreach-account-client.ts";
import {
  mapChannelHistoryItems,
  readTaggedMessages,
} from "../../lib/channel-history.ts";
import {
  buildPostSnapshot,
  type TdContent,
  CreativeMediaSchema,
  extractFormattedText,
  mapCreativeMediaList,
  PostSnapshotSchema,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
} from "../../lib/td-message.ts";
import { respondWithCreativeMedia } from "../../lib/creative-media-response.ts";
import { getDoc, batchUpdate, docPlainText } from "../../lib/google-docs.ts";
import { bodyChanged, rewriteRequests } from "../../lib/creative-doc.ts";
import {
  createDocInFolder,
  shareAnyoneCommenter,
  driveFolderId,
} from "../../lib/google-drive.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { MsgRefSchema, PlacementParam } from "./shared.ts";

// Тело пометки (PUT): то же, но без `at` — сервер ставит сам.
const TagBodySchema = MsgRefSchema.omit({ at: true });

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

// ===========================================================================
// ===========================================================================
// Согласование креативов через Google-док (пилот с агентством, «1 док = 1
// креатив»). «Собрать на согласование» авто-создаёт док в Общем диске агентства,
// пишет туда текст креатива и шарит клиенту; байер/клиент правят в Google;
// «Зафиксировать» читает док и по диффу решает судьбу креатива.
// ===========================================================================

const PlacementDocParam = z.object({
  wsId: z.string(),
  projectId: z.string(),
  placementId: z.string(),
});

// Читает текст помеченного креатива из TG (склейка альбома). "" если недоступно.
async function readCreativeText(
  wsId: string,
  ref: { chatId: string; messageId: string; albumId: string | null; accountId: string },
): Promise<string> {
  const client = await getOutreachWorkerClient({ id: ref.accountId, workspaceId: wsId });
  if (!client) return "";
  const msgs = await readTaggedMessages(client, ref);
  return msgs
    .map((m) => extractFormattedText(m.content as TdContent).text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

// «Собрать на согласование» / «Собрать следующую итерацию» — авто-создаёт (один
// раз) Google-док креатива, пишет туда текущий текст из TG, шарит клиенту,
// счётчик итераций +1, статус → client_review. Док переиспользуется между
// итерациями (история — через версии Google).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/collect",
    tags: ["agency"],
    request: { params: PlacementDocParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ url: z.string(), round: z.number().int() }),
          },
        },
        description: "Креатив залит в Google-док",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [p] = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        stepMessages: projectItems.stepMessages,
        creativeRound: projectItems.creativeRound,
        creativeDocId: projectItems.creativeDocId,
        creativeDocUrl: projectItems.creativeDocUrl,
      })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, placementId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!p) throw new HTTPException(404, { message: "placement not found" });

    const ref = p.stepMessages?.creative;
    if (!ref) {
      throw new HTTPException(422, {
        message: "Сначала пометьте сообщение блогера как «креатив»",
      });
    }
    const text = await readCreativeText(wsId, ref);
    if (!text) {
      throw new HTTPException(422, {
        message: "Не удалось прочитать текст креатива из TG",
      });
    }

    // Док создаём один раз, дальше переиспользуем. id/url персистим СРАЗУ после
    // создания — до записи текста: если batchUpdate упадёт, при повторе возьмём
    // тот же док, а не создадим сироту.
    let docId = p.creativeDocId;
    let url = p.creativeDocUrl;
    if (!docId) {
      const created = await createDocInFolder(
        `Креатив — @${p.username ?? "канал"}`,
        driveFolderId(),
      );
      docId = created.id;
      url = created.url;
      await db
        .update(projectItems)
        .set({ creativeDocId: docId, creativeDocUrl: url })
        .where(eq(projectItems.id, p.id));
      // Шаринг клиенту best-effort: политика организации может запрещать внешний
      // доступ — тогда байер расшарит вручную, док уже создан.
      try {
        await shareAnyoneCommenter(docId);
      } catch (e) {
        console.error(`[creative-doc] share failed:`, errMsg(e));
      }
    }
    if (!docId || !url) {
      throw new HTTPException(500, { message: "не удалось получить ссылку на док" });
    }

    const doc = await getDoc(docId);
    await batchUpdate(docId, rewriteRequests(doc, text));

    const round = (p.creativeRound || 0) + 1;
    await db
      .update(projectItems)
      .set({
        creativeDocText: text,
        creativeRound: round,
        creativeStatus: "client_review",
        // Момент «показали клиенту» → работает флаг editedAfterSent (блогер
        // переправил креатив после отправки).
        creativeClientSentAt: new Date(),
      })
      .where(eq(projectItems.id, p.id));

    return c.json({ url, round });
  },
);

// «Зафиксировать правки клиента» — читает док и диффает весь текст против
// базлайна. Не изменилось → approved (финал, байер шлёт go-сигнал). Изменилось →
// blogger_review, базлайн обновляем на финальный текст (его байер шлёт блогеру).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/freeze",
    tags: ["agency"],
    request: { params: PlacementDocParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              changed: z.boolean(),
              finalText: z.string(),
              contactId: z.string().nullable(),
              accountId: z.string().nullable(),
            }),
          },
        },
        description: "Результат диффа",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [p] = await db
      .select({
        id: projectItems.id,
        contactId: projectItems.contactId,
        stepMessages: projectItems.stepMessages,
        creativeDocId: projectItems.creativeDocId,
        creativeDocText: projectItems.creativeDocText,
      })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, placementId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!p) throw new HTTPException(404, { message: "placement not found" });
    if (!p.creativeDocId) {
      throw new HTTPException(422, {
        message: "Док не создан — сначала «Собрать на согласование»",
      });
    }

    const doc = await getDoc(p.creativeDocId);
    const text = docPlainText(doc);
    const changed = bodyChanged(text, p.creativeDocText ?? "");
    await db
      .update(projectItems)
      .set({
        creativeStatus: changed ? "blogger_review" : "approved",
        ...(changed && { creativeDocText: text }),
      })
      .where(eq(projectItems.id, p.id));

    return c.json({
      changed,
      finalText: text.trim(),
      contactId: p.contactId,
      accountId: p.stepMessages?.creative?.accountId ?? null,
    });
  },
);

export default app;
