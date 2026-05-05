import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";

// Та же валидация, что на сервере (apps/api/src/routes/auth.ts safeNext).
// Если кто-то даст /login?next=//evil.com — на сервер мы next не отправим.
function safeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}

export const Route = createFileRoute("/login")({
  component: Login,
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: string; next?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
});

function Login() {
  const { error, next } = Route.useSearch();
  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const safe = safeNext(next);
  const startUrl = safe
    ? `${apiBase}/v1/auth/telegram/start?next=${encodeURIComponent(safe)}`
    : `${apiBase}/v1/auth/telegram/start`;
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
        href={startUrl}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-white hover:bg-sky-600"
      >
        <Send size={18} />
        Войти через Telegram
      </a>
    </div>
  );
}
