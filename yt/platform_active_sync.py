#!/usr/bin/env python3
"""Суточный синк «Каналы Яндекса» (см. specs/yt-platform-active.md).

Тянет активность каналов с рекл-платформ Яндекса — CPC (tgads) и CPA
(cpa_network) — из YT, нормализует в общий shape и одним bulk-replace заливает
в Postgres нашего сервиса (`platform_active_channels`). Питает гейт «уже
работает» в аутриче и справочник «Каналы Яндекса».

Архитектура (почему так — в спеке):
  * node владеет DDL и чтением; этот джоб только пишет сырую идентичность —
    `match_key` выводит generated-колонка в БД, мы его НЕ считаем (единый
    источник правды матчинга живёт рядом с channel-match-keys.ts);
  * bulk-replace в одной транзакции с предохранителем: если снапшот пуст или
    подозрительно усох (> MAX_DELETE_RATIO) — НЕ применяем, таблица остаётся,
    текст ошибки пишется в `platform_active_sync.last_status` (зеркало РКН);
  * запускается внешним планировщиком (cron/systemd-timer) на хосте с
    YT-токеном, в том же сетевом периметре, что Postgres.

Окружение:
  PLATFORM_ACTIVE_DSN  — DSN отдельного scoped-юзера (write только в
                         platform_active_channels + platform_active_sync).
  YT_TOKEN / ~/.yt/token — OAuth-токен YT.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import astuple, dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg
import yt.wrapper as yt

# --- источники в YT -----------------------------------------------------------
CPA_POSTS_TABLE = "home/cpa_network/analytics/general_analytical_data/general_posts_data"
CPC_MESSAGES_TABLE = "home/tgads/prod/db/messages"
CPC_CHANNELS_TABLE = "//home/tgads/prod/db/channels"

# Платформы продукта (= channelPlatform enum + CHECK в schema.ts). vk сознательно
# не тащим — такой платформы в продукте нет, её строки никогда не сматчатся.
PLATFORM_BY_MEDIA = {
    "telegram": "telegram",
    "tg": "telegram",
    "youtube": "youtube",
    "yt": "youtube",
    "zen": "dzen",
    "dzen": "dzen",
    "tiktok": "tiktok",
    "max": "max",
}
CPA_MEDIA_TYPES = list(PLATFORM_BY_MEDIA)

# Предохранитель bulk-replace (как у РКН-синка).
MAX_DELETE_RATIO = 0.02
SYNC_META_ID = "platform_active"


@dataclass(slots=True)
class Record:
    """Строка-источник в общем shape (одна на запись CPC/CPA, без мержа).

    Порядок полей = порядок колонок COPY в _apply_snapshot. `match_key` тут нет
    осознанно — его выводит generated-колонка БД из идентичности.
    """

    source_key: str
    source: str  # cpc | cpa
    platform: str
    external_id: str | None
    username: str | None
    link: str | None
    owner_login: str | None
    last_post_date: date | None
    recent_posts_count: int
    recent_views: int
    bot_status: str | None
    is_active: bool | None
    is_cpv: bool | None
    moderation_status: str | None


class GuardError(RuntimeError):
    """Снапшот не прошёл предохранитель — применять нельзя."""


# --- нормализация -------------------------------------------------------------
def _platform_from_cpc(value: str) -> str | None:
    # CHANNEL_PLATFORM_TELEGRAM / _MAX (в проде встречается опечатка PLATFROM).
    tail = value.removeprefix("CHANNEL_PLATFORM_").removeprefix("CHANNEL_PLATFROM_")
    return PLATFORM_BY_MEDIA.get(tail.strip().lower())


def _normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    return v if v.startswith(("http://", "https://")) else f"https://{v}"


# Платформа по ХОСТУ ссылки — для CPA, где media_type ненадёжен: под одним
# media_type лежат ссылки на разные площадки (t.me, vk, dzen, rutube, youtube).
# Не наши площадки (vk/ok/rutube/…) → None (дроп).
def _platform_from_url(url: str | None) -> str | None:
    if not url:
        return None
    s = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE)
    s = re.sub(r"^www\.", "", s, flags=re.IGNORECASE).lower()
    if s.startswith(("t.me/", "telegram.me/")):
        return "telegram"
    if s.startswith(("youtube.com/", "youtu.be/", "m.youtube.com/")):
        return "youtube"
    if s.startswith(("dzen.ru/", "zen.yandex.ru/")):
        return "dzen"
    if s.startswith("max.ru/"):
        return "max"
    if s.startswith(("tiktok.com/", "vm.tiktok.com/")):
        return "tiktok"
    return None  # vk.com / ok.ru / rutube.ru / прочее — не наши


def _first_path_seg(url: str) -> str | None:
    """Первый сегмент пути после хоста (без @/query), lower — handle dzen/tiktok."""
    s = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE)
    s = re.sub(r"^www\.", "", s, flags=re.IGNORECASE)
    parts = s.split("/", 1)
    if len(parts) < 2:
        return None
    seg = re.split(r"[/?#]", parts[1], maxsplit=1)[0].lstrip("@").lower()
    return seg or None


# Сегменты youtube, которые не являются именем канала.
_YT_NON_HANDLE = {"watch", "playlist", "results", "feed", "shorts"}


def _youtube_identity(url: str) -> tuple[str | None, str | None]:
    """(external_id, username) из youtube-ссылки: /channel/UC… → external_id;
    /@handle, /c/<name>, /user/<name>, /<custom> → username (lower)."""
    m = re.search(r"youtube\.com/channel/(UC[A-Za-z0-9_-]+)", url, flags=re.IGNORECASE)
    if m:
        return m.group(1), None
    m = re.search(
        r"youtube\.com/(?:c/|user/)?@?([A-Za-z0-9._-]+)", url, flags=re.IGNORECASE
    )
    if m and m.group(1).lower() not in _YT_NON_HANDLE:
        return None, m.group(1).lower()
    return None, None


def _cpa_identity(
    platform: str, channel_id: str | None, url: str | None
) -> tuple[str | None, str | None]:
    """(external_id, username) канала CPA по платформе и ссылке."""
    if platform == "telegram":
        # channel_id == tg chat id (-100…), совпадает с channels.external_id.
        return channel_id, _tg_username(url)
    if platform == "youtube" and url:
        return _youtube_identity(url)
    if platform in ("dzen", "tiktok") and url:
        return None, _first_path_seg(url)
    return None, None  # max — матч по инвайт-хэшу из link


# Валидный публичный telegram-хендл: 5–32 символа, старт с буквы, без хвостового
# «_». По модели TDLib (td_api.tl) username — только то, что резолвится в
# internalLinkTypePublicChat; t.me/c/… (приватный по id), t.me/s/… (превью),
# +/joinchat (инвайт) хендлами НЕ являются. Регулярка сама отвергает c/s
# (короче 5). Портировано из scripts/yt/export_active_cpc_cpa_gate.py.
USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{3,30}[a-z0-9]$")


def _tg_username(url: str | None) -> str | None:
    """@handle из t.me/tg-ссылки по правилам Telegram, иначе None."""
    if not url:
        return None
    s = url.strip()
    if not s:
        return None
    s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^tg://", "", s, flags=re.IGNORECASE)
    m = re.match(r"^resolve\?(?:.*&)?domain=([a-zA-Z0-9_]+)", s, flags=re.IGNORECASE)
    if m:
        handle = m.group(1).lower()
        return handle if USERNAME_RE.match(handle) else None
    m = re.match(r"^t\.me/(.+)$", s, flags=re.IGNORECASE)
    if m:
        tail = m.group(1)
        if tail.startswith("+") or re.match(r"^joinchat/", tail, flags=re.IGNORECASE):
            return None  # инвайт, не хендл
        first = re.split(r"[/?#]", tail, maxsplit=1)[0].lower()
        return first if USERNAME_RE.match(first) else None
    handle = s.removeprefix("@").lower()
    return handle if USERNAME_RE.match(handle) else None


def _to_date(value) -> date | None:
    if value in (None, "", 0):
        return None
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    if ts > 4_102_444_800:  # 2100-01-01 — часть источников в миллисекундах.
        ts //= 1000
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).date()
    except (OSError, OverflowError, ValueError):
        return None


def _int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _bool(value) -> bool | None:
    # YT обычно отдаёт native bool, но подстрахуемся от строк/чисел:
    # bool("false") был бы True.
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"true", "1", "yes", "t"}


# --- YT-клиент и запросы ------------------------------------------------------
def _yt_client(proxy: str, token: str) -> yt.YtClient:
    return yt.YtClient(
        proxy=proxy,
        token=token,
        config={
            "proxy": {
                "url": proxy,
                "request_timeout": 60_000,
                "retries": {"enable": True, "count": 10},
            },
        },
    )


def _read_query(client: yt.YtClient, cluster: str, pool: str, query: str):
    """Выполнить YQL и проитерировать строки result-таблицы."""
    body = f'pragma yt.Pool="{pool}";\nUSE {cluster};\n\n{query}'
    op = client.run_query("yql", body, sync=True)
    result = client.get_query_result(op.id, 0)
    table = (result.get("full_result") or {}).get("table_path")
    if not table:
        raise RuntimeError(f"query {op.id} has no full_result.table_path")
    if not table.startswith("//"):
        table = f"//{table}"
    yield from client.read_table(table)


def _cpa_query(days: int) -> str:
    media = ", ".join(f'"{m}"' for m in CPA_MEDIA_TYPES)
    seconds = days * 86_400
    # Агрегируем по page_key: идентичность через max(), активность за окно через
    # sum()/максимум таймстампа. Берём только то, что реально нужно продукту
    # (без earned_rub/place_name/sandbox/all_posts — см. спеку).
    return f"""
