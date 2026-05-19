import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Та же валидация, что на сервере (apps/api/src/routes/auth.ts safeNext).
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

const POLL_INTERVAL_MS = 2000;

type Stage = "idle" | "waiting" | "expired" | "error";

function Login() {
  const { error, next } = Route.useSearch();
  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const safe = safeNext(next);

  const [stage, setStage] = useState<Stage>("idle");
  const [deepLink, setDeepLink] = useState<string>("");
  const cancelRef = useRef(false);

  useEffect(() => () => { cancelRef.current = true; }, []);

  async function start() {
    setStage("waiting");
    try {
      const res = await fetch(`${apiBase}/v1/auth/tg-bot/start`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`start ${res.status}`);
      const data = (await res.json()) as { token: string; deepLink: string };
      setDeepLink(data.deepLink);
      window.open(data.deepLink, "_blank", "noopener,noreferrer");
      void pollLoop(data.token);
    } catch (e) {
      console.error("[login] start failed:", e);
      setStage("error");
    }
  }

  async function pollLoop(token: string) {
    while (!cancelRef.current) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (cancelRef.current) return;
      let data: { status: string; bridgeToken?: string };
      try {
        const res = await fetch(
          `${apiBase}/v1/auth/tg-bot/poll?token=${encodeURIComponent(token)}`,
          { credentials: "include" },
        );
        data = await res.json();
      } catch {
        continue;
      }
      if (data.status === "approved" && data.bridgeToken) {
        const params = new URLSearchParams({ bt: data.bridgeToken });
        if (safe) params.set("next", safe);
        window.location.href = `/auth/finish?${params}`;
        return;
      }
      if (data.status === "expired" || data.status === "rejected") {
        setStage("expired");
        return;
      }
    }
  }

  return (
    <div className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Войти в crmchat</h1>
      <p className="text-sm text-zinc-500">
        Откроется Telegram-бот, нажмите Start и подтвердите вход.
      </p>

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Не получилось войти. Попробуйте ещё раз.
        </p>
      )}

      {stage === "idle" && (
        <button
          onClick={start}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-white hover:bg-sky-600"
        >
          <Send size={18} />
          Войти через Telegram
        </button>
      )}

      {stage === "waiting" && (
        <div className="space-y-3 rounded-xl bg-zinc-50 p-4 text-sm">
          <p className="text-zinc-700">Открылся Telegram. Нажмите Start у бота и подтвердите вход.</p>
          {deepLink && (
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sky-600 hover:underline"
            >
              Открыть Telegram ещё раз
            </a>
          )}
          <p className="text-xs text-zinc-500">Ждём подтверждения…</p>
        </div>
      )}

      {stage === "expired" && (
        <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm">
          <p className="text-amber-800">Ссылка истекла или вход отменён.</p>
          <button
            onClick={() => setStage("idle")}
            className="text-sky-600 hover:underline"
          >
            Попробовать заново
          </button>
        </div>
      )}

      {stage === "error" && (
        <div className="space-y-3 rounded-xl bg-red-50 p-4 text-sm">
          <p className="text-red-700">Что-то пошло не так. Попробуйте ещё раз.</p>
          <button
            onClick={() => setStage("idle")}
            className="text-sky-600 hover:underline"
          >
            Заново
          </button>
        </div>
      )}
    </div>
  );
}
