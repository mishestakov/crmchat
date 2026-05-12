import { createFileRoute } from "@tanstack/react-router";

// Placeholder для правой панели когда projectId не выбран. Tree-explorer
// слева в layout (route.tsx) — здесь только пустая правая панель.

export const Route = createFileRoute("/_authenticated/w/$wsId/projects/")({
  component: EmptyProjectPanel,
});

function EmptyProjectPanel() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Выберите проект слева
    </div>
  );
}
