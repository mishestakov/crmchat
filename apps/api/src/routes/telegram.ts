import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Api } from "telegram";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  properties as propsTable,
  telegramAccounts,
  telegramSyncConfigs,
  workspaces,
} from "../db/schema";
import { tryDecrypt } from "../lib/crypto";
import { errMsg } from "../lib/errors";
import { qrKey, streamQrState } from "../lib/qr-token-cache";
import {
  clearPendingClient,
  dropUserClient,
  getOrCreatePendingClient,
  getUserClient,
  persistSession,
} from "../lib/telegram-client";
import {
  type TgPendingHelpers,
  tgReadQrState,
  tgSendCode,
  tgSignIn,
  tgSignInPassword,
} from "../lib/tg-auth";
import type { SessionVars } from "../middleware/require-session";

// User-scoped TG-аккаунт (один на user) — для импорта папок-чатов в контакты.
// Auth-флоу делит реализацию с outreach-account auth через lib/tg-auth.

const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

const helpers = (userId: string): TgPendingHelpers => ({
  getPending: () => getOrCreatePendingClient(userId),
  clearPending: () => clearPendingClient(userId),
  cacheKey: qrKey.telegram(userId),
});

const TgUserSchema = z.object({
  tgUserId: z.string(),
  tgUsername: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  firstName: z.string().nullable(),
});

const StatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized"), user: TgUserSchema }),
  z.object({ status: z.literal("unauthorized") }),
]);

const SendCodeRespSchema = z.object({
  phoneCodeHash: z.string(),
  isCodeViaApp: z.boolean(),
});

const SignInRespSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sign_in_complete") }),
  z.object({ status: z.literal("password_needed") }),
  z.object({ status: z.literal("phone_code_invalid") }),
  z.object({ status: z.literal("user_not_found") }),
]);

const SignInPasswordRespSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sign_in_complete") }),
  z.object({ status: z.literal("password_invalid") }),
]);

const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/telegram/status",
    tags: ["telegram"],
    responses: {
      200: {
        content: { "application/json": { schema: StatusSchema } },
        description: "TG account status",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const [acc] = await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, userId))
      .limit(1);
    if (!acc) return c.json({ status: "unauthorized" as const });
    // Legacy plain или corrupted row → дропаем, юзер пере-залогинится.
    if (tryDecrypt(acc.session) === null) {
      await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
      return c.json({ status: "unauthorized" as const });
    }
    return c.json({
      status: "authorized" as const,
      user: {
        tgUserId: acc.tgUserId,
        tgUsername: acc.tgUsername,
        phoneNumber: acc.phoneNumber,
        firstName: acc.firstName,
      },
    });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/auth/send-code",
    tags: ["telegram"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ phoneNumber: z.string().min(5).max(32) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SendCodeRespSchema } },
        description: "Code sent",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { phoneNumber } = c.req.valid("json");
    try {
      return c.json(
        await tgSendCode(helpers(userId), apiId, apiHash, phoneNumber),
      );
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/auth/sign-in",
    tags: ["telegram"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              phoneNumber: z.string().min(5).max(32),
              phoneCode: z.string().min(1).max(16),
              phoneCodeHash: z.string().min(1),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SignInRespSchema } },
        description: "Sign-in result",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const args = c.req.valid("json");
    try {
      const r = await tgSignIn(helpers(userId), args);
      if (r.kind === "user_not_found")
        return c.json({ status: "user_not_found" as const });
      if (r.kind === "password_needed")
        return c.json({ status: "password_needed" as const });
      if (r.kind === "phone_code_invalid")
        return c.json({ status: "phone_code_invalid" as const });
      await afterSuccessfulAuth(userId, r.client);
      return c.json({ status: "sign_in_complete" as const });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/auth/sign-in-password",
    tags: ["telegram"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ password: z.string().min(1).max(256) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SignInPasswordRespSchema } },
        description: "Password check result",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { password } = c.req.valid("json");
    try {
      const r = await tgSignInPassword(helpers(userId), password);
      if (r.kind === "password_invalid")
        return c.json({ status: "password_invalid" as const });
      await afterSuccessfulAuth(userId, r.client);
      return c.json({ status: "sign_in_complete" as const });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.get("/v1/telegram/qr/stream", (c) => {
  const userId = c.get("userId");
  return streamQrState(
    c,
    qrKey.telegram(userId),
    async () => {
      const r = await tgReadQrState(helpers(userId), apiId, apiHash, async (client) => {
        await afterSuccessfulAuth(userId, client);
      });
      // Нормализуем к фронтовому shape: success без data.
      if (r.status === "success") return { status: "success" as const };
      return r;
    },
    (s) => s.status !== "scan-qr-code",
  );
});

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/sign-out",
    tags: ["telegram"],
    responses: { 204: { description: "Signed out" } },
  }),
  async (c) => {
    const userId = c.get("userId");
    await clearPendingClient(userId);
    await dropUserClient(userId);
    return c.body(null, 204);
  },
);

