import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, sql } from "./db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projects,
  projectItems,
  stageTemplates,
  tracks,
  users,
  workspaceMembers,
  workspaces,
  type ProjectMessage,
  type ProjectStage,
} from "./db/schema.ts";
import { seedDefaultProperties } from "./lib/workspace-presets.ts";

// Top-100 реальных TG-каналов из исследования рынка маркетинга — для
// демо «жирной» базы каналов в каждом workspace. Файл seed-data/top-channels.json
// — первые 100 строк из ~14k каналов в outreach-CSV; формат
// {title, username, adminUsername, subscribers, chatId}.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOP_CHANNELS = JSON.parse(
  readFileSync(resolve(__dirname, "seed-data/top-channels.json"), "utf-8"),
) as Array<{
  title: string;
  username: string;
  adminUsername: string;
  subscribers: number;
  chatId: string;
}>;

// Жирный demo-seed для двух показательных юз-кейсов:
//   1. ws_sasha "Саша CPC" — внутренняя BD-команда продакта (см. product.md):
//      4 типа работы (Привлечение/Удержание/Отток/Ad-hoc), у каждого свой
//      шаблон стадий + проекты в разных статусах + лиды на разных стадиях.
//   2. ws_cpp "CPP Agency" — рекламное агентство (см. agency-context.md):
//      клиенты Coca-Cola/Beeline/Skyeng, проекты-кампании с медиапланом
//      из TG-каналов на разных стадиях согласования.
//
// Юзеры:
//   - usr_sasha — admin в ws_sasha
//   - usr_zhenya — admin в ws_cpp
//   - usr_anna / usr_boris — member'ы (для проверки RBAC).
//
// Идемпотентно: фикс-id + onConflictDoNothing/DoUpdate.

// === Юзеры =================================================================

const DEV_USERS = [
  { id: "usr_sasha", tgUserId: "-1", name: "Саша" },
  { id: "usr_zhenya", tgUserId: "-2", name: "Женя" },
  { id: "usr_anna", tgUserId: "-3", name: "Анна" },
  { id: "usr_boris", tgUserId: "-4", name: "Борис" },
] as const;

for (const u of DEV_USERS) {
  await db
    .insert(users)
    .values(u)
    .onConflictDoUpdate({
      target: users.id,
      set: { name: u.name, updatedAt: new Date() },
    });
}
console.log(`upserted ${DEV_USERS.length} users`);

const SASHA_ID = "usr_sasha";
const ZHENYA_ID = "usr_zhenya";
const ANNA_ID = "usr_anna";
const BORIS_ID = "usr_boris";

// === Workspace 1: ws_sasha "Саша CPC" ======================================

const SASHA_WS = "ws_sasha";

await db
  .insert(workspaces)
  .values({ id: SASHA_WS, name: "Саша CPC", createdBy: SASHA_ID })
  .onConflictDoNothing({ target: workspaces.id });

await db
  .insert(workspaceMembers)
  .values([
    { workspaceId: SASHA_WS, userId: SASHA_ID, role: "admin" },
    { workspaceId: SASHA_WS, userId: ANNA_ID, role: "member" },
  ])
  .onConflictDoNothing();

await seedDefaultProperties(SASHA_WS);

// Папки Саши — 4 типа работ из product.md.
await db
  .insert(tracks)
  .values([
    { id: "trk_sasha_acquire", workspaceId: SASHA_WS, name: "Привлечение", createdBy: SASHA_ID },
    { id: "trk_sasha_retain", workspaceId: SASHA_WS, name: "Удержание", createdBy: SASHA_ID },
    { id: "trk_sasha_churn", workspaceId: SASHA_WS, name: "Отток", createdBy: SASHA_ID },
    { id: "trk_sasha_adhoc", workspaceId: SASHA_WS, name: "Ad-hoc", createdBy: SASHA_ID },
  ])
  .onConflictDoNothing({ target: tracks.id });

// === Stage templates: для Саши 4 шаблона под каждый тип ====================

const SASHA_ACQUIRE_STAGES: ProjectStage[] = [
  { id: "new", name: "Новый", order: 0 },
  { id: "in_progress", name: "Идёт диалог", order: 1 },
  { id: "interested", name: "Заинтересован", order: 2 },
  { id: "agreed", name: "Договорились", order: 3 },
  { id: "won", name: "Подключён", order: 4 },
  { id: "lost", name: "Отказ", order: 5 },
];

const SASHA_RETAIN_STAGES: ProjectStage[] = [
  { id: "scheduled", name: "Запланирован контакт", order: 0 },
  { id: "talking", name: "На связи", order: 1 },
  { id: "feedback", name: "Собрали обратную связь", order: 2 },
  { id: "done", name: "Закрыт", order: 3 },
];

const SASHA_CHURN_STAGES: ProjectStage[] = [
  { id: "alert", name: "Замечен спад", order: 0 },
  { id: "contacted", name: "Связались", order: 1 },
  { id: "diagnosed", name: "Поняли причину", order: 2 },
  { id: "fixed", name: "Восстановлен", order: 3 },
  { id: "lost", name: "Ушёл", order: 4 },
];

const SASHA_ADHOC_STAGES: ProjectStage[] = [
  { id: "new", name: "Новая задача", order: 0 },
  { id: "in_progress", name: "В работе", order: 1 },
  { id: "done", name: "Закрыто", order: 2 },
];

