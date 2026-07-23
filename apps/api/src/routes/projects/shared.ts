// Общие для роутов проектов символы (нужны >1 файлу-потребителю): схема
// параметров, опенер/пиналка, enum-схемы, схема Project и его сериализация.
import { z } from "@hono/zod-openapi";
import {
  outreachAccountsMode,
  projects,
  projectPhase,
  projectStatus,
} from "../../db/schema.ts";
import { canFillDunning } from "@repo/core";

export const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});

const DelaySchema = z.object({
  period: z.enum(["minutes", "hours", "days"]),
  value: z.number().int().min(0).max(365),
});

// Форма рассылки: опенер (проектный, первое касание) + пиналка (на воркспейсе).
const VariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal("sticker"),
    setName: z.string().min(1).max(64),
    uniqueId: z.string().min(1).max(64),
  }),
]);
export const OpenerSchema = z.object({
  // Пустой text допустим (draft без опенера); непустоту требует гейт /activate.
  text: z.string().max(4000),
  warmText: z.string().max(4000).nullable().optional(),
  // Проверочный опенер для сегмента «нет РКН» (см. ProjectOpener.rknText).
  rknText: z.string().max(4000).nullable().optional(),
});
// Экспортируется для workspaces.ts — пиналка живёт на воркспейсе (одна на все
// проекты). В проекте остаётся только опенер.
export const DunningSchema = z
  .object({
    pings: z.array(VariantSchema),
    intervals: z.array(DelaySchema),
  })
  // Пул должен покрывать каданс с чередованием текст/котик (раздельно, с
  // graceful-добором) — иначе серия выйдет короче. Пустой каданс валиден.
  .refine(
    (d) =>
      canFillDunning(
        d.pings.filter((p) => p.kind === "text").length,
        d.pings.filter((p) => p.kind === "sticker").length,
        d.intervals.length,
      ),
    { error: "Не хватает текстов/котиков на каданс пиналки", path: ["pings"] },
  );

const ProjectStatusSchema = z.enum(projectStatus.enumValues);
export const PhaseSchema = z.enum(projectPhase.enumValues);
export const AccountsModeSchema = z.enum(outreachAccountsMode.enumValues);

export const StageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  order: z.number().int(),
});

export const ProjectSchema = z
  .object({
    id: z.string(),
    trackId: z.string(),
    name: z.string(),
    status: ProjectStatusSchema,
    // agency-поля (kind='agency'). Для bd-проектов phase='briefing' и brief-*
    // null — UI их не показывает.
    phase: PhaseSchema,
    brief: z.string().nullable(),
    budgetAmount: z.number().nullable(),
    periodStart: z.iso.datetime().nullable(),
    periodEnd: z.iso.datetime().nullable(),
    tov: z.string().nullable(),
    constraints: z.string().nullable(),
    // Ценовые настройки кампании (срез 3): множители цепочки сделки.
    akPercent: z.number(),
    vatEnabled: z.boolean(),
    vatRate: z.number(),
    ordEnabled: z.boolean(),
    // Сплит создание/размещение (срез 5): +3% ОРД только на долю размещения.
    splitEnabled: z.boolean(),
    stages: z.array(StageSchema),
    accountsMode: AccountsModeSchema,
    accountsSelected: z.array(z.string()),
    // Опенер — проектный (первое касание). Пиналка живёт на воркспейсе.
    // Пустой text = кампания ещё не готова к запуску.
    opener: OpenerSchema,
    activatedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    // Клиент финализировал медиаплан (фаза «Согласование»): решения заморожены.
    // null = ещё правит / не дошли до согласования. Менеджер может переоткрыть.
    clientFinalizedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    // SUM(contacts.unread_count) по всем лидам проекта с фильтром по доступным
    // member'у аккаунтам. Считается только в GET /projects (list). Для single-
    // project ответов (POST/PATCH/activate/...) всегда 0 — фронт инвалидирует
    // список и подтянет свежий sum.
    unreadCount: z.number().int(),
    // Есть ли среди лидов проекта диалог с ручной пометкой «непрочитано»
    // (contacts.marked_unread) — точка в сайдбаре при unreadCount=0.
    // Та же семантика «только в list», что у unreadCount.
    hasMarkedUnread: z.boolean(),
  })
  .openapi("Project");

export function serializeProject(
  row: typeof projects.$inferSelect,
  unreadCount = 0,
  hasMarkedUnread = false,
) {
  return {
    id: row.id,
    trackId: row.trackId,
    name: row.name,
    status: row.status,
    phase: row.phase,
    brief: row.brief,
    budgetAmount: row.budgetAmount === null ? null : Number(row.budgetAmount),
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    tov: row.tov,
    constraints: row.constraints,
    akPercent: Number(row.akPercent),
    vatEnabled: row.vatEnabled,
    vatRate: Number(row.vatRate),
    ordEnabled: row.ordEnabled,
    splitEnabled: row.splitEnabled,
    stages: row.stages,
    accountsMode: row.accountsMode,
    accountsSelected: row.accountsSelected,
    opener: row.opener,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    clientFinalizedAt: row.clientFinalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    unreadCount,
    hasMarkedUnread,
  };
}
