import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/accounts/$accountId",
)({
  component: AccountDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  banned: "Banned",
  frozen: "Frozen",
  unauthorized: "Unauthorized",
  offline: "Offline",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-700",
  banned: "text-red-700",
  frozen: "text-amber-700",
  unauthorized: "text-zinc-500",
  offline: "text-zinc-400",
};

function AccountDetailPage() {
  const { wsId, accountId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const account = useQuery({
    queryKey: ["outreach-account", wsId, accountId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [dailyLimit, setDailyLimit] = useState<number>(0);

  // Hydrate local input из server-data при загрузке/refetch.
  useEffect(() => {
    if (account.data) setDailyLimit(account.data.newLeadsDailyLimit);
  }, [account.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        {
          params: { path: { wsId, accountId } },
          body: { newLeadsDailyLimit: dailyLimit },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outreach-account", wsId, accountId] });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
      navigate({ to: "/w/$wsId/outreach/accounts", params: { wsId } });
    },
  });

  if (account.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (account.error || !account.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">
          {account.error ? errorMessage(account.error) : "Аккаунт не найден"}
        </p>
      </div>
    );
  }

  const acc = account.data;
  const isUnauthorized = acc.status === "unauthorized";
  const dirty = dailyLimit !== acc.newLeadsDailyLimit;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold">
              {acc.firstName || acc.tgUsername || "Без имени"}
            </h1>
            {acc.hasPremium && (
              <Star size={16} className="fill-amber-400 text-amber-400" />
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {acc.phoneNumber ?? "—"}
            {acc.phoneNumber && acc.tgUsername ? " · " : ""}
            {acc.tgUsername ? `@${acc.tgUsername}` : ""}
          </p>
        </div>

        <div className="rounded-2xl bg-white shadow-sm">
          <Row label="Статус">
            <span className={STATUS_COLOR[acc.status] ?? "text-zinc-700"}>
              {STATUS_LABEL[acc.status] ?? acc.status}
            </span>
          </Row>
          {isUnauthorized && (
            <div className="border-t border-zinc-100 px-5 py-3 text-xs text-amber-700">
              Сессия не активна — воркер не сможет с этого аккаунта отправлять.
              Подключите заново через «Добавить» в списке аккаунтов
              (если зайдёте под тем же TG-юзером — запись обновится).
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Дневной лимит лидов
            </span>
            <span className="mb-2 block text-xs text-zinc-500">
              Сколько новых сообщений в сутки максимум уйдёт с этого аккаунта.
              Сбрасывается в полночь по часовому поясу workspace. Безопасный
              дефолт для не-Premium без warmup'а — 30. С Premium можно крутить
              выше.
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.max(0, Number(e.target.value) || 0))}
              className="w-32 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          {save.error && (
            <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
          )}
          {dirty && (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </button>
          )}
        </div>

        <div className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-500 space-y-2">
          <div className="font-medium text-zinc-700">Скоро</div>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Прогрев аккаунта (warmup)</li>
            <li>Прокси</li>
            <li>Автосоздание лидов из входящих сообщений</li>
          </ul>
        </div>

        {remove.error && (
          <p className="text-sm text-red-600">{errorMessage(remove.error)}</p>
        )}
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Удалить аккаунт ${
                  acc.firstName || acc.tgUsername || acc.phoneNumber || ""
                }? Сессия будет удалена.`,
              )
            ) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
          className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Удалить аккаунт
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
