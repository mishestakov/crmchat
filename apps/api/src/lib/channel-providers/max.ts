import { db } from "../../db/client.ts";
import { channels, channelSubscriptions } from "../../db/schema.ts";
import type { MaxClient } from "../max/index.ts";
import { writeChannelProfile, type ChannelProfile } from "./index.ts";
import { computeReach } from "./reach.ts";
import type { ProviderVideo, ReachWindow } from "./types.ts";

// Провайдер каналов MAX. В отличие от YouTube/TikTok/Dzen (stateless HTTP),
// MAX читается через авторизованную аккаунт-сессию (CHAT_INFO/PUBLIC_SEARCH/
// LINK_INFO + CHAT_HISTORY) — как TG. Публичные каналы видны без вступления.
// Маппинг полей сверен с ~/MAX/src/domain (parse-chat / parse-message).

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Канал/группа в MAX имеют отрицательный chatId; положительные — это люди.
// Через BigInt, а не Number — id может быть int64 за пределами 2^53 (Number
// исказил бы его, как намеренно избегает maxDialogChatId).
function negativeChatId(chat: Record<string, unknown>): string | null {
  const raw = chat.id ?? chat.chatId ?? chat.dialogId;
  if (raw == null) return null;
  let n: bigint;
  try {
    n = BigInt(typeof raw === "string" ? raw.trim() : (raw as number | bigint));
  } catch {
    return null;
  }
  return n < 0n ? n.toString() : null;
}