await db
  .insert(stageTemplates)
  .values([
    { id: "stt_sasha_acquire", workspaceId: SASHA_WS, name: "Привлечение", stages: SASHA_ACQUIRE_STAGES, createdBy: SASHA_ID },
    { id: "stt_sasha_retain", workspaceId: SASHA_WS, name: "Удержание", stages: SASHA_RETAIN_STAGES, createdBy: SASHA_ID },
    { id: "stt_sasha_churn", workspaceId: SASHA_WS, name: "Отток", stages: SASHA_CHURN_STAGES, createdBy: SASHA_ID },
    { id: "stt_sasha_adhoc", workspaceId: SASHA_WS, name: "Ad-hoc", stages: SASHA_ADHOC_STAGES, createdBy: SASHA_ID },
  ])
  .onConflictDoNothing({ target: stageTemplates.id });

// === Сашины проекты + лиды =================================================

// Цепочка сообщений «холодное привлечение» (5.1 из product.md): Привет /
// Ты живой / Эй грустно с задержками сутки/трое суток.
const ACQUIRE_MESSAGES: ProjectMessage[] = [
  {
    id: "msg1",
    text: "Привет, {{full_name}}! Я Саша из @CPCsupport. Видел твой канал и хочу обсудить интересную возможность сотрудничества по нашей партнёрке.",
    delay: { period: "minutes", value: 0 },
  },
  {
    id: "msg2",
    text: "Привет, ты тут? :) Хотел вернуться к разговору про условия сотрудничества — на этой неделе у нас стартовая ставка повышенная.",
    delay: { period: "days", value: 1 },
  },
  {
    id: "msg3",
    text: "Эй, грустно. Если совсем неинтересно — без проблем, напиши «нет». Иначе попозже стукнусь ещё раз.",
    delay: { period: "days", value: 3 },
  },
];

const RETAIN_MESSAGES: ProjectMessage[] = [
  {
    id: "msg1",
    text: "Привет, {{full_name}}! Заглянул узнать как дела с потоком и выплатами. Видел рост в канале — поздравляю.",
    delay: { period: "minutes", value: 0 },
  },
  {
    id: "msg2",
    text: "Если есть какие-то идеи или замечания по нашей партнёрке — пиши, я на связи всегда.",
    delay: { period: "days", value: 7 },
  },
];

const CHURN_MESSAGES: ProjectMessage[] = [
  {
    id: "msg1",
    text: "Привет {{full_name}}, заметил спад выплат за последние недели. Можем созвониться обсудить как помочь восстановить ситуацию?",
    delay: { period: "minutes", value: 0 },
  },
  {
    id: "msg2",
    text: "Стукнусь ещё раз — если время неудобное, скажи когда можно. Хочется разобраться вместе.",
    delay: { period: "days", value: 2 },
  },
];

const ADHOC_MESSAGES: ProjectMessage[] = [
  {
    id: "msg1",
    text: "Привет, нужна помощь — хотел подсказать процесс перехода на самозанятость. Если интересно, напиши.",
    delay: { period: "minutes", value: 0 },
  },
];

// Helper: сгенерить лидов для проекта с распределением по стадиям.
type LeadSpec = {
  username: string;
  full_name: string;
  niche?: string;
  stageId: string;
  // если задано — лид «ответил» (зелёная иконка, contactCreated и т.п.)
  replied?: boolean;
};

let leadCounter = 0;
function leadId() {
  leadCounter++;
  return `pi_${String(leadCounter).padStart(4, "0")}`;
}
let tgFakeCounter = -100;
function fakeTgId() {
  tgFakeCounter--;
  return String(tgFakeCounter);
}

// Для replied-лидов в seed одновременно создаётся contact (на канбане
// отображаются только те у кого есть contactId — реалистично симулирует
// «ответил → стал контактом»). Накапливаем здесь, в конце дамп'ом INSERT'им.
const seedContacts: (typeof contacts.$inferInsert)[] = [];
// Дедуп: один @username в одном воркспейсе — один contact. Если тот же @
// встречается в нескольких проектах, второй лид цепляется за того же contact.
// Это правило 5A — partial unique по (workspace, lower(@)) на уровне БД.
const contactByWsUsername = new Map<string, string>();
// Канало-центричная модель: каждый блогер демо = канал с этим блогером-админом.
// buildLeads заводит каналы и channel_admins (как seedRealChannels, но для
// демо-персон). Дедуп по ws:lower(username), накапливаем и INSERT'им перед
// project_items (FK на channel_id). Username демо-блогеров не пересекаются с
// TOP_CHANNELS (проверено) — конфликта unique(ws,platform,username) нет.
const seedChannels: (typeof channels.$inferInsert)[] = [];
const seedChannelAdmins: (typeof channelAdmins.$inferInsert)[] = [];
const channelByWsUsername = new Map<string, string>();

