import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { outreachAccounts } from "../db/schema.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { stickerThumbFileId, type TdStickerRaw } from "../lib/td-message.ts";
import type { TdClient } from "../lib/tdlib/index.ts";
import { errMsg } from "../lib/errors.ts";
import type { WorkspaceVars } from "../middleware/assert-member.ts";

// Наборы стикеров/эмодзи аккаунта для пикера в чате (T3.5, MVP). Ничего не
// устанавливаем из CRM — отдаём то, что юзер сам добавил на аккаунт в
// Telegram (getInstalledStickerSets). Эмодзи-наборы (custom emoji) — только
// для premium-аккаунтов: по td_api.tl отправка custom emoji доступна только
// Telegram Premium, без него вкладку не показываем вовсе.
// Превью — статичные thumbnail'ы, байты фронт тянет существующим chat-file.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const AccountQuery = z.object({ accountId: z.string().min(1).max(64) });

const StickerSetInfoSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: z.enum(["sticker", "emoji"]),
  })
  .openapi("StickerSetInfo");

const PickerStickerSchema = z
  .object({
    // remote file id — им же отправляем (inputFileRemote в quick-send).
    remoteId: z.string(),
    // null = у анимированного стикера нет статичного превью; пикер рисует emoji.
    thumbFileId: z.number().int().nullable(),
    emoji: z.string(),
    // Для эмодзи-наборов: id custom emoji (textEntityTypeCustomEmoji).
    customEmojiId: z.string().nullable(),
  })
  .openapi("PickerSticker");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

async function resolveAccountClient(wsId: string, accountId: string) {
  const [acc] = await db
    .select({ hasPremium: outreachAccounts.hasPremium })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, wsId),
      ),
    )
    .limit(1);
  if (!acc) throw new HTTPException(404, { message: "account not found" });
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) {
    throw new HTTPException(503, { message: "tg client unavailable" });
  }
  return { acc, client };
}

type TdStickerSetInfo = { id: number | string; title: string };

const fetchInstalledSets = (client: TdClient, type: string) =>
  client.invoke({
    _: "getInstalledStickerSets",
    sticker_type: { _: type },
  } as never) as Promise<{ sets: TdStickerSetInfo[] }>;

// TDLib sticker[] → shape пикера (remoteId для отправки + статичное превью).
// Дедуп по remoteId: getStickers при непустом запросе подмешивает избранное
// и trending — один стикер может прийти дважды.
function mapPickerStickers(raw: TdStickerRaw[]) {
  const seen = new Set<string>();
  return raw
    .map((s) => {
      const remoteId = s.sticker?.remote?.id;
      if (!remoteId) return null;
      return {
        remoteId,
        thumbFileId: stickerThumbFileId(s),
        emoji: s.emoji ?? "",
        customEmojiId:
          s.full_type?._ === "stickerFullTypeCustomEmoji" &&
          s.full_type.custom_emoji_id != null
            ? String(s.full_type.custom_emoji_id)
            : null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => {
      if (!s || seen.has(s.remoteId)) return false;
      seen.add(s.remoteId);
      return true;
    });
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/sticker-sets",
    tags: ["stickers"],
    request: { params: WsParam, query: AccountQuery },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ sets: z.array(StickerSetInfoSchema) }),
          },
        },
        description: "Installed sticker/emoji sets of the account",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("query");
    const { acc, client } = await resolveAccountClient(wsId, accountId);
    try {
      const [regular, emoji] = await Promise.all([
        fetchInstalledSets(client, "stickerTypeRegular"),
        acc.hasPremium
          ? fetchInstalledSets(client, "stickerTypeCustomEmoji")
          : Promise.resolve({ sets: [] as TdStickerSetInfo[] }),
      ]);
      const map = (sets: TdStickerSetInfo[], kind: "sticker" | "emoji") =>
        sets.map((s) => ({ id: String(s.id), title: s.title, kind }));
      return c.json({
        sets: [...map(regular.sets, "sticker"), ...map(emoji.sets, "emoji")],
      });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/sticker-sets/{setId}",
    tags: ["stickers"],
    request: {
      params: WsParam.extend({ setId: z.string().min(1).max(32) }),
      query: AccountQuery,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ stickers: z.array(PickerStickerSchema) }),
          },
        },
        description: "Stickers of the set",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { setId } = c.req.valid("param");
    const { accountId } = c.req.valid("query");
    const { client } = await resolveAccountClient(wsId, accountId);
    try {
      // set_id — int64: в tdl JSON-интерфейсе передаётся строкой.
      const fetchSet = () =>
        client.invoke({
          _: "getStickerSet",
          set_id: setId,
        } as never) as Promise<{ stickers: TdStickerRaw[] }>;
      let set: { stickers: TdStickerRaw[] };
      try {
        set = await fetchSet();
      } catch (e) {
        // После рестарта TDLib набор по голому id неизвестен («Sticker set
        // not found»), пока не загружен список установленных — access hash
        // живёт там. Прогреваем и повторяем один раз.
        if (!/not found/i.test(errMsg(e))) throw e;
        await Promise.all(
          ["stickerTypeRegular", "stickerTypeCustomEmoji"].map((type) =>
            fetchInstalledSets(client, type).catch(() => null),
          ),
        );
        set = await fetchSet();
      }
      return c.json({ stickers: mapPickerStickers(set.stickers) });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

// Поиск по установленным стикерам/эмодзи (getStickers): матчится по
// эмодзи-символу и sticker-keywords (в основном английским) — как поиск в
// самом Telegram; при непустом запросе TDLib может подмешать избранное и
// trending — такие тоже отправляемы, не фильтруем.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/sticker-search",
    tags: ["stickers"],
    request: {
      params: WsParam,
      query: AccountQuery.extend({
        kind: z.enum(["sticker", "emoji"]),
        q: z.string().min(1).max(64),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ stickers: z.array(PickerStickerSchema) }),
          },
        },
        description: "Stickers matching the query",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId, kind, q } = c.req.valid("query");
    const { acc, client } = await resolveAccountClient(wsId, accountId);
    // Кастом-эмодзи без премиума не отправить — и не ищем.
    if (kind === "emoji" && !acc.hasPremium) return c.json({ stickers: [] });
    try {
      const res = (await client.invoke({
        _: "getStickers",
        sticker_type: {
          _: kind === "emoji" ? "stickerTypeCustomEmoji" : "stickerTypeRegular",
        },
        query: q,
        limit: 50,
        chat_id: 0,
      } as never)) as { stickers: TdStickerRaw[] };
      return c.json({ stickers: mapPickerStickers(res.stickers) });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

export default app;
