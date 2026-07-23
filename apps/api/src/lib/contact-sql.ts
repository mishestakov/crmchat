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

// «Контакт готов» — оператор задал, кому/куда слать: @username админа ЛИБО
// явно выбранный способ связи (contact_method.kind: человек/бот/группа/личка
// канала — set-admin). Общий для гейта квалификации (prepareLeads/activate) и
// списка лидов (бейдж «без контакта»).
//
// НЕ засчитываем «у канала просто есть бесплатная личка» (direct_messages_chat_id
// из sync) как готовность: это авто-определение молча выдёргивало лид из инбокса
// «нет контактов» при простом открытии карточки (sync на open находил личку →
// contactReady=true → лид уходил в «в работе» без отправки и без действия
// оператора, список «прыгал»). Личку оператор выбирает явно кнопкой «Использовать
// личку канала» → set-admin пишет contact_method.kind='channel_dm' → ветка ниже.
// MAX-получатель: контакт привязан (project_items.contact_id), но @username у
// него нет и contact_method не задан — TG-условия выше его не ловят. Признаём
// готовым, если у привязанного контакта есть max-пир (max_user_id | max_link),
// как maxPeerRef. Коррелированный подзапрос — не требует join contacts у
// вызывающих (предикат используется в нескольких запросах).
export const contactReadySql = sql<boolean>`(
  ${projectItems.username} is not null
  or (${channels.meta} -> 'contact_method' ->> 'kind') is not null
  or exists (
    select 1 from contacts cr
    where cr.id = ${projectItems.contactId}
      and (cr.properties ->> 'max_user_id' <> '' or cr.properties ->> 'max_link' <> '')
  )
)`;

// «Авто-адресуем» — планировщик реально может отправить: есть @username админа
// (TG-путь prepareLeads) либо max-пир у контакта (MAX-путь attachMaxPeer).
// Готовый (contactReadySql), но НЕ авто-адресуемый лид — «ручной» (личка
// канала/группа/внешний способ): опенер сам не уйдёт. Используется корзиной
// «Вручную» в readiness — счётчик «Готовы к отправке» не должен обещать
// отправку тем, кого планировщик молча пропустит.
export const autoAddressableSql = sql<boolean>`(
  ${projectItems.username} is not null
  or exists (
    select 1 from contacts ca
    where ca.id = ${projectItems.contactId}
      and (ca.properties ->> 'max_user_id' <> '' or ca.properties ->> 'max_link' <> '')
  )
)`;
