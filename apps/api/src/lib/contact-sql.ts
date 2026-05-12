import { sql, type SQL } from "drizzle-orm";
import { contacts } from "../db/schema.ts";

// Identity-поля контакта (tg_user_id, phone, telegram_username) хранятся
// в `contacts.properties` jsonb — отдельных колонок нет, чтобы юзер мог
// переименовывать/удалять properties без миграций. SQL-выражения для
// этих полей дублировались в 5+ местах; держим единственный shape тут,
// чтобы поменять имя ключа можно было одним правилом.

export const contactTgUserIdSql: SQL<string | null> = sql<string | null>`${contacts.properties}->>'tg_user_id'`;

export const contactPhoneSql: SQL<string | null> = sql<string | null>`${contacts.properties}->>'phone'`;

export const contactUsernameLowerSql: SQL<string | null> = sql<string | null>`lower(${contacts.properties}->>'telegram_username')`;

export const contactUsernameSql: SQL<string | null> = sql<string | null>`${contacts.properties}->>'telegram_username'`;
