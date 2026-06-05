import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  TelegramAuthFlow,
  TelegramLogo,
  type TgAuthApi,
} from "../../../../../../components/telegram-auth-flow";
import { MaxLogo } from "../../../../../../lib/platforms";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/accounts/new",
)({
  component: NewOutreachAccountPage,
});

function NewOutreachAccountPage() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<"telegram" | "max" | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [replicaSize, setReplicaSize] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Реплика чат-листа на свежем аккаунте догружается асинхронно (loadChats
  // батчами). Импорт идемпотентный, гонимся в polling-цикле каждые 1.5с —
  // юзер видит как растёт счётчик. Стоп — когда replicaSize не меняется
  // три тика подряд (≈4.5с стабильности): значит TDLib догрузил всё.
  // По imported стопать нельзя: при онконфликтах он = 0, а реплика ещё растёт.
  useEffect(() => {
    if (!connectedId) return;
    let cancelled = false;
    let prevReplicaSize = -1;
    let stableTicks = 0;
    setIsImporting(true);

    const tick = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await api.POST(
          "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/import-contacts",
          { params: { path: { wsId, accountId: connectedId } } },
        );
        if (cancelled) return;
        if (error) throw error;
        setReplicaSize(data!.replicaSize);
        if (data!.replicaSize === prevReplicaSize) {
          stableTicks++;
        } else {
          stableTicks = 0;
          prevReplicaSize = data!.replicaSize;
        }
        if (stableTicks >= 3) {
          setIsImporting(false);
          qc.invalidateQueries({ queryKey: ["contacts", wsId] });
        } else {
          setTimeout(tick, 1500);
        }
      } catch (e) {
        if (cancelled) return;
        setImportError(errorMessage(e));
        setIsImporting(false);
      }
    };
    void tick();

    return () => {
      cancelled = true;
    };
  }, [connectedId, qc, wsId]);

  const p = platform ?? "telegram";
  const authApi: TgAuthApi = {
    qrStreamUrl: `/v1/workspaces/${wsId}/outreach/accounts/auth/qr-stream`,
    sendCode: async (phoneNumber) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/send-code",
        { params: { path: { wsId } }, body: { phoneNumber, platform: p } },
      );
      if (error) throw error;
      return data;
    },
    signIn: async (args) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in",
        { params: { path: { wsId } }, body: { ...args, platform: p } },
      );
      if (error) throw error;
      return data;
    },
    signInPassword: async (password) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in-password",
        { params: { path: { wsId } }, body: { password, platform: p } },
      );
      if (error) throw error;
      return data;
    },
  };

  const goToList = () =>
    navigate({ to: "/w/$wsId/outreach/accounts", params: { wsId } });

  // Шаг 0: выбор мессенджера. Дальше — общий phone/SMS-флоу (TgAuthApi),
  // различается только брендингом и пост-обработкой (реплика чатов — TG-only).
  if (!connectedId && !platform) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <div className="mx-auto max-w-md space-y-3">
          <h1 className="text-lg font-semibold">Подключить аккаунт</h1>
          <button
            type="button"
            onClick={() => setPlatform("telegram")}
            className="flex w-full items-center gap-3 rounded-xl bg-white px-5 py-4 text-left shadow-sm hover:bg-zinc-50"
          >
            <TelegramLogo size={40} />
            <div>
              <div className="font-medium">Telegram</div>
              <div className="text-sm text-zinc-500">Рассылка, каналы, чаты</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setPlatform("max")}
            className="flex w-full items-center gap-3 rounded-xl bg-white px-5 py-4 text-left shadow-sm hover:bg-zinc-50"
          >
            <MaxLogo size={40} />
            <div>
              <div className="font-medium">MAX</div>
              <div className="text-sm text-zinc-500">Каналы и статистика, ЛС</div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (!connectedId && platform) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <button
          type="button"
          onClick={() => setPlatform(null)}
          className="mx-auto block text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← выбрать другой мессенджер
        </button>
        {/* Реплика чат-листа — только Telegram (tg_chats). */}
        {platform === "telegram" && (
          <div className="mx-auto max-w-xl">
            <div className="mb-4 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <div className="font-medium">После авторизации</div>
              <p className="mt-1 text-amber-900/80">
                Загрузим чат-лист аккаунта локально (на сервере), чтобы система
                понимала, кто из ваших аккаунтов с кем уже общался — тогда при
                импорте каналов/лидов знакомый блогер сам закрепится за нужным
                аккаунтом. Личные переписки в общий список контактов не попадают.
              </p>
            </div>
          </div>
        )}
        <TelegramAuthFlow
          api={authApi}
          platform={platform}
          onComplete={(r) => {
            qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
            // Реплику догружаем только для TG; MAX сразу в список.
            if (platform === "telegram" && r.accountId) {
              setConnectedId(r.accountId);
            } else {
              goToList();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-900">
          Аккаунт подключён
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <div className="font-medium">Загрузка диалогов аккаунта</div>
          {isImporting ? (
            <p className="text-sm text-zinc-600">
              Загружаем чат-лист из Telegram… {replicaSize} диалогов.
            </p>
          ) : importError ? (
            <p className="text-sm text-red-600">{importError}</p>
          ) : (
            <p className="text-sm text-emerald-700">
              Готово — загружено {replicaSize} диалогов. Личные переписки в общий
              список не попадают; контакты появятся при привязке админов и
              импорте каналов.
            </p>
          )}
          <button
            type="button"
            onClick={goToList}
            disabled={isImporting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isImporting ? "Подождите…" : "Готово"}
          </button>
        </div>
      </div>
    </div>
  );
}
