import { VariableTextarea, type VariableOption } from "./variable-textarea";

// Опенер — первое касание: одно сообщение (text) + опциональные варианты:
//   warmText — для тех, кто уже отвечал;
//   rknText  — проверочный вопрос сегменту «нет РКН» (>10к и не в реестре).
//              Задан → эти каналы перестают быть отбраковкой, им шлётся rknText
//              («точно не в ЕРИР?»). Пусто → сегмент остаётся отбракованным.
// Без задержки и без цепочки — догон теперь в пиналке (см. DunningEditor).
// §1.1 bd-autodogon.
export type Opener = {
  text: string;
  warmText?: string | null;
  rknText?: string | null;
};

// Каноничный ключ опенера для dirty-сравнения. opener хранится в Postgres как
// jsonb, а он НЕ сохраняет порядок ключей (нормализует по длине) — поэтому
// прямой JSON.stringify(draft) !== JSON.stringify(server) даёт ложный diff и
// кнопка «Сохранить» мигает после успешного save (CLAUDE.md #6). Фиксируем
// порядок полей и нормализуем null/undefined.
export function openerKey(o: Opener): string {
  return JSON.stringify({
    text: o.text,
    warmText: o.warmText ?? null,
    rknText: o.rknText ?? null,
  });
}

export function OpenerEditor(props: {
  value: Opener;
  onChange: (next: Opener) => void;
  variables: VariableOption[];
  disabled?: boolean;
}) {
  const { value, onChange, variables, disabled } = props;
  const hasWarm = value.warmText != null;
  const hasRkn = value.rknText != null;

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
      {hasRkn ? (
        <div className="space-y-1 rounded-md border border-amber-100 bg-amber-50/50 p-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-amber-800">
            <span>Вопрос сегменту «нет РКН» (перепроверка)</span>
            <button
              type="button"
              onClick={() => onChange({ ...value, rknText: null })}
              className="text-zinc-400 hover:text-red-600"
            >
              убрать
            </button>
          </div>
          <p className="text-[11px] text-amber-700/80">
            Каналы {">"}10к без записи в ЕРИР сейчас отбраковываются. Заполни —
            им уйдёт этот вопрос вместо отбраковки (юзернейм могли сменить,
            запись — устареть).
          </p>
          <VariableTextarea
            value={value.rknText ?? ""}
            onChange={(rknText) => onChange({ ...value, rknText })}
            variables={variables}
            placeholder="Привет! Не нашли вас в реестре ЕРИР — вы точно не зарегистрированы как рекламораспространитель?"
            rows={3}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ ...value, rknText: "" })}
          className="text-xs font-medium text-amber-700 hover:underline"
        >
          + вопрос сегменту «нет РКН»
        </button>
      )}
    </fieldset>
  );
}
