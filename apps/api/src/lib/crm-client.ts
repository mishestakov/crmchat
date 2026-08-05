// Клиент корпоративной CRM Яндекса (crm.yandex-team.ru). Механика и решения —
// specs/crm-integration.md, граф статусов — @repo/core (crm.ts).
//
// Шлём синхронно из ручек: очереди и воркера в MVP нет. Ошибка не теряется —
// вызывающий пишет её в project_items.crm_sync_error, а UI показывает кнопку
// «повторить». CRM внутренняя, недоступна редко, а один вызов ~300 мс.

import { CRM_WORKFLOW_ID } from "@repo/core";

const HOST = process.env.CRM_HOST ?? "crm.yandex-team.ru";
const TOKEN = process.env.CRM_TOKEN ?? "";

/** Интеграция настроена? Без токена ручки квалификации работают локально
 *  (вердикт сохраняется), но в CRM ничего не уезжает — удобно в dev. */
export const isCrmEnabled = (): boolean => TOKEN.length > 0;

export class CrmError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CrmError";
    this.status = status;
  }
}

async function call<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://${HOST}/api${path}`, {
    method,
    headers: {
      Authorization: `OAuth ${TOKEN}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // не-JSON бывает при редиректе на авторизацию — отдадим как есть в сообщении
  }
  if (!res.ok) {
    const msg =
      (data as { Message?: string } | null)?.Message ?? text.slice(0, 200);
    throw new CrmError(msg || `${res.status} ${res.statusText}`, res.status);
  }
  return data as T;
}

// --- типы ответов (только то, что реально читаем) --------------------------

export type CrmIssue = {
  id: number;
  state_id: number;
  resolution_id: number | null;
};

export type CrmTransitionsResponse = {
  current: { id: string; name: string; resolution_name: string | null };
  transitions: { id: string; name: string; resolution_name: string | null }[];
};

// --- операции --------------------------------------------------------------

// createIssue здесь больше нет: создание тикетов остановлено (04.08, решение
// команды привлечения) — тикеты заводятся в самой CRM и приезжают к нам
// пуллом (crm-pull.ts). Механика создания задокументирована в
// specs/crm-integration.md §3.1 на случай отката решения.

/** Исполнить переход. `transitionId` — простой id статуса ("511") либо
 *  составной "статус_резолюция" ("8_562"): резолюция уезжает вместе со
 *  статусом, отдельного поля под неё нет.
 *
 *  Внимание: сервер НЕ проверяет граф — примет и нелегальный переход. Поэтому
 *  легальность проверяем у себя (crmTransitionOptions), а не полагаемся на 400. */
export function executeTransition(
  issueId: number,
  transitionId: string,
): Promise<CrmIssue> {
  return call<CrmIssue>("POST", `/v0/issue/${issueId}/transition/execute`, {
    state_id: transitionId,
  });
}

/** Легальные переходы конкретного тикета — живой источник, в отличие от
 *  константы графа. Дёргаем при открытии карточки: если в CRM добавят причину,
 *  менеджер увидит её без передеплоя. */
export function getTransitions(
  issueId: number,
): Promise<CrmTransitionsResponse> {
  return call<CrmTransitionsResponse>("GET", `/v0/issue/${issueId}/transitions`);
}

// --- пуллер (specs/crm-integration.md §3.5) --------------------------------

export type CrmFilteredIssue = {
  id: number;
  state_id: number;
  resolution_id: number | null;
  /** ВНУТРЕННИЙ id CRM (не яндексовый Uid); 0 = «ничей». */
  owner_id: number;
  /** В ответе поле с заглавной O — не как в фильтре. */
  modified_On: string | null;
};

/** Дельта тикетов воркфлоу, изменённых начиная с `modifiedSince`.
 *  Без даты — первая страница всего воркфлоу (limit максимум 1000, offset'а
 *  в API нет — базу больше 1000 разово не вычитать, только окнами по датам).
 *  ВАЖНО: невалидный формат даты CRM молча игнорирует и отдаёт всё — размер
 *  ответа логирует вызывающий. */
export function filterIssues(
  modifiedSince: Date | null,
): Promise<CrmFilteredIssue[]> {
  return call<CrmFilteredIssue[]>("POST", "/v0/issue/filtered", {
    filter: {
      workflow_id: [CRM_WORKFLOW_ID],
      ...(modifiedSince ? { modified_on: [modifiedSince.toISOString()] } : {}),
    },
    fields: ["id", "state_id", "resolution_id", "owner_id", "modified_on"],
    limit: 1000,
  });
}

export type CrmIssueFull = {
  id: number;
  state_id: number;
  resolution_id: number | null;
  name: string;
  text: string | null;
  /** Login — то, что менеджеры пишут в users.crm_login. */
  owner: { Login?: string | null } | null;
};

/** Полный тикет: text (описание робота-заливщика — из него парсим канал)
 *  и owner.Login отдаются только здесь, filtered их не возвращает. */
export function getIssueFull(issueId: number): Promise<CrmIssueFull> {
  return call<CrmIssueFull>("GET", `/v0/issue/${issueId}`);
}
