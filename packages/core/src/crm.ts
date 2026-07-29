// Воркфлоу «РСЯ 2.0» корпоративной CRM Яндекса (crm.yandex-team.ru), в котором
// живёт процесс привлечения блогеров. Механика API — specs/crm-integration.md.
//
// Граф зашит константой осознанно: воркфлоу одно, очередь одна, конфиг меняется
// в админке CRM крайне редко (с июня 2026 не менялся). Синк графа в БД — таблица
// + суточный обход + обработка «приехал неизвестный статус» — на этом фоне
// неоправдан. Если в CRM поменяют воронку, правим этот файл и деплоим.
//
// Снято с живого API 28.07.2026 обходом тикета через всю воронку
// (`GET /v0/issue/{id}/transitions` на каждом статусе).

// --- параметры создания тикета -------------------------------------------
// Проверены записью в бою: без category_id не проходит ни один переход
// с резолюцией («У обращения должна быть заполнена категория»), поэтому
// проставляем сразу при создании.

export const CRM_WORKFLOW_ID = 41424;
export const CRM_QUEUE_ID = 7031220;
export const CRM_ISSUE_TYPE_ID = 3; // «Тикет» — единственный тип во всей CRM
export const CRM_CATEGORY_ID = 10444906; // ветка «РСЯ для блогеров»

// --- статусы ---------------------------------------------------------------

export const CRM_STATE = {
  open: 2, // Открыт — тикет заведён, никто не смотрел
  inWork: 3, // В работе — менеджер разбирает
  validated: 507, // Валидирован — прошёл квалификацию, идёт холодное касание
  offerMade: 511, // Сделан оффер — блогер откликнулся, мы объяснили суть
  agreed: 150, // Согласие — договорились
  registration: 477, // Регистрация — дальше хвост, его ведут не мы
  moderationPassed: 704,
  moderationRejected: 705,
  firstPost: 706,
  contractSigned: 774, // в истории старых тикетов встречается legacy-id 707
  noContact: 708, // Нет связи (исход, с резолюцией)
  disqualified: 703, // Дисквалификация (исход, с резолюцией)
  rejected: 8, // Отказ (исход, с резолюцией)
} as const;

export const CRM_STATE_NAME: Record<number, string> = {
  2: "Открыт",
  3: "В работе",
  8: "Отказ",
  150: "Согласие",
  477: "Регистрация",
  507: "Валидирован",
  511: "Сделан оффер",
  703: "Дисквалификация",
  704: "Модерация пройдена",
  705: "Отклонён модерацией",
  706: "Вышел первый пост",
  708: "Нет связи",
  774: "Заключил договор",
};

// --- резолюции -------------------------------------------------------------
// Набор причин зависит ТОЛЬКО от целевого статуса, а не от того, откуда пришли:
// «Отказ ▾ 14» из «Валидирован», «Сделан оффер» и «Согласие» — один и тот же
// список. Поэтому резолюции лежат на статусе-исходе, а не на ребре.
//
// id перехода составной: `<статус>_<резолюция>`. Он же уходит в
// `POST /transition/execute` как `state_id` — отдельного поля под резолюцию нет.

export type CrmResolution = { transitionId: string; name: string };

export const CRM_DISQUALIFY_REASONS: CrmResolution[] = [
  { transitionId: "703_775", name: "Не размещает рекламу" },
  { transitionId: "703_776", name: "Нет в РКН" },
  { transitionId: "703_516", name: "Мошенничество" },
  { transitionId: "703_777", name: "Не подходит по контенту/тематике" },
  { transitionId: "703_778", name: "Канал не работает / не существует" },
  { transitionId: "703_779", name: "Мало подписчиков/просмотров/постов/<X мес" },
  { transitionId: "703_578", name: "Подозрение на фрод" },
  { transitionId: "703_780", name: "Ошибка заливки/дубли" },
  { transitionId: "703_511", name: "Нет контакта" },
  { transitionId: "703_18", name: "Другое" },
];

export const CRM_NO_CONTACT_REASONS: CrmResolution[] = [
  { transitionId: "708_791", name: "Перестал отвечать" },
  { transitionId: "708_792", name: "Не отвечает на первое сообщение" },
  { transitionId: "708_793", name: "Заблокировал" },
  { transitionId: "708_18", name: "Другое" },
];

export const CRM_REJECT_REASONS: CrmResolution[] = [
  { transitionId: "8_781", name: "Без объяснения" },
  { transitionId: "8_782", name: "Негативный опыт/отписки" },
  { transitionId: "8_536", name: "Использует другие сервисы" },
  {
    transitionId: "8_783",
    name: "Нет предпросмотра/точное время публикации/Не устраивает вид креатива",
  },
  { transitionId: "8_784", name: "Не хочет создавать контент сам" },
  { transitionId: "8_562", name: "Не хочет добавлять бота" },
  { transitionId: "8_785", name: "Не устраивает маркировка" },
  { transitionId: "8_786", name: "Мало СРА оферов" },
  {
    transitionId: "8_787",
    name: "Не устраивает модель /размер оплаты/Непрозрачная статистика",
  },
  { transitionId: "8_534", name: "Только фиксированная стоимость" },
  { transitionId: "8_788", name: "Не выходит реклама/недостаточно рекламы" },
  { transitionId: "8_789", name: "Неактивная аудитория для модели оплаты" },
  {
    transitionId: "8_790",
    name: "Технические, юридические проблемы с подключением",
  },
  { transitionId: "8_18", name: "Другое" },
];

