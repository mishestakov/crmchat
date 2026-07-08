import type { components } from "@repo/api-client";
import { computeDealPricing, type DealPricing } from "@repo/core";

// Доменные типы агентского флоу берём из api-client (single source of truth —
// OpenAPI). Локально — только конфиг фаз. formatRub/formatViews переехали в
// lib/format (шарятся с публичной share-страницей), реэкспорт для совместимости.
export { formatRub, formatViews, cpv } from "../../../../../lib/format";
import type { ShareStep } from "../../../../../lib/share-steps";

export type Placement = components["schemas"]["Placement"];
export type ChainStatus = Placement["chainStatus"]; // not_sent|sent|replied|declined
export type ClientStatus = Placement["clientStatus"]; // pending|approved|rejected
export type ContractStatus = Placement["contractStatus"];
export type CreativeStatus = Placement["creativeStatus"];
// Кампания = agency-проект (тот же Project-ответ, что у bd-проектов).
export type Campaign = components["schemas"]["Project"];

// Полная цена размещения: поля блогера (на размещении) × множители кампании
// (АК/НДС/ОРД). Единый вход в движок для read-only отчётов и P&L — drawer при
// живом редактировании считает свой вариант из черновика теми же аргументами.
// forecast — снапшот прогноза (что обещали клиенту) или живой охват канала.
export function placementPricing(
  campaign: Campaign,
  p: Placement,
  forecastViews: number | null,
): DealPricing {
  return computeDealPricing({
    cost: p.priceAmount ?? 0,
    surchargePercent: p.surchargePercent ?? 0,
    bloggerVat: p.bloggerVat,
    akPercent: campaign.akPercent,
    vat: campaign.vatEnabled,
    vatRate: campaign.vatRate,
    ord3: campaign.ordEnabled,
    // Сплит (срез 5): движок сам делит createShare% на создание/размещение.
    splitEnabled: campaign.splitEnabled,
    createShare: p.createShare,
    forecastViews,
  });
}

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

// На каком клиентском этапе открывается портал по ссылке, скопированной из этой
// фазы кабинета. Партиал: бриф/лонглист/подтверждение клиент по ссылке не видит.
// Один типизированный словарь вместо трёх голых литералов по компонентам —
// переименование фазы/шага ловит компилятор.
export const PHASE_CLIENT_STEP: Partial<Record<PhaseKey, ShareStep>> = {
  review: "bloggers",
  production: "creatives",
  wrapup: "report",
};
