import type { ChannelRelationStatus } from "@repo/core";

// Глобальный статус взаимодействия по каналу — лейбл + цвет бейджа. Ось
// «работает ли канал с нами», следует за каналом по всем проектам. Общий для
// сайдбара (правка + история) и доски (бейдж на карточке, read-only).
export const RELATION_META: Record<
  ChannelRelationStatus,
  { label: string; cls: string }
> = {
  none: { label: "Не оценён", cls: "bg-zinc-100 text-zinc-500" },
  pending: { label: "Ждём ответа", cls: "bg-amber-100 text-amber-700" },
  working: { label: "Работает", cls: "bg-emerald-100 text-emerald-700" },
  paused: { label: "Перестал", cls: "bg-orange-100 text-orange-700" },
  unsuitable: { label: "Не подходит", cls: "bg-zinc-200 text-zinc-600" },
  declined: { label: "Отказ", cls: "bg-red-100 text-red-700" },
};

// Выбор в дропдауне (none — дефолт «не оценён», руками не ставится).
export const RELATION_CHOICES: ChannelRelationStatus[] = [
  "pending",
  "working",
  "paused",
  "unsuitable",
  "declined",
];

export function RelationBadge(props: { status: ChannelRelationStatus }) {
  const m = RELATION_META[props.status];
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
