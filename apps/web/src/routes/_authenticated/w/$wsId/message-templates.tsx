import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../../../lib/api";
import { errorMessage } from "../../../../lib/errors";
import { useMyRole } from "../../../../lib/hooks";
import { BackButton } from "../../../../components/back-button";
import {
  MessagesEditor,
  type Message,
} from "../../../../components/messages-editor";
import type { VariableOption } from "../../../../components/variable-textarea";
import { CANONICAL } from "../../../../lib/template-variables";

// В библиотеке шаблонов нет проекта-контекста и нет CSV — список колонок
// неизвестен до применения. Доступна только canonical-переменная.
const LIBRARY_VARIABLES: VariableOption[] = [CANONICAL];

// Библиотека шаблонов цепочек сообщений (12.2.1). По UX зеркальна
// /stage-templates: список карточек, inline-edit имени, MessagesEditor
// внутри, dirty-check сравнением JSON.stringify. Создание — через
// inline-карточку с автофокусом в имени (не через window.prompt).

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/message-templates",
)({
  component: MessageTemplatesPage,
});

const TEMPLATES_QK = (wsId: string) => ["message-templates", wsId] as const;

function MessageTemplatesPage() {
  const { wsId } = Route.useParams();
  const isAdmin = useMyRole(wsId) === "admin";
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const list = useQuery({
    queryKey: TEMPLATES_QK(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/message-templates",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Шаблоны цепочек</h1>
          {isAdmin && !showNew && (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="ml-auto flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus size={14} /> Новый шаблон
            </button>
          )}
        </div>

        <p className="text-sm text-zinc-500">
          Шаблоны применяются при создании проекта — цепочка копируется в
          проект и дальше живёт независимо. Правка шаблона не трогает
          существующие проекты.
        </p>

        {showNew && isAdmin && (
          <NewTemplateCard
            wsId={wsId}
            variables={LIBRARY_VARIABLES}
            onClose={() => setShowNew(false)}
            onCreated={() =>
              qc.invalidateQueries({ queryKey: TEMPLATES_QK(wsId) })
            }
          />
        )}

        {list.isLoading && <p className="text-sm text-zinc-500">Загрузка…</p>}
        {list.error && (
          <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
        )}
        {list.data && list.data.length === 0 && !showNew && (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-zinc-500 shadow-sm">
            Нет шаблонов.{" "}
            {isAdmin && "Создай первый кнопкой «Новый шаблон»."}
          </div>
        )}

        {list.data?.map((t) => (
          <TemplateCard
            key={t.id}
            wsId={wsId}
            template={t}
            variables={LIBRARY_VARIABLES}
            canEdit={isAdmin}
          />
        ))}
      </div>
    </div>
  );
}

function NewTemplateCard(props: {
  wsId: string;
  variables: VariableOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите имя шаблона");
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/message-templates",
        {
          params: { path: { wsId: props.wsId } },
          body: { name: trimmed, messages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      props.onCreated();
      props.onClose();
    },
  });

  return (
    <div className="rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm space-y-3">
      <input
        type="text"
        value={name}
        autoFocus
        placeholder="Имя шаблона (например, «Привлечение январь»)"
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium focus:border-emerald-500 focus:outline-none"
      />
      <MessagesEditor
        value={messages}
        variables={props.variables}
        onChange={setMessages}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending || !name.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {create.isPending ? "Создаём…" : "Создать шаблон"}
        </button>
        <button
          type="button"
          onClick={props.onClose}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          Отмена
        </button>
        {create.error && (
          <span className="text-xs text-red-600">
            {errorMessage(create.error)}
          </span>
        )}
      </div>
    </div>
  );
}

function TemplateCard(props: {
  wsId: string;
  template: {
    id: string;
    name: string;
    messages: Message[];
    createdAt: string;
  };
  variables: VariableOption[];
  canEdit: boolean;
}) {
  const { wsId, template, canEdit } = props;
  const qc = useQueryClient();

  const [name, setName] = useState(template.name);
  const [messages, setMessages] = useState<Message[]>(template.messages);

  const dirty =
    name !== template.name ||
    JSON.stringify(messages) !== JSON.stringify(template.messages);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/message-templates/{templateId}",
        {
          params: { path: { wsId, templateId: template.id } },
          body: { name, messages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_QK(wsId) }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/message-templates/{templateId}",
        { params: { path: { wsId, templateId: template.id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_QK(wsId) }),
  });

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium focus:border-emerald-500 focus:outline-none disabled:bg-zinc-50"
        />
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Удалить шаблон «${template.name}»?`)) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            title="Удалить шаблон"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <MessagesEditor
        value={messages}
        variables={props.variables}
        onChange={setMessages}
        disabled={!canEdit}
      />
      {canEdit && dirty && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => {
              setName(template.name);
              setMessages(template.messages);
            }}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            Отмена
          </button>
          {save.error && (
            <span className="text-xs text-red-600">
              {errorMessage(save.error)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
