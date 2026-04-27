import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <Outlet />
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md space-y-3 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">
          Не удалось загрузить страницу
        </h1>
        <p className="text-sm text-zinc-600">
          Произошла ошибка при обращении к серверу. Попробуйте обновить страницу.
        </p>
        <pre className="max-h-40 overflow-auto rounded bg-zinc-100 p-2 text-xs text-zinc-700">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Повторить
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    </div>
  ),
});
