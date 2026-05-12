import { createFileRoute } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import { BackButton } from "../../../../../components/back-button";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/settings/integrations",
)({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <BackButton />
      <h1 className="text-2xl font-semibold">Интеграции</h1>
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm">
        <Plug size={32} className="text-zinc-300" />
        <div className="text-sm font-medium">Скоро</div>
        <p className="max-w-md text-xs text-zinc-500">
          Тут появятся подключения к внешним системам: ОРД для ЕРИД, экспорт в
          DWH, биржи каналов, CRM-импорт. Пока пусто — инструменты для
          подключения добавятся по мере появления продуктовых задач.
        </p>
      </div>
    </div>
  );
}