function buildLeads(
  projectId: string,
  workspaceId: string,
  ownerUserId: string,
  specs: LeadSpec[],
  extraProps?: Record<string, string>,
) {
  return specs.map((s) => {
    const lid = leadId();
    const usernameKey = `${workspaceId}:${s.username.toLowerCase()}`;
    let contactId = contactByWsUsername.get(usernameKey) ?? null;
    let tg: string;
    if (contactId) {
      // Подцепляем tgUserId уже выданный первому лиду с этим @.
      tg = (
        seedContacts.find((c) => c.id === contactId)!.properties as Record<
          string,
          string
        >
      ).tg_user_id!;
    } else {
      tg = fakeTgId();
      // После 5A контакт создаётся на импорте, не только для replied. Для
      // правдоподобия sticky-логики оставляем replied → primary_account_id
      // (это уже не делается тут, но лид с replied=true потом нужен в /contacts).
      contactId = `cont_${lid}`;
      contactByWsUsername.set(usernameKey, contactId);
      seedContacts.push({
        id: contactId,
        workspaceId,
        properties: {
          full_name: s.full_name,
          telegram_username: s.username,
          tg_user_id: tg,
        },
        createdBy: ownerUserId,
      });
    }
    // Канал блогера: дедуп по ws:lower(username) (тот же блогер в разных
    // проектах → один канал, placement'ы цепляются за него). channel_admins
    // линкуем при первом создании канала (контакт-админ = тот же блогер).
    const chKey = `${workspaceId}:${s.username.toLowerCase()}`;
    let channelId = channelByWsUsername.get(chKey) ?? null;
    if (!channelId) {
      channelId = `chl_${workspaceId}_${s.username.toLowerCase()}`;
      channelByWsUsername.set(chKey, channelId);
      seedChannels.push({
        id: channelId,
        workspaceId,
        platform: "telegram",
        username: s.username,
        title: s.full_name,
        link: `https://t.me/${s.username}`,
        createdBy: ownerUserId,
      });
      seedChannelAdmins.push({ channelId, contactId });
    }
    return {
      id: lid,
      workspaceId,
      projectId,
      kind: "placement" as const,
      channelId,
      stageId: s.stageId,
      username: s.username,
      tgUserId: tg,
      repliedAt: s.replied
        ? new Date(Date.now() - Math.random() * 7 * 86_400_000)
        : null,
      contactId,
      properties: {
        full_name: s.full_name,
        ...(s.niche && { niche: s.niche }),
        ...extraProps,
      },
    };
  });
}

// === ws_sasha проекты =====================================================

await db
  .insert(projects)
  .values([
    // ПРИВЛЕЧЕНИЕ
    {
      id: "prj_acq_jan",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_acquire",
      name: "Привлечение январь 2026",
      kind: "outreach",
      status: "active",
      stages: SASHA_ACQUIRE_STAGES,
      messages: ACQUIRE_MESSAGES,
      activatedAt: new Date(Date.now() - 5 * 86_400_000),
      createdBy: SASHA_ID,
    },
    {
      id: "prj_acq_dec",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_acquire",
      name: "Привлечение декабрь 2025",
      kind: "outreach",
      status: "done",
      stages: SASHA_ACQUIRE_STAGES,
      messages: ACQUIRE_MESSAGES,
      activatedAt: new Date(Date.now() - 35 * 86_400_000),
      completedAt: new Date(Date.now() - 5 * 86_400_000),
      createdBy: SASHA_ID,
    },
    {
      id: "prj_acq_feb",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_acquire",
      name: "Привлечение февраль 2026",
      kind: "outreach",
      status: "draft",
      stages: SASHA_ACQUIRE_STAGES,
      messages: ACQUIRE_MESSAGES,
      createdBy: SASHA_ID,
    },
    // УДЕРЖАНИЕ
    {
      id: "prj_ret_q1",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_retain",
      name: "Q1 2026 — ценные партнёры",
      kind: "outreach",
      status: "active",
      stages: SASHA_RETAIN_STAGES,
      messages: RETAIN_MESSAGES,
      activatedAt: new Date(Date.now() - 12 * 86_400_000),
      createdBy: SASHA_ID,
    },
    // ОТТОК
    {
      id: "prj_chr_nov",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_churn",
      name: "Снижение выплат — ноябрь",
      kind: "outreach",
      status: "active",
      stages: SASHA_CHURN_STAGES,
      messages: CHURN_MESSAGES,
      activatedAt: new Date(Date.now() - 8 * 86_400_000),
      createdBy: SASHA_ID,
    },
    // AD-HOC
    {
      id: "prj_adh_self",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_adhoc",
      name: "Переход на самозанятость",
      kind: "outreach",
      status: "active",
      stages: SASHA_ADHOC_STAGES,
      messages: ADHOC_MESSAGES,
      activatedAt: new Date(Date.now() - 3 * 86_400_000),
      createdBy: SASHA_ID,
    },
    {
      id: "prj_adh_unban",
      workspaceId: SASHA_WS,
      trackId: "trk_sasha_adhoc",
      name: "Разбан ботов после правок",
      kind: "outreach",
      status: "active",
      stages: SASHA_ADHOC_STAGES,
      messages: ADHOC_MESSAGES,
      activatedAt: new Date(Date.now() - 1 * 86_400_000),
      createdBy: SASHA_ID,
    },
  ])
  .onConflictDoNothing({ target: projects.id });

