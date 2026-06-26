import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  clearScheduleOnAdminChange,
  repointPlacementSchedule,
  scheduleDolivkaForChannel,
} from "./project-scheduling.ts";
import { channelAdmins, contacts, projectItems } from "../db/schema.ts";

// Получатель аутрича по каналу = первый привязанный админ-контакт. Нет админа →
// размещение без получателя (цепочку не запустить, пока контакт не привязан).
// Вынесено из campaigns.ts в общий lib, чтобы channels.ts (heal на привязке)
// и campaigns.ts (создание размещения) делили одну логику без import-цикла.
export async function resolveAdminRecipient(channelId: string) {
  const [admin] = await db
    .select({ contactId: channelAdmins.contactId, props: contacts.properties })
    .from(channelAdmins)
    .innerJoin(contacts, eq(contacts.id, channelAdmins.contactId))
    .where(eq(channelAdmins.channelId, channelId))
    .limit(1);
  const p = (admin?.props ?? {}) as Record<string, unknown>;
  return {
    contactId: admin?.contactId ?? null,
    username: (p.telegram_username as string | undefined) ?? null,
    tgUserId: (p.tg_user_id as string | undefined) ?? null,
  };
}

// Залечить размещения канала: проставить получателя из админа (этап 16.8).
// По умолчанию трогаем только осиротевшие (contact_id IS NULL) — вызывается
// после привязки админа, чтобы чат и аутрич заработали, не перетирая уже
// настроенных получателей. `override: true` (смена контакта) перенаводит ВСЕ
// размещения канала на текущего админа. Первый админ выигрывает.
export async function healPlacementRecipients(
  channelId: string,
  opts: { override?: boolean; clearScheduleOnly?: boolean } = {},
): Promise<void> {
  const admin = await resolveAdminRecipient(channelId);
  if (!admin.contactId) return;
  const base = eq(projectItems.channelId, channelId);
  await db
    .update(projectItems)
    .set({
      contactId: admin.contactId,
      username: admin.username,
      tgUserId: admin.tgUserId,
    })
    .where(opts.override ? base : and(base, isNull(projectItems.contactId)));
  // Планирование внутри heal, а не у вызывающих: любой вызов лечения сам
  // добирает рассылку, асимметрии не бывает.
  if (opts.override) {
    if (opts.clearScheduleOnly) {
      // Смена админа на ДРУГОГО (был контакт → стал другой): обнуляем график
      // прежнего, новую серию НЕ планируем — запуск рассылки новому вручную.
      await clearScheduleOnAdminChange(channelId);
    } else {
      // Первое назначение контакта (прежнего админа не было) = перенаправление:
      // обнулить старый график и поставить свежий опенер новому, без cold-гейта.
      await repointPlacementSchedule(channelId);
    }
  } else {
    // Пассивное лечение осиротевших размещений (привязали первый контакт) —
    // поздняя доливка с cold-гейтом (новых на холодном проекте запускает
    // явная кнопка).
    await scheduleDolivkaForChannel(channelId);
  }
}

// Снять персону-получателя со всех размещений канала (этап 16.8): способ связи
// сменили на «личку канала»/группу — авто-цепочка адресуется человеку, поэтому
// контакт обнуляем. Готовность дальше держится на contact_method.kind, который
// set-admin пишет в channels.meta (channel_dm/group), а не на самом факте лички.
export async function clearPlacementRecipients(channelId: string): Promise<void> {
  await db
    .update(projectItems)
    .set({ contactId: null, username: null, tgUserId: null })
    .where(eq(projectItems.channelId, channelId));
}
