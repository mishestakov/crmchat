import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api";

export const Route = createFileRoute("/auth/finish")({
  component: AuthFinish,
  validateSearch: (search: Record<string, unknown>): { bt?: string } => ({
    bt: typeof search.bt === "string" ? search.bt : undefined,
  }),
});

function AuthFinish() {
  const { bt } = Route.useSearch();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // StrictMode зовёт useEffect дважды → без guard'а bt консьюмится первым,
  // второй получает 401.
  const ran = useRef(false);

  useEffect(() => {
    if (!bt || ran.current) return;
    ran.current = true;
    api
      .POST("/v1/auth/finish", { body: { bt } })
      .then(({ error }) => {
        if (error) {
          console.error("[auth/finish] exchange failed:", error);
          setFailed(true);
          return;
        }
        navigate({ to: "/", search: { new: false } });
      });
  }, [bt, navigate]);

  if (failed || !bt) {
    return (
      <div className="mx-auto max-w-md p-8">
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Не получилось войти. Попробуйте ещё раз.
        </p>
        <a href="/login" className="mt-4 inline-block text-sm text-sky-600">Назад</a>
      </div>
    );
  }
  return <div className="mx-auto max-w-md p-8 text-sm text-zinc-500">Завершаем вход…</div>;
}
