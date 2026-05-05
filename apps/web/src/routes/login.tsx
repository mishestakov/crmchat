import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: Login,
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});

function Login() {
  const { error } = Route.useSearch();
  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  return (
    <div className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Войти в crmchat</h1>
      <p className="text-sm text-zinc-500">
        Через ваш Telegram-аккаунт. Откроется страница подтверждения, потом
        вернёмся обратно.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Не получилось войти. Попробуйте ещё раз.
        </p>
      )}

      <a
        href={`${apiBase}/v1/auth/telegram/start`}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-white hover:bg-sky-600"
      >
        <Send size={18} />
        Войти через Telegram
      </a>
    </div>
  );
}
