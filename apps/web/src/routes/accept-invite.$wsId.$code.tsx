import {
  Navigate,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";

// Публичный роут вне _authenticated. Поток:
//  1. Не залогинен → 401 на /v1/invites/:code → редирект на
//     /login?next=/accept-invite/$wsId/$code (см. apps/api auth.ts safeNext).
//  2. Залогинен, инвайт валиден → карточка accept/decline.
//  3. alreadyMember → сразу заводим в /w/{wsId}/contacts (без accept-action).
export const Route = createFileRoute("/accept-invite/$wsId/$code")({
  component: AcceptInvite,
});

function AcceptInvite() {
  const { wsId, code } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/v1/auth/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data;
    },
  });

  const invite = useQuery({
    queryKey: ["invite", code],
    queryFn: async () => {
      const { data, error, response } = await api.GET(
        "/v1/invites/{code}",
        { params: { path: { code } } },
      );
      if (response.status === 401) return null;
      if (error) throw error;
      return data;
    },
    enabled: me.data !== null,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/invites/{code}/accept",
        { params: { path: { code } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate({
        to: "/w/$wsId/contacts",
        params: { wsId: data.workspaceId },
      });
    },
  });

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm text-zinc-500">
        Загрузка…
      </div>
    );
  }

  if (!me.data) {
    return (
      <Navigate
        to="/login"
        search={{ next: `/accept-invite/${wsId}/${code}` }}
      />
    );
  }

  if (invite.isLoading) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm text-zinc-500">
        Загрузка приглашения…
      </div>
    );
  }

  if (!invite.data || invite.error) {
    return (
      <div className="mx-auto max-w-md p-8 space-y-3">
        <h1 className="text-xl font-semibold">Приглашение недействительно</h1>
        <p className="text-sm text-zinc-600">
          Ссылка просрочена или была отозвана. Попросите админа создать новое.
        </p>
      </div>
    );
  }

  if (invite.data.alreadyMember) {
    return (
      <Navigate
        to="/w/$wsId/contacts"
        params={{ wsId: invite.data.workspaceId }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Приглашение в команду</h1>
        <p className="text-sm text-zinc-700">
          Вас пригласили в рабочее пространство{" "}
          <strong>{invite.data.workspaceName}</strong>
          {invite.data.invitedByName && <> от {invite.data.invitedByName}</>}.
        </p>
        <p className="text-sm text-zinc-600">
          Роль:{" "}
          <strong>
            {invite.data.role === "admin" ? "Админ" : "Участник"}
          </strong>
        </p>
        <p className="text-xs text-zinc-500">
          Принимая приглашение, вы получите доступ ко всем контактам, чатам и
          подключённым Telegram-аккаунтам этого рабочего пространства.
        </p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Принять
          </button>
          <button
            onClick={() => navigate({ to: "/", search: { new: false } })}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отклонить
          </button>
        </div>
        {accept.error && (
          <p className="text-sm text-red-600">{errorMessage(accept.error)}</p>
        )}
      </div>
    </div>
  );
}
