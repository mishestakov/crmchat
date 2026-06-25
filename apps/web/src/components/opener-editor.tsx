import { VariableTextarea, type VariableOption } from "./variable-textarea";

// Опенер — первое касание: одно сообщение (text) + опциональный warm-вариант
// для тех, кто уже отвечал. Без задержки и без цепочки — догон теперь в пиналке
// (см. DunningEditor). §1.1 bd-autodogon.
export type Opener = { text: string; warmText?: string | null };

export function OpenerEditor(props: {
  value: Opener;
  onChange: (next: Opener) => void;
  variables: VariableOption[];
  disabled?: boolean;
}) {
  const { value, onChange, variables, disabled } = props;
  const hasWarm = value.warmText != null;

  return (
    <fieldset disabled={disabled} className="space-y-2 disabled:opacity-60">
      <VariableTextarea
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        variables={variables}
        placeholder="Привет, {{full_name}}! Я Саша из @CPCsupport…"
        rows={4}
      />
      {hasWarm ? (
        <div className="space-y-1 rounded-md border border-emerald-100 bg-emerald-50/50 p-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-emerald-800">
            <span>Вариант для тех, кто уже отвечал</span>
            <button
              type="button"
              onClick={() => onChange({ ...value, warmText: null })}
              className="text-zinc-400 hover:text-red-600"
            >
              убрать
            </button>
          </div>
          <VariableTextarea
            value={value.warmText ?? ""}
            onChange={(warmText) => onChange({ ...value, warmText })}
            variables={variables}
            rows={3}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ ...value, warmText: "" })}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          + вариант для тех, кто уже отвечал
        </button>
      )}
    </fieldset>
  );
}
