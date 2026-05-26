import { Check } from "lucide-react";
import {
  CAMPAIGN_PHASES,
  type PhaseKey,
  type ChainStatus,
  type ClientStatus,
  type ContractStatus,
  type CreativeStatus,
} from "./-shared";

// Палитра тонов — в стиле StatusBadge из project-tabs.tsx (rounded-full chip).
type Tone = "zinc" | "emerald" | "amber" | "red" | "blue" | "violet";

const TONE_CLASS: Record<Tone, string> = {
  zinc: "bg-zinc-100 text-zinc-600",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
};

type View = { label: string; tone: Tone };

// Единый источник статус-лейблов: таблица лонглиста и drawer рисуют статус
// одинаково. Production-статусы (договор/креатив) добавятся в PR производства.
export const chainView: Record<ChainStatus, View> = {
  not_sent: { label: "не отправлено", tone: "zinc" },
  sent: { label: "отправлено", tone: "blue" },
  read: { label: "прочитано", tone: "blue" },
  replied: { label: "ответил", tone: "emerald" },
  declined: { label: "отказался", tone: "red" },
};

export const clientView: Record<ClientStatus, View> = {
  pending: { label: "ждёт решения", tone: "zinc" },
  approved: { label: "одобрен", tone: "emerald" },
  rejected: { label: "отклонён", tone: "red" },
  replace: { label: "замена", tone: "amber" },
};

export function availableView(v: boolean | null): View {
  if (v === null) return { label: "—", tone: "zinc" };
  return v ? { label: "готов", tone: "emerald" } : { label: "отказ", tone: "red" };
}

export const contractView: Record<ContractStatus, View> = {
  none: { label: "не отправлен", tone: "zinc" },
  sent: { label: "отправлен", tone: "blue" },
  revising: { label: "правки", tone: "amber" },
  signed: { label: "подписан", tone: "emerald" },
};

export const creativeView: Record<CreativeStatus, View> = {
  none: { label: "—", tone: "zinc" },
  awaiting: { label: "ждём драфт", tone: "zinc" },
  internal_review: { label: "проверка", tone: "violet" },
  client_review: { label: "у клиента", tone: "blue" },
  revising: { label: "правки", tone: "amber" },
  approved: { label: "одобрен", tone: "emerald" },
};

export function Chip({
  tone = "zinc",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium " +
        TONE_CLASS[tone]
      }
    >
      {children}
    </span>
  );
}

// Горизонтальный визард-степпер. Фазы кликабельны — свободная навигация
// (phase в БД = «где основная работа», экраны доступны в любом порядке).
export function PhaseStepper({
  current,
  onPick,
}: {
  current: PhaseKey;
  onPick: (p: PhaseKey) => void;
}) {
  const currentIdx = CAMPAIGN_PHASES.findIndex((p) => p.key === current);

  return (
    <div className="flex items-center">
      {CAMPAIGN_PHASES.map((phase, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={phase.key} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onPick(phase.key)}
              className="group flex shrink-0 items-center gap-2"
              title={`Перейти: ${phase.label}`}
            >
              <span
                className={
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                  (active
                    ? "bg-emerald-600 text-white ring-4 ring-emerald-100"
                    : done
                      ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                      : "bg-zinc-100 text-zinc-400 group-hover:bg-zinc-200")
                }
              >
                {done ? <Check size={14} /> : idx + 1}
              </span>
              <span
                className={
                  "text-sm transition-colors " +
                  (active
                    ? "font-semibold text-zinc-900"
                    : done
                      ? "text-zinc-600 group-hover:text-zinc-900"
                      : "text-zinc-400 group-hover:text-zinc-600")
                }
              >
                {phase.label}
              </span>
            </button>
            {idx < CAMPAIGN_PHASES.length - 1 && (
              <span
                className={
                  "mx-2 h-px flex-1 " +
                  (idx < currentIdx ? "bg-emerald-200" : "bg-zinc-200")
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
