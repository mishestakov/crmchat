import type { PropertyType } from "@repo/core";
import { db } from "../db/client";
import { properties as propsTable, type PropertyValue } from "../db/schema";

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

const DEFAULT_STAGE_VALUES: PropertyValue[] = [
  { id: "lead", name: "Лид" },
  { id: "talk", name: "Беседа" },
  { id: "offer", name: "Предложение" },
  { id: "deal", name: "Переговоры" },
  { id: "won", name: "Закрыт" },
];

const PRESETS: PresetSpec[] = [
  { key: "full_name", name: "Имя", type: "text", required: true, showInList: true },
  { key: "description", name: "Описание", type: "textarea", showInList: false },
  { key: "email", name: "Email", type: "email", showInList: true },
  { key: "phone", name: "Телефон", type: "tel", showInList: true },
  { key: "telegram_username", name: "Telegram", type: "text", showInList: true },
  { key: "url", name: "Ссылка", type: "url", showInList: false },
  { key: "amount", name: "Сумма", type: "number", showInList: true },
  {
    key: "stage",
    name: "Стадия",
    type: "single_select",
    required: true,
    showInList: true,
    values: DEFAULT_STAGE_VALUES,
  },
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
