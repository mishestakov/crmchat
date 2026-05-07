import { z } from "zod";

// Площадка = TG-канал/группа, которыми занимается бизнес. Админы — m:n
// связь на contacts (см. schema.ts channelAdmins).
export const ChannelSchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  tgChatId: z.string().nullable(),
  title: z.string().min(1).max(256),
  link: z.string().nullable(),
  lastMessageAt: z.iso.datetime().nullable(),
  properties: z.record(z.string(), z.unknown()),
  // Админы канала (плоский список). Sticky-аккаунт берётся из contact'а
  // первого админа (UI-колонка «закреплён за»).
  admins: z.array(
    z.object({
      contactId: z.string(),
      fullName: z.string().nullable(),
      telegramUsername: z.string().nullable(),
      primaryAccountId: z.string().nullable(),
    }),
  ),
  createdBy: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelSchema = z.object({
  title: z.string().min(1).max(256),
  link: z.string().min(1).max(512).nullable().optional(),
  adminContactIds: z.array(z.string().min(1).max(64)).optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;

// CSV-импорт каналов: одна строка = один канал.
// admin_username опционален; если контакта с таким @ нет в воркспейсе и в
// replica — создадим stub-contact (smart-stub: сначала смотрим в replica,
// при попадании сразу подставляем tg_user_id).
export const ImportChannelsSchema = z.object({
  rows: z.array(
    z.object({
      channel_url: z.string().min(1).max(512),
      title: z.string().max(256).optional(),
      admin_username: z.string().max(64).optional(),
      admin_phone: z.string().max(32).optional(),
    }),
  ),
});
export type ImportChannelsInput = z.infer<typeof ImportChannelsSchema>;

export const ImportChannelsResultSchema = z.object({
  channelsCreated: z.number().int(),
  channelsUpdated: z.number().int(),
  adminContactsCreated: z.number().int(),
  adminContactsRecognized: z.number().int(),
  skippedNoUrl: z.number().int(),
});
export type ImportChannelsResult = z.infer<typeof ImportChannelsResultSchema>;
