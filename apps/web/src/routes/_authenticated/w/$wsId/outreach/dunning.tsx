import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import { TEMPLATE_VARIABLES } from "../../../../../lib/template-variables";
import {
  DunningEditor,
  type Dunning,
} from "../../../../../components/dunning-editor";

export const Route = createFileRoute("/_authenticated/w/$wsId/outreach/dunning")(
  { component: DunningPage },
);

function DunningPage() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(wsId);
  // Любой аккаунт воркспейса — для резолва стикерпаков в пикере котиков.
  const accountId = accountsQ.data?.[0]?.id ?? null;

  const dunningQ = useQuery({
    queryKey: ["ws-dunning", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/dunning",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [draft, setDraft] = useState<Dunning>({ pings: [], intervals: [] });
  useEffect(() => {
    if (dunningQ.data) setDraft(dunningQ.data);
  }, [dunningQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      // Пустые черновые фразы не шлём — бэк требует ≥1 символ (VariantSchema).
      const pings = draft.pings.filter(
        (p) => p.kind !== "text" || p.text.trim() !== "",
      );
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/dunning",
        { params: { path: { wsId } }, body: { ...draft, pings } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["ws-dunning", wsId] }),
  });

  const dirty =
    !!dunningQ.data && JSON.stringify(draft) !== JSON.stringify(dunningQ.data);

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Пиналка</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Догон, если блогер молчит — общий на весь воркспейс (фразы + котики +
        ритм). Опенер у каждого проекта свой.
      </p>
      {dunningQ.isLoading && (
        <p className="text-sm text-zinc-400">Загрузка…</p>
      )}
      {dunningQ.error && (
        <p className="text-sm text-red-600">{errorMessage(dunningQ.error)}</p>
      )}
      {dunningQ.data && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <DunningEditor
            value={draft}
            onChange={setDraft}
            variables={TEMPLATE_VARIABLES}
            wsId={wsId}
            accountId={accountId}
          />
          {dirty && (
            <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-3">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {save.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          )}
          {save.error && (
            <p className="mt-2 text-sm text-red-600">
              {errorMessage(save.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
