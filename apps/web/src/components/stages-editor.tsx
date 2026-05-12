import { Reorder, useDragControls } from "motion/react";
import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

// Редактор массива стадий канбана. Используется на странице
// /stage-templates (для шаблона воркспейса) и в модале/drawer'е
// редактирования стадий конкретного проекта.
//
// Поведение:
//   - Reorder через drag (motion.Reorder).
//   - Inline-edit имени.
//   - Удаление через корзину справа.
//   - Кнопка «+ Добавить стадию» снизу — создаёт новую с random id и
//     order = max+1.
//   - id новых стадий генерируется случайно (8 hex символов). Юзер их
//     не видит — это техническое значение для project_items.stage_id.
//   - При reorder поле order пересчитывается по индексу в массиве.

export type Stage = { id: string; name: string; order: number };

export function StagesEditor(props: {
  value: Stage[];
  onChange: (next: Stage[]) => void;
  disabled?: boolean;
}) {
  const { value, onChange, disabled } = props;

  const setName = (id: string, name: string) => {
    onChange(value.map((s) => (s.id === id ? { ...s, name } : s)));
  };
  const remove = (id: string) => {
    const next = value
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i }));
    onChange(next);
  };
  const add = () => {
    const id = Math.random().toString(36).slice(2, 10);
    onChange([
      ...value,
      { id, name: "Новая стадия", order: value.length },
    ]);
  };
  const onReorder = (next: Stage[]) => {
    onChange(next.map((s, i) => ({ ...s, order: i })));
  };

  return (
    <div className="space-y-2">
      <Reorder.Group axis="y" values={value} onReorder={onReorder} className="space-y-2">
        {value.map((stage) => (
          <StageRow
            key={stage.id}
            stage={stage}
            onName={(name) => setName(stage.id, name)}
            onRemove={() => remove(stage.id)}
            disabled={disabled}
          />
        ))}
      </Reorder.Group>
      {!disabled && (
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:border-emerald-500 hover:text-emerald-700"
        >
          <Plus size={14} /> Добавить стадию
        </button>
      )}
      {value.length === 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Нет стадий. Добавьте хотя бы одну — иначе канбан проекта будет пустым.
        </p>
      )}
    </div>
  );
}

function StageRow(props: {
  stage: Stage;
  onName: (name: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const dragControls = useDragControls();
  const [name, setName] = useState(props.stage.name);

  return (
    <Reorder.Item
      value={props.stage}
      dragListener={false}
      dragControls={dragControls}
      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-sm"
    >
      <span
        onPointerDown={(e) => {
          if (!props.disabled) dragControls.start(e);
        }}
        className={
          "shrink-0 text-zinc-300 " +
          (props.disabled ? "" : "cursor-grab active:cursor-grabbing")
        }
      >
        <GripVertical size={16} />
      </span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name !== props.stage.name) props.onName(name);
        }}
        disabled={props.disabled}
        className="flex-1 bg-transparent px-1 py-0.5 text-sm focus:outline-none disabled:opacity-60"
      />
      {!props.disabled && (
        <button
          type="button"
          onClick={props.onRemove}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
          title="Удалить стадию"
        >
          <Trash2 size={14} />
        </button>
      )}
    </Reorder.Item>
  );
}