$SINCE = cast(DateTime::ToSeconds(CurrentUtcTimestamp()) as Int64) - {seconds}l;

select
    page_key,
    max(channel_id)            as channel_id,
    max(media_type)            as media_type,
    max(place_link)            as place_link,
    max(invite_link)           as invite_link,
    max(user_login)            as user_login,
    max(blog_moderation_status) as moderation_status,
    max(post_in_blog_creation_timestamp) as last_post_timestamp,
    sum(cast(post_in_blog_creation_timestamp >= $SINCE as Int64)) as recent_posts_count,
    sum(if(post_in_blog_creation_timestamp >= $SINCE, cast(total_post_impressions as Int64), 0)) as recent_views
from (
    select
        case when channel_id is not null
             then cast(channel_id as String) else cast(page_id as String) end as page_key,
        cast(channel_id as Int64) as channel_id,
        media_type, place_link, invite_link, user_login,
        blog_moderation_status, post_in_blog_creation_timestamp, total_post_impressions
    from `{CPA_POSTS_TABLE}`
    where (channel_id is not null or page_id is not null)
      and media_type in ({media})
)
group by page_key;
"""


def _cpc_activity_query(days: int) -> str:
    seconds = days * 86_400
    return f"""
$SINCE = cast(DateTime::ToSeconds(CurrentUtcTimestamp()) as Int64) - {seconds}l;

