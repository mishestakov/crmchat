import type { paths } from "@repo/api-client";
import type { VariableOption } from "../components/variable-textarea";
import { PLACEHOLDER_RE } from "./substitute-variables";

// Источники переменных шаблона рассылки. Бэк substituteVariables берёт:
//   1) lead.properties[key] — то что лежит в jsonb лида.
//   2) canonical scalar `username` — TG @-handle, не в properties.
// Список variables для UI должен зеркалить эти источники.

export const CANONICAL: VariableOption = {
  key: "username",
  label: "@-handle Telegram",
};

type ProjectImport =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/imports"]["get"]["responses"][200]["content"]["application/json"][number];

// Для проектного шаблона показываем только то что реально лежит в
// lead.properties: identifier'ы (usernameColumn, channelUsernameColumn)
// исключаем — они в jsonb не идут; замаппленные через propertyMappings —
// под property-key, не под raw header; остальные columns — под raw header.
export function buildVariablesFromImports(
  imports: ProjectImport[] | undefined,
): VariableOption[] {
  const seen = new Set<string>();
  const options: VariableOption[] = [];
  for (const imp of imports ?? []) {
    const sm = imp.sourceMeta;
    const consumed = new Set<string>();
    if (sm.usernameColumn) consumed.add(sm.usernameColumn);
    if (sm.channelUsernameColumn) consumed.add(sm.channelUsernameColumn);
    for (const [propKey, csvHeader] of Object.entries(sm.propertyMappings ?? {})) {
      consumed.add(csvHeader);
      const k = propKey.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      options.push({ key: propKey, label: `← ${csvHeader}` });
    }
    for (const col of sm.columns ?? []) {
      if (consumed.has(col)) continue;
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
