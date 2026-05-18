import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Bell, Check, MoreHorizontal, StickyNote, X } from "lucide-react";
import type { Activity, ActivityRepeat } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useClickOutside, useEscapeKey } from "../../../../../lib/hooks";

const REPEAT_LABELS: Record<ActivityRepeat, string> = {
  none: "Без повтора",
  daily: "Ежедневно",
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
};

const activitiesKey = (wsId: string, contactId: string) =>
  ["activities", wsId, contactId] as const;

export function ActivitySection(props: { wsId: string; contactId: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <ActivityComposer wsId={props.wsId} contactId={props.contactId} />
      <ActivitiesList wsId={props.wsId} contactId={props.contactId} />
    </div>
  );
}

// Без даты = note, с датой = reminder; type выбирается из isReminder, текст
// поля держится тот же. Модалки [[note-modal]] / [[reminder-modal]] остались
// для редактирования.
function ActivityComposer(props: { wsId: string; contactId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [isReminder, setIsReminder] = useState(false);
  const [date, setDate] = useState("");
  const [repeat, setRepeat] = useState<ActivityRepeat>("none");

  const reset = () => {
    setText("");
    setIsReminder(false);
    setDate("");
    setRepeat("none");
  };

  const create = useMutation({
    mutationFn: async () => {
      const body = isReminder
        ? {
            type: "reminder" as const,
            text,
            date: new Date(date).toISOString(),
            ...(repeat !== "none" ? { repeat } : {}),
          }
        : { type: "note" as const, text };
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
        {
          params: { path: { wsId: props.wsId, contactId: props.contactId } },
          body,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: activitiesKey(props.wsId, props.contactId),
      });
      reset();
    },
  });

  const canSave =
    text.trim().length > 0 && (!isReminder || date !== "") && !create.isPending;

  return (
    <form
      className="space-y-3 bg-zinc-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) create.mutate();
      }}
    >
      <textarea
        rows={2}
        placeholder="Что зафиксировать или о чём напомнить?"
        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSave) {
            e.preventDefault();
            create.mutate();
          }
        }}
      />
      {isReminder && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            className={fieldInputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
          />
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as ActivityRepeat)}
            className={fieldInputClass + " bg-white"}
          >
            {(Object.keys(REPEAT_LABELS) as ActivityRepeat[]).map((r) => (
              <option key={r} value={r}>
                {REPEAT_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}
      {create.error && (
        <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setIsReminder((s) => !s);
            if (isReminder) {
              setDate("");
              setRepeat("none");
            }
          }}
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
            (isReminder
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")
          }
        >
          <Bell size={13} />
          {isReminder ? "С напоминанием" : "Напомнить"}
        </button>
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {create.isPending ? "Создаём…" : "Создать"}
        </button>
      </div>
    </form>
  );
}

function ActivitiesList(props: { wsId: string; contactId: string }) {
  const { wsId, contactId } = props;
  const qc = useQueryClient();
  const queryKey = activitiesKey(wsId, contactId);
  const [editing, setEditing] = useState<Activity | null>(null);

  const list = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
        { params: { path: { wsId, contactId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (args: {
      id: string;
      patch: {
        text?: string;
        date?: string | null;
        repeat?: ActivityRepeat;
        status?: "open" | "completed";
      };
    }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
        {
          params: { path: { wsId, contactId, id: args.id } },
          body: args.patch,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
        { params: { path: { wsId, contactId, id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  if (list.isLoading) {
    return (
      <p className="border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
        Загрузка…
      </p>
    );
  }
  if (list.error) {
    return (
      <p className="border-t border-zinc-100 px-4 py-3 text-sm text-red-600">
        {errorMessage(list.error)}
      </p>
    );
  }
  if (!list.data || list.data.length === 0) {
    return null;
  }

  return (
    <>
      <div>
        {list.data.map((a) => (
          <ActivityCard
            key={a.id}
            activity={a}
            onToggle={() =>
              update.mutate({
                id: a.id,
                patch: {
                  status: a.status === "open" ? "completed" : "open",
                },
              })
            }
            onEdit={() => setEditing(a)}
            onDelete={() => {
              if (confirm("Удалить активность?")) remove.mutate(a.id);
            }}
          />
        ))}
      </div>
      {editing &&
        (editing.type === "note" ? (
          <NoteModal
            wsId={wsId}
            contactId={contactId}
            initial={editing}
            onClose={() => setEditing(null)}
          />
        ) : (
          <ReminderModal
            wsId={wsId}
            contactId={contactId}
            initial={editing}
            onClose={() => setEditing(null)}
          />
        ))}
    </>
  );
}

function ActivityCard(props: {
  activity: Activity;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { activity: a } = props;
  const isReminder = a.type === "reminder";
  const completed = a.status === "completed";

  return (
    <div className="border-t border-zinc-100 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={
              "whitespace-pre-wrap text-sm font-medium " +
              (completed ? "text-zinc-400 line-through" : "text-zinc-900")
            }
          >
            {a.text || (isReminder ? "Напоминание" : "Заметка")}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {isReminder && a.date
              ? completed && a.completedAt
                ? `выполнено ${formatDateTime(new Date(a.completedAt))}`
                : `до ${formatDateTime(new Date(a.date))}${
                    a.repeat !== "none" ? ` · ${REPEAT_LABELS[a.repeat]}` : ""
                  }`
              : `создано ${formatDateTime(new Date(a.createdAt))}`}
          </div>
        </div>
        {isReminder && (
          <button
            type="button"
            onClick={props.onToggle}
            title={completed ? "Снова открыть" : "Завершить"}
            className={
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors " +
              (completed
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-zinc-300 bg-white hover:border-zinc-500")
            }
          >
            {completed && <Check size={12} strokeWidth={3} />}
          </button>
        )}
        <RowMenu onEdit={props.onEdit} onDelete={props.onDelete} />
      </div>
    </div>
  );
}

function RowMenu(props: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onEdit();
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
          >
            Редактировать
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-50"
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}

export function NoteModal(props: {
  wsId: string;
  contactId: string;
  initial?: Activity;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(props.initial?.text ?? "");
  const isEdit = !!props.initial;

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
        {
          params: { path: { wsId: props.wsId, contactId: props.contactId } },
          body: { type: "note", text },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activitiesKey(props.wsId, props.contactId) });
      props.onClose();
    },
  });

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
        {
          params: {
            path: {
              wsId: props.wsId,
              contactId: props.contactId,
              id: props.initial!.id,
            },
          },
          body: { text },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activitiesKey(props.wsId, props.contactId) });
      props.onClose();
    },
  });

  const m = isEdit ? update : create;
  const canSave = text.trim().length > 0;

  return (
    <Modal title="Заметка" onClose={props.onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) m.mutate();
        }}
      >
        <Field label="Текст">
          <textarea
            autoFocus
            rows={4}
            className={fieldInputClass}
            placeholder="Что важно зафиксировать"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        {m.error && (
          <p className="text-sm text-red-600">{errorMessage(m.error)}</p>
        )}
        <button
          type="submit"
          disabled={!canSave || m.isPending}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isEdit ? "Сохранить заметку" : "Создать заметку"}
        </button>
      </form>
    </Modal>
  );
}

