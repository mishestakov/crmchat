// Заголовок вкладки браузера по маршруту. Дефолт — «CRM»; страницы —
// «Название — CRM». Ключ — TanStack routeId leaf-матча (с $-параметрами).
// Держим централизованно, чтобы не расставлять head в 42 route-файла;
// новый маршрут без записи здесь просто получит дефолт «CRM».
const TITLES: Record<string, string> = {
  "/login": "Вход",
  "/auth/finish": "Вход",
  "/accept-invite/$wsId/$code": "Приглашение",
  "/share/$token": "Просмотр",
  "/share/conv/$token": "Переписка",
  "/_authenticated/w/$wsId/channels": "Каналы",
  "/_authenticated/w/$wsId/rkn": "РКН-реестр",
  "/_authenticated/w/$wsId/platform-active": "Каналы Яндекса",
  "/_authenticated/w/$wsId/projects": "Проекты",
  "/_authenticated/w/$wsId/projects/": "Проекты",
  "/_authenticated/w/$wsId/projects/new": "Новый проект",
  "/_authenticated/w/$wsId/projects/$projectId/": "Проект",
  "/_authenticated/w/$wsId/projects/$projectId/kanban": "Канбан",
  "/_authenticated/w/$wsId/projects/$projectId/leads": "Лиды",
  "/_authenticated/w/$wsId/projects/$projectId/accounts": "Аккаунты проекта",
  "/_authenticated/w/$wsId/campaigns": "Кампании",
  "/_authenticated/w/$wsId/campaigns/": "Кампании",
  "/_authenticated/w/$wsId/campaigns/new": "Новая кампания",
  "/_authenticated/w/$wsId/campaigns/$campaignId": "Кампания",
  "/_authenticated/w/$wsId/campaigns/client/$clientId": "Клиент",
  "/_authenticated/w/$wsId/outreach/accounts/": "Аккаунты",
  "/_authenticated/w/$wsId/outreach/accounts/new": "Новый аккаунт",
  "/_authenticated/w/$wsId/outreach/accounts/$accountId": "Аккаунт",
  "/_authenticated/w/$wsId/outreach/schedule": "Расписание",
  "/_authenticated/w/$wsId/outreach/dunning": "Пиналка",
  "/_authenticated/w/$wsId/contacts/$id/": "Контакт",
  "/_authenticated/w/$wsId/contacts/$id/edit": "Контакт · правка",
  "/_authenticated/w/$wsId/properties/": "Свойства",
  "/_authenticated/w/$wsId/properties/new": "Новое свойство",
  "/_authenticated/w/$wsId/properties/$propertyId/edit": "Свойство · правка",
  "/_authenticated/w/$wsId/settings/": "Настройки",
  "/_authenticated/w/$wsId/settings/integrations": "Интеграции",
  "/_authenticated/w/$wsId/settings/workspace/": "Воркспейс",
  "/_authenticated/w/$wsId/settings/workspace/invite": "Приглашение",
  "/_authenticated/w/$wsId/stage-templates": "Шаблоны стадий",
};

export function pageTitle(routeId: string | undefined): string {
  const name = routeId ? TITLES[routeId] : undefined;
  return name ? `${name} — CRM` : "CRM";
}