select
    tg_chat_id,
    count(*)                         as recent_posts_count,
    sum(cast(Views as Int64))        as recent_views,
    max(cast(DeliveryTimestamp as Int64)) as last_post_timestamp
from (
    select cast(TgChatId as Int64) as tg_chat_id, Views, DeliveryTimestamp
    from `{CPC_MESSAGES_TABLE}`
    where DeliveryTimestamp > $SINCE and TgChatId is not null
)
group by tg_chat_id;
"""


def _scalar(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    text = str(value).strip()
    return text or None


# --- сбор источников ----------------------------------------------------------
def collect_cpa(client: yt.YtClient, cluster: str, pool: str, days: int) -> list[Record]:
    records: list[Record] = []
    for row in _read_query(client, cluster, pool, _cpa_query(days)):
        link = _normalize_url(_scalar(row.get("place_link"))) or _normalize_url(
            _scalar(row.get("invite_link"))
        )
        # Платформа — по ХОСТУ ссылки, а не по media_type (он у CPA мусорный:
        # под media_type='youtube' лежат t.me/vk/dzen/rutube/youtube вперемешку).
        platform = _platform_from_url(link)
        if not platform:
            continue  # vk / rutube / не наша площадка
        external_id, username = _cpa_identity(
            platform, _scalar(row.get("channel_id")), link
        )
        records.append(
            Record(
                source_key=f"cpa:{_scalar(row.get('page_key'))}",
                source="cpa",
                platform=platform,
                external_id=external_id,
                username=username,
                link=link,
                owner_login=_scalar(row.get("user_login")),
                last_post_date=_to_date(row.get("last_post_timestamp")),
                recent_posts_count=_int(row.get("recent_posts_count")),
                recent_views=_int(row.get("recent_views")),
                bot_status=None,
                is_active=None,
                is_cpv=None,
                moderation_status=_scalar(row.get("moderation_status")),
            )
        )
    return records


def collect_cpc(client: yt.YtClient, cluster: str, pool: str, days: int) -> list[Record]:
    # YT делает один тяжёлый запрос по messages; метаданные каналов читаем
    # минимальным набором колонок и джойним в памяти — эмпирически быстрее
    # джойна на YT.
    # Держим в памяти только нужные 3 поля (~126k строк), не весь YT-row.
    activity: dict[str, tuple[date | None, int, int]] = {}
    for row in _read_query(client, cluster, pool, _cpc_activity_query(days)):
        chat_id = _scalar(row.get("tg_chat_id"))
        if chat_id:
            activity[chat_id] = (
                _to_date(row.get("last_post_timestamp")),
                _int(row.get("recent_posts_count")),
                _int(row.get("recent_views")),
            )

    columns = ["TgChatId", "Username", "IsActive", "Platform", "IsCpv", "BotStatus", "InviteLink"]
    records: list[Record] = []
    for row in client.read_table(yt.TablePath(CPC_CHANNELS_TABLE, columns=columns)):
        chat_id = _scalar(row.get("TgChatId"))
        if not chat_id:
            continue
        platform = _platform_from_cpc(_scalar(row.get("Platform")) or "")
        if not platform:
            continue
        username = _scalar(row.get("Username"))
        username = username.removeprefix("@") if username else None
        invite = _scalar(row.get("InviteLink"))
        # telegram матчим по username/external_id; max — по инвайт-хэшу из link
        # (external_id из tg_chat_id у max — внутренний id, не матчабелен → None).
        external_id = chat_id if platform == "telegram" else None
        if platform == "telegram" and username:
            link = f"https://t.me/{username}"
        else:
            link = _normalize_url(invite)
        last_post_date, recent_posts_count, recent_views = activity.get(
            chat_id, (None, 0, 0)
        )
        records.append(
            Record(
                source_key=f"cpc:{chat_id}",
                source="cpc",
                platform=platform,
                external_id=external_id,
                username=username,
                link=link,
                owner_login=None,
                last_post_date=last_post_date,
                recent_posts_count=recent_posts_count,
                recent_views=recent_views,
                bot_status=_scalar(row.get("BotStatus")),
                is_active=_bool(row.get("IsActive")),
                is_cpv=_bool(row.get("IsCpv")),
                moderation_status=None,
            )
        )
    return records


# --- запись в Postgres --------------------------------------------------------
_COPY_COLUMNS = (
    "source_key", "source", "platform", "external_id", "username", "link",
    "owner_login", "last_post_date", "recent_posts_count", "recent_views",
    "bot_status", "is_active", "is_cpv", "moderation_status",
)


def _apply_snapshot(conn: psycopg.Connection, records: list[Record]) -> None:
    """Bulk-replace в одной транзакции с предохранителем. Raises GuardError."""
    staged = len(records)
    if staged == 0:
        raise GuardError("empty snapshot — отказ от применения")
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TEMP TABLE pac_stage (
                source_key text, source text, platform text, external_id text,
                username text, link text, owner_login text, last_post_date date,
                recent_posts_count int, recent_views bigint, bot_status text,
                is_active boolean, is_cpv boolean, moderation_status text
            ) ON COMMIT DROP
            """
        )
        cols = ", ".join(_COPY_COLUMNS)
        # astuple(r) — порядок полей Record == порядок _COPY_COLUMNS (инвариант
        # в докстроке Record), поэтому ручной 14-польный кортеж не нужен.
        with cur.copy(f"COPY pac_stage ({cols}) FROM STDIN") as copy:
            for r in records:
                copy.write_row(astuple(r))
        cur.execute("SELECT count(*) FROM platform_active_channels")
        current = cur.fetchone()[0]
        if current > 0 and staged < current * (1 - MAX_DELETE_RATIO):
            raise GuardError(f"snapshot усох: {staged} < текущих {current} (>{MAX_DELETE_RATIO:.0%})")
        # records уже дедуплены по source_key в _collect (до guard'а), поэтому
        # staged == число вставляемых строк и DISTINCT ON не нужен.
        cur.execute("TRUNCATE platform_active_channels")
        cur.execute(
            f"""
            INSERT INTO platform_active_channels ({cols}, updated_at)
            SELECT {cols}, now() FROM pac_stage
            """
        )