export function ReminderModal(props: {
  wsId: string;
  contactId: string;
  initial?: Activity;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!props.initial;
  const [text, setText] = useState(props.initial?.text ?? "");
  const [date, setDate] = useState(
    props.initial?.date ? toLocalInputValue(new Date(props.initial.date)) : "",
  );
  const [repeat, setRepeat] = useState<ActivityRepeat>(
    props.initial?.repeat ?? "none",
  );

  const create = useMutation({
    mutationFn: async () => {
      const iso = new Date(date).toISOString();
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
        {
          params: { path: { wsId: props.wsId, contactId: props.contactId } },
          body: {
            type: "reminder",
            text,
            date: iso,
            ...(repeat !== "none" ? { repeat } : {}),
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activitiesKey(props.wsId, props.contactId) });
      props.onClose();
    },
  });

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
        {
          params: {
            path: {
              wsId: props.wsId,
              contactId: props.contactId,
              id: props.initial!.id,
            },
          },
          body: {
            text,
            date: new Date(date).toISOString(),
            repeat,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activitiesKey(props.wsId, props.contactId) });
      props.onClose();
    },
  });

  const m = isEdit ? update : create;
  const canSave = text.trim().length > 0 && date !== "";

  return (
    <Modal title="Напоминание" onClose={props.onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) m.mutate();
        }}
      >
        <Field label="Что напомнить">
          <input
            autoFocus
            type="text"
            className={fieldInputClass}
            placeholder="Например, «Уточнить решение»"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label="Дата">
          <input
            type="datetime-local"
            className={fieldInputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Повтор">
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as ActivityRepeat)}
            className={fieldInputClass + " bg-white"}
          >
            {(Object.keys(REPEAT_LABELS) as ActivityRepeat[]).map((r) => (
              <option key={r} value={r}>
                {REPEAT_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {m.error && (
          <p className="text-sm text-red-600">{errorMessage(m.error)}</p>
        )}
        <button
          type="submit"
          disabled={!canSave || m.isPending}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isEdit ? "Сохранить напоминание" : "Создать напоминание"}
        </button>
      </form>
    </Modal>
  );
}

const fieldInputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-zinc-600">{props.label}</span>
      {props.children}
    </label>
  );
}

function Modal(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEscapeKey(props.onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={props.onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold text-zinc-900">
            {props.title}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100"
          >
            <X size={16} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function formatDateTime(d: Date): string {
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `сегодня в ${hm}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${hm}`;
}

// Re-export для совместимости — старый ActivitiesSection (note/reminder buttons + list)
// больше не используется в карточке: заметка/напоминание открываются как модалки
// из action-row карточки контакта, а ActivitiesList рендерит только список.