// Общая обработка успешной аутентификации: достаём профиль, сохраняем session,
// чистим pending. Игнорируем gramjs Authorization-объект и просто дёргаем getMe —
// результат стабильно типизирован, в отличие от пересекающихся namespace-ов
// Api.Authorization vs Api.auth.Authorization (TS сводит к never).
async function afterSuccessfulAuth(
  userId: string,
  client: import("telegram").TelegramClient,
) {
  const user = (await client.getMe()) as Api.User;
  // legacy `username` пустует у юзеров с новым multi-username — fallback на active.
  const tgUsername =
    user.username ||
    user.usernames?.find((u) => u.active)?.username ||
    null;
  await persistSession(userId, client, {
    tgUserId: String(user.id),
    tgUsername,
    phoneNumber: user.phone ?? null,
    firstName: user.firstName ?? null,
  });
  await clearPendingClient(userId);
}

// ─────────────────────── folders + sync ───────────────────────

const FolderSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  supported: z.boolean(),
});

const SyncConfigSchema = z.object({
  id: z.string(),
  folderId: z.number().int(),
  folderTitle: z.string(),
  workspaceId: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  lastSyncImported: z.number().int().nullable(),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/telegram/folders",
    tags: ["telegram"],
    responses: {
      200: {
        content: { "application/json": { schema: z.array(FolderSchema) } },
        description: "List of user TG folders",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const client = await getUserClient(userId);
    if (!client) {
      throw new HTTPException(400, { message: "telegram not connected" });
    }
    const result = await client.invoke(new Api.messages.GetDialogFilters());
    // Возможные элементы filters:
    //  - DialogFilter — обычная пользовательская папка
    //  - DialogFilterChatlist — расшаренная папка (другой access-model, не поддерживаем)
    //  - DialogFilterDefault — псевдо «Все чаты», не папка → скип
    //
    // «Динамические» папки (с wildcard-флагами contacts/nonContacts/groups/...)
    // помечаем supported=false и в UI они grayed-out. Иначе sync втянет всех
    // кому юзер когда-либо писал — сотни рандомов, спам, ботов поддержки.
    // Только static папки (только explicit includePeers) импортим — это
    // осознанный набор контактов.
    const folders: { id: number; title: string; supported: boolean }[] = [];
    for (const f of result.filters) {
      if (f instanceof Api.DialogFilter) {
        const hasWildcards = !!(
          f.contacts ||
          f.nonContacts ||
          f.groups ||
          f.broadcasts ||
          f.bots
        );
        folders.push({
          id: f.id,
          title: extractFilterTitle(f.title),
          supported: !hasWildcards,
        });
      } else if (f instanceof Api.DialogFilterChatlist) {
        folders.push({
          id: f.id,
          title: extractFilterTitle(f.title),
          supported: false,
        });
      }
    }
    return c.json(folders);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/telegram/sync-configs",
    tags: ["telegram"],
    responses: {
      200: {
        content: { "application/json": { schema: z.array(SyncConfigSchema) } },
        description: "Active sync configs",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const rows = await db
      .select()
      .from(telegramSyncConfigs)
      .where(eq(telegramSyncConfigs.userId, userId));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        folderId: Number(r.folderId),
        folderTitle: r.folderTitle,
        workspaceId: r.workspaceId,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        lastSyncImported: r.lastSyncImported,
      })),
    );
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/sync-configs",
    tags: ["telegram"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              folderId: z.number().int(),
              folderTitle: z.string().min(1),
              workspaceId: z.string().min(1).max(64),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: SyncConfigSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    // Workspace должна принадлежать юзеру — переиспользуем правило `createdBy`,
    // как в assertMember (сейчас единственная авторизация workspace'ов).
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, body.workspaceId),
          eq(workspaces.createdBy, userId),
        ),
      )
      .limit(1);
    if (!ws) throw new HTTPException(404, { message: "workspace not found" });

    const [row] = await db
      .insert(telegramSyncConfigs)
      .values({
        userId,
        folderId: String(body.folderId),
        folderTitle: body.folderTitle,
        workspaceId: body.workspaceId,
      })
      .onConflictDoUpdate({
        target: [telegramSyncConfigs.userId, telegramSyncConfigs.folderId],
        set: {
          folderTitle: body.folderTitle,
          workspaceId: body.workspaceId,
        },
      })
      .returning();

    // Fire-and-forget — sync уйдёт в фон, ответ возвращаем сразу. Юзер увидит
    // toast «синхронизация началась» и через ~неск.секунд lastSyncAt обновится.
    void runSync(userId, body.folderId, body.workspaceId).catch((e) => {
      console.error("[telegram/sync] background failed:", e);
    });

    return c.json(
      {
        id: row!.id,
        folderId: Number(row!.folderId),
        folderTitle: row!.folderTitle,
        workspaceId: row!.workspaceId,
        lastSyncAt: row!.lastSyncAt?.toISOString() ?? null,
        lastSyncImported: row!.lastSyncImported,
      },
      201,
    );
  },
);

