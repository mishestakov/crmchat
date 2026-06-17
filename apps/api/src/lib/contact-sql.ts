import { sql, type SQL } from "drizzle-orm";
import { channels, contacts, projectItems } from "../db/schema.ts";

// Identity-поля контакта (tg_user_id, telegram_username) хранятся
// в `contacts.properties` jsonb — отдельных колонок нет, чтобы юзер мог
// переименовывать/удалять properties без миграций. SQL-выражения для
// этих полей дублировались в 5+ местах; держим единственный shape тут,
// чтобы поменять имя ключа можно было одним правилом.

export const contactTgUserIdSql: SQL<string | null> = sql<string | null>`${contacts.properties}->>'tg_user_id'`;

export const contactUsernameLowerSql: SQL<string | null> = sql<string | null>`lower(${contacts.properties}->>'telegram_username')`;

export const contactUsernameSql: SQL<string | null> = sql<string | null>`${contacts.properties}->>'telegram_username'`;

// «Контакт готов» — каналу есть куда слать опенер: @username админа, либо
// заданный contact_method, либо бесплатная личка. Общий для гейта квалификации
// (prepareLeads/activate) и списка лидов (бейдж «без контакта»).
// «готовый» → канал активен, опенер не ушёл. Сверяемся с username.
// Личка: по direct_messages_chat_id (кладёт sync), не по has_dm (его пишет
// репликатор асинхронно). coalesce star-поля к 0: отсутствие поля трактуем
// как бесплатную личку, иначе null ложно блокировал бы активацию.
export const contactReadySql = sql<boolean>`(
  ${projectItems.username} is not null
  or (${channels.meta} -> 'contact_method' ->> 'kind') is not null
  or (
    coalesce(${channels.meta} ->> 'direct_messages_chat_id', '0') <> '0'
    and coalesce((${channels.meta} ->> 'outgoing_paid_message_star_count')::int, 0) = 0
  )
)`;
