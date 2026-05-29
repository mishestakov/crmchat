import { Check } from "lucide-react";
import {
  CAMPAIGN_PHASES,
  type PhaseKey,
  type ChainStatus,
  type ClientStatus,
  type ContractStatus,
  type CreativeStatus,
  type Placement,
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

// ── Фаза «Запуск»: производный статус размещения ────────────────────────────
// 12 реальных шагов сводятся к паре «текущая стадия + на ком сейчас ход».
// Деривится из полей размещения (БД не трогаем). owner=us → это todo менеджера;
// список/матрица сортируются так, чтобы «на нас» был сверху.
export type ProdOwner = "us" | "client" | "blogger" | "done";

export const PROD_OWNER: Record<
  ProdOwner,
  { label: string; dot: string; text: string; border: string; soft: string }
> = {
  us:      { label: "На нас",     dot: "bg-red-500",     text: "text-red-700",     border: "border-l-red-400",     soft: "bg-red-50" },
  client:  { label: "На клиенте", dot: "bg-blue-500",    text: "text-blue-700",    border: "border-l-blue-400",    soft: "bg-blue-50" },
  blogger: { label: "На блогере", dot: "bg-amber-500",   text: "text-amber-700",   border: "border-l-amber-400",   soft: "bg-amber-50" },
  done:    { label: "Готово",     dot: "bg-emerald-500", text: "text-emerald-700", border: "border-l-emerald-400", soft: "bg-emerald-50" },
};

export const PROD_OWNER_ORDER: ProdOwner[] = ["us", "client", "blogger", "done"];

// Единый источник состояния договора. «Подписан» хранится в contractStatus
// (кнопка у менеджера), а «отправлен» выводится из факта пометки договора в
// чате (stepMessages.contract) — чтобы плашка, вертолёт и матрица не расходились
// (раньше плашка читала тег, а остальное — отдельное поле).
export function contractState(p: Placement): "none" | "sent" | "signed" {
  if (p.contractStatus === "signed") return "signed";
  if (p.stepMessages?.contract) return "sent";
  return "none";
}

export function deriveProduction(p: Placement): {
  owner: ProdOwner;
  stage: string;
  cta: string | null;
} {
  const cs = contractState(p);
  if (cs !== "signed") {
    if (cs === "none")
      return { owner: "us", stage: "Договор · отправить", cta: "Отправить договор" };
    return { owner: "blogger", stage: "Договор · ждём подпись", cta: null };
  }
  if (p.creativeStatus !== "approved") {
    if (p.creativeStatus === "internal_review")
      return { owner: "us", stage: "Креатив · проверяем драфт", cta: "Проверить драфт" };
    if (p.creativeStatus === "client_review")
      return { owner: "client", stage: "Креатив · у клиента на ОК", cta: null };
    // none / awaiting / revising — ждём драфт/правки от блогера
    return { owner: "blogger", stage: "Креатив · ждём от блогера", cta: null };
  }
  if (!p.erid)
    return { owner: "us", stage: "ЕРИД · промаркировать", cta: "Промаркировать (ЕРИД)" };
  if (!p.publishedAt)
    return { owner: "blogger", stage: "Публикация · ждём выход", cta: null };
  if (!p.actReceivedAt)
    return { owner: "blogger", stage: "Акт · ждём от блогера", cta: "Запросить акт" };
  return { owner: "done", stage: "Готово", cta: null };
}

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
