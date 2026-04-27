import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../../../../../../../lib/api";
import { errorMessage } from "../../../../../../../lib/errors";
import { BackButton } from "../../../../../../../components/back-button";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
} from "../../../../../../../components/section";
import {
  useOutreachAccounts,
  useSequence,
} from "../../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/$seqId/accounts",
)({
  component: AccountsPage,
});

function AccountsPage() {
  const { wsId, seqId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useSequence(wsId, seqId);
  const accounts = useOutreachAccounts(wsId);

  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!seq.data) return;
    setMode(seq.data.accountsMode);
    setSelected(seq.data.accountsSelected);
  }, [seq.data]);

  const activeAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => a.status === "active"),
    [accounts.data],
  );

  const isDraft = seq.data?.status === "draft";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        {
          params: { path: { wsId, seqId } },
          body: { accountsMode: mode, accountsSelected: selected },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      navigate({
        to: "/w/$wsId/outreach/sequences/$seqId",
        params: { wsId, seqId },
      });
    },
  });

  if (seq.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-2xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (seq.error || !seq.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-2xl text-red-600">
          {seq.error ? errorMessage(seq.error) : "Рассылка не найдена"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Аккаунты</h1>

        <Section>
          <SectionItem
            onClick={isDraft ? () => setMode("all") : undefined}
            className={isDraft ? "" : "opacity-60"}
          >
            <input
              type="radio"
              checked={mode === "all"}
              readOnly
              disabled={!isDraft}
              className="shrink-0"
            />
            <SectionItemTitle>
              <div className="font-medium">Все активные</div>
              <div className="text-xs text-zinc-500">
                Лиды распределяются между всеми авторизованными аккаунтами
              </div>
            </SectionItemTitle>
          </SectionItem>
          <SectionItem
            onClick={isDraft ? () => setMode("selected") : undefined}
            className={isDraft ? "" : "opacity-60"}
          >
            <input
              type="radio"
              checked={mode === "selected"}
              readOnly
              disabled={!isDraft}
              className="shrink-0"
            />
            <SectionItemTitle>
              <div className="font-medium">Выбранные</div>
              <div className="text-xs text-zinc-500">
                Использовать только отмеченные ниже аккаунты
              </div>
            </SectionItemTitle>
          </SectionItem>
        </Section>

        <Section header={`Доступно: ${activeAccounts.length}`}>
          {activeAccounts.length === 0 && (
            <SectionItem>
              <SectionItemTitle>
                <span className="text-amber-700">
                  Нет активных outreach-аккаунтов. Добавьте их в разделе
                  «Аккаунты».
                </span>
              </SectionItemTitle>
            </SectionItem>
          )}
          {activeAccounts.map((a) => {
            const checked = mode === "all" || selected.includes(a.id);
            return (
              <SectionItem
                key={a.id}
                onClick={
                  isDraft && mode === "selected"
                    ? () =>
                        setSelected((prev) =>
                          prev.includes(a.id)
                            ? prev.filter((id) => id !== a.id)
                            : [...prev, a.id],
                        )
                    : undefined
                }
                className={
                  isDraft && mode === "selected" ? "" : "cursor-default"
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  disabled={mode === "all" || !isDraft}
                  className="shrink-0"
                />
                <SectionItemTitle>
                  <div className="flex items-center gap-1.5 font-medium">
                    {a.firstName ?? "—"}
                    {a.hasPremium && (
                      <Sparkles
                        size={12}
                        className="text-amber-500"
                        aria-label="Telegram Premium"
                      />
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {a.tgUsername ? `@${a.tgUsername}` : ""}
                    {a.tgUsername && a.phoneNumber ? " · " : ""}
                    {a.phoneNumber ?? ""}
                  </div>
                </SectionItemTitle>
                <SectionItemValue>
                  <span
                    className={
                      "inline-block h-2 w-2 rounded-full " +
                      (a.status === "active"
                        ? "bg-emerald-500"
                        : "bg-zinc-300")
                    }
                  />
                </SectionItemValue>
              </SectionItem>
            );
          })}
        </Section>

        {save.error && (
          <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
        )}

        {isDraft && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        )}
        {!isDraft && (
          <p className="text-xs text-zinc-500">
            Аккаунты можно менять только в статусе «Черновик».
          </p>
        )}
      </div>
    </div>
  );
}
