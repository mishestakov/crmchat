// Общая форма полей контакта — используется в /contacts/new и /contacts/$id/edit.
// Один блок, одно правило отображения:
//   ALWAYS_SHOWN_KEYS — всегда поле (full_name, description, stage)
//   filled (есть значение) — поле
//   иначе — chip «+ Email» внизу, по клику раскрывается в поле
// Без деления identity/properties и спец-исключений.

import { useState } from "react";
import type { Property, PropertyType } from "@repo/core";

// Жёсткий порядок верхушки. Дальше — properties.order.
const ALWAYS_SHOWN_KEYS = ["full_name", "description", "stage"] as const;

export function ContactFormFields(props: {
  properties: Property[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { properties, values, onChange } = props;

  const setValue = (key: string, v: unknown) => {
    onChange({ ...values, [key]: v });
  };

  // revealed — что раскрыл юзер кликом по chip'у. С прошлого раскрытия не сворачивается
  // обратно автоматически, даже если очистил значение (UX: «передумал — закрою сам»).
  // Lazy init: считаем только на первом mount'е, иначе пересчитывалось бы на каждом
  // рендере (и setState игнорировал бы кроме первого раза).
  const [revealed, setRevealed] = useState<Set<string>>(() => {
    const r = new Set<string>();
    for (const p of properties) {
      if (!isAlwaysShown(p.key) && hasValue(values[p.key])) r.add(p.key);
    }
    return r;
  });

  const visible: Property[] = [];
  const hidden: Property[] = [];
  for (const p of properties) {
    if (
      isAlwaysShown(p.key) ||
      hasValue(values[p.key]) ||
      revealed.has(p.key)
    ) {
      visible.push(p);
    } else {
      hidden.push(p);
    }
  }
  visible.sort(visibleOrder);

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {visible.map((p, i) => (
        <PropertyRow
          key={p.id}
          property={p}
          value={values[p.key]}
          onChange={(v) => setValue(p.key, v)}
          isLast={i === visible.length - 1 && hidden.length === 0}
          autoFocus={i === 0}
        />
      ))}
      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3">
          {hidden.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setRevealed((s) => new Set([...s, p.key]))}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              + {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function isAlwaysShown(key: string): boolean {
  return (ALWAYS_SHOWN_KEYS as readonly string[]).includes(key);
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// ALWAYS_SHOWN сверху в фиксированном порядке, дальше — по property.order.
function visibleOrder(a: Property, b: Property): number {
  const all: readonly string[] = ALWAYS_SHOWN_KEYS;
  const aA = all.indexOf(a.key);
  const bA = all.indexOf(b.key);
  if (aA !== -1 && bA !== -1) return aA - bA;
  if (aA !== -1) return -1;
  if (bA !== -1) return 1;
  return a.order - b.order;
}

function PropertyRow(props: {
  property: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  isLast: boolean;
  autoFocus?: boolean;
}) {
  const { property: p, value, onChange } = props;
  return (
    <div
      className={
        "flex items-start gap-3 px-4 py-3 text-sm " +
        (props.isLast ? "" : "border-b border-zinc-100")
      }
    >
      {/* pt-1.5 совпадает с py-1.5 у инпутов → label выравнен с первой строкой
          текста (для многострочного textarea — с верхней строкой, как и должно). */}
      <span className="w-28 shrink-0 pt-1.5 text-zinc-500">{p.name}</span>
      <div className="min-w-0 flex-1">
        <ValueInput
          type={p.type}
          required={p.required}
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
  required: boolean;
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
        autoFocus={props.autoFocus}
        className={inputCls}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {!props.required && <option value="">—</option>}
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