def _stamp_ok(conn: psycopg.Connection, total: int) -> None:
    conn.execute(
        """
        INSERT INTO platform_active_sync (id, last_sync_at, last_status, total)
        VALUES (%s, now(), 'ok', %s)
        ON CONFLICT (id) DO UPDATE
            SET last_sync_at = now(), last_status = 'ok', total = EXCLUDED.total
        """,
        (SYNC_META_ID, total),
    )


def _stamp_error(conn: psycopg.Connection, message: str) -> None:
    # last_sync_at/total НЕ трогаем — на странице остаётся «данные на <дата>».
    conn.execute(
        """
        INSERT INTO platform_active_sync (id, last_sync_at, last_status, total)
        VALUES (%s, NULL, %s, 0)
        ON CONFLICT (id) DO UPDATE SET last_status = EXCLUDED.last_status
        """,
        (SYNC_META_ID, message[:500]),
    )


# --- CLI ----------------------------------------------------------------------
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync Yandex platform-active channels into Postgres.")
    p.add_argument("--proxy", default="hahn.yt.yandex.net", help="YT proxy.")
    p.add_argument("--cluster", default="hahn", help="YQL cluster for USE.")
    p.add_argument("--pool", default="ad-research", help="YT pool pragma.")
    p.add_argument("--days", type=int, default=60, help="Activity window in days.")
    p.add_argument(
        "--dsn",
        default=os.environ.get("PLATFORM_ACTIVE_DSN"),
        help="Postgres DSN (default: env PLATFORM_ACTIVE_DSN).",
    )
    p.add_argument(
        "--token-path",
        default=str(Path.home() / ".yt" / "token"),
        help="Path to YT OAuth token (default: env YT_TOKEN or ~/.yt/token).",
    )
    p.add_argument("--dry-run", action="store_true", help="Collect only, don't write DB.")
    return p.parse_args()


