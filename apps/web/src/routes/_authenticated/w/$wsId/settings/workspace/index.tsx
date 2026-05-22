import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK, WS_QK } from "../../../../../../lib/query-keys";
import { formatDateTime } from "../../../../../../lib/date-utils";

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
    queryKey: WS_QK.members(wsId),
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
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-8">
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
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // «В отпуске» = у member'а есть собственный outreach-аккаунт с активной
  // делегацией прямо сейчас. Считаем на клиенте из двух списков, чтобы не
  // плодить отдельный API. Подгружаем только для admin'а — member чужие
  // отпуска отслеживать не будет.
  const accountsQuery = useQuery({
    queryKey: OUTREACH_QK.accounts(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
    enabled: isAdmin,
  });
  const activeDelegationsQuery = useQuery({
    queryKey: ["delegations-ws", wsId, "active"],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/delegations",
        {
          params: { path: { wsId }, query: { active: "true" } },
        },
      );
      if (error) throw error;
      return data.items;
    },
    enabled: isAdmin,
  });
  const delegatedOwners = useMemo(() => {
    const accounts = accountsQuery.data ?? [];
    const delegations = activeDelegationsQuery.data ?? [];
    const ownerByAccount = new Map(accounts.map((a) => [a.id, a.ownerUserId]));
    const set = new Set<string>();
    for (const d of delegations) {
      const owner = ownerByAccount.get(d.accountId);
      if (owner) set.add(owner);
    }
    return set;
  }, [accountsQuery.data, activeDelegationsQuery.data]);

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
      qc.invalidateQueries({ queryKey: WS_QK.members(wsId) }),
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
        qc.invalidateQueries({ queryKey: WS_QK.members(wsId) });
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
          const canLeave = isMe;
          const canDismiss = isAdmin && !isMe;
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
                  {delegatedOwners.has(m.id) && (
                    <span
                      className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                      title="хотя бы один аккаунт сейчас делегирован другому участнику"
                    >
                      делегирован
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
              {canLeave && (
                <button
                  onClick={() => {
                    if (!confirm("Покинуть рабочее пространство?")) return;
                    removeMember.mutate(m.id);
                  }}
                  disabled={removeMember.isPending}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Покинуть
                </button>
              )}
              {canDismiss && (
                <button
                  onClick={() => setDismissingId(m.id)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Уволить
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
      {dismissingId && (
        <DismissModal
          wsId={wsId}
          targetUserId={dismissingId}
          members={members}
          onClose={() => setDismissingId(null)}
        />
      )}
    </section>
  );
}

// Мастер увольнения: одной транзакцией переводит все outreach-аккаунты на
// новых владельцев, отзывает делегации (входящие/исходящие), чистит
// projects.contactDefaultOwnerIds и удаляет из members. Pre-condition «все
// аккаунты должны иметь нового владельца» проверяет бэк; UI просто не
// даёт отправить пока есть пустой select.
function DismissModal({
  wsId,
  targetUserId,
  members,
  onClose,
}: {
  wsId: string;
  targetUserId: string;
  members: Member[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const target = members.find((m) => m.id === targetUserId);
  // useMemo обязателен: candidates попадает в deps useEffect ниже, без
  // мемо это свежий референс каждый рендер → setTransfers возвращает новый
  // объект → infinite loop.
  const candidates = useMemo(
    () => members.filter((m) => m.id !== targetUserId),
    [members, targetUserId],
  );

  const accountsQuery = useQuery({
    queryKey: OUTREACH_QK.accounts(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const ownedAccounts = useMemo(
    () =>
      (accountsQuery.data ?? []).filter((a) => a.ownerUserId === targetUserId),
    [accountsQuery.data, targetUserId],
  );

  // Делегации, которые сервер удалит при увольнении: активные + будущие,
  // где target — delegate. active=true показал бы ТОЛЬКО активные, а
  // сервер сносит и будущие — превью бы лгало. Берём всё и режем past
  // на клиенте.
  const inboundDelegationsQuery = useQuery({
    queryKey: ["delegations-ws", wsId, "delegate", targetUserId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/delegations",
        {
          params: {
            path: { wsId },
            query: { delegateId: targetUserId },
          },
        },
      );
      if (error) throw error;
      return data.items;
    },
  });

  // Per-account select нового владельца. Default — первый кандидат.
  const [transfers, setTransfers] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ownedAccounts.length || !candidates.length) return;
    setTransfers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const a of ownedAccounts) {
        if (!next[a.id]) {
          next[a.id] = candidates[0]!.id;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ownedAccounts, candidates]);

  const dismiss = useMutation({
    mutationFn: async () => {
      const payload = ownedAccounts.map((a) => ({
        accountId: a.id,
        newOwnerUserId: transfers[a.id]!,
      }));
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/members/{userId}/dismiss",
        {
          params: { path: { wsId, userId: targetUserId } },
          body: { transfers: payload },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: async () => {
      // Каскад: owner_user_id меняется → доступ к contacts/channels/sequences
      // через accountAccessClause переезжает; projects.contactDefaultOwnerIds
      // чистится; делегации (active/future inbound) удаляются. Инвалидируем
      // префиксами, чтобы накрыть все странички этих доменов.
      await Promise.all([
        qc.invalidateQueries({ queryKey: WS_QK.members(wsId) }),
        qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) }),
        qc.invalidateQueries({ queryKey: ["contacts", wsId] }),
        qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) }),
        qc.invalidateQueries({ queryKey: ["channels", wsId] }),
        qc.invalidateQueries({ queryKey: ["delegations", wsId] }),
        qc.invalidateQueries({ queryKey: ["delegations-ws", wsId] }),
      ]);
      onClose();
    },
  });

  const targetLabel = target?.name ?? target?.username ?? targetUserId;
  const noCandidates = candidates.length === 0;
  const allChosen = ownedAccounts.every((a) => !!transfers[a.id]);
  // Сервер при увольнении сносит все строки delegations с delegate_id=target,
  // у которых ends_at IS NULL OR ends_at > now() (active + future).
  // Превью считает то же самое, чтобы число не расходилось с реальностью.
  const inboundToRevoke = useMemo(() => {
    const now = Date.now();
    return (inboundDelegationsQuery.data ?? []).filter((d) => {
      if (d.endsAt === null) return true;
      return new Date(d.endsAt).getTime() > now;
    });
  }, [inboundDelegationsQuery.data]);
  const inboundCount = inboundToRevoke.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">
            Уволить {targetLabel}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            Аккаунты сотрудника перейдут к другим членам команды, активные
            делегации будут отозваны, доступ в воркспейс закроется. Действие
            необратимо.
          </p>
        </div>

        {accountsQuery.isLoading && <p className="text-sm">Загрузка…</p>}

        {!accountsQuery.isLoading && ownedAccounts.length === 0 && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
            У сотрудника нет outreach-аккаунтов. Можно сразу увольнять.
          </p>
        )}

        {ownedAccounts.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Передать аккаунты ({ownedAccounts.length})
            </div>
            {noCandidates && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Некому передать — кроме увольняемого в команде нет других
                участников. Пригласите кого-то прежде чем увольнять.
              </p>
            )}
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
              {ownedAccounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {a.firstName ||
                        (a.tgUsername ? `@${a.tgUsername}` : a.tgUserId)}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {a.phoneNumber ?? a.tgUsername ?? a.tgUserId}
                    </div>
                  </div>
                  <select
                    value={transfers[a.id] ?? ""}
                    onChange={(e) =>
                      setTransfers((p) => ({ ...p, [a.id]: e.target.value }))
                    }
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
                  >
                    {candidates.length === 0 && (
                      <option value="">Нет кандидатов</option>
                    )}
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.id}
                        {c.username ? ` (@${c.username})` : ""}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}

        {inboundCount > 0 && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            Будет отозвано делегаций (где сотрудник — делегат):{" "}
            <span className="font-medium">{inboundCount}</span>.
            <ul className="mt-1 space-y-0.5">
              {inboundToRevoke.map((d) => (
                <li
                  key={`${d.accountId}-${d.startsAt}`}
                  className="truncate text-zinc-600"
                >
                  {formatDateTime(d.startsAt)} →{" "}
                  {d.endsAt ? formatDateTime(d.endsAt) : "бессрочно"}
                  {d.reason ? ` · ${d.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dismiss.error && (
          <p className="text-sm text-red-600">{errorMessage(dismiss.error)}</p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => dismiss.mutate()}
            disabled={
              dismiss.isPending ||
              accountsQuery.isLoading ||
              (ownedAccounts.length > 0 && (noCandidates || !allChosen))
            }
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {dismiss.isPending ? "Увольняем…" : "Уволить"}
          </button>
        </div>
      </div>
    </div>
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
