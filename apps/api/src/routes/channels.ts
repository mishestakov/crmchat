import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Channel,
  ChannelSchema as BaseChannelSchema,
  CreateChannelSchema as BaseCreateChannel,
  ImportChannelsSchema as BaseImportChannels,
  ImportChannelsResultSchema as BaseImportResult,
} from "@repo/core";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  tgUsers,
} from "../db/schema.ts";
import {
  assertChannelAccess,
  channelAccessClause,
} from "../lib/channels-access.ts";
import { contactAccessClause } from "../lib/contacts-access.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

const ChannelSchema = BaseChannelSchema.openapi("Channel");
const CreateChannelSchema = BaseCreateChannel.openapi("CreateChannel");
const ImportChannelsSchema = BaseImportChannels.openapi("ImportChannels");
const ImportChannelsResultSchema = BaseImportResult.openapi(
  "ImportChannelsResult",
);

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
});
const WsIdContactParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
});

const AddAdminsBody = z.object({
  contactIds: z.array(z.string().min(1).max(64)).min(1).max(50),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ChannelSchema) } },
        description: "Channels with admins",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const rows = await db
      .select()
      .from(channels)
      .where(channelAccessClause(wsId, userId, role))
      .orderBy(sql`${channels.createdAt} desc`);
    return c.json(await joinAdmins(rows));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateChannelSchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [created] = await db
      .insert(channels)
      .values({
        workspaceId: wsId,
        title: body.title,
        link: body.link ?? null,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: "insert failed" });

    if (body.adminContactIds?.length) {
      await db
        .insert(channelAdmins)
        .values(
          body.adminContactIds.map((contactId) => ({
            channelId: created.id,
            contactId,
          })),
        )
        .onConflictDoNothing();
    }

    const [serialized] = await joinAdmins([created]);
    return c.json(serialized!, 201);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    await db
      .delete(channels)
      .where(and(eq(channels.id, id), eq(channels.workspaceId, wsId)));
    return c.body(null, 204);
  },
);

