import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { channels, rknRecords, rknSync } from "../db/schema.ts";
import { errMsg } from "./errors.ts";

// РКН-реестр (T4.5): суточный синк словаря страниц с Госуслуг + матчинг с
// channels. Источник — открытый справочник SocNet_reestr (POST-пагинация по
// 1000, cookie НЕ нужна — проверено 11.06.26; ~200k записей, ~4 мин).
//
// Синк — диффом по uid, не дропом: insert новых / update изменившихся /
// delete исчезнувших. Guard от снесения данных кривой выгрузкой: если
// выгрузка оборвалась (получили меньше заявленного total) или удаляется
// больше MAX_DELETE_RATIO существующих записей — НЕ применяем, таблица
// остаётся как была, ошибка пишется в rkn_sync.last_status.
//
// Кнопки «Обновить» нет осознанно: суточного автосинка достаточно, дата
// последнего обновления видна на странице реестра.

const API_URL = "https://www.gosuslugi.ru/api/nsi/v1/dictionary/SocNet_reestr";
const PAGE_SIZE = 1000;
const SYNC_INTERVAL_MS = 24 * 3600_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const MAX_DELETE_RATIO = 0.02;
const META_ID = "rkn";

type RegistryRecord = {
  uid: string;
  network: string;
  url: string;
  title: string | null;
  status: string;
  matchKey: string | null;
};

// url реестра → нормализованный ключ матчинга с channels (формат должен
// байт-в-байт совпадать с channelRknKeySql ниже). Не наши сети (ВК/ОК/…) —
// null: храним для поиска по реестру, но не матчим.
export function rknMatchKey(
  network: string | null,
  url: string | null,
): string | null {
  if (!network || !url) return null;
  const u = url.trim();
  switch (network) {
    case "Telegram": {
      let m = u.match(/t\.me\/(?:s\/)?([A-Za-z0-9_]+)\/?$/i);
      if (m) return `telegram:${m[1]!.toLowerCase()}`;
      // Приватный инвайт: хэш регистрозависимый, не lower'им.
      m = u.match(/t\.me\/(?:joinchat\/|\+)([A-Za-z0-9_-]+)/i);
      if (m) return `telegram:+${m[1]}`;
      return null;
    }
    case "YouTube": {
      const m = u.match(
        /youtube\.com\/(?:@|c\/|user\/)?([A-Za-z0-9_.-]+)\/?$/i,
      );
      return m ? `youtube:${m[1]!.toLowerCase()}` : null;
    }
    case "TikTok": {
      const m = u.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
      return m ? `tiktok:${m[1]!.toLowerCase()}` : null;
    }
    case "Дзен": {
      const m = u.match(/dzen\.ru\/(?:id\/)?([A-Za-z0-9_.-]+)\/?$/i);
      return m ? `dzen:${m[1]!.toLowerCase()}` : null;
    }
    case "MAX": {
      // max.ru/join/<hash> — приватные инвайты, по ним не матчим.
      const m = u.match(/max\.ru\/([A-Za-z0-9_.-]+)\/?$/i);
      return m && m[1]!.toLowerCase() !== "join"
        ? `max:${m[1]!.toLowerCase()}`
        : null;
    }
    default:
      return null;
  }
}

// Тот же ключ со стороны channels, SQL-выражением — для EXISTS-подзапросов
// в списках (каталог, лиды, лонглист, contact.channels). username каналов
// в БД без «@»; приватный TG — хэш из link. Текст параметризован алиасом,
// потому что встраивается и в drizzle-запросы (channels), и в raw-подзапросы
// с алиасом (ch в contact.channels).
export function channelRknExistsSqlText(alias: string): string {
  // status-фильтр: матчим только действующие записи — появись в реестре
  // «исключённые», они не должны давать спокойный бейдж «РКН».
  // Флаг 'i' у regexp_match — как /i в rknMatchKey (T.me/JoinChat/…).
  return `EXISTS (
  SELECT 1 FROM rkn_records rr
  WHERE rr.status IN ('active', 'reissued')
    AND rr.match_key = ${alias}.platform || ':' || (
    CASE
      WHEN ${alias}.username IS NOT NULL THEN lower(${alias}.username)
      WHEN ${alias}.platform = 'telegram' AND ${alias}.link ~* 't\\.me/(joinchat/|\\+)'
        THEN '+' || (regexp_match(${alias}.link, 't\\.me/(?:joinchat/|\\+)([A-Za-z0-9_-]+)', 'i'))[1]
      ELSE NULL
    END
  ))`;
}
export const channelIsRknSql = sql<boolean>`${sql.raw(
  channelRknExistsSqlText("channels"),
)}`;

