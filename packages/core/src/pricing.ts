// Ценовая цепочка сделки: стоимость блогера → цена клиенту. Единая формула для
// фронта (живой показ в сделке-панели) и бэка (снапшот clientPrice), чтобы
// расчёт не разъехался между слоями. Источник правды по цепочке — внутренняя
// «ШАБЛОН РЫБЫ» Go Influence (см. specs/goinfluence-pricing-model.md):
//   к оплате блогеру = W×(1+%сверху)                ← «% сверху» = надбавка блогера
//   база в цепочку   = НДС? W : к оплате             ← НДСный блогер: надбавка зачётная
//   до НДС (H)       = (база +3% ОРД на долю) × (1+АК)  ← АК это НАЦЕНКА, не деление
//   с НДС  (I)       = H × (1 + ставка)              ← клиентский НДС (расхардкод, 22)
//   CPV = H / прогноз просмотров                     ← база CPV именно до НДС
//
// Всё про деньги блогера (надбавка/НДС/формат) живёт на размещении
// (project_items), не на контакте и не на канале: один контакт ведёт разные
// каналы через разные ИП. Множители кампании (АК/НДС/ОРД/ставка) — из настроек
// РК (срез 3). Сплит создание/размещение (splitEnabled + createShare%) — срез 5:
// +3% ОРД грузится только на долю размещения, создание идёт без ОРД.
//
// Налоговый режим блогера нас не интересует (не бухгалтерский софт): блогер
// говорит «хочу W и +X% сверху» — накидываем. Если это НДС — галочка bloggerVat,
// тогда X% трактуется как зачётный НДС (в базу цены идёт чистая W).

// Агентская комиссия по умолчанию (наценка сверх базы). Поле кампании (срез 3).
export const DEFAULT_AK_PERCENT = 20;
// Ставка клиентского НДС по умолчанию — свободное число, меняется без правки
// кода (была 20, сейчас 22). Реальная ставка приходит из настроек кампании (vatRate).
export const DEFAULT_VAT_PERCENT = 22;
// +3% ОРД начисляется на долю размещения (договорённость с клиентом, мокап v2).
export const ORD_RATE = 0.03;

export interface DealPricingInput {
  // Сумма блогеру чистыми — W (project_items.priceAmount).
  cost: number;
  // «% сверху» — надбавка, которую блогер просит накинуть (не важно налог/комиссия).
  // Аддитивно: W×(1+%). По умолчанию 0.
  surchargePercent?: number;
  // Надбавка «% сверху» — это НДС блогера (зачётный): в базу цены идёт чистая W,
  // а не W×(1+%). false — просто добавляется.
  bloggerVat?: boolean;
  // Агентская комиссия, % (наценка). По умолчанию DEFAULT_AK_PERCENT.
  akPercent?: number;
  // Клиентский НДС. false — отдаём без НДС (не накидываем). По умолчанию с НДС.
  vat?: boolean;
  // Ставка клиентского НДС, %. По умолчанию DEFAULT_VAT_PERCENT.
  vatRate?: number;
  // Учитывать +3% ОРД на долю размещения.
  ord3?: boolean;
  // Сплит создание/размещение (срез 5). При splitEnabled доля создания =
  // createShare% (без ОРД), остальное — размещение (на него +3%). Иначе вся
  // сумма как размещение. createShare — percent 0..100, ровно как в БД/API:
  // движок сам делит на 100, чтобы каллеры не инвертировали в placementShare.
  splitEnabled?: boolean;
  createShare?: number | null;
  // Прогноз просмотров — для CPV. null/0 → CPV не считаем.
  forecastViews?: number | null;
}

export interface DealPricing {
  // К оплате блогеру = W×(1+%сверху) — что реально уходит.
  payout: number;
  // База в наценочную цепочку клиента = НДС? W : payout.
  costBasis: number;
  // К оплате блогеру до НДС, до АК (AF в рыбе): база + ОРД, до наценки. Это то,
  // с чего берётся АК, и левая часть прибыли GI. В P&L — «Σ к оплате блогерам».
  beforeAk: number;
  // Разбивка beforeAk на создание/размещение (сплит по документам, срез 5):
  // создание — без ОРД, размещение — с +3%. Без сплита всё уходит в placePart.
  createPart: number;
  placePart: number;
  // Цена клиенту до НДС (H): (база +ОРД) × (1 + АК).
  clientNoVat: number;
  // Цена клиенту с НДС (I) — или = clientNoVat, если vat=false.
  clientVat: number;
  // Прибыль Go Influence = clientNoVat − beforeAk (наценка АК в рублях).
  profit: number;
  // CPV по базе до НДС; null, если нет прогноза.
  cpv: number | null;
}

export function computeDealPricing(input: DealPricingInput): DealPricing {
  const cost = input.cost || 0;
  const surcharge = (input.surchargePercent ?? 0) / 100;
  const ak = (input.akPercent ?? DEFAULT_AK_PERCENT) / 100;
  const clientVatRate = (input.vatRate ?? DEFAULT_VAT_PERCENT) / 100;
  // Доля создания 0..1 из createShare% (только при splitEnabled). Остальное —
  // размещение. Без сплита createFrac=0 → вся сумма как размещение, +3% на всё.
  // Кламп [0..1]: живое превью в сделке считает по несейвленному вводу в обход
  // Zod-границы max(100), а доля >100%/<0 дала бы отрицательную цену.
  const createFrac =
    input.splitEnabled && input.createShare != null
      ? Math.min(1, Math.max(0, input.createShare / 100))
      : 0;

  // Что реально уходит блогеру: чистыми + надбавка.
  const payout = cost * (1 + surcharge);
  // База в наценочную цепочку: если надбавка — зачётный НДС, агентство его
  // возвращает, поэтому в цену клиента идёт чистая W. Иначе надбавка остаётся.
  const costBasis = input.bloggerVat ? cost : payout;
  // Создание — доля createFrac от базы, без ОРД. Размещение — остальное,
  // грубится на +3% ОРД (гросс-ап /0.97, как в рыбе), если включён. Сумма = beforeAk.
  const createPart = costBasis * createFrac;
  const placePart = input.ord3
    ? (costBasis * (1 - createFrac)) / (1 - ORD_RATE)
    : costBasis * (1 - createFrac);
  const withOrd = createPart + placePart;
  const clientNoVat = withOrd * (1 + ak);
  const clientVat =
    input.vat === false ? clientNoVat : clientNoVat * (1 + clientVatRate);
  const profit = clientNoVat - withOrd;
  const forecast = input.forecastViews ?? 0;
  const cpv = forecast > 0 ? clientNoVat / forecast : null;
  return {
    payout,
    costBasis,
    beforeAk: withOrd,
    createPart,
    placePart,
    clientNoVat,
    clientVat,
    profit,
    cpv,
  };
}
