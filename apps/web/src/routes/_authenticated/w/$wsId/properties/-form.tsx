// Shared form для create/edit property. Не route — префикс `-` игнорится TanStack Router.

import { useState } from "react";
import type { Property, PropertyType, PropertyValue } from "@repo/core";

const TYPE_LABELS: Record<PropertyType, string> = {
  text: "Текст",
  single_select: "Одиночный выбор",
  multi_select: "Множественный выбор",
};

const RU_TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function autoKey(name: string): string {
  const slug = name
    .toLowerCase()
    .split("")
    .map((c) => RU_TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  const base = slug && /^[a-z]/.test(slug) ? slug : `custom_${slug || "field"}`;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${base}_${suffix}`.slice(0, 64);
}

function newOptionId(): string {
  return `opt_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export type PropertyFormValue = {
  name: string;
  type: PropertyType;
  required: boolean;
  showInList: boolean;
  values: PropertyValue[];
};

export type SubmitInput = PropertyFormValue & { key: string };

export function PropertyForm(props: {
  mode: "create" | "edit";
  initial?: Property;
  onCancel: () => void;
  onSave: (input: SubmitInput) => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
}) {
  const isEdit = props.mode === "edit";
  const initialValue: PropertyFormValue = {
    name: props.initial?.name ?? "",
    type: props.initial?.type ?? "text",
    required: props.initial?.required ?? false,
    showInList: props.initial?.showInList ?? true,
    values: props.initial?.values ?? [],
  };
  const [name, setName] = useState(initialValue.name);
  const [type, setType] = useState<PropertyType>(initialValue.type);
  const [required, setRequired] = useState(initialValue.required);
  const [showInList, setShowInList] = useState(initialValue.showInList);
  const [values, setValues] = useState<PropertyValue[]>(initialValue.values);
  const [protectedIds] = useState<Set<string>>(
    () => new Set(props.initial?.values?.map((v) => v.id) ?? []),
  );

  const current: PropertyFormValue = { name, type, required, showInList, values };
  const isDirty = JSON.stringify(current) !== JSON.stringify(initialValue);
  const needsValues = type === "single_select" || type === "multi_select";
  const isValid =
    name.trim().length > 0 && (!needsValues || values.length > 0);
  const canSave = isDirty && isValid;

  return (
    <form
      className="mx-auto max-w-2xl space-y-4 p-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        props.onSave({
          key: isEdit ? props.initial!.key : autoKey(name),
          name,
          type,
          required,
          showInList,
          values: needsValues ? values : [],
        });
      }}
    >
      <Section label="Название поля">
        <input
          autoFocus
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название поля"
        />
      </Section>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <Row label="Тип поля">
          {isEdit ? (
            <span className="text-zinc-500">{TYPE_LABELS[type]}</span>
          ) : (
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: "text", label: "Текст" },
                { value: "single_select", label: "Одиночный выбор" },
                { value: "multi_select", label: "Множественный выбор" },
              ]}
            />
          )}
        </Row>
        <Row label="Обязательное поле">
          <Toggle value={required} onChange={setRequired} />
        </Row>
        <Row label="Отображать в списке">
          <Toggle value={showInList} onChange={setShowInList} />
        </Row>
      </div>

      {(type === "single_select" || type === "multi_select") && (
        <Section label="Значения">
          <ValuesEditor
            values={values}
            onChange={setValues}
            protectedIds={protectedIds}
            newId={newOptionId}
          />
        </Section>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={props.saving || !canSave}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {isEdit ? "Сохранить" : "Создать поле"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        {isEdit && props.onDelete && (
          <button
            type="button"
            onClick={props.onDelete}
            className="ml-auto rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            Удалить
          </button>
        )}
      </div>
      {props.error && (
        <p className="text-sm text-red-600">{props.error}</p>
      )}
    </form>
  );
}

function Section(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </div>
      {props.children}
    </div>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm not-last:border-b not-last:border-zinc-200">
      <span>{props.label}</span>
      <div>{props.children}</div>
    </div>
  );
}

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.value)}
      className={
        "inline-flex h-6 w-11 items-center rounded-full transition-colors " +
        (props.value ? "bg-emerald-500" : "bg-zinc-300")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform " +
          (props.value ? "translate-x-5" : "translate-x-0.5")
        }
      />
    </button>
  );
}

function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          className={
            "rounded-md px-2.5 py-1 text-xs " +
            (o.value === props.value
              ? "bg-zinc-900 text-white"
              : "text-zinc-700 hover:bg-zinc-100")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ValuesEditor(props: {
  values: PropertyValue[];
  onChange: (v: PropertyValue[]) => void;
  protectedIds: Set<string>;
  newId: () => string;
}) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const update = (idx: number, patch: Partial<PropertyValue>) => {
    const next = [...props.values];
    next[idx] = { ...next[idx]!, ...patch };
    props.onChange(next);
  };
  const remove = (idx: number) => {
    const v = props.values[idx];
    if (!v) return;
    if (props.protectedIds.has(v.id)) {
      const ok = confirm(
        `Удалить «${v.name || "опцию"}»? Контакты с этим значением потеряют ссылку.`,
      );
      if (!ok) return;
    }
    props.onChange(props.values.filter((_, i) => i !== idx));
  };
  const add = () => {
    props.onChange([...props.values, { id: props.newId(), name: "" }]);
  };
  const moveTo = (fromIdx: number, beforeIdx: number) => {
    let toIdx = beforeIdx;
    if (fromIdx < beforeIdx) toIdx = beforeIdx - 1;
    if (fromIdx === toIdx) return;
    const next = [...props.values];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved!);
    props.onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200">
      {props.values.map((v, idx) => (
        <div
          key={v.id}
          onDragOver={(e) => {
            if (draggingIdx === null) return;
            e.preventDefault();
            if (overIdx !== idx) setOverIdx(idx);
          }}
          onDrop={(e) => {
            if (draggingIdx === null) return;
            e.preventDefault();
            moveTo(draggingIdx, idx);
            setOverIdx(null);
          }}
          className={
            "flex items-center gap-2 px-3 py-2 transition-colors " +
            (overIdx === idx && draggingIdx !== idx ? "bg-zinc-100 " : "") +
            (draggingIdx === idx ? "opacity-40" : "")
          }
        >
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDraggingIdx(idx);
            }}
            onDragEnd={() => {
              setDraggingIdx(null);
              setOverIdx(null);
            }}
            className="cursor-grab select-none text-zinc-400 hover:text-zinc-600 active:cursor-grabbing"
            title="Перетащите для изменения порядка"
          >
            ⠿
          </span>
          <input
            className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
            value={v.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            placeholder="Название значения"
          />
          <button
            type="button"
            onClick={() => remove(idx)}
            className="text-zinc-400 hover:text-red-600"
          >
            ×
          </button>
        </div>
      ))}
      <div
        onDragOver={(e) => {
          if (draggingIdx === null) return;
          e.preventDefault();
          if (overIdx !== props.values.length) setOverIdx(props.values.length);
        }}
        onDrop={(e) => {
          if (draggingIdx === null) return;
          e.preventDefault();
          moveTo(draggingIdx, props.values.length);
          setOverIdx(null);
        }}
        className={overIdx === props.values.length ? "bg-zinc-100" : ""}
      >
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-50"
        >
          <span className="text-lg leading-none">+</span>
          <span>Новое значение</span>
        </button>
      </div>
    </div>
  );
}
