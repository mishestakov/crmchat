import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK, WS_QK } from "../../../../../../lib/query-keys";
import { useMyRole } from "../../../../../../lib/hooks";
import { formatDateTime } from "../../../../../../lib/date-utils";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/accounts/$accountId",
)({
  component: AccountDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  banned: "Banned",
  frozen: "Frozen",
  unauthorized: "Unauthorized",
  offline: "Offline",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-700",
  banned: "text-red-700",
  frozen: "text-amber-700",
  unauthorized: "text-zinc-500",
  offline: "text-zinc-400",
};

function AccountDetailPage() {
  const { wsId, accountId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const account = useQuery({
    queryKey: ["outreach-account", wsId, accountId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [dailyLimit, setDailyLimit] = useState<number>(0);

  // Hydrate local input из server-data при загрузке/refetch.
  useEffect(() => {
    if (account.data) setDailyLimit(account.data.newLeadsDailyLimit);
  }, [account.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        {
          params: { path: { wsId, accountId } },
          body: { newLeadsDailyLimit: dailyLimit },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outreach-account", wsId, accountId] });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
      navigate({ to: "/w/$wsId/outreach/accounts", params: { wsId } });
    },
  });

  if (account.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (account.error || !account.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">
          {account.error ? errorMessage(account.error) : "Аккаунт не найден"}
        </p>
      </div>
    );
  }

  const acc = account.data;
  const isUnauthorized = acc.status === "unauthorized";
  const dirty = dailyLimit !== acc.newLeadsDailyLimit;
  const cooldownMs = acc.cooldownUntil
    ? new Date(acc.cooldownUntil).getTime()
    : null;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold">
              {acc.firstName || acc.tgUsername || "Без имени"}
            </h1>
            {acc.hasPremium && (
              <Star size={16} className="fill-amber-400 text-amber-400" />
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {acc.phoneNumber ?? "—"}
            {acc.phoneNumber && acc.tgUsername ? " · " : ""}
            {acc.tgUsername ? `@${acc.tgUsername}` : ""}
          </p>
        </div>

        <div className="rounded-2xl bg-white shadow-sm">
          <Row label="Статус">
            <span className={STATUS_COLOR[acc.status] ?? "text-zinc-700"}>
              {STATUS_LABEL[acc.status] ?? acc.status}
            </span>
          </Row>
          {isUnauthorized && (
            <div className="border-t border-zinc-100 px-5 py-3 text-xs text-amber-700">
              Сессия не активна — воркер не сможет с этого аккаунта отправлять.
              Подключите заново через «Добавить» в списке аккаунтов
              (если зайдёте под тем же TG-юзером — запись обновится).
            </div>
          )}
          {cooldownMs !== null && cooldownMs > Date.now() && (
            <CooldownBanner
              untilMs={cooldownMs}
              reason={acc.cooldownReason}
              onExpire={() =>
                qc.invalidateQueries({
                  queryKey: ["outreach-account", wsId, accountId],
                })
              }
            />
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Дневной лимит лидов
            </span>
            <span className="mb-2 block text-xs text-zinc-500">
              Сколько новых сообщений в сутки максимум уйдёт с этого аккаунта.
              Сбрасывается в полночь по часовому поясу workspace. Безопасный
              дефолт для не-Premium без warmup'а — 30. С Premium можно крутить
              выше.
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.max(0, Number(e.target.value) || 0))}
              className="w-32 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          {save.error && (
            <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
          )}
          {dirty && (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </button>
          )}
        </div>

        <DelegationsSection wsId={wsId} accountId={accountId} ownerUserId={acc.ownerUserId} />

        <div className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-500 space-y-2">
          <div className="font-medium text-zinc-700">Скоро</div>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Прогрев аккаунта (warmup)</li>
            <li>Прокси</li>
            <li>Автосоздание лидов из входящих сообщений</li>
          </ul>
        </div>

        {remove.error && (
          <p className="text-sm text-red-600">{errorMessage(remove.error)}</p>
        )}
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Выйти из аккаунта ${
                  acc.firstName || acc.tgUsername || acc.phoneNumber || ""
                }? Сессия будет разлогинена в Telegram.`,
              )
            ) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
          className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

// Делегации — временная передача аккаунта на отпуск/больничный. View — для
// всех у кого есть доступ к аккаунту (admin или owner/активный delegate).
// CRUD — admin-only.
function DelegationsSection({
  wsId,
  accountId,
  ownerUserId,
}: {
  wsId: string;
  accountId: string;
  ownerUserId: string;
}) {
  const qc = useQueryClient();
  const myRole = useMyRole(wsId);
  const isAdmin = myRole === "admin";
  const [adding, setAdding] = useState(false);

  const delegationsQuery = useQuery({
    queryKey: ["delegations", wsId, accountId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
      return data.items;
    },
  });

  const cancel = useMutation({
    mutationFn: async (vars: { delegateId: string; startsAt: string }) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations/{delegateId}",
        {
          params: {
            path: { wsId, accountId, delegateId: vars.delegateId },
            query: { startsAt: vars.startsAt },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["delegations", wsId, accountId] }),
  });

  const items = delegationsQuery.data ?? [];
  const now = Date.now();
  const active = items.filter((d) => {
    const s = new Date(d.startsAt).getTime();
    const e = d.endsAt ? new Date(d.endsAt).getTime() : Infinity;
    return s <= now && now < e;
  });
  const upcoming = items.filter((d) => new Date(d.startsAt).getTime() > now);
  const past = items.filter((d) => {
    const e = d.endsAt ? new Date(d.endsAt).getTime() : Infinity;
    return e <= now;
  });

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-sm">Делегации</div>
          <p className="mt-1 text-xs text-zinc-500">
            Временно передать доступ к аккаунту коллеге — отпуск, больничный.
            Владелец остаётся прежним; делегат видит чаты и ведёт переписку,
            пока активно окно дат.
          </p>
        </div>
        {isAdmin && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Добавить
          </button>
        )}
      </div>

      {adding && isAdmin && (
        <AddDelegationForm
          wsId={wsId}
          accountId={accountId}
          ownerUserId={ownerUserId}
          onClose={() => setAdding(false)}
          onSuccess={() => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: ["delegations", wsId, accountId] });
          }}
        />
      )}

      {delegationsQuery.isLoading && (
        <p className="text-xs text-zinc-500">Загрузка…</p>
      )}
      {delegationsQuery.error && (
        <p className="text-xs text-red-600">
          {errorMessage(delegationsQuery.error)}
        </p>
      )}
      {!delegationsQuery.isLoading && items.length === 0 && !adding && (
        <p className="text-xs text-zinc-500">Активных делегаций нет.</p>
      )}

      {(active.length > 0 || upcoming.length > 0 || past.length > 0) && (
        <div className="space-y-3">
          {active.length > 0 && (
            <DelegationGroup
              title="Сейчас"
              items={active}
              tone="active"
              isAdmin={isAdmin}
              onCancel={(d) =>
                cancel.mutate({ delegateId: d.delegateId, startsAt: d.startsAt })
              }
              cancelPending={cancel.isPending}
            />
          )}
          {upcoming.length > 0 && (
            <DelegationGroup
              title="Будущие"
              items={upcoming}
              tone="upcoming"
              isAdmin={isAdmin}
              onCancel={(d) =>
                cancel.mutate({ delegateId: d.delegateId, startsAt: d.startsAt })
              }
              cancelPending={cancel.isPending}
            />
          )}
          {past.length > 0 && (
            <DelegationGroup
              title="Прошлые"
              items={past}
              tone="past"
              isAdmin={isAdmin}
              onCancel={() => {}}
              cancelPending={false}
            />
          )}
        </div>
      )}

      {cancel.error && (
        <p className="text-xs text-red-600">{errorMessage(cancel.error)}</p>
      )}
    </div>
  );
}

type Delegation = {
  accountId: string;
  delegateId: string;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  delegate: {
    id: string;
    name: string | null;
    username: string | null;
  } | null;
};

function DelegationGroup({
  title,
  items,
  tone,
  isAdmin,
  onCancel,
  cancelPending,
}: {
  title: string;
  items: Delegation[];
  tone: "active" | "upcoming" | "past";
  isAdmin: boolean;
  onCancel: (d: Delegation) => void;
  cancelPending: boolean;
}) {
  const toneClass =
    tone === "active"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "upcoming"
        ? "border-sky-200 bg-sky-50"
        : "border-zinc-200 bg-zinc-50 text-zinc-500";
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-zinc-600">{title}</div>
      <ul className={`divide-y rounded-lg border ${toneClass}`}>
        {items.map((d) => {
          const name =
            d.delegate?.name ?? (d.delegate?.username ? `@${d.delegate.username}` : d.delegateId);
          return (
            <li
              key={`${d.delegateId}-${d.startsAt}`}
              className="flex items-start gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-900">{name}</div>
                <div className="mt-0.5 text-zinc-600">
                  {formatDateTime(d.startsAt)} —{" "}
                  {d.endsAt ? formatDateTime(d.endsAt) : "бессрочно"}
                </div>
                {d.reason && (
                  <div className="mt-0.5 text-zinc-500">«{d.reason}»</div>
                )}
              </div>
              {isAdmin && tone !== "past" && (
                <button
                  type="button"
                  onClick={() => {
                    const msg =
                      tone === "active"
                        ? "Завершить делегацию прямо сейчас?"
                        : "Отменить будущую делегацию?";
                    if (!confirm(msg)) return;
                    onCancel(d);
                  }}
                  disabled={cancelPending}
                  className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {tone === "active" ? "Завершить" : "Отменить"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddDelegationForm({
  wsId,
  accountId,
  ownerUserId,
  onClose,
  onSuccess,
}: {
  wsId: string;
  accountId: string;
  ownerUserId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: WS_QK.members(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{id}/members", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  // Кандидаты — все members кроме текущего owner'а (ему делегировать его же
  // аккаунт бессмысленно, бэк вернёт 400).
  const candidates = (members.data ?? []).filter((m) => m.id !== ownerUserId);

  const [delegateId, setDelegateId] = useState("");
  const [startsAt, setStartsAt] = useState(""); // datetime-local, "" = now()
  const [endsAt, setEndsAt] = useState("");
  const [openEnded, setOpenEnded] = useState(false);
  const [reason, setReason] = useState("");

  // Hydrate delegate'ом по умолчанию после загрузки members.
  useEffect(() => {
    if (!delegateId && candidates.length > 0) setDelegateId(candidates[0]!.id);
  }, [candidates, delegateId]);

  const create = useMutation({
    mutationFn: async () => {
      const body: {
        delegateId: string;
        startsAt?: string;
        endsAt?: string | null;
        reason?: string;
      } = { delegateId };
      if (startsAt) body.startsAt = new Date(startsAt).toISOString();
      if (openEnded) body.endsAt = null;
      else if (endsAt) body.endsAt = new Date(endsAt).toISOString();
      const trimmed = reason.trim();
      if (trimmed) body.reason = trimmed;
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations",
        {
          params: { path: { wsId, accountId } },
          body,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delegations", wsId, accountId] });
      onSuccess();
    },
  });

  // Конец делегации обязателен — либо дата, либо явный чекбокс «бессрочно».
  // Иначе «оставить пустым = бессрочно» — silent surprise.
  const submittable = delegateId && (openEnded || endsAt);

  return (
    <form
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!submittable) return;
        create.mutate();
      }}
    >
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-zinc-700">Делегат</span>
        <select
          value={delegateId}
          onChange={(e) => setDelegateId(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5"
        >
          {candidates.length === 0 && <option value="">Нет кандидатов</option>}
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.id}
              {m.username ? ` (@${m.username})` : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">От</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5"
            placeholder="сейчас"
          />
          <span className="mt-0.5 block text-zinc-500">
            пусто = сейчас
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">До</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => {
              setEndsAt(e.target.value);
              if (e.target.value) setOpenEnded(false);
            }}
            disabled={openEnded}
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 disabled:bg-zinc-100 disabled:text-zinc-400"
          />
          <label className="mt-0.5 flex items-center gap-1 text-zinc-500">
            <input
              type="checkbox"
              checked={openEnded}
              onChange={(e) => {
                setOpenEnded(e.target.checked);
                if (e.target.checked) setEndsAt("");
              }}
              className="h-3 w-3"
            />
            бессрочно
          </label>
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-zinc-700">
          Причина (необязательно)
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="отпуск, больничный, …"
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5"
        />
      </label>
      {create.error && (
        <p className="text-xs text-red-600">{errorMessage(create.error)}</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!submittable || create.isPending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {create.isPending ? "Создаём…" : "Создать"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

// Плашка «аккаунт молчит до HH:MM:SS» с тикающим countdown'ом. Когда
// время вышло — инвалидирует query, бэк за тик worker'а уже почистит
// cooldown поля, при следующем рендере плашка исчезнет.
function CooldownBanner(props: {
  untilMs: number;
  reason: string | null;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, props.untilMs - now);
  useEffect(() => {
    if (remaining === 0) props.onExpire();
  }, [remaining, props]);
  if (remaining === 0) return null;
  const sec = Math.ceil(remaining / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const until = new Date(props.untilMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="border-t border-zinc-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">
      <div className="font-medium">
        Аккаунт молчит до {until} (ещё{" "}
        {mm > 0 ? `${mm} мин ` : ""}
        {ss} сек)
      </div>
      <div className="mt-0.5 text-amber-700">
        Причина: {props.reason ?? "Telegram FloodWait"}. Авто-цепочки
        приостановлены; ручной quick send тоже будет отклонён до окончания
        cooldown'а.
      </div>
    </div>
  );
}
