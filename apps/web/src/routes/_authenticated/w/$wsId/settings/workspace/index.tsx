import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/settings/workspace/")({
  component: WorkspaceSettings,
});

type Member = {
  id: string;
  name: string | null;
  username: string | null;
  role: "admin" | "member";
};

function WorkspaceSettings() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();

  const ws = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
    select: (rows) => rows.find((w) => w.id === wsId),
  });

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/v1/auth/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data;
    },
  });

  const members = useQuery({
    queryKey: ["workspaces", wsId, "members"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{id}/members", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
      return data as Member[];
    },
  });

  const myRole = members.data?.find((m) => m.id === me.data?.id)?.role;
  const isAdmin = myRole === "admin";

  const [name, setName] = useState("");
  useEffect(() => {
    if (ws.data) setName(ws.data.name);
  }, [ws.data?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH("/v1/workspaces/{id}", {
        params: { path: { id: wsId } },
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  return (
    <div className="mx-auto max-w-xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Настройки</h1>

      {ws.isLoading && <p>Загрузка…</p>}
      {ws.error && <p className="text-red-600">{errorMessage(ws.error)}</p>}

      {ws.data && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name !== ws.data?.name && isAdmin) save.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">Название</span>
            <input
              className="w-full rounded border border-zinc-300 px-3 py-2 disabled:bg-zinc-50 disabled:text-zinc-500"
              value={name}
              disabled={!isAdmin}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {isAdmin && name !== ws.data.name && name.trim() && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={save.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Сохранить
              </button>
              {save.error && (
                <span className="text-sm text-red-600">
                  {errorMessage(save.error)}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-zinc-500">
            ID: <code>{ws.data.id}</code>
          </p>
        </form>
      )}

      <TeamSection
        wsId={wsId}
        members={members.data ?? []}
        meId={me.data?.id}
        isAdmin={isAdmin}
        isLoading={members.isLoading}
      />

      {isAdmin && <PendingInvites wsId={wsId} />}

      {isAdmin && <DangerZone wsId={wsId} wsName={ws.data?.name ?? ""} />}
    </div>
  );
}

function TeamSection({
  wsId,
  members,
  meId,
  isAdmin,
  isLoading,
}: {
  wsId: string;
  members: Member[];
  meId: string | undefined;
  isAdmin: boolean;
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const changeRole = useMutation({
    mutationFn: async (vars: { userId: string; role: "admin" | "member" }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/members/{userId}",
        {
          params: { path: { wsId, userId: vars.userId } },
          body: { role: vars.role },
        },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workspaces", wsId, "members"] }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/members/{userId}",
        {
          params: { path: { wsId, userId } },
        },
      );
      if (error) throw error;
      return userId;
    },
    onSuccess: async (userId) => {
      const isMe = userId === meId;
      if (isMe) {
        // self leave: ws пропадёт из списка, переходим на главную, там
        // index.tsx сам выберет первый ws либо предложит создать.
        await qc.invalidateQueries({ queryKey: ["workspaces"] });
        navigate({ to: "/", search: { new: false } });
      } else {
        qc.invalidateQueries({ queryKey: ["workspaces", wsId, "members"] });
      }
    },
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Команда</h2>
        {isAdmin && (
          <Link
            to="/w/$wsId/settings/workspace/invite"
            params={{ wsId }}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
          >
            Пригласить
          </Link>
        )}
      </div>
      {isLoading && <p className="text-sm text-zinc-500">Загрузка…</p>}
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
        {members.map((m) => {
          const isMe = m.id === meId;
          const canEditRole = isAdmin && !isMe;
          const canRemove = isAdmin || isMe;
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {m.name ?? m.id}
                  {isMe && (
                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                      вы
                    </span>
                  )}
                </div>
                {m.username && (
                  <div className="truncate text-xs text-zinc-500">
                    @{m.username}
                  </div>
                )}
              </div>
              <select
                value={m.role}
                disabled={!canEditRole || changeRole.isPending}
                onChange={(e) =>
                  changeRole.mutate({
                    userId: m.id,
                    role: e.target.value as "admin" | "member",
                  })
                }
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
              >
                <option value="member">Участник</option>
                <option value="admin">Админ</option>
              </select>
              {canRemove && (
                <button
                  onClick={() => {
                    const msg = isMe
                      ? "Покинуть рабочее пространство?"
                      : `Удалить ${m.name ?? m.id} из команды?`;
                    if (!confirm(msg)) return;
                    removeMember.mutate(m.id);
                  }}
                  disabled={removeMember.isPending}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {isMe ? "Покинуть" : "Удалить"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(changeRole.error || removeMember.error) && (
        <p className="text-sm text-red-600">
          {errorMessage(changeRole.error ?? removeMember.error)}
        </p>
      )}
    </section>
  );
}

function PendingInvites({ wsId }: { wsId: string }) {
  const qc = useQueryClient();
  const invites = useQuery({
    queryKey: ["workspaces", wsId, "invites"],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/invites",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const revoke = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/invites/{inviteId}",
        { params: { path: { wsId, inviteId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workspaces", wsId, "invites"] }),
  });

  if (!invites.data || invites.data.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Ожидающие приглашения</h2>
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
        {invites.data.map((inv) => {
          const link = `${window.location.origin}/accept-invite/${wsId}/${inv.code}`;
          const expiresIn = relativeDays(new Date(inv.expiresAt));
          return (
            <li key={inv.id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    @{inv.telegramUsername}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {inv.role === "admin" ? "Админ" : "Участник"} ·{" "}
                    {expiresIn}
                  </div>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(link)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  title={link}
                >
                  Скопировать
                </button>
                <button
                  onClick={() => {
                    if (!confirm("Отозвать приглашение?")) return;
                    revoke.mutate(inv.id);
                  }}
                  disabled={revoke.isPending}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Отозвать
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {revoke.error && (
        <p className="text-sm text-red-600">{errorMessage(revoke.error)}</p>
      )}
    </section>
  );
}

function DangerZone({ wsId, wsName }: { wsId: string; wsName: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/v1/workspaces/{id}", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate({ to: "/", search: { new: false } });
    },
  });
  return (
    <section className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
      <h2 className="text-lg font-medium text-red-800">Опасная зона</h2>
      <p className="text-sm text-red-700">
        Удаление рабочего пространства каскадно сносит все контакты, кампании,
        TG-аккаунты и приглашения. Восстановить нельзя.
      </p>
      <button
        onClick={() => {
          const expected = wsName;
          const got = prompt(
            `Введите название «${expected}» для подтверждения удаления:`,
          );
          if (got !== expected) return;
          remove.mutate();
        }}
        disabled={remove.isPending}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        Удалить рабочее пространство
      </button>
      {remove.error && (
        <p className="text-sm text-red-700">{errorMessage(remove.error)}</p>
      )}
    </section>
  );
}

// Простая локализация «осталось N дней / часов / истёк». Хватит для UI без
// date-fns; expiresAt приходит ISO-строкой, считаем дельту в часах/днях.
function relativeDays(target: Date): string {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "истёк";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return `осталось ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `осталось ${days} дн`;
}
