import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { BackButton } from "../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../lib/query-keys";

// Дефолтный шаблон в селекте — последний использованный в этой папке
// (хранится в localStorage по trackId). Это закрывает кейс «у клиента
// 99% одинаковый канбан» без явного «папка имеет шаблон».

export const Route = createFileRoute("/_authenticated/w/$wsId/projects/new")({
  // ?trackId=X из ссылки «+ Новый проект» под папкой в tree-explorer'е —
  // предзаполняем селект папки.
  validateSearch: (s: Record<string, unknown>) => ({
    trackId: typeof s.trackId === "string" ? s.trackId : undefined,
  }),
  component: NewProjectPage,
});

const lastTemplateKey = (wsId: string, trackId: string) =>
  `crmchat:lastTemplate:${wsId}:${trackId}`;

function NewProjectPage() {
  const { wsId } = Route.useParams();
  const { trackId: presetTrackId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const tracksQ = useQuery({
    queryKey: OUTREACH_QK.tracks(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/tracks",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const templatesQ = useQuery({
    queryKey: ["stage-templates", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/stage-templates",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [trackId, setTrackId] = useState<string>(presetTrackId ?? "");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");

  // Когда выбрали папку — подставить последний использованный шаблон стадий
  // в этой папке (если он ещё существует).
  useEffect(() => {
    if (!trackId) return;
    const last = localStorage.getItem(lastTemplateKey(wsId, trackId));
    if (last && templatesQ.data?.some((t) => t.id === last)) {
      setTemplateId(last);
    } else {
      setTemplateId("");
    }
  }, [trackId, wsId, templatesQ.data]);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects",
        {
          params: { path: { wsId } },
          body: {
            trackId,
            name: name.trim(),
            ...(templateId && { templateId }),
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (project) => {
      // Запоминаем выбор шаблонов в localStorage — следующий проект в этой
      // папке откроется с этими же дефолтами.
      if (templateId) {
        localStorage.setItem(lastTemplateKey(wsId, trackId), templateId);
      }
      qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
      navigate({
        to: "/w/$wsId/projects/$projectId",
        params: { wsId, projectId: project.id },
      });
    },
  });

  // Если папка пришла из URL и резолвится — не показываем селект, кейс
  // «открыл форму из tree-кнопки папки» это 99% сценарий. Селект остаётся
  // только когда пришли без preset'а или папка из ?trackId уже удалена.
  const presetTrack =
    presetTrackId && tracksQ.data?.find((t) => t.id === presetTrackId);

  const selectedTemplate = templatesQ.data?.find((t) => t.id === templateId);
  const canSubmit =
    trackId.length > 0 && name.trim().length > 0 && !create.isPending;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Новый проект</h1>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          {presetTrack ? (
            <div className="text-sm text-zinc-600">
              Папка: <span className="font-medium text-zinc-900">{presetTrack.name}</span>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-sm text-zinc-600">Папка</span>
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">— выбрать —</option>
                {tracksQ.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">Название</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Привлечение январь 2026"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">
              Шаблон стадий канбана
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">— дефолтный (4 стадии) —</option>
              {templatesQ.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate && (
            <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              <div className="mb-1 font-medium text-zinc-700">Стадии:</div>
              <div className="flex flex-wrap gap-1">
                {[...selectedTemplate.stages]
                  .sort((a, b) => a.order - b.order)
                  .map((s) => (
                    <span
                      key={s.id}
                      className="rounded border border-zinc-200 bg-white px-1.5 py-0.5"
                    >
                      {s.name}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {create.error && (
            <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => create.mutate()}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {create.isPending ? "Создаём…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