// Лиды для prj_acq_jan — основной демо-канбан Привлечения с распределением
// по всем стадиям. Это «вау»-доска для Саши.
const sashaAcqJanLeads = buildLeads("prj_acq_jan", SASHA_WS, SASHA_ID, [
  // Новый — холодные ещё не получившие ответ
  { username: "crypto_market_pro", full_name: "Денис Фролов", niche: "крипта", stageId: "new" },
  { username: "stocks_daily", full_name: "Олег Курский", niche: "фондовый рынок", stageId: "new" },
  { username: "fintech_blogger", full_name: "Анна Радова", niche: "финтех", stageId: "new" },
  { username: "investments_hub", full_name: "Михаил Зорин", niche: "инвестиции", stageId: "new" },
  // Идёт диалог — получили первое наше, но не ответили
  { username: "trader_voice", full_name: "Лена Маркова", niche: "трейдинг", stageId: "in_progress" },
  { username: "forex_signals_ru", full_name: "Артём Балин", niche: "форекс", stageId: "in_progress" },
  { username: "btc_pulse", full_name: "Слава Курилов", niche: "BTC", stageId: "in_progress" },
  // Заинтересован — ответили положительно
  { username: "altcoin_news", full_name: "Влад Грачёв", niche: "альткоины", stageId: "interested", replied: true },
  { username: "deri_master", full_name: "Кирилл Ясов", niche: "деривативы", stageId: "interested", replied: true },
  { username: "crypto_review", full_name: "Юлия Демчик", niche: "обзоры крипты", stageId: "interested", replied: true },
  // Договорились — обсудили условия, ждём подключения
  { username: "trade_secrets", full_name: "Тимур Беспалов", niche: "торговые сигналы", stageId: "agreed", replied: true },
  { username: "dollarmoves", full_name: "Кира Мажор", niche: "макро", stageId: "agreed", replied: true },
  // Подключён — реальные партнёры
  { username: "moneyflow_top", full_name: "Игорь Малько", niche: "финансы", stageId: "won", replied: true },
  // Отказ
  { username: "free_signals_2k", full_name: "Александр Крам", niche: "халявные сигналы", stageId: "lost" },
]);

const sashaAcqDecLeads = buildLeads("prj_acq_dec", SASHA_WS, SASHA_ID, [
  // Декабрьский поток уже завершён — все на won/lost
  { username: "macro_view", full_name: "Дмитрий Зорин", stageId: "won", replied: true },
  { username: "crypto_evening", full_name: "Анна Лимонова", stageId: "won", replied: true },
  { username: "exchange_master", full_name: "Сергей Брезгин", stageId: "won", replied: true },
  { username: "broker_review_ru", full_name: "Ольга Кравцова", stageId: "lost" },
  { username: "binary_options_blog", full_name: "Иван Сидоров", stageId: "lost" },
]);

// Удержание — короткие циклы, ценные партнёры на разных этапах
const sashaRetainLeads = buildLeads("prj_ret_q1", SASHA_WS, SASHA_ID, [
  { username: "moneyflow_top", full_name: "Игорь Малько", niche: "финансы", stageId: "scheduled" },
  { username: "btc_pulse_pro", full_name: "Слава Курилов", niche: "BTC", stageId: "talking", replied: true },
  { username: "crypto_review", full_name: "Юлия Демчик", niche: "обзоры", stageId: "feedback", replied: true },
  { username: "altcoin_news", full_name: "Влад Грачёв", niche: "альткоины", stageId: "done", replied: true },
]);

// Отток — заметили спад, помогаем выйти из плато
const sashaChurnLeads = buildLeads("prj_chr_nov", SASHA_WS, SASHA_ID, [
  { username: "trade_strategy", full_name: "Григорий Хан", stageId: "alert" },
  { username: "stocks_today", full_name: "Тарас Воблов", stageId: "alert" },
  { username: "futures_room", full_name: "Андрей Кисло", stageId: "contacted", replied: true },
  { username: "options_lab", full_name: "Виктор Ким", stageId: "diagnosed", replied: true },
  { username: "trader_voice", full_name: "Лена Маркова", stageId: "fixed", replied: true },
  { username: "no_signal_lol", full_name: "Никита Орлов", stageId: "lost" },
]);

// Ad-hoc — операционные коммуникации
const sashaAdhocLeads = buildLeads("prj_adh_self", SASHA_WS, SASHA_ID, [
  { username: "crypto_market_pro", full_name: "Денис Фролов", stageId: "new" },
  { username: "stocks_daily", full_name: "Олег Курский", stageId: "in_progress", replied: true },
  { username: "fintech_blogger", full_name: "Анна Радова", stageId: "done", replied: true },
]);

const sashaAdhocUnbanLeads = buildLeads("prj_adh_unban", SASHA_WS, SASHA_ID, [
  { username: "btc_pulse", full_name: "Слава Курилов", stageId: "in_progress" },
  { username: "options_lab", full_name: "Виктор Ким", stageId: "done" },
]);

// Сначала contacts для replied-лидов в этом workspace — иначе FK на
// project_items.contactId упадёт. seedContacts накапливался во всех
// buildLeads-вызовах выше; здесь фильтруем sasha-only.
const sashaSeedContacts = seedContacts.filter(
  (c) => c.workspaceId === SASHA_WS,
);
if (sashaSeedContacts.length > 0) {
  await db
    .insert(contacts)
    .values(sashaSeedContacts)
    .onConflictDoNothing({ target: contacts.id });
}

// Каналы блогеров + channel_admins (перед project_items — FK на channel_id).
const sashaSeedChannels = seedChannels.filter((c) => c.workspaceId === SASHA_WS);
if (sashaSeedChannels.length > 0) {
  await db
    .insert(channels)
    .values(sashaSeedChannels)
    .onConflictDoNothing({ target: channels.id });
  await db
    .insert(channelAdmins)
    .values(
      seedChannelAdmins.filter((a) => a.channelId.startsWith(`chl_${SASHA_WS}_`)),
    )
    .onConflictDoNothing();
}

await db
  .insert(projectItems)
  .values([
    ...sashaAcqJanLeads,
    ...sashaAcqDecLeads,
    ...sashaRetainLeads,
    ...sashaChurnLeads,
    ...sashaAdhocLeads,
    ...sashaAdhocUnbanLeads,
  ])
  .onConflictDoNothing({ target: projectItems.id });