// Manual re-sync уже-настроенной папки. Юзер хочет «обновить, вдруг там есть
// новые чаты». Авто-cron — отдельный шаг (background scheduler).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/telegram/sync-configs/{id}/sync",
    tags: ["telegram"],
    request: { params: z.object({ id: z.string().min(1).max(64) }) },
    responses: { 202: { description: "Sync started" } },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const [config] = await db
      .select()
      .from(telegramSyncConfigs)
      .where(
        and(
          eq(telegramSyncConfigs.id, id),
          eq(telegramSyncConfigs.userId, userId),
        ),
      )
      .limit(1);
    if (!config) throw new HTTPException(404, { message: "config not found" });

    // Сбрасываем lastSyncAt → UI поймёт что идёт sync (показывает spinner).
    await db
      .update(telegramSyncConfigs)
      .set({ lastSyncAt: null, lastSyncImported: null })
      .where(eq(telegramSyncConfigs.id, id));

    void runSync(userId, Number(config.folderId), config.workspaceId).catch(
      (e) => console.error("[telegram/sync] background failed:", e),
    );
    return c.body(null, 202);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/telegram/sync-configs/{id}",
    tags: ["telegram"],
    request: { params: z.object({ id: z.string().min(1).max(64) }) },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    await db
      .delete(telegramSyncConfigs)
      .where(
        and(
          eq(telegramSyncConfigs.id, id),
          eq(telegramSyncConfigs.userId, userId),
        ),
      );
    return c.body(null, 204);
  },
);

