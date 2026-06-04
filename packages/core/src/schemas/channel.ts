import { z } from "zod";

// Площадка = аккаунт блогера в соцсети: Telegram-канал, YouTube-канал,
// TikTok-аккаунт (MAX — задел). Связь с блогером — всегда через Telegram
// (contact), площадка лишь «где выходит пост и откуда снимаем метрики»
// (см. specs/etap-17-multiplatform.md).
// Раскладка хранилища:
//   - типизированные поля (title, description, username, link, member_count,
//     external_id) — универсальные для любой соцсети; member_count =
//     нормализованная аудитория (TG members / YT subscribers / TT followers)
//   - `meta` jsonb — сырые поля соцсети + вычисленные сигналы (avgViews,
//     medianViews, engagementRate, lastPostAt, …). Перезатирается соц-pull'ом
//   - `properties` jsonb — наши computed/csv-импорт поля (ручной ER, ниша,
//     is_rkn). Соц-pull их НЕ ТРОГАЕТ
//   - `synced_at` — когда последний раз пулили соцсеть. NULL = ни разу
export const ChannelPlatformSchema = z.enum([
  "telegram",
  "youtube",
  "tiktok",
  "dzen",
  "max",
]);
export type ChannelPlatform = z.infer<typeof ChannelPlatformSchema>;

export const ChannelSchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  platform: ChannelPlatformSchema,
  externalId: z.string().nullable(),
  title: z.string().min(1).max(256),
  description: z.string().nullable(),
  username: z.string().nullable(),
  link: z.string().nullable(),
  memberCount: z.number().int().nullable(),
  meta: z.record(z.string(), z.unknown()),
  properties: z.record(z.string(), z.unknown()),
  syncedAt: z.iso.datetime().nullable(),
  lastMessageAt: z.iso.datetime().nullable(),
  unavailableSince: z.iso.datetime().nullable(),
  unavailableLastCheckAt: z.iso.datetime().nullable(),
  unavailableReason: z.string().nullable(),
  // Минитамбнейл из соцсети (base64 jpeg). Тянется LEFT JOIN'ом из
  // channel_thumbnails — если ещё не было соц-pull'а или картинки нет.
  thumbnailB64: z.string().nullable(),
  // Админы канала (плоский список). Sticky-аккаунт берётся из contact'а
  // первого админа (UI-колонка «закреплён за»).
  admins: z.array(
    z.object({
      contactId: z.string(),
      fullName: z.string().nullable(),
      telegramUsername: z.string().nullable(),
      primaryAccountId: z.string().nullable(),
      // Аккаунты команды, у кого есть личный диалог с этим админом (из
      // tg_chats, воркспейс-wide) — «кружочки» в таблице каналов + анти-дабл-
      // тач (при наведении — как давно общались). Пусто = с админом никто не в
      // контакте.
      chatAccounts: z.array(
        z.object({
          accountId: z.string(),
          lastInboundAt: z.iso.datetime().nullable(),
          lastOutboundAt: z.iso.datetime().nullable(),
        }),
      ),
    }),
  ),
  createdBy: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelSchema = z.object({
  title: z.string().min(1).max(256),
  link: z.string().min(1).max(512).nullable().optional(),
  username: z.string().min(1).max(64).nullable().optional(),
  externalId: z.string().min(1).max(64).nullable().optional(),
  platform: ChannelPlatformSchema.optional(),
  adminContactIds: z.array(z.string().min(1).max(64)).optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;

// CSV-импорт каналов с column-mapping. Юзер на фронте парсит CSV и
// присылает сюда:
//   - rows: массив объектов { csvHeader: csvValue }
//   - mapping: какой CSV-header в какой типизированный слот идёт + какие
//     headers идут в `properties` под их собственным или указанным ключом
// Бэк применяет mapping. Правило приоритета: если канал уже синхронизирован
// из соцсети (synced_at IS NOT NULL), CSV пишет только `properties` +
// admin_username; типизированные поля (title/description/member_count/…)
// остаются от соцсети.
export const ImportChannelsMappingSchema = z.object({
  // Идентифицирующий слот (нужен хотя бы один). external_id или username
  // используются для дедупа.
  externalId: z.string().optional(),
  username: z.string().optional(),
  link: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  memberCount: z.string().optional(),
  adminUsername: z.string().optional(),
  // Свободные пользовательские поля: { propertyKey: csvHeader }.
  // propertyKey — это ключ внутри channels.properties (например 'er', 'niche').
  // Регексп зеркалит фронтовую валидацию (см. ImportWizard) — без него
  // через curl можно было бы записать произвольный ключ в jsonb.
  properties: z
    .record(
      z.string().regex(/^[a-z0-9_]+$/i, "propertyKey must match [a-z0-9_]+"),
      z.string(),
    )
    .optional(),
});
export type ImportChannelsMapping = z.infer<typeof ImportChannelsMappingSchema>;

export const ImportChannelsSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).max(50000),
  mapping: ImportChannelsMappingSchema,
  platform: ChannelPlatformSchema.default("telegram"),
});
export type ImportChannelsInput = z.infer<typeof ImportChannelsSchema>;

export const ImportChannelsResultSchema = z.object({
  channelsCreated: z.number().int(),
  channelsUpdated: z.number().int(),
  // Канал уже синхронизирован из соцсети — типизированные поля пропущены,
  // обновлены только `properties` + admin-привязка.
  channelsSyncSkipped: z.number().int(),
  adminContactsCreated: z.number().int(),
  adminContactsRecognized: z.number().int(),
  skippedNoIdentifier: z.number().int(),
});
export type ImportChannelsResult = z.infer<typeof ImportChannelsResultSchema>;
