// Сборка описания тикета CRM.
//
// Верхняя часть — 1:1 формат робота-заливщика `robot-oobp-analytics`: те же 14
// строк в том же порядке. Отклоняться нельзя: тикеты читают глазами и, судя по
// стабильности формата, парсят скриптами. Поля, которых у нас нет («Тип
// монетизации», «Категория канала», «Тип блогера»), оставляем пустыми — ровно
// как робот оставляет пустыми телефон и почту.
//
// Нижняя часть — наш блок. Он и есть смысл интеграции: в CRM тикет заведён на
// КАНАЛ, а разговор идёт с АДМИНОМ, и без этого блока в CRM не видно, что за
// одним человеком числится пять каналов.

import {
  CHANNEL_PLATFORM_LABEL,
  CHANNEL_RELATION_LABEL,
  type ChannelPlatform,
  type ChannelRelationStatus,
} from "@repo/core";

export type CrmIssueTextInput = {
  /** Дата, когда лид попал в проект. */
  loadedAt: Date;
  channel: {
    title: string;
    memberCount: number | null;
    link: string | null;
    /** Внешний id площадки — у робота это поле называется Chat_id. */
    externalId: string | null;
    platform: ChannelPlatform;
    /** Работает ли канал с нами (CPC/CPA) — relation_status. */
    relationStatus: ChannelRelationStatus | null;
    /** Зарегистрирован в реестре РКН. null = не проверяли. */
    isRkn: boolean | null;
  };
  admin: {
    fullName: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
    /** Памятка об админе из карточки контакта. */
    note: string | null;
  } | null;
  /** Остальные каналы этого админа — без текущего. */
  otherChannels: { title: string; memberCount: number | null }[];
  project: { name: string };
  /** Ссылка на лида в аутрич-туле. Пустая, если WEB_ORIGIN не настроен. */
  leadUrl: string | null;
};

const num = (v: number | null): string => (v === null ? "" : String(v));
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Имя тикета. У робота оно одинаковое у всех («Привлечение блогеров: РСЯ 2_0»),
 *  из-за чего список в CRM выглядит стеной одинаковых строк. Берём название
 *  канала — по нему тикет находится поиском. Менять тут, если менеджеры
 *  попросят иначе. */
export function buildIssueName(channelTitle: string): string {
  return channelTitle.trim() || "Канал без названия";
}

export function buildIssueText(input: CrmIssueTextInput): string {
  const { channel: ch, admin, otherChannels: others } = input;

  // Формат робота. Пробел после двоеточия сохраняем даже у пустых значений —
  // как в оригинале.
  const head = [
    `Дата заливки: ${ymd(input.loadedAt)}`,
    `Название канала: ${ch.title}`,
    `Кол-во подписчиков: ${num(ch.memberCount)}`,
    `Тип монетизации: `,
    `Особые отметки: `,
    `Ссылка: ${ch.link ?? ""}`,
    `Chat_id: ${ch.externalId ?? ""}`,
    `Категория канала: `,
    `Телефон: ${admin?.phone ?? ""}`,
    `Почта партнера: ${admin?.email ?? ""}`,
    `Контакт в ТГ/Макс: ${admin?.username ? `@${admin.username}` : ""}`,
    `Тип блогера: `,
    `Тип площадки: ${CHANNEL_PLATFORM_LABEL[ch.platform] ?? ch.platform}`,
    `Resolution: new`,
  ];

  const tail = ["", "--- Аутрич-тул ---", `Проект: ${input.project.name}`];
  if (input.leadUrl) tail.push(`Лид: ${input.leadUrl}`);

  const adminName = [admin?.fullName, admin?.username && `@${admin.username}`]
    .filter(Boolean)
    .join(" ");
  if (adminName) tail.push(`Админ: ${adminName}`);
  if (admin?.note) tail.push(`Заметка об админе: ${admin.note}`);

  if (others.length) {
    const list = others
      .map((c) => (c.memberCount ? `${c.title} (${c.memberCount})` : c.title))
      .join(", ");
    tail.push(`Другие каналы админа: ${list}`);
  }

  if (ch.isRkn !== null) {
    tail.push(`РКН: ${ch.isRkn ? "зарегистрирован" : "нет в реестре"}`);
  }
  if (ch.relationStatus) {
    tail.push(
      `Статус канала у нас: ${CHANNEL_RELATION_LABEL[ch.relationStatus] ?? ch.relationStatus}`,
    );
  }

  return [...head, ...tail].join("\n");
}