async function fetchPage(pageNum: number): Promise<{
  total: number;
  items: RegistryRecord[];
  // СЫРОЕ число записей страницы (до фильтра невалидных) — конец пагинации
  // определяется по нему, иначе страница из одних битых записей оборвала бы
  // выгрузку посередине.
  rawCount: number;
}> {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://www.gosuslugi.ru",
      Referer: "https://www.gosuslugi.ru/snet",
    },
    body: JSON.stringify({
      treeFiltering: "ONELEVEL",
      pageNum,
      pageSize: PAGE_SIZE,
      parentRefItemValue: "",
      selectAttributes: ["*"],
    }),
  });
  if (!r.ok) throw new Error(`gosuslugi page ${pageNum}: HTTP ${r.status}`);
  const d = (await r.json()) as {
    total?: number;
    items?: { attributeValues?: Record<string, string> }[];
  };
  const items: RegistryRecord[] = [];
  for (const it of d.items ?? []) {
    const a = it.attributeValues ?? {};
    const uid = a.Unikalnyi_identifikator_reestrovoi_zapisi;
    const network = a.Naimenovanie_socialnoi_seti;
    const url = a.Ssylka_na_personalnuyu_stranicu;
    if (!uid || !network || !url) continue;
    items.push({
      uid,
      network,
      url,
      title: a.Naimenovanie_personalnoi_stranicy ?? null,
      status: a.Status_zapisi_o_personalnoi_stranice ?? "active",
      matchKey: rknMatchKey(network, url),
    });
  }
  return { total: d.total ?? 0, items, rawCount: (d.items ?? []).length };
}

async function fetchAll(): Promise<RegistryRecord[]> {
  const out = new Map<string, RegistryRecord>();
  let total = Infinity;
  for (let page = 1; out.size < total; page++) {
    // Страховка от вечного цикла, если API начнёт клампить номер страницы
    // к последней (out.size перестаёт расти, страницы непустые).
    if (page > Math.ceil(total / PAGE_SIZE) + 5) {
      throw new Error(
        `пагинация не сходится: страница ${page} при total ${total}`,
      );
    }
    const { total: t, items, rawCount } = await fetchPage(page);
    total = t;
    if (rawCount === 0) break;
    for (const it of items) out.set(it.uid, it);
    if (state.progress) {
      state.progress.fetched = out.size;
      state.progress.total = total;
    }
    if (page % 50 === 0) {
      console.log(`[rkn-registry] fetch ${out.size}/${total}`);
    }
  }
  // Дубли uid в выгрузке бывают (<1%) — Map дедупит; допуск на это при
  // проверке полноты. Оборванная выгрузка — главный риск снесения данных.
  if (out.size < total * 0.98) {
    throw new Error(`выгрузка неполная: получено ${out.size} из ${total}`);
  }
  return [...out.values()];
}

const CHUNK = 1000;