console.log(
  `[ws_sasha] seeded: tracks=4, templates=4, projects=7, items=${
    sashaAcqJanLeads.length +
    sashaAcqDecLeads.length +
    sashaRetainLeads.length +
    sashaChurnLeads.length +
    sashaAdhocLeads.length +
    sashaAdhocUnbanLeads.length
  }, contacts=${sashaSeedContacts.length}`,
);

// === Workspace 2: ws_cpp "CPP Agency" ======================================

const CPP_WS = "ws_cpp";

await db
  .insert(workspaces)
  .values({ id: CPP_WS, name: "CPP Agency", createdBy: ZHENYA_ID })
  .onConflictDoNothing({ target: workspaces.id });

await db
  .insert(workspaceMembers)
  .values([
    { workspaceId: CPP_WS, userId: ZHENYA_ID, role: "admin" },
    { workspaceId: CPP_WS, userId: BORIS_ID, role: "member" },
  ])
  .onConflictDoNothing();

await seedDefaultProperties(CPP_WS);

// Папки агентства = клиенты-рекламодатели (kind='client'). Реквизиты пока
// не заполняем — поля жидкие в properties jsonb.
await db
  .insert(tracks)
  .values([
    {
      id: "trk_cpp_cocacola",
      workspaceId: CPP_WS,
      name: "Coca-Cola",
      properties: { inn: "7707049388", contract: "CC-2026-001" },
      createdBy: ZHENYA_ID,
    },
    {
      id: "trk_cpp_beeline",
      workspaceId: CPP_WS,
      name: "Beeline",
      properties: { inn: "7713076301", contract: "BL-2026-014" },
      createdBy: ZHENYA_ID,
    },
    {
      id: "trk_cpp_skyeng",
      workspaceId: CPP_WS,
      name: "Skyeng",
      properties: { inn: "7724831594", contract: "SK-2026-007" },
      createdBy: ZHENYA_ID,
    },
  ])
  .onConflictDoNothing({ target: tracks.id });

// Stage template "Размещение в TG" — 8 стадий из agency-pivot.md (от подбора
// канала до закрытия). Один template на всё агентство — у 99% клиентов
// одинаковый канбан, как и говорили в обсуждении 12.2.
const CPP_PLACEMENT_STAGES: ProjectStage[] = [
  { id: "selection", name: "Подбор", order: 0 },
  { id: "offer", name: "Оффер", order: 1 },
  { id: "price", name: "Прайс получен", order: 2 },
  { id: "draft", name: "Драфт", order: 3 },
  { id: "approval", name: "Согласование", order: 4 },
  { id: "scheduled", name: "Запланировано", order: 5 },
  { id: "published", name: "Опубликовано", order: 6 },
  { id: "closed", name: "Закрыто", order: 7 },
];

await db
  .insert(stageTemplates)
  .values([
    {
      id: "stt_cpp_placement",
      workspaceId: CPP_WS,
      name: "Размещение в TG",
      stages: CPP_PLACEMENT_STAGES,
      createdBy: ZHENYA_ID,
    },
  ])
  .onConflictDoNothing({ target: stageTemplates.id });

// Универсальная цепочка для агентского запроса прайсов (P6 в agency-pivot —
// в перспективе подкапотный механизм запроса; сейчас сидится как обычная
// outreach-цепочка для демо).
const CPP_OFFER_MESSAGES: ProjectMessage[] = [
  {
    id: "msg1",
    text: "Привет {{full_name}}, я Женя из CPP Agency. У нас проект для бренда {{brand}} — рекламная интеграция в TG. Дата выхода — {{air_date}}. Какая твоя ставка за пост 24/48?",
    delay: { period: "minutes", value: 0 },
  },
  {
    id: "msg2",
    text: "Стукнусь ещё раз. Бюджет до {{budget}}, готовы обсуждать формат. Если ставка на этой неделе ОК, можем фиксировать.",
    delay: { period: "days", value: 1 },
  },
];

await db
  .insert(projects)
  .values([
    // Coca-Cola
    {
      id: "prj_cc_q4",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_cocacola",
      name: "Q4 2026 Holiday",
      kind: "outreach",
      status: "active",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "2 000 000 ₽", spent: "850 000 ₽", placements: 18 },
      activatedAt: new Date(Date.now() - 14 * 86_400_000),
      createdBy: ZHENYA_ID,
    },
    {
      id: "prj_cc_pre",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_cocacola",
      name: "Cold pre-launch",
      kind: "outreach",
      status: "draft",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "500 000 ₽" },
      createdBy: ZHENYA_ID,
    },
    // Beeline
    {
      id: "prj_bl_youth",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_beeline",
      name: "Тариф «Молодёжный»",
      kind: "outreach",
      status: "active",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "1 500 000 ₽", spent: "1 200 000 ₽", placements: 24 },
      activatedAt: new Date(Date.now() - 21 * 86_400_000),
      createdBy: ZHENYA_ID,
    },
    {
      id: "prj_bl_smb",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_beeline",
      name: "B2B SMB сегмент",
      kind: "outreach",
      status: "active",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "800 000 ₽", spent: "320 000 ₽", placements: 9 },
      activatedAt: new Date(Date.now() - 7 * 86_400_000),
      createdBy: ZHENYA_ID,
    },
    {
      id: "prj_bl_summer",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_beeline",
      name: "Лето 2026",
      kind: "outreach",
      status: "done",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "600 000 ₽", spent: "600 000 ₽", placements: 12 },
      activatedAt: new Date(Date.now() - 90 * 86_400_000),
      completedAt: new Date(Date.now() - 30 * 86_400_000),
      createdBy: ZHENYA_ID,
    },
    // Skyeng
    {
      id: "prj_sk_q1",
      workspaceId: CPP_WS,
      trackId: "trk_cpp_skyeng",
      name: "EdTech Q1",
      kind: "outreach",
      status: "draft",
      stages: CPP_PLACEMENT_STAGES,
      messages: CPP_OFFER_MESSAGES,
      properties: { budget: "1 200 000 ₽" },
      createdBy: ZHENYA_ID,
    },
  ])
  .onConflictDoNothing({ target: projects.id });

