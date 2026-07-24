// Финальный оффер «вы выбраны» одобренным блогерам шортлиста (разовая рассылка
// через worker) + постановка снятия метрик опубликованных постов (фаза «Отчёт»).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  channels,
  projectItems,
  projects,
  scheduledMessages,
} from "../../db/schema.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import {
  resolveStickyByTgUserIds,
  resolveProjectAccountIds,
  resolveSenderNames,
  channelIdentifier,
  FINAL_OFFER_MSG_IDX,
} from "../../lib/project-scheduling.ts";
import { substituteVariables } from "../../lib/substitute-variables.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsProjectParam } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

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
        contactId: projectItems.contactId,
        properties: projectItems.properties,
        // Для {{каналы}} в оффере: идентификатор канала (тот же helper, что в
        // опенере — TG → @username, провайдер → ссылка, иначе title).
        platform: channels.platform,
        channelUsername: channels.username,
        channelLink: channels.link,
        channelTitle: channels.title,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.clientStatus, "approved"),
          isNotNull(projectItems.shortlistedAt),
          // Отказавшихся (available=false) не оффереем и не перечисляем в
          // {{каналы}} — тот же гейт, что в опенере (этап 16.10). Иначе DM мог
          // бы рекламировать канал, от которого блогер уже отказался.
          sql`${projectItems.available} is distinct from false`,
          sql`(${projectItems.username} IS NOT NULL OR ${projectItems.tgUserId} IS NOT NULL)`,
        ),
      )
      // Детерминированный порядок каналов в {{каналы}} (как в опенере) —
      // «первый» канал не зависит от плана Postgres.
      .orderBy(asc(projectItems.createdAt));

    // Один DM на ПОЛУЧАТЕЛЯ, а не на канал. Идентичность получателя может быть
    // РАЗМАЗАНА по разным полям у сиблинг-каналов одного человека: у одного канала
    // админ привязан контактом (contactId+tgUserId), у другого — только tg_user_id,
    // доресолвленный воркером (contactId=null, см. outreach-worker). Ключ по одному
    // полю разнёс бы их и снова задублил DM. Объединяем по ЛЮБОМУ общему
    // идентификатору (contactId / tgUserId / @username) через union-find.
    // Компромисс: объединение по @username может СЛИТЬ двух разных людей, если
    // хэндл был переназначен (один item хранит устаревший @p, теперь принадлежащий
    // другому) — тогда один не получит DM. Это редкая аномалия данных; убрать
    // username из ключа вернуло бы дубли для «один канал резолвнут, другой только
    // по @username» (тот же человек), что хуже.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root)! !== root) root = parent.get(root)!;
      let cur = x; // сжатие пути
      while (cur !== root) {
        const nxt = parent.get(cur)!;
        parent.set(cur, root);
        cur = nxt;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const idsOf = (r: {
      id: string;
      contactId: string | null;
      tgUserId: string | null;
      username: string | null;
    }) => {
      const ids: string[] = [];
      if (r.contactId) ids.push(`c:${r.contactId}`);
      if (r.tgUserId) ids.push(`t:${r.tgUserId}`);
      if (r.username) ids.push(`u:${r.username.toLowerCase()}`);
      if (ids.length === 0) ids.push(`i:${r.id}`);
      return ids;
    };

    // Уже оповещённые получатели: sent/pending оффер у ЛЮБОГО их канала в проекте
    // (по человеку, не по item — иначе повторный «оповестить» задублит DM админу,
    // которому оффер ушёл через другой его канал).
    const offeredRows = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        tgUserId: projectItems.tgUserId,
        contactId: projectItems.contactId,
      })
      .from(scheduledMessages)
      .innerJoin(projectItems, eq(projectItems.id, scheduledMessages.itemId))
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
          inArray(scheduledMessages.status, ["sent", "pending"]),
        ),
      );

    // Регистрируем идентификаторы кандидатов и уже-оповещённых в ОДНОЙ структуре,
    // чтобы оффер и кандидат одного человека попали в одну группу.
    for (const r of [...offeredRows, ...rows]) {
      const ids = idsOf(r);
      for (let i = 1; i < ids.length; i++) union(ids[0]!, ids[i]!);
      find(ids[0]!);
    }
    const rootOf = (r: {
      id: string;
      contactId: string | null;
      tgUserId: string | null;
      username: string | null;
    }) => find(idsOf(r)[0]!);
    const offeredRoots = new Set(offeredRows.map(rootOf));

    // Группируем кандидатов по получателю; пропускаем уже оповещённых.
    const byRoot = new Map<string, typeof rows>();
    for (const r of rows) {
      const root = rootOf(r);
      if (offeredRoots.has(root)) continue;
      const g = byRoot.get(root);
      if (g) g.push(r);
      else byRoot.set(root, [r]);
    }
    if (byRoot.size === 0) {
      throw new HTTPException(400, {
        message: "Все одобренные блогеры уже оповещены",
      });
    }
    // Представитель группы — с tg_user_id (чтобы сохранить sticky-аккаунт того,
    // кто вёл переписку), иначе первый. Реальный DM — по одному на представителя.
    // idents — все каналы получателя в проекте (для {{каналы}} в тексте оффера);
    // порядок — как выбрал ORDER BY created_at выше.
    const targets = [...byRoot.values()].map((g) => ({
      rep: g.find((r) => r.tgUserId) ?? g[0]!,
      idents: g.map((r) =>
        channelIdentifier({
          platform: r.platform,
          username: r.channelUsername,
          title: r.channelTitle,
          link: r.channelLink,
        }).ident,
      ),
    }));

    // active-аккаунты проекта (round-robin) + sticky-continuity.
    const accountIds = await resolveProjectAccountIds(wsId, project);
    if (accountIds.length === 0) {
      throw new HTTPException(400, {
        message: "Нет активных Telegram-аккаунтов для рассылки",
      });
    }
    const tgUserIds = targets
      .map((t) => t.rep.tgUserId)
      .filter((x): x is string => x !== null);
    const sticky = await resolveStickyByTgUserIds(wsId, tgUserIds);
    // Имена отправителей пула — чтобы {{отправитель}} в оффере резолвился, а не
    // уезжал литералом (тот же резолвер, что и в опенере/пиналке).
    const senderNames = await resolveSenderNames(accountIds);

    let rr = 0;
    const now = new Date();
    const scheduled = targets.map(({ rep, idents }) => {
      const stickyAcc = rep.tgUserId ? sticky.get(rep.tgUserId) : undefined;
      // sticky берём только если аккаунт ещё активен; иначе round-robin.
      const accountId =
        stickyAcc && accountIds.includes(stickyAcc)
          ? stickyAcc
          : accountIds[rr++ % accountIds.length]!;
      return {
        workspaceId: wsId,
        projectId,
        itemId: rep.id,
        accountId,
        messageIdx: FINAL_OFFER_MSG_IDX,
        text: substituteVariables(text, {
          username: rep.username,
          // {{каналы}} = список всех каналов получателя (как в опенере). Кладём
          // поверх properties, чтобы плейсхолдер резолвился, а не уезжал литералом.
          properties: {
            ...(rep.properties as Record<string, string>),
            каналы: idents.join(", "),
          },
          senderName: senderNames.get(accountId) ?? null,
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
      // Штампуем только представителей (у них есть scheduled_message) — иначе у
      // сиблингов finalOfferSentAt противоречил бы finalOfferStatus='none'.
      await tx
        .update(projectItems)
        .set({ finalOfferSentAt: now })
        .where(
          inArray(
            projectItems.id,
            targets.map((t) => t.rep.id),
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

export default app;
