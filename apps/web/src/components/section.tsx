import { ChevronRight } from "lucide-react";

// Section + SectionItem — донор-style строки в общей карточке-«листе».
// Используются на sequence-detail и sub-routes; возможно появятся в settings.
//
// SectionItem умеет режим navigation (link на sub-route, chevron справа) и
// режим content (любой children, без chevron). Для navigation используем
// проп `to` (TanStack Router-link выше уровнем; здесь принимаем либо <Link>
// children, либо обычный onClick). Без Radix Slot — самый простой паттерн.

export function Section(props: {
  header?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {props.header && (
        <div className="px-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
          {props.header}
        </div>
      )}
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm">
        {props.children}
      </div>
    </div>
  );
}

// Универсальная строка. Если передан onClick / asLink — добавляем chevron
// справа (кроме случая когда withChevron=false). Хвост (`right`) — для
// inline-кнопок (Pause/Play в Status) или value-текста.
export function SectionItem(props: {
  onClick?: () => void;
  withChevron?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const isInteractive = !!props.onClick;
  const Tag = isInteractive ? "button" : "div";
  return (
    <Tag
      type={isInteractive ? "button" : undefined}
      onClick={props.onClick}
      className={
        "flex w-full items-center gap-3 px-5 py-3 text-left " +
        (isInteractive ? "hover:bg-zinc-50 " : "") +
        (props.className ?? "")
      }
    >
      {props.children}
      {props.withChevron && (
        <ChevronRight size={16} className="shrink-0 text-zinc-400" />
      )}
    </Tag>
  );
}

// SectionItemTitle / SectionItemValue — слоты внутри SectionItem,
// title слева растягивается, value жмётся вправо.
export function SectionItemTitle(props: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 text-sm">{props.children}</div>;
}

export function SectionItemValue(props: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 text-sm text-zinc-500">{props.children}</div>
  );
}