// Coca-Cola Q4 Holiday — флагманская доска. Каналы по всей агентской
// воронке: от подбора до опубликовано. Это «вау»-демо для Жени.
const ccQ4Leads = buildLeads(
  "prj_cc_q4",
  CPP_WS,
  ZHENYA_ID,
  [
    // Подбор — кандидаты для медиаплана
    { username: "morning_brief", full_name: "Утренний брифинг", niche: "новости/lifestyle", stageId: "selection" },
    { username: "lifestyle_today", full_name: "Lifestyle Today", niche: "lifestyle", stageId: "selection" },
    { username: "weekend_vibes", full_name: "Weekend Vibes", niche: "развлечения", stageId: "selection" },
    // Оффер — отправлен, ждём ответа
    { username: "city_pulse", full_name: "City Pulse", niche: "город", stageId: "offer" },
    { username: "events_msk", full_name: "Events Москва", niche: "события", stageId: "offer" },
    // Прайс получен
    { username: "music_lab", full_name: "Music Lab", niche: "музыка", stageId: "price", replied: true },
    { username: "viral_today", full_name: "Viral Today", niche: "вирусные", stageId: "price", replied: true },
    { username: "youth_news", full_name: "Молодёжные новости", niche: "молодёжь", stageId: "price", replied: true },
    // Драфт текста / креатива
    { username: "tech_review", full_name: "Tech Review", niche: "техно", stageId: "draft", replied: true },
    { username: "digital_today", full_name: "Digital Today", niche: "digital", stageId: "draft", replied: true },
    // Согласование с клиентом
    { username: "news_sphere", full_name: "News Sphere", niche: "новости", stageId: "approval", replied: true },
    { username: "trend_radar", full_name: "Trend Radar", niche: "тренды", stageId: "approval", replied: true },
    // Запланировано
    { username: "weekend_brief", full_name: "Weekend Brief", niche: "выходные", stageId: "scheduled", replied: true },
    { username: "youth_lab", full_name: "Youth Lab", niche: "молодёжь", stageId: "scheduled", replied: true },
    // Опубликовано
    { username: "morning_news_msk", full_name: "Утренние новости Москва", niche: "новости", stageId: "published", replied: true },
    { username: "fashion_review", full_name: "Fashion Review", niche: "мода", stageId: "published", replied: true },
    // Закрыто (с актом)
    { username: "deals_today", full_name: "Deals Today", niche: "скидки", stageId: "closed", replied: true },
    { username: "events_today", full_name: "Events Today", niche: "события", stageId: "closed", replied: true },
  ],
  { brand: "Coca-Cola", air_date: "15.12.2026", budget: "120k ₽" },
);

const blYouthLeads = buildLeads(
  "prj_bl_youth",
  CPP_WS,
  ZHENYA_ID,
  [
    { username: "memchik_blog", full_name: "Мемчик", niche: "мемы", stageId: "offer" },
    { username: "student_msk", full_name: "Студент Москва", niche: "студенты", stageId: "price", replied: true },
    { username: "campus_voice", full_name: "Голос Кампуса", niche: "студенты", stageId: "price", replied: true },
    { username: "gen_z_lab", full_name: "Gen Z Lab", niche: "Gen Z", stageId: "draft", replied: true },
    { username: "tiktok_today", full_name: "TikTok Today", niche: "TikTok", stageId: "approval", replied: true },
    { username: "youth_pulse", full_name: "Youth Pulse", niche: "молодёжь", stageId: "scheduled", replied: true },
    { username: "uni_news", full_name: "Uni News", niche: "вузы", stageId: "scheduled", replied: true },
    { username: "music_chart", full_name: "Music Chart", niche: "музыка", stageId: "published", replied: true },
    { username: "weekend_youth", full_name: "Weekend Youth", niche: "молодёжь", stageId: "published", replied: true },
    { username: "campus_chat", full_name: "Campus Chat", niche: "вузы", stageId: "closed", replied: true },
    { username: "gen_z_today", full_name: "Gen Z Today", niche: "Gen Z", stageId: "closed", replied: true },
    { username: "memes_top", full_name: "Memes Top", niche: "мемы", stageId: "closed", replied: true },
  ],
  { brand: "Beeline", air_date: "01.02.2026", budget: "60k ₽" },
);

const blSmbLeads = buildLeads(
  "prj_bl_smb",
  CPP_WS,
  ZHENYA_ID,
  [
    { username: "smb_news", full_name: "SMB News", niche: "малый бизнес", stageId: "selection" },
    { username: "freelance_lab", full_name: "Freelance Lab", niche: "фриланс", stageId: "selection" },
    { username: "self_employed_ru", full_name: "Самозанятые РФ", niche: "самозанятость", stageId: "offer" },
    { username: "biz_chat", full_name: "Бизнес Чат", niche: "бизнес", stageId: "offer" },
    { username: "ip_help", full_name: "ИП помощь", niche: "ИП", stageId: "price", replied: true },
    { username: "smb_review", full_name: "SMB Review", niche: "малый бизнес", stageId: "price", replied: true },
    { username: "startup_today", full_name: "Startup Today", niche: "стартапы", stageId: "draft", replied: true },
    { username: "biz_lab", full_name: "Биз Лаб", niche: "бизнес", stageId: "approval", replied: true },
    { username: "smb_pulse", full_name: "SMB Pulse", niche: "SMB", stageId: "scheduled", replied: true },
  ],
  { brand: "Beeline B2B", air_date: "20.02.2026", budget: "75k ₽" },
);

