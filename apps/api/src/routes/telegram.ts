import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  properties as propsTable,
  telegramAccounts,
  telegramSyncConfigs,
  workspaceMembers,
} from "../db/schema";
import { errMsg } from "../lib/errors";
import {
  awaitChatFolders,
  clearPendingPersonalClient,
  dropPersonalClient,
  getOrCreatePendingPersonalClient,
  getPersonalChatFoldersCache,
  getPersonalClient,
  persistPersonalAccount,
} from "../lib/personal-account-client";
import {
  extractActiveUsername,
  streamAuthState,
  tdRequestQr,
  tdSendCode,
  tdSignInCode,
  tdSignInPassword,
  type AuthState,
  type TdUser,
} from "../lib/tdlib";
import type { SessionVars } from "../middleware/require-session";

// User-scoped TG-аккаунт (один на user) — для импорта папок-чатов в контакты.
// Auth-флоу делит реализацию с outreach-account через TDLib pending-store
// (отдельно per userId).

const TgUserSchema = z
  .object({
    tgUserId: z.string(),
    tgUsername: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    firstName: z.string().nullable(),
  })
  .openapi("TelegramUser");

const StatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized"), user: TgUserSchema }),
  z.object({ status: z.literal("unauthorized") }),
]);

const SendCodeRespSchema = z.object({
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
      await clearPendingPersonalClient(userId);
      const pending = await getOrCreatePendingPersonalClient(userId);
      return c.json(await tdSendCode(pending, phoneNumber));
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
              phoneCode: z.string().min(1).max(16),
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
    const { phoneCode } = c.req.valid("json");
    try {
      const pending = await getOrCreatePendingPersonalClient(userId);
      const r = await tdSignInCode(pending, phoneCode);
      if (r.kind === "user_not_found")
        return c.json({ status: "user_not_found" as const });
      if (r.kind === "password_needed")
        return c.json({ status: "password_needed" as const });
      if (r.kind === "phone_code_invalid")
        return c.json({ status: "phone_code_invalid" as const });
      await persistPersonalAccount(userId, pending);
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
      const pending = await getOrCreatePendingPersonalClient(userId);
      const r = await tdSignInPassword(pending, password);
      if (r.kind === "password_invalid")
        return c.json({ status: "password_invalid" as const });
      await persistPersonalAccount(userId, pending);
      return c.json({ status: "sign_in_complete" as const });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.get("/v1/telegram/qr/stream", async (c) => {
  const userId = c.get("userId");
  await clearPendingPersonalClient(userId);
  const pending = await getOrCreatePendingPersonalClient(userId);
  await tdRequestQr(pending);

  type QrState =
    | { status: "scan-qr-code"; token: string }
    | { status: "password_needed" }
    | { status: "success" }
    | { status: "error"; message: string };

  let persisted = false;
  let errored: string | null = null;

  const read = async (): Promise<QrState> => {
    if (persisted) return { status: "success" };
    if (errored) return { status: "error", message: errored };
    const s: AuthState = pending.authBus.current();
    if (s.kind === "wait_qr") return { status: "scan-qr-code", token: s.link };
    if (s.kind === "wait_password") return { status: "password_needed" };
    if (s.kind === "ready") {
      try {
        await persistPersonalAccount(userId, pending);
        persisted = true;
        return { status: "success" };
      } catch (e) {
        errored = errMsg(e);
        return { status: "error", message: errored };
      }
    }
    return { status: "scan-qr-code", token: "" };
  };

  return streamAuthState(c, pending.authBus, read, (s) => {
    return s.status === "success" || s.status === "password_needed" || s.status === "error";
  });
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
    await clearPendingPersonalClient(userId);
    await dropPersonalClient(userId);
    return c.body(null, 204);
  },
);

// ─────────────────────── folders + sync ───────────────────────

const FolderSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    supported: z.boolean(),
  })
  .openapi("TelegramFolder");

const SyncConfigSchema = z
  .object({
    id: z.string(),
    folderId: z.number().int(),
    folderTitle: z.string(),
    workspaceId: z.string(),
    lastSyncAt: z.iso.datetime().nullable(),
    lastSyncImported: z.number().int().nullable(),
  })
  .openapi("TelegramSyncConfig");

import type { TdChatFolderInfo } from "../lib/personal-account-client";

// chatFolder (td_api.tl:3172) — полный объект, который возвращает getChatFolder.
type TdChatFolder = {
  name: { text: { text: string } };
  included_chat_ids: number[];
  excluded_chat_ids: number[];
  pinned_chat_ids: number[];
  include_contacts: boolean;
  include_non_contacts: boolean;
  include_groups: boolean;
  include_channels: boolean;
  include_bots: boolean;
};

type TdChat = {
  id: number;
  type:
    | { _: "chatTypePrivate"; user_id: number }
    | { _: "chatTypeBasicGroup" | "chatTypeSupergroup" | "chatTypeSecret"; [k: string]: unknown };
};

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
    const client = await getPersonalClient(userId);
    if (!client) {
      throw new HTTPException(400, { message: "telegram not connected" });
    }
    // RPC `getChatFolders` нет в TDLib master — список доставляется push'ем
    // через updateChatFolders. Listener в personal-account-client кэширует
    // последний апдейт; ждём его до 10s, если ещё не пришёл (аккаунт только
    // что поднялся, TDLib инициализируется).
    const cache = getPersonalChatFoldersCache(userId);
    if (!cache) {
      throw new HTTPException(400, { message: "telegram not connected" });
    }
    let chatFolders: TdChatFolderInfo[];
    try {
      chatFolders = await awaitChatFolders(cache, 10_000);
    } catch {
      throw new HTTPException(503, {
        message: "chat folders not yet available, retry in a moment",
      });
    }

    // Каждая folder через getChatFolder — full фильтр-объект с wildcard-флагами.
    // «Динамические» папки (любой include_* wildcard) помечаем supported=false:
    // sync втянул бы всех, кому юзер когда-либо писал, плюс ботов. Только static
    // папки (только explicit included_chat_ids) импортим.
    const out: { id: number; title: string; supported: boolean }[] = [];
    for (const f of chatFolders) {
      const full = (await client
        .invoke({ _: "getChatFolder", chat_folder_id: f.id } as never)
        .catch(() => null)) as TdChatFolder | null;
      const title = extractFolderTitle(f);
      if (!full) {
        out.push({ id: f.id, title, supported: false });
        continue;
      }
      const hasWildcards =
        full.include_contacts ||
        full.include_non_contacts ||
        full.include_groups ||
        full.include_channels ||
        full.include_bots;
      const isShareable = f.is_shareable || f.has_my_invite_links;
      out.push({
        id: f.id,
        title,
        supported: !hasWildcards && !isShareable,
      });
    }
    return c.json(out);
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
    const [member] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, body.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) throw new HTTPException(404, { message: "workspace not found" });

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