export async function syncRknRegistry(): Promise<void> {
  console.log("[rkn-registry] sync started");
  state.progress = {
    startedAt: new Date().toISOString(),
    fetched: 0,
    total: 0,
  };
  try {
    const fetched = await fetchAll();
    const fresh = new Map(fetched.map((r) => [r.uid, r]));
    const existing = await db
      .select({
        uid: rknRecords.uid,
        url: rknRecords.url,
        title: rknRecords.title,
        status: rknRecords.status,
        matchKey: rknRecords.matchKey,
      })
      .from(rknRecords);

    const toInsert: RegistryRecord[] = [];
    const toUpdate: RegistryRecord[] = [];
    const toDelete: string[] = [];
    const seen = new Set<string>();
    for (const e of existing) {
      const f = fresh.get(e.uid);
      if (!f) {
        toDelete.push(e.uid);
        continue;
      }
      seen.add(e.uid);
      if (
        f.url !== e.url ||
        f.title !== e.title ||
        f.status !== e.status ||
        // matchKey — derived-поле: при изменении правил нормализации в коде
        // старые строки должны пересчитаться, иначе матчинг навсегда
        // останется на старом формате ключа.
        f.matchKey !== e.matchKey
      ) {
        toUpdate.push(f);
      }
    }
    for (const f of fetched) if (!seen.has(f.uid)) toInsert.push(f);

    if (
      existing.length > 0 &&
      toDelete.length > existing.length * MAX_DELETE_RATIO
    ) {
      throw new Error(
        `подозрительная выгрузка: удалилось бы ${toDelete.length} из ${existing.length} записей (>${MAX_DELETE_RATIO * 100}%) — не применяем`,
      );
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < toDelete.length; i += CHUNK) {
        await tx
          .delete(rknRecords)
          .where(inArray(rknRecords.uid, toDelete.slice(i, i + CHUNK)));
      }
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        await tx.insert(rknRecords).values(toInsert.slice(i, i + CHUNK));
      }
      // Изменившихся при суточном дрейфе — единицы, по одному ок.
      for (const r of toUpdate) {
        await tx
          .update(rknRecords)
          .set({
            url: r.url,
            title: r.title,
            status: r.status,
            matchKey: r.matchKey,
            updatedAt: new Date(),
          })
          .where(sql`${rknRecords.uid} = ${r.uid}`);
      }
      await tx
        .insert(rknSync)
        .values({
          id: META_ID,
          lastSyncAt: new Date(),
          lastStatus: "ok",
          total: fresh.size,
        })
        .onConflictDoUpdate({
          target: rknSync.id,
          set: {
            lastSyncAt: new Date(),
            lastStatus: "ok",
            total: fresh.size,
          },
        });
    });
    console.log(
      `[rkn-registry] sync ok: +${toInsert.length} ~${toUpdate.length} -${toDelete.length}, total ${fresh.size}`,
    );
  } catch (e) {
    const msg = errMsg(e);
    console.error("[rkn-registry] sync failed:", msg);
    // lastSyncAt НЕ трогаем — на странице видно, что данные протухают.
    await db
      .insert(rknSync)
      .values({ id: META_ID, lastStatus: `error: ${msg}`, total: 0 })
      .onConflictDoUpdate({
        target: rknSync.id,
        set: { lastStatus: `error: ${msg}` },
      })
      .catch(() => {});
  } finally {
    state.progress = null;
  }
}

// Worker: раз в час проверяет, не пора ли (суточный интервал от последнего
// успешного синка). Первый запуск после деплоя с пустой таблицей синкнет
// сразу. globalThis-стейт против двойного интервала при HMR (как у
// outreach-worker).
type SyncProgress = {
  startedAt: string;
  fetched: number;
  total: number;
};
type RknWorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  // Прогресс идущего синка (страница РКН показывает полосу). In-memory:
  // single-instance, потеря при рестарте безвредна — синк начнётся заново.
  progress: SyncProgress | null;
};
const globalRef = globalThis as { __rknWorker?: RknWorkerState };
const state: RknWorkerState = (globalRef.__rknWorker ??= {
  timer: null,
  running: false,
  progress: null,
});

export function getRknSyncProgress(): SyncProgress | null {
  return state.progress;
}

async function checkAndSync() {
  if (state.running) return;
  state.running = true;
  try {
    const [meta] = await db.select().from(rknSync).limit(1);
    const age = meta?.lastSyncAt
      ? Date.now() - meta.lastSyncAt.getTime()
      : Infinity;
    if (age >= SYNC_INTERVAL_MS) await syncRknRegistry();
  } catch (e) {
    console.error("[rkn-registry] check failed:", errMsg(e));
  } finally {
    state.running = false;
  }
}

export function startRknWorker() {
  if (state.timer) return;
  console.log("[rkn-registry] worker started, check=1h, sync=24h");
  state.timer = setInterval(() => void checkAndSync(), CHECK_INTERVAL_MS);
  void checkAndSync();
}
