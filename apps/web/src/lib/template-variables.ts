import type { VariableOption } from "../components/variable-textarea";
import { PLACEHOLDER_RE } from "./substitute-variables";

// Переменные шаблона рассылки. Бэк substituteVariables берёт их из
// lead.properties + canonical `username`. В канало-центричной схеме значения
// синтезируются из базы каналов на активации (prepareLeads): один опенер на
// админа, поэтому доступны @-handle админа и идентификаторы его каналов.
// Произвольные ключи юзер тоже может вписать — они подсветятся как unknown,
// если их нет в lead.properties.

export const CANONICAL: VariableOption = {
  key: "username",
  label: "@-handle админа",
};

// Из базы каналов (см. apps/api/.../project-scheduling.ts → prepareLeads).
export const CHANNEL_VARIABLES: VariableOption[] = [
  { key: "каналы", label: "все каналы админа (список)" },
  { key: "канал", label: "название канала" },
  { key: "ссылка", label: "ссылка на канал" },
];

export const TEMPLATE_VARIABLES: VariableOption[] = [
  CANONICAL,
  // Имя ОТПРАВИТЕЛЯ (аккаунта, с которого уйдёт сообщение): outreach_name ??
  // firstName. Резолвится на сервере при активации по выбранному аккаунту — в
  // preview значения нет (зависит от аккаунта), placeholder остаётся.
  { key: "отправитель", label: "имя отправителя (из аккаунта)" },
  ...CHANNEL_VARIABLES,
];

export function extractUnknownVariables(
  text: string,
  variables: VariableOption[],
): string[] {
  const known = new Set(variables.map((v) => v.key));
  const unknown = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const key = m[1]!.trim();
    if (!known.has(key)) unknown.add(key);
  }
  return [...unknown];
}
