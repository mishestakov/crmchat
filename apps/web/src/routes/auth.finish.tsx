import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../lib/api";

// Дублируем серверную validation `safeNext` — defense-in-depth: даже если
// бэкенд по ошибке пустит open-redirect, фронт всё равно навигирует только на
// path внутри своего origin'а.
function safeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}

export const Route = createFileRoute("/auth/finish")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { bt?: string; next?: string } => ({
    bt: typeof search.bt === "string" ? search.bt : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  loaderDeps: ({ search: { bt, next } }) => ({ bt, next }),
  // Loader выполняется один раз per navigation (до mount компонента),
  // поэтому StrictMode-double-mount не задевает — bridge-token консьюмится строго один раз.
  loader: async ({ deps: { bt, next } }) => {
    if (!bt) throw new Error("missing bt");
    const { error } = await api.POST("/v1/auth/finish", { body: { bt } });
    if (error) {
      console.error("[auth/finish] exchange failed:", error);
      throw new Error("exchange failed");
    }
    const target = safeNext(next);
    if (target) {
      throw redirect({ href: target });
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
