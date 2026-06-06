import {
  extractCreativeMedia,
  extractFormattedText,
  extractMediaThumb,
  extractReactions,
  type TdContent,
} from "./td-message.ts";
import type { TdClient } from "./tdlib/client.ts";

// Парсинг ленты канала (TDLib Message → плоский элемент для UI) + бережное
// чтение из кэша. Вынесено из routes/channels.ts, чтобы переиспользовать в
// предпросмотре канала (менеджер + клиентская ссылка).

type TdReaction = { type: { _: string; emoji?: string }; total_count: number };

export type TdChannelMessage = {
  id: number;
  date: number;
  is_pinned?: boolean;
  content: TdContent;
  interaction_info?: {
    view_count?: number;
    forward_count?: number;
    reply_info?: { reply_count: number };
    reactions?: { reactions: TdReaction[] };
  };
  forward_info?: { origin: { _: string }; date: number };
};

// Message → элемент ленты (текст+entities, превью медиа, просмотры/реакции).
// withMedia: считать ли full-res дескриптор (нужен только ленте канала /history,
// где фронт грузит full-res поверх блюра; превью/шаринг его не используют).
export function mapChannelHistoryItems(
  messages: TdChannelMessage[],
  opts?: { withMedia?: boolean },
) {
  return messages.map((m) => {
    const { text, entities } = extractFormattedText(m.content);
    const mediaThumb = extractMediaThumb(m.content);
    // Дескриптор full-res медиа (без fileId — фронт качает по messageId через
    // post-media роут). Блюр-минитюмбнейл остаётся мгновенным placeholder'ом.
    const cm = opts?.withMedia ? extractCreativeMedia(m.content) : null;
    const media = cm
      ? { kind: cm.kind, width: cm.width, height: cm.height }
      : null;
    const ii = m.interaction_info;
    const reactions = extractReactions(ii);
    return {
      id: String(m.id),
      date: new Date(m.date * 1000).toISOString(),
      // Без текста и без thumb (стикер/voice/…) — короткий type-label.
      text: text || (mediaThumb ? "" : "[медиа]"),
      entities,
      mediaThumb,
      media,
      // TG отдаёт байты медиа через post-media/{id} прокси — прямого URL нет.
      mediaUrl: null,
      views: ii?.view_count ?? null,
      forwards: ii?.forward_count ?? null,
      replies: ii?.reply_info?.reply_count ?? null,
      reactions,
      isForwarded: !!m.forward_info,
    };
  });
}

// Каналы холодные (аккаунт не подписан → RAM-кэш TDLib пустой), и первый
// getChatHistory часто возвращает 1-2 сообщения — TDLib инициирует фоновый
// fetch и отдаёт что успел (td_api.tl §getChatHistory: «can be smaller than the
// specified limit»). Дозваниваемся пагинацией от oldest_id, пока не наберём
// limit или TDLib не отдаст empty (конец канала). MAX_ATTEMPTS — стоп от цикла.
// 8 даёт окну метрик (до 500 постов) дозвониться даже когда TDLib отдаёт
// маленькими порциями; фид (limit~50) стопится по aggregated раньше.
const MAX_ATTEMPTS = 8;

// Сетевое чтение ленты канала: openChat → backfill-loop getChatHistory →
// closeChat. only_local:false — TDLib ходит на сервер если кэша не хватает.
// openChat обязателен: без него канал не «активен», и сервер-fetch ленив
// (td_api.tl §openChat «all updates are received only for opened chats»).
// closeChat — best-effort в finally, только если openChat успел.
// Прогрев state'а (searchPublicChat для публичных) — на стороне вызывающего:
// /history делает его с классификацией ошибок, превью — через readChannelPreview.
export async function fetchChannelHistory(
  client: TdClient,
  opts: {
    chatId: number;
    limit: number;
    fromMessageId?: number;
    // Окно метрик: дальше постов старше maxAgeMs не листаем (охват считаем за
    // ~2 недели, см. вызов в /history). Не задан → только по limit.
    maxAgeMs?: number;
  },
): Promise<TdChannelMessage[]> {
  const { chatId, limit, maxAgeMs } = opts;
  const minDate = maxAgeMs ? (Date.now() - maxAgeMs) / 1000 : 0;
  let aggregated: TdChannelMessage[] = [];
  let from = opts.fromMessageId ?? 0;
  let opened = false;
  try {
    await client.invoke({ _: "openChat", chat_id: chatId } as never);
    opened = true;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = (await client.invoke({
        _: "getChatHistory",
        chat_id: chatId,
        from_message_id: from,
        offset: 0,
        limit: limit - aggregated.length,
        only_local: false,
      } as never)) as { messages: TdChannelMessage[] };
      if (r.messages.length === 0) break;
      aggregated = [...aggregated, ...r.messages];
      if (aggregated.length >= limit) break;
      const oldest = r.messages[r.messages.length - 1]!;
      // Старше окна — дальше листать незачем (история идёт newest→oldest).
      if (minDate && oldest.date < minDate) break;
      from = Number(oldest.id);
    }
  } finally {
    if (opened) {
      await client
        .invoke({ _: "closeChat", chat_id: chatId } as never)
        .catch(() => {});
    }
  }
  return aggregated;
}

