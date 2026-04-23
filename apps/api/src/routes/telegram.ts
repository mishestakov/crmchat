import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  properties as propsTable,
  telegramAccounts,
  telegramSyncConfigs,
  workspaces,
} from "../db/schema";
import {
  clearPendingClient,
  dropUserClient,
  getOrCreatePendingClient,
  getUserClient,
  persistSession,
} from "../lib/telegram-client";
import type { SessionVars } from "../middleware/require-session";

// Авторизация в Telegram через MTProto. State-машина по донор-флоу:
//   initial → (qr-poll | sendCode → signIn) → [signInWithPassword] → success
//
// gramjs предоставляет all-in-one методы (signInUser, signInUserWithQrCode) с
// async-callbacks, но они блокируются до ввода кода/QR-скана. Для stateless HTTP
// API этого мало — поэтому работаем низкоуровневыми Api.auth.* вызовами и
// держим один pending-клиент per userId между запросами (см. lib/telegram-client).

const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

// gramjs кидает Error с понятным `.message` (типа "PHONE_CODE_INVALID"); прочее
// бросает строкой. Универсальный extractor под match'инг по содержимому.
function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

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

const QrStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("scan-qr-code"), token: z.string() }),
  z.object({ status: z.literal("password_needed") }),
  z.object({ status: z.literal("success") }),
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
    // Свежий клиент: предыдущая попытка (если была) могла оставить устаревший
    // phoneCodeHash. Перезапускаем pending-сессию.
    await clearPendingClient(userId);
    const client = await getOrCreatePendingClient(userId);
    try {
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({}),
        }),
      );
      // Тип ответа: SentCode | SentCodeSuccess. Нас интересует только SentCode.
      if (!(result instanceof Api.auth.SentCode)) {
        throw new HTTPException(500, { message: "unexpected sendCode response" });
      }
      return c.json({
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.type instanceof Api.auth.SentCodeTypeApp,
      });
    } catch (e) {
      const msg = errMsg(e);
      throw new HTTPException(400, { message: msg });
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
    const { phoneNumber, phoneCode, phoneCodeHash } = c.req.valid("json");
    const client = await getOrCreatePendingClient(userId);
    try {
      const result = await client.invoke(
        new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode }),
      );
      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        return c.json({ status: "user_not_found" as const });
      }
      await afterSuccessfulAuth(userId, client);
      return c.json({ status: "sign_in_complete" as const });
    } catch (e) {
      const msg = errMsg(e);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        return c.json({ status: "password_needed" as const });
      }
      if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EXPIRED")) {
        return c.json({ status: "phone_code_invalid" as const });
      }
      throw new HTTPException(400, { message: msg });
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
    const client = await getOrCreatePendingClient(userId);
    try {
      // 2FA через SRP: тащим параметры с TG, считаем proof, отправляем check.
      const passwordParams = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordParams, password);
      const result = await client.invoke(
        new Api.auth.CheckPassword({ password: check }),
      );
      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new HTTPException(400, { message: "user not found" });
      }
      await afterSuccessfulAuth(userId, client);
      return c.json({ status: "sign_in_complete" as const });
    } catch (e) {
      const msg = errMsg(e);
      if (msg.includes("PASSWORD_HASH_INVALID")) {
        return c.json({ status: "password_invalid" as const });
      }
      throw new HTTPException(400, { message: msg });
    }
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/telegram/qr/state",
    tags: ["telegram"],
    responses: {
      200: {
        content: { "application/json": { schema: QrStateSchema } },
        description: "QR-login poll state",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const client = await getOrCreatePendingClient(userId);
    try {
      let result: unknown = await client.invoke(
        new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
      );

      // Migrate-loop: если scanned token принадлежит другому DC (типичный случай —
      // юзер на DC2, мы по умолчанию на DC4), сервер возвращает LoginTokenMigrateTo.
      // Переключаем pending-клиента на нужный DC и доимпортируем там же. После
      // ImportLoginToken прилетает уже LoginTokenSuccess с authorization.
      while (result instanceof Api.auth.LoginTokenMigrateTo) {
        // _switchDC — internal gramjs method; в типах не торчит, но работает.
        await (client as unknown as { _switchDC: (dc: number) => Promise<void> })
          ._switchDC(result.dcId);
        result = await client.invoke(
          new Api.auth.ImportLoginToken({ token: result.token }),
        );
      }

      if (result instanceof Api.auth.LoginTokenSuccess) {
        await afterSuccessfulAuth(userId, client);
        return c.json({ status: "success" as const });
      }
      if (result instanceof Api.auth.LoginToken) {
        // Ещё не сканировано — вернём текущий QR-token клиенту.
        const tokenB64 = Buffer.from(result.token).toString("base64url");
        return c.json({ status: "scan-qr-code" as const, token: tokenB64 });
      }
      throw new HTTPException(500, {
        message: `unexpected QR result: ${result?.constructor?.name}`,
      });
    } catch (e) {
      const msg = errMsg(e);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        return c.json({ status: "password_needed" as const });
      }
      console.error("[telegram/qr]", msg);
      throw new HTTPException(400, { message: msg });
    }
  },
);

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
  await persistSession(userId, client, {
    tgUserId: String(user.id),
    tgUsername: user.username ?? null,
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
      const fullName =
        [entity.firstName, entity.lastName].filter(Boolean).join(" ").trim() ||
        entity.username ||
        "Без имени";
      const properties: Record<string, unknown> = {
        tg_user_id: String(entity.id),
        full_name: fullName,
      };
      if (entity.username) properties.telegram_username = entity.username;
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
