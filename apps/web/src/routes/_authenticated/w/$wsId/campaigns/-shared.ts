import type { components } from "@repo/api-client";

// Доменные типы агентского флоу берём из api-client (single source of truth —
// OpenAPI). Локально — только конфиг фаз и форматтеры, не дублируем shape.

export type Placement = components["schemas"]["Placement"];
export type ChainStatus = Placement["chainStatus"]; // not_sent|sent|replied|declined
export type ClientStatus = Placement["clientStatus"]; // pending|approved|rejected|replace
export type ContractStatus = Placement["contractStatus"];
export type CreativeStatus = Placement["creativeStatus"];
// Кампания = agency-проект (тот же Project-ответ, что у bd-проектов).
export type Campaign = components["schemas"]["Project"];

// Фазы кампании — порядок воронки. На проде приходит из projects.phase.
export const CAMPAIGN_PHASES = [
  { key: "briefing", label: "Бриф" },
  { key: "longlist", label: "Лонглист" },
  { key: "review", label: "Согласование" },
  { key: "shortlist", label: "Подтверждение" },
  { key: "production", label: "Запуск" },
  { key: "wrapup", label: "Отчёт" },
] as const;

export type PhaseKey = (typeof CAMPAIGN_PHASES)[number]["key"];

export function phaseLabel(key: string): string {
  return CAMPAIGN_PHASES.find((p) => p.key === key)?.label ?? key;
}

export function formatRub(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("ru-RU") + " ₽";
}

export function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(0) + "k";
  return String(n);
}

// CPV (cost per view) = цена / прогнозный охват, ₽ за просмотр.
export function cpv(price: number | null, views: number | null): string {
  if (price === null || views === null || views === 0) return "—";
  return (price / views).toFixed(2) + " ₽";
}
