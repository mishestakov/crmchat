import { useState } from "react";
import { Eye, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { pluralize } from "../lib/date-utils";

// Редактор массива сообщений outreach-цепочки. Используется в проекте
// (/projects/$projectId — секция «Кампания») и в шаблонах
// (/message-templates). Внутренний state — текущий редактируемый id;
// данные наружу через onChange, parent сам решает что делать (auto-save
// в проекте, dirty-check в шаблоне).
//
// Опциональное warmText — альтернативный текст для тёплых лидов
// (12.2.1). UI показывает поле только для первого сообщения (idx=0):
// модель «у тёплых отличается только приветствие». Активация при
// idx===0 && lead.warm && warmText.trim() → warmText, иначе text.

export type MessageDelay = {
  period: "minutes" | "hours" | "days";
  value: number;
};
export type Message = {
  id: string;
  text: string;
  warmText?: string | null;
  delay: MessageDelay;
};

export function newMessage(): Message {
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: "",
    delay: { period: "hours", value: 0 },
  };
}

export function MessagesEditor(props: {
  value: Message[];
  onChange: (next: Message[]) => void;
  disabled?: boolean;
  // Если передан — у каждого сообщения появляется кнопка превью (нужен
  // sample-lead из конкретного проекта; в шаблонах нет, поэтому опц.).
  onPreview?: (m: Message) => void;
  // Текст когда список пуст. Дефолт — про активацию проекта.
  emptyHint?: string;
}) {
  const { value, onChange, disabled, onPreview } = props;
  // editingId — id существующего (уже в value) сообщения, открытого на
  // редактирование. draft — новое сообщение, ещё НЕ переданное parent'у:
  // живёт только локально, в value попадает на «Сохранить» внутри editor'а.
  // Это закрывает кейс «Добавить сообщение → auto-save парента ругается
  // на пустой text»: parent узнаёт о новом сообщении только когда оно
  // уже валидно (text непустой).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Message | null>(null);

  const saveMessage = (updated: Message) => {
    const next = value.map((x) => (x.id === updated.id ? updated : x));
    onChange(next);
    setEditingId(null);
  };
  const removeMessage = (id: string) => {
    const next = value.filter((x) => x.id !== id);
    onChange(next);
    setEditingId(null);
  };
  const addMessage = () => {
    if (draft || editingId) return;
    setDraft(newMessage());
  };
  const saveDraft = (m: Message) => {
    onChange([...value, m]);
    setDraft(null);
  };

  const showAddButton =
    !disabled && !editingId && !draft && value.length > 0;

  if (value.length === 0 && !draft) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          {props.emptyHint ??
            "Пока ни одного сообщения. Добавьте первое — оно отправится сразу после запуска рассылки."}
        </p>
        {!disabled && (
          <button
            type="button"
            onClick={addMessage}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            <Plus size={14} /> Добавить сообщение
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="relative space-y-3 border-l border-zinc-200 pl-5">
        {value.map((m, idx) => (
          <li key={m.id} className="relative">
            <div className="absolute -left-[26px] top-2 h-3 w-3 rounded-full border-2 border-zinc-300 bg-white" />
            {editingId === m.id ? (
              <MessageEditor
                message={m}
                index={idx}
                canEditDelay={idx > 0}
                canEditWarm={idx === 0}
                onCancel={() => setEditingId(null)}
                onSave={saveMessage}
                onPreview={onPreview ? () => onPreview(m) : undefined}
                onDelete={() => removeMessage(m.id)}
              />
            ) : (
              <MessageRow
                message={m}
                index={idx}
                editable={!disabled}
                onClick={() => setEditingId(m.id)}
                onPreview={onPreview ? () => onPreview(m) : undefined}
              />
            )}
          </li>
        ))}
        {draft && (
          <li className="relative">
            <div className="absolute -left-[26px] top-2 h-3 w-3 rounded-full border-2 border-emerald-400 bg-white" />
            <MessageEditor
              message={draft}
              index={value.length}
              canEditDelay={value.length > 0}
              canEditWarm={value.length === 0}
              onCancel={() => setDraft(null)}
              onSave={saveDraft}
              onPreview={undefined}
              onDelete={() => setDraft(null)}
            />
          </li>
        )}
      </ol>
      {showAddButton && (
        <button
          type="button"
          onClick={addMessage}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
        >
          <Plus size={14} /> Добавить сообщение
        </button>
      )}
    </div>
  );
}

function MessageRow(props: {
  message: Message;
  index: number;
  editable: boolean;
  onClick: () => void;
  onPreview?: () => void;
}) {
  const m = props.message;
  const hasWarm = !!m.warmText && m.warmText.trim().length > 0;
  return (
    <div
      role={props.editable ? "button" : undefined}
      onClick={props.editable ? props.onClick : undefined}
      className={
        "rounded-lg border border-zinc-200 bg-white p-3 " +
        (props.editable ? "cursor-pointer hover:border-emerald-300" : "")
      }
    >
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {props.index === 0
            ? "Первое сообщение"
            : `Сообщение ${props.index + 1}, через ${m.delay.value} ${pluralizeDelayPeriod(m.delay)}`}
        </span>
        <div className="flex items-center gap-2">
          {props.onPreview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onPreview?.();
              }}
              disabled={!m.text.trim()}
              className="text-zinc-400 hover:text-emerald-700 disabled:opacity-30"
              aria-label="Превью"
              title="Превью с подстановкой переменных"
            >
              <Eye size={14} />
            </button>
          )}
          {props.editable && <Pencil size={14} className="text-zinc-400" />}
        </div>
      </div>
      <div className="mt-1 text-sm whitespace-pre-wrap text-zinc-800">
        {m.text || (
          <span className="text-zinc-400 italic">Пустое сообщение</span>
        )}
      </div>
      {hasWarm && (
        <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/50 p-2">
          <div className="mb-0.5 text-[11px] font-medium text-emerald-800">
            Альтернатива для тёплых
          </div>
          <div className="text-xs whitespace-pre-wrap text-zinc-700">
            {m.warmText}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageEditor(props: {
  message: Message;
  index: number;
  canEditDelay: boolean;
  canEditWarm: boolean;
  onCancel: () => void;
  onSave: (m: Message) => void;
  onPreview?: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(props.message.text);
  const [warmText, setWarmText] = useState(props.message.warmText ?? "");
  const [delayValue, setDelayValue] = useState(props.message.delay.value);
  const [delayPeriod, setDelayPeriod] = useState(props.message.delay.period);
  // Открываем секцию warm-альтернативы сразу если она уже заполнена;
  // иначе показываем «+ Альтернатива для тёплых», чтобы не заваливать UX.
  const [warmOpen, setWarmOpen] = useState(
    !!props.message.warmText && props.message.warmText.trim().length > 0,
  );

  return (
    <div className="rounded-lg border border-emerald-300 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {props.index === 0
            ? "Первое сообщение"
            : `Сообщение ${props.index + 1}`}
        </span>
        <button
          type="button"
          onClick={props.onDelete}
          className="text-zinc-400 hover:text-red-600"
          aria-label="Удалить"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {props.canEditDelay && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Через</span>
          <input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) =>
              setDelayValue(Math.max(0, Number(e.target.value) || 0))
            }
            className="w-16 rounded-md border border-zinc-300 px-2 py-1"
          />
          <select
            value={delayPeriod}
            onChange={(e) =>
              setDelayPeriod(e.target.value as Message["delay"]["period"])
            }
            className="rounded-md border border-zinc-300 bg-white px-2 py-1"
          >
            <option value="minutes">минут</option>
            <option value="hours">часов</option>
            <option value="days">дней</option>
          </select>
          <span className="text-zinc-500">после предыдущего</span>
        </div>
      )}

      <textarea
        value={text}
        rows={4}
        autoFocus
        placeholder="Привет, {{username}}! ..."
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />

      {props.canEditWarm && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50/40 p-2">
          {warmOpen ? (
            <>
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                  <MessageSquare size={12} />
                  Альтернатива для тёплых
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWarmOpen(false);
                    setWarmText("");
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  убрать
                </button>
              </div>
              <p className="mb-1.5 text-[11px] text-zinc-500">
                Получат лиды, кто хотя бы раз отвечал нам через любой ваш
                аккаунт. Остальные получат основной текст выше.
              </p>
              <textarea
                value={warmText}
                rows={3}
                placeholder="Привет, {{username}}! Помнишь, мы обсуждали…"
                onChange={(e) => setWarmText(e.target.value)}
                className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setWarmOpen(true)}
              className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              <Plus size={12} /> Альтернатива для тёплых
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {props.onPreview ? (
          <button
            type="button"
            onClick={props.onPreview}
            disabled={!text.trim()}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
          >
            <Eye size={14} /> Превью
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() =>
            props.onSave({
              ...props.message,
              text,
              warmText: warmOpen && warmText.trim() ? warmText : null,
              delay: { value: delayValue, period: delayPeriod },
            })
          }
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

function pluralizeDelayPeriod(d: Message["delay"]): string {
  if (d.period === "minutes")
    return pluralize(d.value, "минуту", "минуты", "минут");
  if (d.period === "hours")
    return pluralize(d.value, "час", "часа", "часов");
  return pluralize(d.value, "день", "дня", "дней");
}