// Background sync: тянет все диалоги юзера, отфильтровывает соответствующие
// заданному folder (по правилам gramjs DialogFilter: includePeers/pinnedPeers
// + wildcard-флаги contacts/nonContacts/bots; minus excludePeers), upsert'ит
// User-контакты в workspace. Group/Channel диалоги игнорируем — мы импортим
// людей, а не чаты.
async function runSync(userId: string, folderId: number, workspaceId: string) {
  const client = await getUserClient(userId);
  if (!client) return;

  const result = await client.invoke(new Api.messages.GetDialogFilters());
  const filter = result.filters.find(
    (f): f is Api.DialogFilter =>
      f instanceof Api.DialogFilter && f.id === folderId,
  );
  if (!filter) {
    await markSynced(userId, folderId, 0);
    return;
  }

  // Set ключей user-id для O(1) лукапа — peers могут быть InputPeerUser /
  // InputPeerChat / InputPeerChannel; нас интересуют только User.
  const userIdsFrom = (peers: readonly Api.TypeInputPeer[]): Set<string> => {
    const out = new Set<string>();
    for (const p of peers) {
      if (p instanceof Api.InputPeerUser) out.add(String(p.userId));
    }
    return out;
  };
  const includeUsers = userIdsFrom(filter.includePeers);
  const pinnedUsers = userIdsFrom(filter.pinnedPeers);
  const excludeUsers = userIdsFrom(filter.excludePeers);

  // limit=500 — для большинства юзеров достаточно, дальше пагинация TODO.
  const dialogs = await client.getDialogs({ limit: 500 });

  // Дефолтный stage для нового контакта — first option preset-property `stage`.
  const [stageProp] = await db
    .select()
    .from(propsTable)
    .where(
      and(
        eq(propsTable.workspaceId, workspaceId),
        eq(propsTable.key, "stage"),
      ),
    )
    .limit(1);
  const defaultStageId = stageProp?.values?.[0]?.id;

  // Pass 1: фильтруем диалоги по правилам без обращения к БД.
  const candidates: Api.User[] = [];
  for (const d of dialogs) {
    const entity = d.entity;
    if (!(entity instanceof Api.User)) continue;
    if (entity.deleted || entity.bot) continue;

    const tgUserId = String(entity.id);
    if (excludeUsers.has(tgUserId)) continue;

    // Подходит ли диалог под фильтр: явное включение || pinned || wildcard по типу.
    // Боты уже отсечены выше — даже если папка включает botс, мы их не импортим.
    let matches = includeUsers.has(tgUserId) || pinnedUsers.has(tgUserId);
    if (!matches) {
      if (entity.contact) matches = !!filter.contacts;
      else matches = !!filter.nonContacts;
    }
    if (matches) candidates.push(entity);
  }

  if (candidates.length === 0) {
    await markSynced(userId, folderId, 0);
    return;
  }

  // Pass 2: один батч-SELECT для дедупа (вместо N+1).
  const candidateIds = candidates.map((u) => String(u.id));
  const existingRows = await db
    .select({
      tgUserId: sql<string>`${contacts.properties}->>'tg_user_id'`,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        sql`${contacts.properties}->>'tg_user_id' = ANY(${candidateIds}::text[])`,
      ),
    );
  const existingSet = new Set(existingRows.map((r) => r.tgUserId));

  // Pass 3: батч-INSERT новых.
  const toInsert = candidates
    .filter((u) => !existingSet.has(String(u.id)))
    .map((entity) => {
      // У TG двойная модель username: legacy `username` (string) + новый
      // `usernames[]` (с флагами active/editable). У юзеров с новым multi-username
      // legacy поле бывает пустым → берём active из массива как fallback.
      const username =
        entity.username ||
        entity.usernames?.find((u) => u.active)?.username ||
        null;
      const fullName =
        [entity.firstName, entity.lastName].filter(Boolean).join(" ").trim() ||
        username ||
        "Без имени";
      const properties: Record<string, unknown> = {
        tg_user_id: String(entity.id),
        full_name: fullName,
      };
      if (username) properties.telegram_username = username;
      if (entity.phone) properties.phone = `+${entity.phone}`;
      if (defaultStageId) properties.stage = defaultStageId;
      return { workspaceId, properties, createdBy: userId };
    });

  if (toInsert.length > 0) {
    await db.insert(contacts).values(toInsert);
  }

  await markSynced(userId, folderId, toInsert.length);
}

async function markSynced(
  userId: string,
  folderId: number,
  imported: number,
) {
  await db
    .update(telegramSyncConfigs)
    .set({ lastSyncAt: new Date(), lastSyncImported: imported })
    .where(
      and(
        eq(telegramSyncConfigs.userId, userId),
        eq(telegramSyncConfigs.folderId, String(folderId)),
      ),
    );
}

// gramjs возвращает title как `TextWithEntities { text, entities }` для DialogFilter.title
// (раньше был просто string). Приводим к строке.
function extractFilterTitle(title: unknown): string {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "text" in title) {
    return String((title as { text: string }).text);
  }
  return "Без названия";
}

export default app;