// Привязка контакт↔канал постфактум: каналы могли прийти из CSV без
// админов, а контакты автоподтянуться позже из живого трафика — нужен
// способ связать руками. Возвращает обновлённый channel (с актуальным
// admins[]) — фронт сразу патчит cache.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: { content: { "application/json": { schema: AddAdminsBody } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Admins added",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { contactIds } = c.req.valid("json");

    const channel = await assertChannelAccess(id, wsId, userId, role);

    // Проверяем, что все contactIds доступны юзеру (а не просто принадлежат
    // workspace'у): member не должен прилинковать к каналу контакт коллеги,
    // которого сам видеть не вправе.
    const valid = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          contactAccessClause(wsId, userId, role),
          inArray(contacts.id, contactIds),
        ),
      );
    if (valid.length !== contactIds.length) {
      throw new HTTPException(400, {
        message: "some contacts are not accessible",
      });
    }

    await db
      .insert(channelAdmins)
      .values(contactIds.map((contactId) => ({ channelId: id, contactId })))
      .onConflictDoNothing();

    const [serialized] = await joinAdmins([channel]);
    return c.json(serialized!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
    tags: ["channels"],
    request: { params: WsIdContactParam },
    responses: { 204: { description: "Admin removed" } },
  }),
  async (c) => {
    const { wsId, id, contactId } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    // Канал должен быть доступен этому юзеру (без проверки можно было бы
    // дёрнуть DELETE по подобранному channelId, в том числе чужому).
    await assertChannelAccess(id, wsId, userId, role);
    await db
      .delete(channelAdmins)
      .where(
        and(
          eq(channelAdmins.channelId, id),
          eq(channelAdmins.contactId, contactId),
        ),
      );
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/import",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: ImportChannelsSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ImportChannelsResultSchema } },
        description: "Import result",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const { rows } = c.req.valid("json");

    let skippedNoUrl = 0;
    let adminContactsCreated = 0;
    let adminContactsRecognized = 0;

    // Дедуп админов по lower(username) — один человек в нескольких строках
    // CSV = один stub-контакт.
    const uniqueAdminUsernames = new Set<string>();
    for (const r of rows) {
      const u = r.admin_username?.trim().replace(/^@/, "").toLowerCase();
      if (u) uniqueAdminUsernames.add(u);
    }

    // Разрешаем админов: contact в воркспейсе → tg_users replica → stub.
    const usernameToContactId = new Map<string, string>();
    if (uniqueAdminUsernames.size > 0) {
      const usernames = [...uniqueAdminUsernames];
      const existing = await db
        .select({
          id: contacts.id,
          username: sql<string>`lower(${contacts.properties}->>'telegram_username')`,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(
              sql`lower(${contacts.properties}->>'telegram_username')`,
              usernames,
            ),
          ),
        );
      for (const e of existing) {
        if (e.username) usernameToContactId.set(e.username, e.id);
      }

      const missing = usernames.filter((u) => !usernameToContactId.has(u));
      if (missing.length > 0) {
        // Smart-stub: смотрим в replica подключённых аккаунтов. Те, кого
        // хоть один аккаунт «видел», получают полноценную карточку с
        // tg_user_id — sticky-резолвер сразу подхватит при создании задачи.
        const known = await db
          .select({
            userId: tgUsers.userId,
            username: sql<string>`lower(${tgUsers.username})`,
            fullName: tgUsers.fullName,
          })
          .from(tgUsers)
          .where(
            and(
              eq(tgUsers.isDeleted, false),
              inArray(sql`lower(${tgUsers.username})`, missing),
            ),
          );
        const knownByUsername = new Map(known.map((k) => [k.username, k]));

        const stubInserts = missing.map((u) => {
          const k = knownByUsername.get(u);
          const props: Record<string, unknown> = {
            telegram_username: u,
            full_name: k?.fullName || `@${u}`,
          };
          if (k?.userId) props.tg_user_id = k.userId;
          if (k) adminContactsRecognized++;
          return {
            workspaceId: wsId,
            properties: props,
            createdBy: userId,
          };
        });

        const inserted = await db
          .insert(contacts)
          .values(stubInserts)
          .onConflictDoNothing()
          .returning({
            id: contacts.id,
            username: sql<string>`lower(${contacts.properties}->>'telegram_username')`,
          });
        for (const ins of inserted) {
          if (ins.username) usernameToContactId.set(ins.username, ins.id);
        }
        adminContactsCreated += inserted.length;

        // ON CONFLICT мог проглотить кого-то (race с параллельным импортом),
        // дочитаем оставшихся.
        const stillMissing = missing.filter((u) => !usernameToContactId.has(u));
        if (stillMissing.length > 0) {
          const reread = await db
            .select({
              id: contacts.id,
              username: sql<string>`lower(${contacts.properties}->>'telegram_username')`,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, wsId),
                inArray(
                  sql`lower(${contacts.properties}->>'telegram_username')`,
                  stillMissing,
                ),
              ),
            );
          for (const r of reread) {
            if (r.username) usernameToContactId.set(r.username, r.id);
          }
        }
      }
    }

    // Дедуп по lower(link) внутри батча: одна строка в CSV = одна попытка
    // upsert'а; повторяющиеся ссылки сливаются в одну операцию.
    const byLowerLink = new Map<
      string,
      { link: string; title: string; adminUsername: string | null }
    >();
    for (const r of rows) {
      const link = r.channel_url?.trim();
      if (!link) {
        skippedNoUrl++;
        continue;
      }
      const lowerLink = link.toLowerCase();
      const adminUsername =
        r.admin_username?.trim().replace(/^@/, "").toLowerCase() || null;
      const existing = byLowerLink.get(lowerLink);
      if (existing) {
        // Если в нескольких строках разные admin'ы для одного канала —
        // они оба прилинкуются ниже через allChannelAdminLinks.
        if (adminUsername && !existing.adminUsername) {
          existing.adminUsername = adminUsername;
        }
        continue;
      }
      byLowerLink.set(lowerLink, {
        link,
        title: r.title?.trim() || deriveTitle(link),
        adminUsername,
      });
    }

    const lowerLinks = [...byLowerLink.keys()];
    const existingChannels = lowerLinks.length
      ? await db
          .select({
            id: channels.id,
            lowerLink: sql<string>`lower(${channels.link})`,
          })
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, wsId),
              inArray(sql`lower(${channels.link})`, lowerLinks),
            ),
          )
      : [];
    const existingIdByLower = new Map(
      existingChannels.map((e) => [e.lowerLink, e.id]),
    );

    const toInsert: (typeof channels.$inferInsert)[] = [];
    const toUpdate: { id: string; title: string }[] = [];
    for (const [lowerLink, row] of byLowerLink) {
      const existingId = existingIdByLower.get(lowerLink);
      if (existingId) {
        toUpdate.push({ id: existingId, title: row.title });
      } else {
        toInsert.push({
          workspaceId: wsId,
          title: row.title,
          link: row.link,
          createdBy: userId,
        });
      }
    }

    let channelsCreated = 0;
    let channelsUpdated = 0;
    const idByLower = new Map(existingIdByLower);
    if (toInsert.length > 0) {
      const inserted = await db
        .insert(channels)
        .values(toInsert)
        .returning({
          id: channels.id,
          lowerLink: sql<string>`lower(${channels.link})`,
        });
      for (const ins of inserted) {
        if (ins.lowerLink) idByLower.set(ins.lowerLink, ins.id);
      }
      channelsCreated = inserted.length;
    }
    for (const u of toUpdate) {
      await db
        .update(channels)
        .set({ title: u.title, updatedAt: new Date() })
        .where(eq(channels.id, u.id));
    }
    channelsUpdated = toUpdate.length;

    const allChannelAdminLinks: { channelId: string; contactId: string }[] = [];
    for (const [lowerLink, row] of byLowerLink) {
      if (!row.adminUsername) continue;
      const channelId = idByLower.get(lowerLink);
      const contactId = usernameToContactId.get(row.adminUsername);
      if (channelId && contactId) {
        allChannelAdminLinks.push({ channelId, contactId });
      }
    }

    if (allChannelAdminLinks.length > 0) {
      await db
        .insert(channelAdmins)
        .values(allChannelAdminLinks)
        .onConflictDoNothing();
    }

    return c.json({
      channelsCreated,
      channelsUpdated,
      adminContactsCreated,
      adminContactsRecognized,
      skippedNoUrl,
    });
  },
);