// --- граф переходов --------------------------------------------------------

export type CrmButton = {
  /** Подпись кнопки. Не всегда равна имени целевого статуса: переход в
   *  «В работе» подписан «В работу». */
  label: string;
  targetStateId: number;
  /** Прямой переход — id тут, resolutions пуст. Иначе null и выбор из причин. */
  transitionId: string | null;
  resolutions: CrmResolution[];
};

const BACK_TO_WORK: CrmButton = {
  label: "В работу",
  targetStateId: CRM_STATE.inWork,
  transitionId: "3",
  resolutions: [],
};
const NO_CONTACT: CrmButton = {
  label: "Нет связи",
  targetStateId: CRM_STATE.noContact,
  transitionId: null,
  resolutions: CRM_NO_CONTACT_REASONS,
};
const REJECT: CrmButton = {
  label: "Отказ",
  targetStateId: CRM_STATE.rejected,
  transitionId: null,
  resolutions: CRM_REJECT_REASONS,
};

export const CRM_GRAPH: Record<number, CrmButton[]> = {
  [CRM_STATE.open]: [BACK_TO_WORK],
  [CRM_STATE.inWork]: [
    {
      label: "Валидирован",
      targetStateId: CRM_STATE.validated,
      transitionId: "507",
      resolutions: [],
    },
    {
      label: "Дисквалификация",
      targetStateId: CRM_STATE.disqualified,
      transitionId: null,
      resolutions: CRM_DISQUALIFY_REASONS,
    },
  ],
  [CRM_STATE.validated]: [
    {
      label: "Сделан оффер",
      targetStateId: CRM_STATE.offerMade,
      transitionId: "511",
      resolutions: [],
    },
    NO_CONTACT,
    REJECT,
  ],
  [CRM_STATE.offerMade]: [
    {
      label: "Согласие",
      targetStateId: CRM_STATE.agreed,
      transitionId: "150",
      resolutions: [],
    },
    NO_CONTACT,
    REJECT,
    BACK_TO_WORK,
  ],
  [CRM_STATE.agreed]: [
    {
      label: "Регистрация",
      targetStateId: CRM_STATE.registration,
      transitionId: "477",
      resolutions: [],
    },
    NO_CONTACT,
    REJECT,
    BACK_TO_WORK,
  ],
  // Хвост ведут другие люди в CRM. Кнопки описаны для полноты — из аутрича по
  // ним не ходим, но зеркало должно уметь показать, что карточка там.
  [CRM_STATE.registration]: [
    {
      label: "Модерация пройдена",
      targetStateId: CRM_STATE.moderationPassed,
      transitionId: "704",
      resolutions: [],
    },
    {
      label: "Отклонён модерацией",
      targetStateId: CRM_STATE.moderationRejected,
      transitionId: "705",
      resolutions: [],
    },
    NO_CONTACT,
    REJECT,
    BACK_TO_WORK,
  ],
  [CRM_STATE.moderationPassed]: [
    {
      label: "Вышел первый пост",
      targetStateId: CRM_STATE.firstPost,
      transitionId: "706",
      resolutions: [],
    },
    NO_CONTACT,
    REJECT,
    BACK_TO_WORK,
  ],
  [CRM_STATE.firstPost]: [
    {
      label: "Заключил договор",
      targetStateId: CRM_STATE.contractSigned,
      transitionId: null,
      resolutions: [{ transitionId: "707_774", name: "Заключил договор" }],
    },
    NO_CONTACT,
    REJECT,
    BACK_TO_WORK,
  ],
  [CRM_STATE.noContact]: [BACK_TO_WORK],
  [CRM_STATE.disqualified]: [BACK_TO_WORK],
  [CRM_STATE.rejected]: [BACK_TO_WORK],
  [CRM_STATE.contractSigned]: [
    {
      label: "Открыть",
      targetStateId: CRM_STATE.open,
      transitionId: "2",
      resolutions: [],
    },
  ],
};

/** Плоский список переходов для `<select>`: «Отказ · не хочет добавлять бота».
 *  Пустой, если статус неизвестен (в CRM добавили новый — не падаем). */
export function crmTransitionOptions(
  stateId: number | null,
): { transitionId: string; label: string }[] {
  if (stateId === null) return [];
  return (CRM_GRAPH[stateId] ?? []).flatMap((b) =>
    b.transitionId !== null
      ? [{ transitionId: b.transitionId, label: b.label }]
      : b.resolutions.map((r) => ({
          transitionId: r.transitionId,
          label: `${b.label} · ${r.name}`,
        })),
  );
}

/** Разбор составного id перехода: "703_578" → { stateId: 703, resolutionId: 578 }. */
export function parseCrmTransitionId(transitionId: string): {
  stateId: number;
  resolutionId: number | null;
} {
  const [state, resolution] = transitionId.split("_");
  return {
    stateId: Number(state),
    resolutionId: resolution ? Number(resolution) : null,
  };
}

/** Имя резолюции по составному id — для снимка в зеркале. */
export function crmResolutionName(transitionId: string): string | null {
  const all = [
    ...CRM_DISQUALIFY_REASONS,
    ...CRM_NO_CONTACT_REASONS,
    ...CRM_REJECT_REASONS,
  ];
  return all.find((r) => r.transitionId === transitionId)?.name ?? null;
}
