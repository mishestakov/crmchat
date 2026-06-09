// Generic-рендерер набора полей (FieldDef[]) поверх values-объекта. Используется
// и для контакта (фиксированный CONTACT_FIELD_DEFS), и для канала (каталог
// channels.properties). Правило отображения одно:
//   alwaysShownKeys — всегда поле (для контакта: full_name/description)
//   filled (есть значение) — поле
//   иначе — chip «+ Название» внизу, по клику раскрывается в поле
// Порядок полей = порядок входного массива (каталог уже отсортирован сервером),
// alwaysShownKeys пиннятся вперёд.

import { useState } from "react";
import type { FieldDef, PropertyType } from "@repo/core";

export function PropertyFields(props: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  // Ключи, которые показываем всегда (даже пустыми), в заданном порядке.
  alwaysShownKeys?: string[];
}) {
  const { fields, values, onChange } = props;
  const alwaysShownKeys = props.alwaysShownKeys ?? [];
  const isAlwaysShown = (key: string) => alwaysShownKeys.includes(key);

  const setValue = (key: string, v: unknown) => {
    onChange({ ...values, [key]: v });
  };

  // revealed — что раскрыл юзер кликом по chip'у. С прошлого раскрытия не сворачивается
  // обратно автоматически, даже если очистил значение (UX: «передумал — закрою сам»).
  // Lazy init: считаем только на первом mount'е, иначе пересчитывалось бы на каждом
  // рендере (и setState игнорировал бы кроме первого раза).
  const [revealed, setRevealed] = useState<Set<string>>(() => {
    const r = new Set<string>();
    for (const f of fields) {
      if (!isAlwaysShown(f.key) && hasValue(values[f.key])) r.add(f.key);
    }
    return r;
  });

  const visible: FieldDef[] = [];
  const hidden: FieldDef[] = [];
  for (const f of fields) {
    if (isAlwaysShown(f.key) || hasValue(values[f.key]) || revealed.has(f.key)) {
      visible.push(f);
    } else {
      hidden.push(f);
    }
  }
  visible.sort((a, b) => orderOf(a.key) - orderOf(b.key));
  function orderOf(key: string): number {
    const i = alwaysShownKeys.indexOf(key);
    // alwaysShown — вперёд в своём порядке; остальные сохраняют входной порядок.
    return i !== -1 ? i : alwaysShownKeys.length + fields.findIndex((f) => f.key === key);
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {visible.map((f, i) => (
        <FieldRow
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(v) => setValue(f.key, v)}
          isLast={i === visible.length - 1 && hidden.length === 0}
          autoFocus={i === 0}
        />
      ))}
      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3">
          {hidden.map((f) => (
            <button
              type="button"
              key={f.key}
              onClick={() => setRevealed((s) => new Set([...s, f.key]))}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              + {f.name}
            </button>
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

function FieldRow(props: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  isLast: boolean;
  autoFocus?: boolean;
}) {
  const { field: f, value, onChange } = props;
  return (
    <div
      className={
        "flex items-start gap-3 px-4 py-3 text-sm " +
        (props.isLast ? "" : "border-b border-zinc-100")
      }
    >
      {/* pt-1.5 совпадает с py-1.5 у инпутов → label выравнен с первой строкой
          текста (для многострочного textarea — с верхней строкой, как и должно). */}
      <span className="w-28 shrink-0 pt-1.5 text-zinc-500">{f.name}</span>
      <div className="min-w-0 flex-1">
        <ValueInput
          type={f.type}
          required={f.required}
          value={value}
          onChange={onChange}
          options={f.values ?? []}
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
  // text / email / tel / url / user_select — общий string input.
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