// Предпросмотр канала (менеджер + клиентская ссылка). Раньше читали only_local
// (только кэш, без сети) ради бережности к MTProto, НО кэш в TDLib — на каждый
// аккаунт свой: превью выбирает аккаунт «подписанный-иначе-любой», и если ленту
// грел другой аккаунт, only_local отдавал 1 пост / пусто — лажа для клиента.
// Решили (с юзером): тянуть с сервера. Чтение ~20 постов канала — лёгкая read-
// операция (не отправка), флуд-риск низкий; фронт кэширует ответ (staleTime),
// так что повторные открытия дровера не долбят сеть. Публичный канал прогреваем
// searchPublicChat; приватный читается только подписанным аккаунтом (иначе
// openChat упадёт «Chat not found»). Ошибка → [] (дровер не должен падать).
export async function readChannelPreview(
  client: TdClient,
  opts: { chatId: number; username: string | null; limit: number },
): Promise<TdChannelMessage[]> {
  try {
    if (opts.username) {
      await client.invoke({
        _: "searchPublicChat",
        username: opts.username,
      } as never);
    }
    return await fetchChannelHistory(client, {
      chatId: opts.chatId,
      limit: opts.limit,
    });
  } catch {
    return [];
  }
}

// Чтение помеченного сообщения (договор/креатив/акт) — раздаётся менеджеру
// (step-message) и клиенту (креативы). openChat обязателен: getMessage/
// getChatHistory НЕ offline. albumId → собираем весь альбом из окна истории по
// media_album_id (фронт хранит одно id). Ошибка → []. Сорт по возрастанию id.
export type TdAlbumMessage = TdChannelMessage & {
  media_album_id?: string | number;
};
export async function readTaggedMessages(
  client: TdClient,
  ref: { chatId: string; messageId: string; albumId: string | null },
): Promise<TdAlbumMessage[]> {
  const chatId = Number(ref.chatId);
  const msgId = Number(ref.messageId);
  try {
    await client.invoke({ _: "openChat", chat_id: chatId } as never);
    let msgs: TdAlbumMessage[];
    if (ref.albumId) {
      const r = (await client.invoke({
        _: "getChatHistory",
        chat_id: chatId,
        from_message_id: msgId,
        offset: -9,
        limit: 20,
        only_local: false,
      } as never)) as { messages?: (TdAlbumMessage | null)[] };
      msgs = (r.messages ?? []).filter(
        (m): m is TdAlbumMessage =>
          !!m && String(m.media_album_id ?? "0") === ref.albumId,
      );
      if (msgs.length === 0) {
        const one = (await client
          .invoke({ _: "getMessage", chat_id: chatId, message_id: msgId } as never)
          .catch(() => null)) as TdAlbumMessage | null;
        if (one) msgs = [one];
      }
      msgs.sort((a, b) => Number(a.id) - Number(b.id));
    } else {
      const one = (await client.invoke({
        _: "getMessage",
        chat_id: chatId,
        message_id: msgId,
      } as never)) as TdAlbumMessage | null;
      msgs = one ? [one] : [];
    }
    return msgs;
  } catch {
    return [];
  } finally {
    await client
      .invoke({ _: "closeChat", chat_id: chatId } as never)
      .catch(() => {});
  }
}
