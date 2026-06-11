import { AlertTriangle } from "lucide-react";
import { formatRelative } from "../lib/date-utils";

// Ряд статус-пилюль канала для строк списков (каталог, карточка контакта, …).
// Единая точка: новая пометка (РКН, «подходит под продукт») добавляется здесь
// и появляется во всех списках сразу — до унификации «Закрытый» жил только в
// каталоге, а DM-пилюля имела три разных вида (аудит C1, 10.06.26).
const PILL =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1";
const DM_PILL = PILL + " bg-emerald-50 text-emerald-700 ring-emerald-200";

// Порог закона о реестре РКН: страницы с аудиторией БОЛЕЕ 10к обязаны быть
// зарегистрированы, иначе размещать рекламу нельзя.
export const RKN_THRESHOLD = 10_000;

// РКН-статус канала — единственная реализация пилюль: ряд бейджей в списках
// (через ChannelBadges) и hero карточки канала (withIcon). Три состояния:
// в реестре → спокойный «РКН»; >10к и нет → красная тревога; аудитория
// неизвестна (без соц-pull'а) и нет в реестре → серый «РКН?» — молчание
// выглядело бы как «всё чисто».
export function RknBadge(props: {
  isRkn?: boolean;
  memberCount?: number | null;
  withIcon?: boolean;
}) {
  if (props.isRkn === undefined) return null;
  if (props.isRkn) {
    return (
      <span
        title="Страница зарегистрирована в реестре РКН"
        className={PILL + " bg-sky-50 text-sky-700 ring-sky-200"}
      >
        РКН
      </span>
    );
  }
  if (props.memberCount != null && props.memberCount > RKN_THRESHOLD) {
    return (
      <span
        title="Больше 10 000 подписчиков и нет в реестре РКН — размещать рекламу нельзя"
        className={PILL + " gap-1 bg-red-600 text-white ring-red-600"}
      >
        {props.withIcon && <AlertTriangle size={11} />}
        Нет РКН
      </span>
    );
  }
  if (props.memberCount == null) {
    return (
      <span
        title="Нет в реестре РКН, аудитория ещё не синкалась — возможно, регистрация обязательна"
        className={PILL + " bg-zinc-100 text-zinc-500 ring-zinc-200"}
      >
        РКН?
      </span>
    );
  }
  return null;
}

export function ChannelBadges(props: {
  username: string | null;
  // Нет публичного @username, есть ссылка → «Закрытый» (приватный инвайт).
  link?: string | null;
  unavailableSince?: string | null;
  unavailableReason?: string | null;
  // Личка канала: "open" — DM-группа синкнута (кликабельна при onDmClick),
  // "syncing" — has_dm=true, но группа ещё реплицируется.
  dm?: "open" | "syncing" | null;
  onDmClick?: () => void;
  // РКН: true → спокойная пилюля «РКН»; false при memberCount > 10к →
  // кричащая красная «Нет РКН» (реклама запрещена). undefined — данных нет,
  // ничего не рисуем (список без РКН-полей в ответе).
  isRkn?: boolean;
  memberCount?: number | null;
}) {
  return (
    <>
      <RknBadge isRkn={props.isRkn} memberCount={props.memberCount} />
      {props.dm === "open" && props.onDmClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onDmClick?.();
          }}
          title="Написать в личку канала"
          className={DM_PILL + " hover:bg-emerald-100"}
        >
          DM
        </button>
      ) : props.dm ? (
        <span
          title={
            props.dm === "open"
              ? "Канал принимает прямые сообщения в личку"
              : "Канал принимает прямые сообщения в личку (синхронизируется)"
          }
          className={DM_PILL}
        >
          DM
        </span>
      ) : null}
      {props.unavailableSince && (
        <span
          title={`${props.unavailableReason ?? "недоступен"} · последняя попытка ${formatRelative(props.unavailableSince)}`}
          className={PILL + " bg-zinc-100 text-zinc-500 ring-zinc-200"}
        >
          Недоступен
        </span>
      )}
      {!props.username && props.link && (
        <span
          title="Закрытый канал — доступен после вступления"
          className={PILL + " bg-amber-50 text-amber-700 ring-amber-200"}
        >
          Закрытый
        </span>
      )}
    </>
  );
}
