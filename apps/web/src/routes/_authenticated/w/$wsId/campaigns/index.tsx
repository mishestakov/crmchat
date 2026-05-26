import { createFileRoute } from "@tanstack/react-router";

// Правая панель когда ничего не выбрано в tree (слева, route.tsx).
export const Route = createFileRoute("/_authenticated/w/$wsId/campaigns/")({
  component: EmptyPanel,
});

function EmptyPanel() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Выберите клиента или кампанию слева
    </div>
  );
}
