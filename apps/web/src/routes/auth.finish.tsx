import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../lib/api";

export const Route = createFileRoute("/auth/finish")({
  validateSearch: (search: Record<string, unknown>): { bt?: string } => ({
    bt: typeof search.bt === "string" ? search.bt : undefined,
  }),
  loaderDeps: ({ search: { bt } }) => ({ bt }),
  // Loader выполняется один раз per navigation (до mount компонента),
  // поэтому StrictMode-double-mount не задевает — bridge-token консьюмится строго один раз.
  loader: async ({ deps: { bt } }) => {
    if (!bt) throw new Error("missing bt");
    const { error } = await api.POST("/v1/auth/finish", { body: { bt } });
    if (error) {
      console.error("[auth/finish] exchange failed:", error);
      throw new Error("exchange failed");
    }
    throw redirect({ to: "/", search: { new: false } });
  },
  pendingComponent: () => (
    <div className="mx-auto max-w-md p-8 text-sm text-zinc-500">Завершаем вход…</div>
  ),
  errorComponent: () => (
    <div className="mx-auto max-w-md p-8">
      <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
        Не получилось войти. Попробуйте ещё раз.
      </p>
      <a href="/login" className="mt-4 inline-block text-sm text-sky-600">Назад</a>
    </div>
  ),
  component: () => null,
});
