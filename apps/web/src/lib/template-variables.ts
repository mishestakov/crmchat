import type { paths } from "@repo/api-client";
import type { VariableOption } from "../components/variable-textarea";
import { PLACEHOLDER_RE } from "./substitute-variables";

// Источники переменных шаблона рассылки. Бэк substituteVariables берёт:
//   1) lead.properties[key] — снимок CSV-строки под raw header'ами.
//   2) canonical scalar `username` — TG @-handle, не в properties.
// Список variables для UI зеркалит CSV-колонки прошлых импортов.

export const CANONICAL: VariableOption = {
  key: "username",
  label: "@-handle Telegram",
};

type ProjectImport =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/imports"]["get"]["responses"][200]["content"]["application/json"][number];

// Все CSV-headers из импортов проекта — под теми же именами что в файле.
// Identifier-колонку (usernameColumn) исключаем: её значение доступно как
// canonical {{username}}, дубль в jsonb не делаем.
export function buildVariablesFromImports(
  imports: ProjectImport[] | undefined,
): VariableOption[] {
  const seen = new Set<string>();
  const options: VariableOption[] = [];
  for (const imp of imports ?? []) {
    const sm = imp.sourceMeta;
    for (const col of sm.columns ?? []) {
      if (col === sm.usernameColumn) continue;
      const k = col.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      options.push({ key: col });
    }
  }
  return [CANONICAL, ...options];
}

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
