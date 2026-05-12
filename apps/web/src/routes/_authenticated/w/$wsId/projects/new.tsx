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
const lastMessageTemplateKey = (wsId: string, trackId: string) =>
  `crmchat:lastMessageTemplate:${wsId}:${trackId}`;

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

  const messageTemplatesQ = useQuery({
    queryKey: ["message-templates", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/message-templates",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [trackId, setTrackId] = useState<string>(presetTrackId ?? "");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [messageTemplateId, setMessageTemplateId] = useState<string>("");

  // Когда выбрали папку — подставить последний использованный шаблон стадий
  // и шаблон цепочки в этой папке (если они ещё существуют).
  useEffect(() => {
    if (!trackId) return;
    const last = localStorage.getItem(lastTemplateKey(wsId, trackId));
    if (last && templatesQ.data?.some((t) => t.id === last)) {
      setTemplateId(last);
    } else {
      setTemplateId("");
    }
    const lastMsg = localStorage.getItem(lastMessageTemplateKey(wsId, trackId));
    if (lastMsg && messageTemplatesQ.data?.some((t) => t.id === lastMsg)) {
      setMessageTemplateId(lastMsg);
    } else {
      setMessageTemplateId("");
    }
  }, [trackId, wsId, templatesQ.data, messageTemplatesQ.data]);

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
            ...(messageTemplateId && { messageTemplateId }),
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
      if (messageTemplateId) {
        localStorage.setItem(
          lastMessageTemplateKey(wsId, trackId),
          messageTemplateId,
        );
      }
      qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
      navigate({
        to: "/w/$wsId/projects/$projectId",
        params: { wsId, projectId: project.id },
      });
    },
  });

  const selectedTemplate = templatesQ.data?.find((t) => t.id === templateId);
  const selectedMessageTemplate = messageTemplatesQ.data?.find(
    (t) => t.id === messageTemplateId,
  );
  const canSubmit =
    trackId.length > 0 && name.trim().length > 0 && !create.isPending;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Новый проект</h1>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
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

          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">
              Шаблон цепочки сообщений
            </span>
            <select
              value={messageTemplateId}
              onChange={(e) => setMessageTemplateId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">— пустая цепочка —</option>
              {messageTemplatesQ.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {selectedMessageTemplate && (
            <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 space-y-1.5">
              <div className="font-medium text-zinc-700">
                Цепочка ({selectedMessageTemplate.messages.length}{" "}
                {selectedMessageTemplate.messages.length === 1
                  ? "сообщение"
                  : "сообщений"}
                ):
              </div>
              {selectedMessageTemplate.messages.length === 0 && (
                <p className="text-zinc-500">Шаблон пустой.</p>
              )}
              <ol className="space-y-1">
                {selectedMessageTemplate.messages.map((m, idx) => (
                  <li
                    key={m.id}
                    className="rounded border border-zinc-200 bg-white px-2 py-1"
                  >
                    <div className="text-[11px] text-zinc-500">
                      {idx === 0
                        ? "Первое"
                        : `Шаг ${idx + 1} — через ${m.delay.value} ${
                            m.delay.period === "minutes"
                              ? "мин"
                              : m.delay.period === "hours"
                              ? "ч"
                              : "дн"
                          }`}
                    </div>
                    <div className="truncate text-zinc-700">
                      {m.text || (
                        <span className="italic text-zinc-400">пусто</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="pt-1 text-[11px] text-zinc-500">
                Цепочка скопируется в проект — после создания её можно править,
                на шаблон это не повлияет.
              </p>
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
