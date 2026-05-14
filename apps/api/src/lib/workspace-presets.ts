import type { PropertyType } from "@repo/core";
import { db } from "../db/client.ts";
import {
  properties as propsTable,
  workspaces,
  type PropertyValue,
} from "../db/schema.ts";

// Preset-properties, которые сидятся в каждый workspace при его создании.
// 1:1 структура с donor (за вычетом avatarUrl) — см. PROPERTY_METADATA в
// reconstructed/src/lib/properties.ts и getDefaultPropertiesConfig в
// reconstructed/src/routes/.../onboarding/$stepId.tsx.
type PresetSpec = {
  key: string;
  name: string;
  type: PropertyType;
  required?: boolean;
  showInList?: boolean;
  values?: PropertyValue[];
};

// `stage` preset-property удалена в 12.6: после 12.1 стадии канбана живут
// на проекте (project.stages jsonb), а не как single_select-property
// контакта. Старые записи property с key='stage' в существующих
// воркспейсах безвредны — они сиротствуют и не используются.
const PRESETS: PresetSpec[] = [
  { key: "full_name", name: "Имя", type: "text", required: true, showInList: true },
  { key: "description", name: "Описание", type: "textarea", showInList: false },
  { key: "telegram_username", name: "Telegram", type: "text", showInList: true },
  // tg_user_id — служебное поле, не показываем в списке. Заполняется системно
  // (TG-импорт, outreach worker, listener, lead→contact конверсия). Юзер не
  // редактирует, но валидатору нужно знать что ключ существует.
  { key: "tg_user_id", name: "TG ID", type: "text", showInList: false },
];

export async function seedDefaultProperties(workspaceId: string) {
  await db
    .insert(propsTable)
    .values(
      PRESETS.map((p, i) => ({
        workspaceId,
        key: p.key,
        name: p.name,
        type: p.type,
        order: i,
        required: p.required ?? false,
        showInList: p.showInList ?? true,
        internal: true,
        values: p.values ?? null,
      })),
    )
    .onConflictDoNothing({
      target: [propsTable.workspaceId, propsTable.key],
    });
}

// Досыпает новые preset-properties в каждый существующий workspace. Идемпотентно
// через onConflictDoNothing. Запускается на boot — когда добавляем новый preset
// (например tg_user_id), старые workspace получают его без миграций.
export async function syncPresetsForAllWorkspaces() {
  const ws = await db.select({ id: workspaces.id }).from(workspaces);
  const results = await Promise.allSettled(
    ws.map((w) => seedDefaultProperties(w.id)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (ws.length > 0) {
    console.log(
      `[boot] preset-properties re-synced: ${ws.length - failed}/${ws.length} workspace(s)`,
    );
  }
  if (failed > 0) {
    for (const r of results) {
      if (r.status === "rejected") {
        console.error(`[boot] preset re-sync failed:`, r.reason);
      }
    }
  }
}
