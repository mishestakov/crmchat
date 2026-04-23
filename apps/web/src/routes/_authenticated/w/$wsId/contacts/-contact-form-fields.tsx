// Общая форма полей контакта — используется в /contacts/new и /contacts/$id/edit.
// Получает properties (определения) + values (текущее состояние) + onChange.
// Сама группирует поля на 2 карточки и реализует progressive disclosure для
// optional identity-полей (email/phone/telegram/url через chip-ряд).

import { useState } from "react";
import type { Property, PropertyType } from "@repo/core";

// Identity-properties: имя, описание + контакты. В view рендерятся специально
// (имя по центру, описание подписью, остальное — соц.иконки). В edit — собраны
// в верхнюю карточку. Импортируется отсюда же в $id/index.tsx, чтобы не плодить
// дубликат.
export const IDENTITY_KEYS = new Set([
  "full_name",
  "description",
  "email",
  "phone",
  "url",
  "telegram_username",
]);

// Identity-поля, которые можно скрыть когда пусты (показываются как chip
// «+ Email» внизу карточки и раскрываются по клику в полноценный input).
// full_name (required) и description (всегда нужно поле) — не скрываются.
const COLLAPSIBLE_KEYS = new Set([
  "email",
  "phone",
  "telegram_username",
  "url",
]);

export function ContactFormFields(props: {
  properties: Property[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { properties, values, onChange } = props;

  const setValue = (key: string, v: unknown) => {
    onChange({ ...values, [key]: v });
  };

  const identity = properties.filter((p) => IDENTITY_KEYS.has(p.key));
  const others = properties.filter((p) => !IDENTITY_KEYS.has(p.key));

  // Какие collapsible-identity поля «раскрыты» (либо имеют значение, либо юзер
  // нажал chip). Не раскрытые с пустым значением рендерятся как chip внизу.
  const initiallyRevealed = new Set<string>();
  for (const p of identity) {
    if (COLLAPSIBLE_KEYS.has(p.key) && hasValue(values[p.key])) {
      initiallyRevealed.add(p.key);
    }
  }
  const [revealed, setRevealed] = useState<Set<string>>(initiallyRevealed);

  const visibleIdentity = identity.filter(
    (p) => !COLLAPSIBLE_KEYS.has(p.key) || revealed.has(p.key),
  );
  const hiddenIdentity = identity.filter(
    (p) => COLLAPSIBLE_KEYS.has(p.key) && !revealed.has(p.key),
  );

  return (
    <div className="space-y-3">
      {identity.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {visibleIdentity.map((p, i) => (
            <PropertyRow
              key={p.id}
              property={p}
              value={values[p.key]}
              onChange={(v) => setValue(p.key, v)}
              isLast={
                i === visibleIdentity.length - 1 && hiddenIdentity.length === 0
              }
              autoFocus={i === 0}
            />
          ))}
          {hiddenIdentity.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3">
              {hiddenIdentity.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() =>
                    setRevealed((s) => new Set([...s, p.key]))
                  }
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                >
                  + {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {others.map((p, i) => (
            <PropertyRow
              key={p.id}
              property={p}
              value={values[p.key]}
              onChange={(v) => setValue(p.key, v)}
              isLast={i === others.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function PropertyRow(props: {
  property: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  isLast: boolean;
  autoFocus?: boolean;
}) {
  const { property: p, value, onChange } = props;
  // textarea и multi_select шире обычной строки → лейбл сверху, не слева.
  const labelTop = p.type === "textarea" || p.type === "multi_select";
  return (
    <div
      className={
        (labelTop
          ? "flex flex-col gap-1.5 px-4 py-3 text-sm"
          : "flex items-center gap-3 px-4 py-3 text-sm") +
        (props.isLast ? "" : " border-b border-zinc-100")
      }
    >
      <span
        className={
          labelTop ? "text-zinc-500" : "w-28 shrink-0 text-zinc-500"
        }
      >
        {p.name}
      </span>
      <div className="min-w-0 flex-1">
        <ValueInput
          type={p.type}
          value={value}
          onChange={onChange}
          options={p.values ?? []}
          autoFocus={props.autoFocus}
        />
      </div>
    </div>
  );
}

function ValueInput(props: {
  type: PropertyType;
  value: unknown;
  onChange: (v: unknown) => void;
  options: { id: string; name: string }[];
  autoFocus?: boolean;
}) {
  // Видимая граница всегда (а не только на hover/focus) — иначе инпут визуально
  // не отличается от label'а и юзер не понимает что это поле ввода.
  const inputCls =
    "w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 hover:border-zinc-300 focus:border-emerald-500 focus:outline-none";
  const { type, value, onChange } = props;

  if (type === "single_select") {
    return (
      <select
        className={inputCls}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {props.options.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    );
  }
  if (type === "multi_select") {
    const arr = Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];
    return (
      <div className="flex flex-wrap gap-1.5 py-1">
        {props.options.map((o) => {
          const selected = arr.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              onClick={() =>
                onChange(
                  selected ? arr.filter((x) => x !== o.id) : [...arr, o.id],
                )
              }
              className={
                "rounded-full border px-3 py-0.5 text-xs transition-colors " +
                (selected
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")
              }
            >
              {o.name}
            </button>
          );
        })}
      </div>
    );
  }
  if (type === "textarea") {
    return (
      <textarea
        autoFocus={props.autoFocus}
        rows={3}
        className={inputCls}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (type === "number") {
    return (
      <input
        autoFocus={props.autoFocus}
        type="number"
        className={inputCls}
        value={
          typeof value === "number" && Number.isFinite(value)
            ? String(value)
            : ""
        }
        onChange={(e) => {
          const s = e.target.value;
          if (s === "") onChange("");
          else {
            const n = Number(s);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
      />
    );
  }
  // text / email / tel / url / user_select — общий strgin input.
  // Браузер сам делает легкую валидацию по type=email/tel/url и подсказывает
  // подходящую клавиатуру на mobile.
  const htmlType =
    type === "email"
      ? "email"
      : type === "tel"
        ? "tel"
        : type === "url"
          ? "url"
          : "text";
  return (
    <input
      autoFocus={props.autoFocus}
      type={htmlType}
      className={inputCls}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
