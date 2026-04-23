import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Activity, ActivityRepeat } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

const REPEAT_LABELS: Record<ActivityRepeat, string> = {
  none: "Без повтора",
  daily: "Ежедневно",
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
};

export function ActivitiesSection(props: {
  wsId: string;
  contactId: string;
}) {
  const { wsId, contactId } = props;
  const qc = useQueryClient();
  const queryKey = ["activities", wsId, contactId] as const;
  const [adding, setAdding] = useState<"note" | "reminder" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const create = useMutation({
    mutationFn: async (
      input:
        | { type: "note"; text: string }
        | {
            type: "reminder";
            text: string;
            date: string;
            repeat?: ActivityRepeat;
          },
    ) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
        {
          params: { path: { wsId, contactId } },
          body: input,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setAdding(null);
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

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Активности</h2>
        <button
          onClick={() => setAdding("note")}
          className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
        >
          + Заметка
        </button>
        <button
          onClick={() => setAdding("reminder")}
          className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
        >
          + Напоминание
        </button>
      </div>

      {adding === "note" && (
        <NoteForm
          onCancel={() => {
            create.reset();
            setAdding(null);
          }}
          onSave={(text) => create.mutate({ type: "note", text })}
          saving={create.isPending}
          error={create.error ? errorMessage(create.error) : null}
        />
      )}
      {adding === "reminder" && (
        <ReminderForm
          onCancel={() => {
            create.reset();
            setAdding(null);
          }}
          onSave={(input) =>
            create.mutate({ type: "reminder", ...input })
          }
          saving={create.isPending}
          error={create.error ? errorMessage(create.error) : null}
        />
      )}

      {list.isLoading && <p className="text-sm">Загрузка…</p>}
      {list.error && (
        <p className="text-red-600 text-sm">{errorMessage(list.error)}</p>
      )}

      {list.data && list.data.length === 0 && !adding && (
        <p className="text-sm text-zinc-500">Пока пусто</p>
      )}

      {list.data && (
        <ul className="space-y-2">
          {list.data.map((a) => (
            <li
              key={a.id}
              className="rounded border border-zinc-200 bg-white p-3"
            >
              {editingId === a.id ? (
                <ActivityEditForm
                  activity={a}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) =>
                    update.mutate(
                      { id: a.id, patch },
                      { onSuccess: () => setEditingId(null) },
                    )
                  }
                  saving={update.isPending}
                />
              ) : (
                <ActivityRow
                  activity={a}
                  onEdit={() => setEditingId(a.id)}
                  onToggle={() =>
                    update.mutate({
                      id: a.id,
                      patch: {
                        status: a.status === "open" ? "completed" : "open",
                      },
                    })
                  }
                  onDelete={() => {
                    if (confirm(`Удалить активность?`)) remove.mutate(a.id);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow(props: {
  activity: Activity;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { activity: a } = props;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-medium uppercase">{a.type}</span>
          {a.status === "completed" && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">
              completed
              {a.completedAt &&
                ` · ${new Date(a.completedAt).toLocaleString()}`}
            </span>
          )}
        </div>
        <div
          className={`mt-1 whitespace-pre-wrap ${
            a.status === "completed" ? "text-zinc-400 line-through" : ""
          }`}
        >
          {a.text}
        </div>
        {a.type === "reminder" && a.date && (
          <div className="mt-1 text-xs text-zinc-500">
            {new Date(a.date).toLocaleString()}
            {a.repeat !== "none" && ` · ${REPEAT_LABELS[a.repeat]}`}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1 text-xs">
        <button
          onClick={props.onToggle}
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          title={a.status === "open" ? "Завершить" : "Снова открыть"}
        >
          {a.status === "open" ? "✓" : "↺"}
        </button>
        <button
          onClick={props.onEdit}
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
        >
          Изменить
        </button>
        <button
          onClick={props.onDelete}
          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

function NoteForm(props: {
  onCancel: () => void;
  onSave: (text: string) => void;
  saving: boolean;
  error: string | null;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="rounded border border-zinc-300 bg-white p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) props.onSave(text);
      }}
    >
      <textarea
        autoFocus
        rows={3}
        className="w-full rounded border border-zinc-300 px-3 py-2"
        placeholder="Заметка..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.saving || !text.trim()}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Создать заметку
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
      {props.error && (
        <p className="text-sm text-red-600">{props.error}</p>
      )}
    </form>
  );
}

function ReminderForm(props: {
  onCancel: () => void;
  onSave: (input: {
    text: string;
    date: string;
    repeat?: ActivityRepeat;
  }) => void;
  saving: boolean;
  error: string | null;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(""); // datetime-local format
  const [repeat, setRepeat] = useState<ActivityRepeat>("none");

  const submit = () => {
    if (!text.trim() || !date) return;
    // datetime-local не имеет TZ → интерпретируем как локальное и конвертим в ISO.
    const iso = new Date(date).toISOString();
    props.onSave({
      text,
      date: iso,
      ...(repeat !== "none" ? { repeat } : {}),
    });
  };

  return (
    <form
      className="rounded border border-zinc-300 bg-white p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        autoFocus
        rows={2}
        className="w-full rounded border border-zinc-300 px-3 py-2"
        placeholder="Описание..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          type="datetime-local"
          className="rounded border border-zinc-300 px-3 py-2 text-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as ActivityRepeat)}
        >
          {(Object.keys(REPEAT_LABELS) as ActivityRepeat[]).map((r) => (
            <option key={r} value={r}>
              {REPEAT_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.saving || !text.trim() || !date}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Создать напоминание
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
      {props.error && (
        <p className="text-sm text-red-600">{props.error}</p>
      )}
    </form>
  );
}

function ActivityEditForm(props: {
  activity: Activity;
  onCancel: () => void;
  onSave: (patch: {
    text?: string;
    date?: string | null;
    repeat?: ActivityRepeat;
  }) => void;
  saving: boolean;
}) {
  const { activity: a } = props;
  const [text, setText] = useState(a.text);
  // datetime-local требует "YYYY-MM-DDTHH:mm" в локальной TZ.
  const [date, setDate] = useState(
    a.date
      ? toLocalInputValue(new Date(a.date))
      : "",
  );
  const [repeat, setRepeat] = useState<ActivityRepeat>(a.repeat);

  const canSave =
    text.trim().length > 0 && (a.type === "note" || date !== "");

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const patch: {
          text?: string;
          date?: string | null;
          repeat?: ActivityRepeat;
        } = { text };
        if (a.type === "reminder") {
          patch.date = new Date(date).toISOString();
          patch.repeat = repeat;
        }
        props.onSave(patch);
      }}
    >
      <textarea
        rows={2}
        className="w-full rounded border border-zinc-300 px-3 py-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {a.type === "reminder" && (
        <div className="flex gap-2">
          <input
            type="datetime-local"
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <select
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as ActivityRepeat)}
          >
            {(Object.keys(REPEAT_LABELS) as ActivityRepeat[]).map((r) => (
              <option key={r} value={r}>
                {REPEAT_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.saving || !canSave}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
