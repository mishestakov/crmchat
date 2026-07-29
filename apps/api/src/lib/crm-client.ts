// Клиент корпоративной CRM Яндекса (crm.yandex-team.ru). Механика и решения —
// specs/crm-integration.md, граф статусов — @repo/core (crm.ts).
//
// Шлём синхронно из ручек: очереди и воркера в MVP нет. Ошибка не теряется —
// вызывающий пишет её в project_items.crm_sync_error, а UI показывает кнопку
// «повторить». CRM внутренняя, недоступна редко, а один вызов ~300 мс.

import {
  CRM_CATEGORY_ID,
  CRM_ISSUE_TYPE_ID,
  CRM_QUEUE_ID,
  CRM_WORKFLOW_ID,
} from "@repo/core";

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

/** Создание тикета. `state_id` в теле игнорируется — тикет всегда рождается
 *  в «Открыт», доводить до нужного статуса переходами.
 *  `owner` достаточно одного логина: Uid и внутренний id CRM резолвит сама.
 *  `category_id` обязателен — без него не пройдёт ни один переход с
 *  резолюцией («У обращения должна быть заполнена категория»). */
export function createIssue(args: {
  name: string;
  text: string;
  ownerLogin: string;
}): Promise<CrmIssue> {
  return call<CrmIssue>("POST", "/v0/issue", {
    workflow_id: CRM_WORKFLOW_ID,
    queue_id: CRM_QUEUE_ID,
    issue_type_id: CRM_ISSUE_TYPE_ID,
    category_id: CRM_CATEGORY_ID,
    name: args.name,
    text: args.text,
    owner: { Login: args.ownerLogin },
  });
}

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
