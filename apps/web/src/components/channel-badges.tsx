import { formatRelative } from "../lib/date-utils";

// Ряд статус-пилюль канала для строк списков (каталог, карточка контакта, …).
// Единая точка: новая пометка (РКН, «подходит под продукт») добавляется здесь
// и появляется во всех списках сразу — до унификации «Закрытый» жил только в
// каталоге, а DM-пилюля имела три разных вида (аудит C1, 10.06.26).
const PILL =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1";
const DM_PILL = PILL + " bg-emerald-50 text-emerald-700 ring-emerald-200";

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
}) {
  return (
    <>
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