// Слаг публичного канала из ссылки https://max.ru/<slug> или голого username.
function slugFromChannel(channel: typeof channels.$inferSelect): string | null {
  if (channel.username) return channel.username.replace(/^@/, "");
  if (channel.link) {
    const m = channel.link.match(/max\.ru\/(?:c\/)?([^/?#]+)/i);
    if (m) return m[1]!;
  }
  return null;
}

// Ссылка max.ru для LINK_INFO: либо явная (если это max.ru), либо из username.
function channelMaxLink(channel: typeof channels.$inferSelect): string | null {
  if (channel.link && /max\.ru|oneme\.ru/i.test(channel.link)) return channel.link;
  if (channel.username) return `https://max.ru/${channel.username.replace(/^@/, "")}`;
  return null;
}

// CHAT_INFO/LINK_INFO кладут чаты в payload.chats (массив или объект-словарь).
// Порт extractChats из ~/MAX/src/domain/channels/parse-chat.ts.
function extractChats(payload: unknown): Record<string, unknown>[] {
  const p = rec(payload);
  if (!p) return [];
  if (Array.isArray(p.chats)) return p.chats.map(rec).filter((c): c is Record<string, unknown> => !!c);
  if (p.chats && typeof p.chats === "object")
    return Object.values(p.chats).map(rec).filter((c): c is Record<string, unknown> => !!c);
  return [];
}

// PUBLIC_SEARCH кладёт чаты как result[].chat (не chats[]). Рекурсивный обход
// payload собирает любые объекты-чаты с отрицательным id. Порт
// collectSearchCandidates/pickSearchCandidate из ~/MAX (там это уже решено).
interface SearchCandidate {
  chatId: number;
  link: string | null;
}

function walkObjects(value: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walkObjects(v, visit);
    return;
  }
  visit(value as Record<string, unknown>);
  for (const v of Object.values(value as object)) walkObjects(v, visit);
}

function collectSearchCandidates(payload: unknown): SearchCandidate[] {
  const out: SearchCandidate[] = [];
  const seen = new Set<string>();
  walkObjects(payload, (node) => {
    const raw = node.chatId ?? node.id ?? node.dialogId;
    const n = Number(raw);
    if (!Number.isFinite(n) || n >= 0 || seen.has(String(n))) return;
    seen.add(String(n));
    const link =
      typeof node.link === "string"
        ? node.link
        : (typeof rec(node.chat)?.link === "string" ? (rec(node.chat)!.link as string) : null);
    out.push({ chatId: n, link });
  });
  return out;
}

function pickSearchCandidate(payload: unknown, slug: string): SearchCandidate | null {
  const lower = slug.toLowerCase();
  return (
    collectSearchCandidates(payload).find((c) => {
      if (typeof c.link !== "string") return false;
      const linkSlug = c.link
        .replace(/^https?:\/\/max\.ru\//i, "")
        .replace(/^\/+|\/+$/g, "")
        .toLowerCase();
      return linkSlug === lower;
    }) ?? null
  );
}

// Резолвим ref канала: точный externalId → LINK_INFO по ссылке (точно) →
// PUBLIC_SEARCH по слагу. Возвращаем и chatId, и сам chat из LINK_INFO, если
// он пришёл — для приватных join-инвайтов это единственное превью (id/title/
// access/participantsCount) ДО вступления; CHAT_INFO без членства пуст.
async function resolveMaxChatRef(
  client: MaxClient,
  channel: typeof channels.$inferSelect,
): Promise<{ chatId: string; linkChat: Record<string, unknown> | null }> {
  if (channel.externalId) return { chatId: channel.externalId, linkChat: null };

  const link = channelMaxLink(channel);
  if (link) {
    const res = await client.linkInfo(link);
    const chat = rec(rec(res.payload)?.chat);
    const id = chat && negativeChatId(chat);
    if (id) return { chatId: id, linkChat: chat };
  }

  const slug = slugFromChannel(channel);
  if (slug) {
    const res = await client.publicSearch(slug, { count: 20 });
    const cand = pickSearchCandidate(res.payload, slug);
    if (cand) return { chatId: String(cand.chatId), linkChat: null };
  }

  throw new Error(
    `MAX: не удалось резолвить канал (external_id=${channel.externalId}, link=${link}, slug=${slug})`,
  );
}

// Резолвим в сырой chat-объект: CHAT_INFO по id (канонические полные поля:
// подписчики, messagesCount, аватар). Для приватного канала без членства
// CHAT_INFO пуст — тогда отдаём превью из LINK_INFO (его хватает на карточку +
// определить access=PRIVATE для кнопки «Вступить»).
async function resolveMaxChat(
  client: MaxClient,
  channel: typeof channels.$inferSelect,
): Promise<Record<string, unknown>> {
  const { chatId, linkChat } = await resolveMaxChatRef(client, channel);
  const info = await client.chatsInfo([chatId]);
  const chat = extractChats(info.payload)[0];
  if (chat && negativeChatId(chat)) return chat;
  if (linkChat) return linkChat;
  throw new Error(`MAX: CHAT_INFO пуст для chatId=${chatId}`);
}

// Окно охвата из последних сообщений: медиана просмотров (stats.views), ER
// (медиана reactionInfo.totalCount / views), дата последнего поста.
async function fetchReach(client: MaxClient, chatId: string): Promise<ReachWindow> {
  const res = await client.chatHistory(chatId, { backward: 20, getMessages: true });
  const msgs = ((rec(res.payload)?.messages as unknown[] | undefined) ?? [])
    .map(rec)
    .filter((m): m is Record<string, unknown> => !!m);

  // likes = реакции (reactionInfo.totalCount). createdAt из time → общий
  // computeReach сам считает медиану просмотров, ER и lastPostAt по тому же
  // контракту, что YouTube/TikTok/Dzen (avg_reach/err).
  const vids: ProviderVideo[] = [];
  for (const m of msgs) {
    const views = toInt(rec(m.stats)?.views);
    if (views == null) continue;
    const reactions = toInt(rec(m.reactionInfo)?.totalCount) ?? 0;
    const time = toInt(m.time);
    vids.push({ views, likes: reactions, createdAt: time ? new Date(time) : undefined });
  }
  return computeReach(vids, Date.now());
}

export type MaxPost = {
  id: string;
  date: string;
  text: string;
  entities: never[];
  mediaThumb: null;
  media: { kind: "photo" | "video"; width: number; height: number } | null;
  // Прямой CDN-URL картинки/постера (okcdn.ru/oneme.ru) — MAX отдаёт ссылкой,
  // прокси не нужен. null = медиа нет (TG-посты тоже null, рендер по mediaUrl).
  mediaUrl: string | null;
  views: number | null;
  forwards: null;
  replies: null;
  reactions: { emoji: string; count: number }[];
  isForwarded: boolean;
};

// Медиа из attaches MAX-сообщения. PHOTO → baseUrl/url; VIDEO → thumbnail
// (постер; видео не проигрываем, показываем кадр). Shape снят с исходников
// web.max.ru + живого RT. previewData (инлайн WebP-блюр) пока не используем.
function extractMaxMedia(msg: Record<string, unknown>): {
  media: { kind: "photo" | "video"; width: number; height: number } | null;
  mediaUrl: string | null;
} {
  const atts = (Array.isArray(msg.attaches) ? msg.attaches : [])
    .map(rec)
    .filter((a): a is Record<string, unknown> => !!a);
  const att = atts.find((a) => a._type === "PHOTO" || a._type === "VIDEO");
  if (!att) return { media: null, mediaUrl: null };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const isVideo = att._type === "VIDEO";
  const url = isVideo ? str(att.thumbnail) : (str(att.baseUrl) ?? str(att.url));
  if (!url) return { media: null, mediaUrl: null };
  return {
    media: {
      kind: isVideo ? "video" : "photo",
      width: toInt(att.width) ?? 0,
      height: toInt(att.height) ?? 0,
    },
    mediaUrl: url,
  };
}

// Лента постов MAX: CHAT_HISTORY → формат ChannelHistoryItem (тот же контракт,
// что TG /history, чтобы PostsFeed рендерил без ветвлений). MAX отдаёт
// text/stats.views/reactionInfo.totalCount/time + медиа в attaches. Реакции —
// агрегат totalCount одним значком; forwards/replies/entities — пустые.
export async function fetchMaxPosts(
  client: MaxClient,
  chatId: string,
  limit: number,
): Promise<MaxPost[]> {
  const res = await client.chatHistory(chatId, {
    backward: limit,
    getMessages: true,
  });
  const msgs = ((rec(res.payload)?.messages as unknown[] | undefined) ?? [])
    .map(rec)
    .filter((m): m is Record<string, unknown> => !!m);
  const posts: MaxPost[] = [];
  for (const m of msgs) {
    // Без id нет стабильного React-key — пропускаем (иначе key="" коллизит).
    if (m.id == null) continue;
    const time = toInt(m.time);
    const total = toInt(rec(m.reactionInfo)?.totalCount) ?? 0;
    const { media, mediaUrl } = extractMaxMedia(m);
    posts.push({
      id: String(m.id),
      // time=0/мусор → берём now, иначе localeCompare сослал бы пост в 1970.
      date: new Date(time && time > 0 ? time : Date.now()).toISOString(),
      text: typeof m.text === "string" ? m.text : "",
      entities: [],
      mediaThumb: null,
      media,
      mediaUrl,
      views: toInt(rec(m.stats)?.views),
      forwards: null,
      replies: null,
      reactions: total > 0 ? [{ emoji: "❤️", count: total }] : [],
      isForwarded: false,
    });
  }
  // Свежие сверху, как в TG-ленте.
  posts.sort((a, b) => b.date.localeCompare(a.date));
  return posts;
}

// CHAT_INFO/PUBLIC_SEARCH chat → нормализованный ChannelProfile.
function mapChatToProfile(chat: Record<string, unknown>, reach: ReachWindow): ChannelProfile {
  const opts = rec(chat.options) ?? {};
  const link = typeof chat.link === "string" ? chat.link : null;
  const slugMatch = link?.match(/max\.ru\/(?:c\/)?([^/?#]+)/i);
  return {
    externalId: negativeChatId(chat),
    title: typeof chat.title === "string" ? chat.title : "",
    description: typeof chat.description === "string" ? chat.description : null,
    username: slugMatch ? slugMatch[1]! : null,
    link,
    audience: toInt(chat.participantsCount),
    verified: Boolean(opts.OFFICIAL),
    avatarUrl: typeof chat.baseIconUrl === "string" ? chat.baseIconUrl : null,
    reach,
    topics: [],
    recentVideos: [],
    raw: chat,
  };
}

// Доступность канала. Публичные (access=PUBLIC) читаются без вступления.
// Закрытые (PRIVATE) требуют CHAT_JOIN: либо вступаем сразу, либо уходим в
// ожидание одобрения админа (options.JOIN_REQUEST). Зеркало TG
// channel_subscriptions (status subscribed|pending). Возвращает актуальный chat
// и pending — при pending читать историю ещё нельзя.
async function ensureChannelAccess(
  client: MaxClient,
  channel: typeof channels.$inferSelect,
  chat: Record<string, unknown>,
  accountId: string | undefined,
): Promise<{ chat: Record<string, unknown>; pending: boolean }> {
  const access = typeof chat.access === "string" ? chat.access : "PUBLIC";
  const joined = chat.joinTime != null && Number(chat.joinTime) > 0;
  if (access !== "PRIVATE" || joined) return { chat, pending: false };

  const link =
    channelMaxLink(channel) ?? (typeof chat.link === "string" ? chat.link : null);
  if (!link) return { chat, pending: true };

  let joinedNow = false;
  try {
    const res = await client.chatJoin(link);
    const jc = rec(rec(res.payload)?.chat);
    joinedNow = !!jc && jc.joinTime != null && Number(jc.joinTime) > 0;
  } catch {
    // join отклонён / требует одобрения → pending.
    joinedNow = false;
  }

  if (accountId) {
    await db
      .insert(channelSubscriptions)
      .values({
        accountId,
        channelId: channel.id,
        status: joinedNow ? "subscribed" : "pending",
      })
      .onConflictDoUpdate({
        target: [channelSubscriptions.accountId, channelSubscriptions.channelId],
        set: { status: joinedNow ? "subscribed" : "pending" },
      });
  }

  if (!joinedNow) return { chat, pending: true };
  // После вступления — свежий CHAT_INFO (полные поля доступны участнику).
  const fresh = await client.chatsInfo([negativeChatId(chat)!]);
  return { chat: extractChats(fresh.payload)[0] ?? chat, pending: false };
}

const EMPTY_REACH: ReachWindow = {
  medianViews: null,
  engagementRate: null,
  lastPostAt: null,
};

// Pull карточки MAX-канала через переданную аккаунт-сессию и запись в БД
// (общий writeChannelProfile, meta-ключ "mx"). Зеркалит syncChannelFromProvider,
// но фетч — не HTTP, а через MaxClient. accountId — для записи подписки на
// закрытый канал. Бросает — вызывающий маппит в 4xx.
export async function syncChannelFromMax(
  channel: typeof channels.$inferSelect,
  client: MaxClient,
  accountId?: string,
): Promise<typeof channels.$inferSelect> {
  if (channel.platform !== "max") {
    throw new Error(`syncChannelFromMax: ожидалась платформа max, получено ${channel.platform}`);
  }
  let chat = await resolveMaxChat(client, channel);
  const access = await ensureChannelAccess(client, channel, chat, accountId);
  chat = access.chat;

  // Reach только если можем читать (публичный или вступили). При ожидании
  // одобрения история недоступна — оставляем reach пустым.
  const reach = access.pending
    ? EMPTY_REACH
    : await fetchReach(client, negativeChatId(chat)!).catch(() => EMPTY_REACH);

  const profile = mapChatToProfile(chat, reach);
  return writeChannelProfile(channel, profile, "mx");
}

// Батч-выгрузка карточек MAX на импорте: CHAT_INFO принимает до 100 id за раз,
// поэтому идентичность+подписчики+access тянем пачками сразу (вместо ленивого
// синка по открытию). Reach (история per-channel) здесь НЕ считаем — он остаётся
// пустым и доберётся ленивым single-синком (syncChannelFromMax) при открытии.
// Применять только к свежесозданным каналам (иначе занулит существующий reach).
const CHAT_INFO_BATCH = 100;

export async function syncMaxChannelsBatch(
  client: MaxClient,
  rows: (typeof channels.$inferSelect)[],
): Promise<{ updated: number; unresolved: number }> {
  // 1. Резолвим id для каждого канала (externalId — сразу, иначе LINK_INFO/поиск).
  const byId = new Map<string, typeof channels.$inferSelect>();
  let unresolved = 0;
  for (const ch of rows) {
    let id: string | null = ch.externalId;
    if (!id) {
      id = await resolveMaxChatRef(client, ch)
        .then((r) => r.chatId)
        .catch(() => null);
    }
    if (id) byId.set(id, ch);
    else unresolved++;
  }

  // 2. CHAT_INFO пачками по 100 → запись карточки. Записи в БД независимы —
  // гоним пачку параллельно (это Postgres, rate-limit MAX-сокета тут ни при чём).
  const ids = [...byId.keys()];
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHAT_INFO_BATCH) {
    const chunk = ids.slice(i, i + CHAT_INFO_BATCH);
    const info = await client.chatsInfo(chunk);
    const writes = extractChats(info.payload).flatMap((chat) => {
      const cid = negativeChatId(chat);
      const ch = cid ? byId.get(cid) : null;
      return ch ? [writeChannelProfile(ch, mapChatToProfile(chat, EMPTY_REACH), "mx")] : [];
    });
    await Promise.all(writes);
    updated += writes.length;
  }
  return { updated, unresolved };
}