const blSummerLeads = buildLeads(
  "prj_bl_summer",
  CPP_WS,
  ZHENYA_ID,
  [
    { username: "summer_today", full_name: "Лето Today", stageId: "closed", replied: true },
    { username: "vacation_blog", full_name: "Vacation Blog", stageId: "closed", replied: true },
    { username: "travel_msk", full_name: "Travel Москва", stageId: "closed", replied: true },
    { username: "outdoor_lab", full_name: "Outdoor Lab", stageId: "closed", replied: true },
    { username: "summer_brief", full_name: "Summer Brief", stageId: "closed", replied: true },
    { username: "beach_today", full_name: "Beach Today", stageId: "closed", replied: true },
    { username: "festival_news", full_name: "Festival News", stageId: "closed", replied: true },
    { username: "summer_chart", full_name: "Summer Chart", stageId: "closed", replied: true },
    { username: "vacation_today", full_name: "Vacation Today", stageId: "closed", replied: true },
    { username: "outdoor_pulse", full_name: "Outdoor Pulse", stageId: "closed", replied: true },
  ],
  { brand: "Beeline Лето", air_date: "01.06.2026", budget: "50k ₽" },
);

// Сначала contacts для replied-лидов CPP. См. комментарий выше про FK.
const cppSeedContacts = seedContacts.filter((c) => c.workspaceId === CPP_WS);
if (cppSeedContacts.length > 0) {
  await db
    .insert(contacts)
    .values(cppSeedContacts)
    .onConflictDoNothing({ target: contacts.id });
}

const cppSeedChannels = seedChannels.filter((c) => c.workspaceId === CPP_WS);
if (cppSeedChannels.length > 0) {
  await db
    .insert(channels)
    .values(cppSeedChannels)
    .onConflictDoNothing({ target: channels.id });
  await db
    .insert(channelAdmins)
    .values(
      seedChannelAdmins.filter((a) => a.channelId.startsWith(`chl_${CPP_WS}_`)),
    )
    .onConflictDoNothing();
}

await db
  .insert(projectItems)
  .values([
    ...ccQ4Leads,
    ...blYouthLeads,
    ...blSmbLeads,
    ...blSummerLeads,
  ])
  .onConflictDoNothing({ target: projectItems.id });

console.log(
  `[ws_cpp] seeded: tracks=3, templates=1, projects=6, items=${
    ccQ4Leads.length + blYouthLeads.length + blSmbLeads.length + blSummerLeads.length
  }, contacts=${cppSeedContacts.length}`,
);

// === Top-100 реальных каналов в обоих workspace'ах =========================
//
// Один и тот же список засеваем в Сашин и Женин workspace — чтобы у обоих
// была плотная база для демо. Админы создаются как контакты (один admin =
// один contact, dedup по lower(admin_username) внутри workspace), каналы
// связываются с админами через channel_admins.

async function seedRealChannels(wsId: string, ownerUserId: string) {
  // Шаг 1: уникальные админы по lower(admin_username). У одного admin может
  // быть несколько каналов — у нас в выборке встречаются повторы.
  const uniqueAdmins = new Map<string, string>(); // lower(username) → contactId
  let adminIdx = 0;
  for (const ch of TOP_CHANNELS) {
    const u = ch.adminUsername.toLowerCase();
    if (!uniqueAdmins.has(u)) {
      uniqueAdmins.set(u, `cont_${wsId}_admin_${String(adminIdx++).padStart(3, "0")}`);
    }
  }

  if (uniqueAdmins.size > 0) {
    await db
      .insert(contacts)
      .values(
        [...uniqueAdmins.entries()].map(([username, id]) => ({
          id,
          workspaceId: wsId,
          properties: {
            full_name: `@${username}`,
            telegram_username: username,
          },
          createdBy: ownerUserId,
        })),
      )
      .onConflictDoNothing({ target: contacts.id });
  }

  // Шаг 2: каналы. Subscribers → memberCount, chat_id → externalId, link
  // строим как t.me/<username>.
  const channelRows = TOP_CHANNELS.map((ch, i) => ({
    id: `ch_${wsId}_${String(i).padStart(3, "0")}`,
    workspaceId: wsId,
    platform: "telegram" as const,
    externalId: ch.chatId,
    title: ch.title,
    username: ch.username,
    link: `https://t.me/${ch.username}`,
    memberCount: ch.subscribers,
    createdBy: ownerUserId,
  }));

  await db
    .insert(channels)
    .values(channelRows)
    .onConflictDoNothing({ target: channels.id });

  // Шаг 3: channel_admins — для каждого канала связь с его админом.
  await db
    .insert(channelAdmins)
    .values(
      TOP_CHANNELS.map((ch, i) => ({
        channelId: `ch_${wsId}_${String(i).padStart(3, "0")}`,
        contactId: uniqueAdmins.get(ch.adminUsername.toLowerCase())!,
      })),
    )
    .onConflictDoNothing();

  return { channels: TOP_CHANNELS.length, admins: uniqueAdmins.size };
}

const sashaChannels = await seedRealChannels(SASHA_WS, SASHA_ID);
console.log(
  `[ws_sasha] seeded real channels=${sashaChannels.channels}, admin-contacts=${sashaChannels.admins}`,
);