def _collect(client: yt.YtClient, args: argparse.Namespace) -> list[Record]:
    records = collect_cpc(client, args.cluster, args.pool, args.days)
    records += collect_cpa(client, args.cluster, args.pool, args.days)
    # Дедуп по source_key (keep-last) ДО guard'а: тогда staged == число
    # вставляемых строк, предохранитель и штампуемый total точны.
    by_key: dict[str, Record] = {r.source_key: r for r in records}
    return list(by_key.values())


def main() -> int:
    args = _parse_args()
    token = os.environ.get("YT_TOKEN") or Path(args.token_path).read_text("utf-8").strip()
    client = _yt_client(args.proxy, token)

    if args.dry_run:
        records = _collect(client, args)
        print(f"collected: {len(records)} records", flush=True)
        for r in records[:5]:
            print(r, flush=True)
        return 0
    if not args.dsn:
        raise SystemExit("PLATFORM_ACTIVE_DSN is required (or pass --dsn)")

    # Сбор внутри try с подключённой БД: ЛЮБОЙ сбой (чтение YT, COPY, INSERT,
    # нарушение CHECK) штампуется в last_status — иначе суточный джоб падал бы
    # молча, а страница показывала бы протухшие данные как свежие.
    with psycopg.connect(args.dsn) as conn:
        try:
            records = _collect(client, args)
            print(f"collected: {len(records)} records", flush=True)
            _apply_snapshot(conn, records)
            _stamp_ok(conn, len(records))
            conn.commit()
            print(f"applied: {len(records)} rows", flush=True)
            return 0
        except GuardError as exc:
            conn.rollback()
            _stamp_error(conn, str(exc))
            conn.commit()
            print(f"GUARD: {exc} — snapshot rejected, table unchanged", flush=True)
            return 1
        except Exception as exc:  # noqa: BLE001 — записать и упасть с alert
            conn.rollback()
            _stamp_error(conn, f"{type(exc).__name__}: {exc}")
            conn.commit()
            raise


if __name__ == "__main__":
    raise SystemExit(main())