// Background sync: тащим chat_id'ы из конкретной папки через TDLib, фильтруем
// до приватных DM с user'ами (не группы/каналы/боты), upsert'им в contacts.
async function runSync(
  userId: string,
  folderId: number,
  workspaceId: string,
): Promise<void> {
  const client = await getPersonalClient(userId);
  if (!client) return;

  const folder = (await client
    .invoke({ _: "getChatFolder", chat_folder_id: folderId } as never)
    .catch(() => null)) as TdChatFolder | null;
  if (!folder) {
    await markSynced(userId, folderId, 0);
    return;
  }

  const includeIds = new Set<number>([
    ...folder.included_chat_ids,
    ...folder.pinned_chat_ids,
  ]);
  const excludeIds = new Set<number>(folder.excluded_chat_ids);

  // Фильтруем до private DM — для каждой включённой chat_id getChat и проверяем
  // type. Параллелим фиксированными чанками: на 100+ чатах вереница getChat
  // занимает секунды; concurrency=10 даёт компромисс между скоростью и
  // FloodWait-риском.
  const chatIds = [...includeIds].filter((id) => !excludeIds.has(id));
  const userIds: number[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < chatIds.length; i += CONCURRENCY) {
    const batch = chatIds.slice(i, i + CONCURRENCY);
    const chats = await Promise.all(
      batch.map((id) =>
        (client.invoke({ _: "getChat", chat_id: id } as never) as Promise<TdChat>).catch(
          () => null,
        ),
      ),
    );
    for (const chat of chats) {
      if (!chat) continue;
      if (chat.type._ === "chatTypePrivate") {
        userIds.push(chat.type.user_id);
      }
    }
  }

  if (userIds.length === 0) {
    await markSynced(userId, folderId, 0);
    return;
  }

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

  // Дедуп по существующим contact'ам — один пакетный SELECT.
  const candidateIds = userIds.map(String);
  const tgUserIdExpr = sql<string>`${contacts.properties}->>'tg_user_id'`;
  const existingRows = await db
    .select({ tgUserId: tgUserIdExpr })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        inArray(tgUserIdExpr, candidateIds),
      ),
    );
  const existingSet = new Set(existingRows.map((r) => r.tgUserId));

  // getUser per новый id — получаем имя/username/phone. Боты и удалённые —
  // отсеиваем.
  const newUserIds = userIds.filter((id) => !existingSet.has(String(id)));
  const toInsert: Array<{
    workspaceId: string;
    properties: Record<string, unknown>;
    createdBy: string;
  }> = [];
  for (let i = 0; i < newUserIds.length; i += CONCURRENCY) {
    const batch = newUserIds.slice(i, i + CONCURRENCY);
    const users = await Promise.all(
      batch.map((uid) =>
        (
          client.invoke({ _: "getUser", user_id: uid } as never) as Promise<TdUser>
        ).catch(() => null),
      ),
    );
    for (let j = 0; j < users.length; j++) {
      const user = users[j];
      if (!user) continue;
      if (user.type?._ === "userTypeBot" || user.type?._ === "userTypeDeleted") {
        continue;
      }
      const username = extractActiveUsername(user);
      const fullName =
        [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
        username ||
        "Без имени";
      const properties: Record<string, unknown> = {
        tg_user_id: String(batch[j]),
        full_name: fullName,
      };
      if (username) properties.telegram_username = username;
      if (user.phone_number) properties.phone = `+${user.phone_number}`;
      if (defaultStageId) properties.stage = defaultStageId;
      toInsert.push({ workspaceId, properties, createdBy: userId });
    }
  }

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

// chatFolderInfo.name (td_api.tl:3181) = chatFolderName (td_api.tl:3154):
//   chatFolderName text:formattedText animate_custom_emoji:Bool
//   formattedText  text:string entities:vector<textEntity>
// Все три поля required по TL — папка без названия невозможна, нет fallback.
function extractFolderTitle(folder: { name: { text: { text: string } } }): string {
  return folder.name.text.text;
}

export default app;
