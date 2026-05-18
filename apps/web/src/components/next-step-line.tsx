import { Bell, Repeat2 } from "lucide-react";

// Строка с ближайшим открытым reminder'ом контакта. Bell-иконка + дата (Сегодня
// / DD.MM, красным если просрочен) + Repeat2 если повторяющийся + truncate-
// текст. Источник — Contact.nextStep (или Lead.nextStep в проектном канбане).
//
// Раньше рендерилось на kanban-карточке /contacts; при ребилде /contacts в
// плоскую таблицу (10.1) компонент потерялся вместе с канбаном — восстановлен
// здесь как переиспользуемый.

export type NextStep = {
  date: string;
  text: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
};

export function NextStepLine({ next }: { next: NextStep }) {
  const date = new Date(next.date);
  const overdue = date.getTime() < Date.now();
  const today = isSameDay(date, new Date());
  const label = today
    ? "Сегодня"
    : `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  return (
    <div className="flex items-start gap-1 text-xs">
      <Bell
        size={11}
        className={
          "mt-0.5 shrink-0 " + (overdue ? "text-red-500" : "text-zinc-400")
        }
      />
      <span className={overdue ? "text-red-600" : "text-zinc-500"}>
        {label}
      </span>
      {next.repeat !== "none" && (
        <Repeat2 size={11} className="mt-0.5 shrink-0 text-zinc-400" />
      )}
      <span className="truncate text-zinc-600">· {next.text}</span>
    </div>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
