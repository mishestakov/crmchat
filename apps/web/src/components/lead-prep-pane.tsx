import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Trash2 } from "lucide-react";
import type { Contact } from "@repo/core";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { invalidateProject } from "../lib/query-keys";
import { ChannelCard } from "./channel-card";
import { ContactNote } from "./chat-drawer";
import { ContactResolver } from "./contact-resolver";

// Панель подготовки канала в draft-проекте (BD): слева карточка канала
// (описание, лента — то, за чем менеджер ходил в Telegram руками на тесте
// 10.06.26), справа резолвер контакта. Правая часть инбокса подготовки в
// leads.tsx; после запуска клик по строке ведёт в переписку (LeadChatDrawer).
type PrepLead = {
  id: string;
  username: string | null;
  contactId: string | null;
  contactReady: boolean;
  channel: { id: string; title: string; username: string | null } | null;
};

export function LeadPrepPane(props: {
  wsId: string;
  projectId: string;
  lead: PrepLead;
  // Идущая кампания (active/paused): «убрать» = skip («в Не отправляем»,
  // обратимо), т.к. delete сервер разрешает только в draft. В draft — delete.
  running: boolean;
  // Инспект-режим (смотрим исключённый лид из «Не отправляем») — кнопку убрать
  // не показываем: лид уже исключён, тут только проверить/найти контакт.
  showRemove?: boolean;
  // После удаления/исключения канала — родитель выбирает следующего.
  onRemoved: () => void;
}) {
  const { wsId, projectId, lead, running } = props;
  const showRemove = props.showRemove ?? true;
  const qc = useQueryClient();
  const [changing, setChanging] = useState(false);
  const channelId = lead.channel?.id ?? null;

  const channelQ = useQuery({
    queryKey: ["channel", wsId, channelId] as const,
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}",
        { params: { path: { wsId, id: channelId! } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // Контакт админа — ради пометки («не беспокоить до января») ДО запуска
  // рассылки. Тот же queryKey, что у чата/карточки — кэш общий.
  const contactQ = useQuery({
    queryKey: ["contact", wsId, lead.contactId ?? ""] as const,
    enabled: !!lead.contactId,
    // Свои правки памятки инвалидируются мутацией NoteStrip; минута кэша
    // гасит refetch при щёлканье по лидам туда-сюда.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}",
        { params: { path: { wsId, id: lead.contactId! } } },
      );
      if (error) throw error;
      return data as Contact;
    },
  });

  const invalidateLeads = () =>
    invalidateProject(qc, wsId, projectId, { leads: true });

  // draft — удалить из списка (список ещё строится). active/paused — delete
  // запрещён сервером, поэтому «убрать» = skip («в Не отправляем», обратимо).
  const removeLead = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
        { params: { path: { wsId, projectId, itemId: lead.id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateLeads();
      props.onRemoved();
    },
  });
  const excludeLead = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/skip",
        { params: { path: { wsId, projectId, itemId: lead.id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateLeads();
      props.onRemoved();
    },
  });

  const removeBtn = !showRemove ? null : running ? (
    <button
      type="button"
      onClick={() => excludeLead.mutate()}
      disabled={excludeLead.isPending}
      title="Убрать в «Не отправляем» (можно вернуть)"
      className="shrink-0 rounded-lg border border-zinc-300 p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Ban size={15} />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => {
        if (window.confirm("Удалить канал из списка?")) removeLead.mutate();
      }}
      disabled={removeLead.isPending}
      title="Удалить из списка"
      className="shrink-0 rounded-lg border border-zinc-300 p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 size={15} />
    </button>
  );

  // contactReady считает бэк (тот же предикат, что гейт /activate) — здесь
  // только подпись, каким способом уйдёт опенер.
  const meta = (channelQ.data?.meta ?? {}) as Record<string, unknown>;
  const methodKind =
    ((meta.contact_method as { kind?: string } | null)?.kind ?? null);
  const contactLabel = lead.username
    ? `админ @${lead.username}`
    : methodKind === "group"
      ? "группа обсуждения"
      : "личка канала";

  return (
    <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-hidden border-r border-zinc-200">
          {channelQ.data ? (
            <ChannelCard wsId={wsId} channel={channelQ.data} compact />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
              {channelQ.isLoading ? "Загрузка канала…" : "Канал недоступен"}
            </div>
          )}
        </div>
        <div className="flex w-[360px] shrink-0 flex-col">
          {lead.contactReady && !changing ? (
            <>
              {contactQ.data && (
                <ContactNote wsId={wsId} contact={contactQ.data} />
              )}
              <div className="border-b border-zinc-200 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">
                      Контакт для рассылки
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-600">
                      {contactLabel}
                    </p>
                  </div>
                  {removeBtn}
                </div>
                <button
                  type="button"
                  onClick={() => setChanging(true)}
                  className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  сменить
                </button>
              </div>
              <p className="px-4 py-3 text-xs text-zinc-400">
                Опенер уйдёт этому контакту при запуске. Переписка появится
                здесь после старта рассылки.
              </p>
            </>
          ) : (
            <ContactResolver
              wsId={wsId}
              channelId={channelId}
              channel={channelQ.data ?? null}
              onResolved={invalidateLeads}
              onClose={lead.contactReady ? () => setChanging(false) : undefined}
              headerAction={removeBtn}
            />
          )}
          {(removeLead.error || excludeLead.error) && (
            <p className="px-4 pb-3 text-xs text-red-600">
              {errorMessage(removeLead.error ?? excludeLead.error)}
            </p>
          )}
        </div>
    </div>
  );
}
