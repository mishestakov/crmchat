import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { OUTREACH_QK } from "../lib/query-keys";
import { Modal } from "./modal";
import { StagesEditor, type Stage } from "./stages-editor";

// Редактор стадий канбана конкретного проекта. Меняет только этот проект
// (stage-template остаётся неизменным). Сохранение через PATCH /projects.
// Раньше жил на странице /kanban; перенесён сюда чтобы открываться из
// /index (настройки проекта) — канбан стал чистым представлением, без
// административных кнопок.
export function StagesEditModal(props: {
  wsId: string;
  projectId: string;
  initial: Stage[];
  onClose: () => void;
}) {
  const { wsId, projectId, initial, onClose } = props;
  const qc = useQueryClient();
  const [stages, setStages] = useState<Stage[]>(initial);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId } },
          body: { stages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.project(wsId, projectId),
      });
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
      });
      onClose();
    },
  });

  const dirty = JSON.stringify(stages) !== JSON.stringify(initial);

  return (
    <>
      <Modal onClose={onClose} zIndex={30}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-semibold">Стадии канбана</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          Меняется только этот проект. Шаблон стадий не затронется. Лиды на
          удалённых стадиях попадут в колонку «Без стадии».
        </p>
        <StagesEditor value={stages} onChange={setStages} />
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => setShowSaveAsTemplate(true)}
            disabled={stages.length === 0}
            className="ml-auto text-xs text-zinc-500 hover:text-emerald-700 disabled:opacity-50"
            title="Сохранить текущие стадии как шаблон воркспейса"
          >
            Сохранить как шаблон
          </button>
          {save.error && (
            <span className="text-xs text-red-600">
              {errorMessage(save.error)}
            </span>
          )}
        </div>
      </Modal>
      {showSaveAsTemplate && (
        <SaveAsStageTemplateDialog
          wsId={wsId}
          stages={stages}
          onClose={() => setShowSaveAsTemplate(false)}
        />
      )}
    </>
  );
}

function SaveAsStageTemplateDialog(props: {
  wsId: string;
  stages: Stage[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите имя шаблона");
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/stage-templates",
        {
          params: { path: { wsId: props.wsId } },
          body: { name: trimmed, stages: props.stages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => props.onClose(),
  });

  return (
    <Modal onClose={props.onClose} variant="sheet" zIndex={40}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-semibold">
          Сохранить стадии как шаблон
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Закрыть"
          className="text-zinc-400 hover:text-zinc-700"
        >
          <X size={18} />
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Шаблон попадёт в библиотеку и будет доступен при создании новых
        проектов. Этот проект и шаблон дальше живут независимо.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-600">Имя шаблона</span>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </label>
      {save.error && (
        <p className="mt-2 text-sm text-red-600">{errorMessage(save.error)}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить шаблон"}
        </button>
      </div>
    </Modal>
  );
}
