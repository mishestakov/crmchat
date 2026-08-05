import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plug } from "lucide-react";
import { BackButton } from "../../../../../components/back-button";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useMe } from "../../../../../lib/hooks";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/settings/integrations",
)({
  component: IntegrationsPage,
});

// Логин в корп-CRM Яндекса. Личная настройка, не воркспейсная: тикет
// заводится от имени сервисного робота, а владельцем ставится тот менеджер,
// который вынес вердикт. Справочника сотрудников в API CRM нет, поэтому
// строка — опечатка всплывёт на первом же вердикте (CRM откажется ставить
// владельца, текст ошибки ляжет на карточку лида).
function CrmLoginCard() {
  const qc = useQueryClient();
  const meQ = useMe();
  const saved = meQ.data?.crmLogin ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH("/v1/auth/me", {
        body: { crmLogin: value.trim() || null },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <div>
        <div className="text-sm font-medium">CRM Яндекса</div>
        <p className="mt-1 text-xs text-zinc-500">
          Ваш логин в CRM. По нему тикеты, назначенные на вас в CRM, при
          подтягивании закрепляются за вами и здесь. Пока не заполнен — ваши
          лиды будут приезжать «ничейными» и уходить в общую очередь.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="например, ivanov"
          className="w-56 rounded-md border border-zinc-200 px-2 py-1 text-sm"
        />
        {value.trim() !== saved && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Сохранить
          </button>
        )}
      </div>
      {save.error && (
        <div className="text-xs text-red-600">{errorMessage(save.error)}</div>
      )}
    </div>
  );
}

function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <BackButton />
      <h1 className="text-2xl font-semibold">Интеграции</h1>
      <CrmLoginCard />
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm">
        <Plug size={32} className="text-zinc-300" />
        <div className="text-sm font-medium">Остальное — скоро</div>
        <p className="max-w-md text-xs text-zinc-500">
          Тут появятся подключения к внешним системам: ОРД для ЕРИД, экспорт в
          DWH, биржи каналов. Пока пусто — инструменты добавятся по мере
          появления продуктовых задач.
        </p>
      </div>
    </div>
  );
}
