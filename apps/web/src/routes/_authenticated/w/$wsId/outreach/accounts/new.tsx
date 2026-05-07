import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  TelegramAuthFlow,
  type TgAuthApi,
} from "../../../../../../components/telegram-auth-flow";
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
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [totalImported, setTotalImported] = useState(0);
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
        if (data!.imported > 0) setTotalImported((p) => p + data!.imported);
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

  const tgApi: TgAuthApi = {
    qrStreamUrl: `/v1/workspaces/${wsId}/outreach/accounts/auth/qr-stream`,
    sendCode: async (phoneNumber) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/send-code",
        { params: { path: { wsId } }, body: { phoneNumber } },
      );
      if (error) throw error;
      return data;
    },
    signIn: async (args) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in",
        { params: { path: { wsId } }, body: args },
      );
      if (error) throw error;
      return data;
    },
    signInPassword: async (password) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in-password",
        { params: { path: { wsId } }, body: { password } },
      );
      if (error) throw error;
      return data;
    },
  };

  const goToList = () =>
    navigate({ to: "/w/$wsId/outreach/accounts", params: { wsId } });
  const goToContacts = () =>
    navigate({ to: "/w/$wsId/contacts", params: { wsId } });

  if (!connectedId) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <div className="mx-auto max-w-xl">
          <div className="mb-4 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <div className="font-medium">После авторизации</div>
            <p className="mt-1 text-amber-900/80">
              Заведём контакты в CRM на всех, с кем у этого аккаунта есть
              личная переписка в Telegram. Это нужно, чтобы система понимала,
              кто из ваших аккаунтов с кем уже общался — при загрузке нового
              CSV знакомый блогер автоматически закрепится за тем же
              аккаунтом, что и раньше.
            </p>
          </div>
        </div>
        <TelegramAuthFlow
          api={tgApi}
          onComplete={(r) => {
            qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
            if (r.accountId) {
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
          <div className="font-medium">Импорт собеседников</div>
          {isImporting ? (
            <p className="text-sm text-zinc-600">
              Загружаем диалоги из Telegram… подгружено {replicaSize}{" "}
              собеседников.
            </p>
          ) : importError ? (
            <p className="text-sm text-red-600">{importError}</p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm text-emerald-700">
                Готово. В CRM {totalImported} контактов.
              </p>
              {replicaSize - totalImported > 0 && (
                <p className="text-xs text-zinc-500">
                  Ещё {replicaSize - totalImported} уже были в CRM от других
                  аккаунтов.
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={importError ? goToList : goToContacts}
              disabled={isImporting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isImporting
                ? "Подождите…"
                : importError
                  ? "К списку аккаунтов"
                  : "Посмотреть контакты"}
            </button>
            {!isImporting && !importError && (
              <button
                type="button"
                onClick={goToList}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                К аккаунтам
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
