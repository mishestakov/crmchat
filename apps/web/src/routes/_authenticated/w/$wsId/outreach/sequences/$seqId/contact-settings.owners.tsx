import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../../../lib/api";
import { errorMessage } from "../../../../../../../lib/errors";
import { BackButton } from "../../../../../../../components/back-button";
import {
  Section,
  SectionItem,
  SectionItemTitle,
} from "../../../../../../../components/section";
import { useSequence } from "../../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/$seqId/contact-settings/owners",
)({
  component: OwnersPage,
});

function OwnersPage() {
  const { wsId, seqId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useSequence(wsId, seqId);

  const members = useQuery({
    queryKey: ["workspace-members", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{id}/members", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (seq.data) setSelected(seq.data.contactDefaultOwnerIds);
  }, [seq.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        {
          params: { path: { wsId, seqId } },
          body: { contactDefaultOwnerIds: selected },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      navigate({
        to: "/w/$wsId/outreach/sequences/$seqId/contact-settings",
        params: { wsId, seqId },
      });
    },
  });

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Ответственные за лидов</h1>
        <p className="text-sm text-zinc-600">
          Кто будет назначаться ответственным при создании контакта из этой
          рассылки. При нескольких выбранных — round-robin между ними.
        </p>

        <Section header={`Доступно: ${members.data?.length ?? 0}`}>
          {members.isLoading && (
            <SectionItem>
              <SectionItemTitle>Загрузка…</SectionItemTitle>
            </SectionItem>
          )}
          {members.data?.map((m) => {
            const checked = selected.includes(m.id);
            return (
              <SectionItem
                key={m.id}
                onClick={() =>
                  setSelected((prev) =>
                    checked
                      ? prev.filter((id) => id !== m.id)
                      : [...prev, m.id],
                  )
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="shrink-0"
                />
                <SectionItemTitle>
                  <div className="font-medium">{m.name ?? m.username ?? m.id}</div>
                  {m.username && <div className="text-xs text-zinc-500">@{m.username}</div>}
                </SectionItemTitle>
              </SectionItem>
            );
          })}
        </Section>

        <p className="text-xs text-zinc-500">
          Если не выбрано ничего — ответственным становится создатель рассылки.
        </p>

        {save.error && (
          <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
        )}

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
