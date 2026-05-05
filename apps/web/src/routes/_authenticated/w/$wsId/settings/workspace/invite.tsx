import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/settings/workspace/invite",
)({
  component: InviteForm,
});

function InviteForm() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/invites",
        {
          params: { path: { wsId } },
          body: {
            telegramUsername: username.trim().replace(/^@/, ""),
            role,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setLink(`${window.location.origin}/accept-invite/${wsId}/${data.code}`);
      qc.invalidateQueries({ queryKey: ["workspaces", wsId, "invites"] });
    },
  });

  // Если приглашение создано — экран превращается в «вот ссылка, отправьте
  // её адресату». Ничего автоматически не отправляется (бота для рассылки
  // у нас пока нет, см. план/DECISIONS); юзер копирует или открывает t.me.
  if (link) {
    const tgUserUrl = username.trim().replace(/^@/, "")
      ? `https://t.me/${encodeURIComponent(username.trim().replace(/^@/, ""))}`
      : null;
    return (
      <div className="mx-auto max-w-xl p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Приглашение создано</h1>
        <p className="text-sm text-zinc-600">
          Отправьте эту ссылку пользователю любым удобным способом. Срок
          действия — 7 дней.
        </p>
        <div className="space-y-2 rounded border border-zinc-200 bg-white p-3">
          <code className="block break-all rounded bg-zinc-50 px-2 py-1.5 text-xs">
            {link}
          </code>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
            >
              {copied ? "Скопировано ✓" : "Скопировать ссылку"}
            </button>
            {tgUserUrl && (
              <a
                href={tgUserUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Открыть @{username.trim().replace(/^@/, "")} в Telegram
              </a>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Бота для автоматической отправки приглашений у нас пока нет —
            ссылку шлёте вручную.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setLink(null);
              setUsername("");
              setRole("member");
              create.reset();
            }}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Пригласить ещё
          </button>
          <Link
            to="/w/$wsId/settings/workspace"
            params={{ wsId }}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            К списку команды
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Пригласить в команду</h1>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!username.trim()) return;
          create.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-600">
            Telegram username
          </span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Это подсказка для вас, кому отправляется приглашение. При приёме
            ссылки сверка username не делается — принять может любой
            залогиненный пользователь по этой ссылке.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-600">Роль</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2"
          >
            <option value="member">Участник</option>
            <option value="admin">Админ</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!username.trim() || create.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Создать ссылку
          </button>
          <button
            type="button"
            onClick={() =>
              navigate({
                to: "/w/$wsId/settings/workspace",
                params: { wsId },
              })
            }
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отмена
          </button>
          {create.error && (
            <span className="text-sm text-red-600">
              {errorMessage(create.error)}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