const cppChannels = await seedRealChannels(CPP_WS, ZHENYA_ID);
console.log(
  `[ws_cpp] seeded real channels=${cppChannels.channels}, admin-contacts=${cppChannels.admins}`,
);

// === Workspace 3: ws_agency "Agency Demo" (mode=agency, медиаплан-флоу) ====
// Отдельный agency-ws под новый бриф+лонглист-флоу. ws_cpp выше остаётся
// bd-режимным канбан-demo. Здесь: клиент с реквизитами + draft-кампания с
// заготовленным лонглистом (каналы в разных статусах подбора) + цепочка,
// готовая к запуску рассылки.
const AGENCY_WS = "ws_agency";

await db
  .insert(workspaces)
  .values({
    id: AGENCY_WS,
    name: "Agency Demo",
    mode: "agency",
    createdBy: ZHENYA_ID,
  })
  .onConflictDoNothing({ target: workspaces.id });

await db
  .insert(workspaceMembers)
  .values([
    { workspaceId: AGENCY_WS, userId: ZHENYA_ID, role: "admin" },
    { workspaceId: AGENCY_WS, userId: BORIS_ID, role: "member" },
  ])
  .onConflictDoNothing();

await seedDefaultProperties(AGENCY_WS);

await db
  .insert(tracks)
  .values([
    {
      id: "trk_ag_coke",
      workspaceId: AGENCY_WS,
      name: "Coca-Cola",
      properties: {
        legal_entity: "ООО «Кока-Кола»",
        inn: "7707049388",
        accountant_contact: "buh@coca-cola.example",
      },
      createdBy: ZHENYA_ID,
    },
    {
      id: "trk_ag_beeline",
      workspaceId: AGENCY_WS,
      name: "Beeline",
      properties: { inn: "7713076301" },
      createdBy: ZHENYA_ID,
    },
  ])
  .onConflictDoNothing({ target: tracks.id });

await db
  .insert(projects)
  .values({
    id: "prj_ag_q4",
    workspaceId: AGENCY_WS,
    trackId: "trk_ag_coke",
    name: "Q4 Holiday B2B",
    kind: "agency",
    status: "draft",
    phase: "longlist",
    brief:
      "Новогодняя кампания Coca-Cola Zero для аудитории 25-40. Нативные интеграции в нишах lifestyle / авто / технологии. Акцент «праздник без сахара».",
    budgetAmount: "1500000",
    tov: "Тёплый, праздничный, без пафоса.",
    constraints: "Без алкоголя в кадре. Не упоминать конкурентов.",
    messages: CPP_OFFER_MESSAGES,
    createdBy: ZHENYA_ID,
  })
  .onConflictDoNothing({ target: projects.id });

const agChannels = await seedRealChannels(AGENCY_WS, ZHENYA_ID);

// Лонглист: первые 7 каналов + их админы, разные статусы подбора (для демо
// таблицы). chainStatus выводится из repliedAt/sentExists — пока 'not_sent'
// (кампания в draft, рассылку не запускали), кроме отказа (available=false).
const agChannelIds = Array.from(
  { length: 7 },
  (_, i) => `ch_${AGENCY_WS}_${String(i).padStart(3, "0")}`,
);
const agAdmins = await db
  .select({
    channelId: channelAdmins.channelId,
    contactId: channelAdmins.contactId,
    props: contacts.properties,
  })
  .from(channelAdmins)
  .innerJoin(contacts, eq(contacts.id, channelAdmins.contactId))
  .where(inArray(channelAdmins.channelId, agChannelIds));
const agAdminByChannel = new Map(agAdmins.map((a) => [a.channelId, a]));

const PLACEMENT_SEED: Array<{
  available: boolean | null;
  priceAmount: string | null;
  forecastViews: number | null;
  forecastErr: string | null;
}> = [
  { available: true, priceAmount: "80000", forecastViews: 120000, forecastErr: "4.20" },
  { available: true, priceAmount: "150000", forecastViews: 250000, forecastErr: "3.80" },
  { available: true, priceAmount: "95000", forecastViews: 180000, forecastErr: "5.10" },
  { available: false, priceAmount: null, forecastViews: null, forecastErr: null },
  { available: null, priceAmount: null, forecastViews: 90000, forecastErr: null },
  { available: null, priceAmount: null, forecastViews: 300000, forecastErr: null },
  { available: true, priceAmount: "120000", forecastViews: 200000, forecastErr: "2.40" },
];

const placementRows = agChannelIds.map((channelId, i) => {
  const admin = agAdminByChannel.get(channelId);
  const props = (admin?.props ?? {}) as Record<string, unknown>;
  const s = PLACEMENT_SEED[i]!;
  return {
    id: `pli_ag_${String(i).padStart(3, "0")}`,
    workspaceId: AGENCY_WS,
    projectId: "prj_ag_q4",
    kind: "placement" as const,
    channelId,
    contactId: admin?.contactId ?? null,
    username: (props.telegram_username as string | undefined) ?? null,
    available: s.available,
    priceAmount: s.priceAmount,
    forecastViews: s.forecastViews,
    forecastErr: s.forecastErr,
  };
});
await db
  .insert(projectItems)
  .values(placementRows)
  .onConflictDoNothing({ target: projectItems.id });

console.log(
  `[ws_agency] seeded: clients=2, campaign=1 (draft longlist), placements=${placementRows.length}, channels=${agChannels.channels}`,
);

console.log("done — full demo seed complete");

await sql.end();