// Достраивает Channel объекты массивом admins (с минимальными полями для
// рендера колонки «админ» и «закреплён за»).
async function joinAdmins(
  rows: (typeof channels.$inferSelect)[],
): Promise<Channel[]> {
  if (rows.length === 0) return [];
  const channelIds = rows.map((r) => r.id);
  const adminRows = await db
    .select({
      channelId: channelAdmins.channelId,
      contactId: contacts.id,
      properties: contacts.properties,
      primaryAccountId: contacts.primaryAccountId,
    })
    .from(channelAdmins)
    .innerJoin(contacts, eq(channelAdmins.contactId, contacts.id))
    .where(inArray(channelAdmins.channelId, channelIds));

  const byChannel = new Map<
    string,
    {
      contactId: string;
      fullName: string | null;
      telegramUsername: string | null;
      primaryAccountId: string | null;
    }[]
  >();
  for (const a of adminRows) {
    const props = a.properties as Record<string, unknown>;
    const list = byChannel.get(a.channelId) ?? [];
    list.push({
      contactId: a.contactId,
      fullName:
        typeof props.full_name === "string" ? props.full_name : null,
      telegramUsername:
        typeof props.telegram_username === "string"
          ? props.telegram_username
          : null,
      primaryAccountId: a.primaryAccountId,
    });
    byChannel.set(a.channelId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    tgChatId: r.tgChatId,
    title: r.title,
    link: r.link,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    properties: r.properties,
    admins: byChannel.get(r.id) ?? [],
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

// Берём последний сегмент пути или @-имя как заголовок если CSV его не дал.
// Юзер потом отредактирует — это плейсхолдер, не финальное имя.
function deriveTitle(link: string): string {
  const cleaned = link.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (cleaned.startsWith("t.me/")) return "@" + cleaned.slice("t.me/".length);
  if (cleaned.startsWith("@")) return cleaned;
  return cleaned;
}

export default app;
