import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../../../lib/api";
import { errorMessage } from "../../../../lib/errors";
import { useMyRole } from "../../../../lib/hooks";
import { BackButton } from "../../../../components/back-button";
import { StagesEditor, type Stage } from "../../../../components/stages-editor";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/stage-templates",
)({
  component: StageTemplatesPage,
});

const TEMPLATES_QK = (wsId: string) => ["stage-templates", wsId] as const;

function StageTemplatesPage() {
  const { wsId } = Route.useParams();
  const isAdmin = useMyRole(wsId) === "admin";
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: TEMPLATES_QK(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/stage-templates",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/stage-templates",
        {
          params: { path: { wsId } },
          body: { name },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_QK(wsId) }),
  });

  const handleNew = () => {
    const name = window.prompt("Название шаблона:");
    if (!name || !name.trim()) return;
    create.mutate(name.trim(), {
      onError: (e) => alert("Ошибка: " + errorMessage(e)),
    });
  };

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Шаблоны стадий</h1>
          {isAdmin && (
            <button
              type="button"
              onClick={handleNew}
              disabled={create.isPending}
              className="ml-auto flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Plus size={14} /> Новый шаблон
            </button>
          )}
        </div>

        <p className="text-sm text-zinc-500">
          Шаблоны применяются при создании проекта — стадии копируются в
          проект и дальше живут независимо. Правка шаблона не трогает
          существующие проекты.
        </p>

        {list.isLoading && <p className="text-sm text-zinc-500">Загрузка…</p>}
        {list.error && (
          <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
        )}
        {list.data && list.data.length === 0 && (
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
            canEdit={isAdmin}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard(props: {
  wsId: string;
  template: {
    id: string;
    name: string;
    stages: Stage[];
    createdAt: string;
  };
  canEdit: boolean;
}) {
  const { wsId, template, canEdit } = props;
  const qc = useQueryClient();

  const [name, setName] = useState(template.name);
  const [stages, setStages] = useState<Stage[]>(template.stages);

  const dirty =
    name !== template.name ||
    JSON.stringify(stages) !== JSON.stringify(template.stages);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/stage-templates/{templateId}",
        {
          params: { path: { wsId, templateId: template.id } },
          body: { name, stages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_QK(wsId) }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/stage-templates/{templateId}",
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
      <StagesEditor value={stages} onChange={setStages} disabled={!canEdit} />
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
              setStages(template.stages);
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
