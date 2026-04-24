import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Send } from "lucide-react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// Auth-флоу импорта Telegram-папок (по донор-структуре). State-машина:
//   initial → (scan-qr | enter-phone → enter-code) → [enter-password] → complete
// После complete → SyncSettings: список папок + toggle/sync.

const POLL_MS = 2000;
const QK = {
  status: ["telegram-status"] as const,
  qr: ["telegram-qr"] as const,
  folders: ["telegram-folders"] as const,
  configs: ["telegram-sync-configs"] as const,
};

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/settings/telegram-sync",
)({
  component: TelegramSyncPage,
});

type AuthState =
  | { step: "initial" }
  | { step: "scan-qr" }
  | { step: "enter-phone"; phoneNumber: string }
  | {
      step: "enter-code";
      phoneNumber: string;
      phoneCodeHash: string;
      isCodeViaApp: boolean;
      phoneCode: string;
    }
  | { step: "enter-password"; password: string };

function TelegramSyncPage() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: QK.status,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/telegram/status");
      if (error) throw error;
      return data;
    },
  });

  if (status.isLoading) {
    return <CenteredLoading />;
  }
  if (status.error) {
    return (
      <CenteredError message={errorMessage(status.error)} />
    );
  }
  if (status.data?.status === "authorized") {
    return <SyncSettings user={status.data.user} />;
  }

  return (
    <AuthFlow
      onComplete={() => qc.invalidateQueries({ queryKey: QK.status })}
    />
  );
}

function AuthFlow(props: { onComplete: () => void }) {
  // QR — дефолтная точка входа (донорский UX). Phone — fallback по ссылке.
  const [state, setState] = useState<AuthState>({ step: "scan-qr" });

  return (
    <div className="mx-auto max-w-md p-6">
      {state.step === "initial" && <InitialStep setState={setState} />}
      {state.step === "scan-qr" && (
        <ScanQrStep setState={setState} onComplete={props.onComplete} />
      )}
      {state.step === "enter-phone" && (
        <PhoneStep state={state} setState={setState} />
      )}
      {state.step === "enter-code" && (
        <CodeStep
          state={state}
          setState={setState}
          onComplete={props.onComplete}
        />
      )}
      {state.step === "enter-password" && (
        <PasswordStep
          state={state}
          setState={setState}
          onComplete={props.onComplete}
        />
      )}
    </div>
  );
}

function InitialStep(props: {
  setState: (s: AuthState) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
          <TelegramLogo size={80} />
          <h1 className="text-xl font-semibold">Импорт из Telegram</h1>
          <p className="text-sm text-zinc-600">
            Подключите Telegram, чтобы автоматически создавать контакты из ваших
            папок чатов.
          </p>
          <button
            type="button"
            onClick={() => props.setState({ step: "scan-qr" })}
            className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Войти в Telegram
          </button>
        </div>
      </Card>
      <PrivacySection />
    </div>
  );
}

function PrivacySection() {
  return (
    <Card>
      <div className="space-y-3 px-6 py-5 text-sm">
        <div className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck size={20} className="text-emerald-600" />
          <span>Безопасность</span>
        </div>
        <ol className="ml-5 list-decimal space-y-2 text-zinc-700">
          <li>
            <strong>Мы не пишем в чаты.</strong> Только читаем список и
            метаданные.
          </li>
          <li>
            <strong>Личные сообщения не передаются.</strong> CRM хранит лишь
            имя, username и telegram-id контакта.
          </li>
          <li>
            <strong>Сессия только у вас.</strong> Logout в один клик, после чего
            токен удаляется из БД.
          </li>
        </ol>
      </div>
    </Card>
  );
}

function ScanQrStep(props: {
  setState: (s: AuthState) => void;
  onComplete: () => void;
}) {
  // Поллим раз в 2 сек: бэк дёргает Api.auth.ExportLoginToken, возвращает свежий
  // token (если ещё не сканировано) или success/password_needed.
  const qr = useQuery({
    queryKey: QK.qr,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/telegram/qr/state");
      if (error) throw error;
      return data;
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    // Свежий кэш на каждый mount — иначе stale `password_needed` от прошлой
    // сессии моментально переключит state до первого полла.
    gcTime: 0,
  });

  useEffect(() => {
    if (qr.data?.status === "success") props.onComplete();
    if (qr.data?.status === "password_needed") {
      props.setState({ step: "enter-password", password: "" });
    }
  }, [qr.data?.status, props]);

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Войти в Telegram</h1>

        <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-zinc-200 bg-white">
          {qr.data?.status === "scan-qr-code" ? (
            <QrImage token={qr.data.token} />
          ) : (
            <div className="text-sm text-zinc-400">Загрузка QR…</div>
          )}
        </div>

        <ol className="ml-5 list-decimal self-start space-y-1 text-sm text-zinc-700">
          <li>Откройте Telegram на телефоне</li>
          <li>Зайдите в «Настройки» → «Устройства»</li>
          <li>Нажмите «Подключить устройство» и отсканируйте QR</li>
        </ol>

        <div className="my-2 flex w-full items-center gap-2 text-xs text-zinc-400">
          <hr className="flex-1 border-zinc-200" />
          <span>или</span>
          <hr className="flex-1 border-zinc-200" />
        </div>

        <button
          type="button"
          onClick={() => props.setState({ step: "enter-phone", phoneNumber: "" })}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          Войти по номеру телефона
        </button>
      </div>
    </Card>
  );
}

// Telegram-deep-link для QR: tg://login?token={base64url(token)}.
// QR-генератор без либы — используем quickchart-like canvas сложно; делаем простую
// картинку через api.qrserver.com (внешний сервис, для MVP нормально).
// TODO: вынести в pure-js QR-кодер если хочется без external dep.
function QrImage({ token }: { token: string }) {
  const tgUrl = `tg://login?token=${token}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(tgUrl)}`;
  return <img src={qrSrc} alt="Telegram QR" className="h-56 w-56" />;
}

function PhoneStep(props: {
  state: Extract<AuthState, { step: "enter-phone" }>;
  setState: (s: AuthState) => void;
}) {
  const [phone, setPhone] = useState(props.state.phoneNumber);
  const send = useMutation({
    mutationFn: async () => {
      const phoneNumber = phone.replace(/[^\d+]/g, "");
      const { data, error } = await api.POST(
        "/v1/telegram/auth/send-code",
        { body: { phoneNumber } },
      );
      if (error) throw error;
      return { ...data, phoneNumber };
    },
    onSuccess: (d) =>
      props.setState({
        step: "enter-code",
        phoneNumber: d.phoneNumber,
        phoneCodeHash: d.phoneCodeHash,
        isCodeViaApp: d.isCodeViaApp,
        phoneCode: "",
      }),
  });

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Введите номер</h1>
        <input
          autoFocus
          type="tel"
          placeholder="+7 999 123 45 67"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-center text-base focus:border-emerald-500 focus:outline-none"
        />
        {send.error && (
          <p className="text-sm text-red-600">{errorMessage(send.error)}</p>
        )}
        <button
          type="button"
          disabled={!phone || send.isPending}
          onClick={() => send.mutate()}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {send.isPending ? "Отправка…" : "Получить код"}
        </button>
        <button
          type="button"
          onClick={() => props.setState({ step: "scan-qr" })}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Войти по QR
        </button>
      </div>
    </Card>
  );
}

function CodeStep(props: {
  state: Extract<AuthState, { step: "enter-code" }>;
  setState: (s: AuthState) => void;
  onComplete: () => void;
}) {
  const [code, setCode] = useState(props.state.phoneCode);
  const [error, setError] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: async (phoneCode: string) => {
      const { data, error } = await api.POST("/v1/telegram/auth/sign-in", {
        body: {
          phoneNumber: props.state.phoneNumber,
          phoneCodeHash: props.state.phoneCodeHash,
          phoneCode,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      if (d.status === "sign_in_complete") props.onComplete();
      else if (d.status === "password_needed")
        props.setState({ step: "enter-password", password: "" });
      else if (d.status === "phone_code_invalid")
        setError("Неверный код, попробуйте ещё раз");
      else if (d.status === "user_not_found")
        setError("Пользователь не найден. Зарегистрируйтесь в Telegram сначала");
    },
  });

  const submit = () => {
    if (code.length >= 5) signIn.mutate(code);
  };

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Введите код</h1>
        <p className="text-center text-sm text-zinc-600">
          {props.state.isCodeViaApp
            ? "Откройте Telegram и проверьте сообщение от Telegram"
            : `Код отправлен SMS на ${props.state.phoneNumber}`}
        </p>
        <input
          autoFocus
          inputMode="numeric"
          maxLength={6}
          placeholder="12345"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-center font-mono text-2xl tracking-widest focus:border-emerald-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {signIn.error && (
          <p className="text-sm text-red-600">{errorMessage(signIn.error)}</p>
        )}
        <button
          type="button"
          disabled={code.length < 5 || signIn.isPending}
          onClick={submit}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {signIn.isPending ? "Проверка…" : "Войти"}
        </button>
        <button
          type="button"
          onClick={() =>
            props.setState({
              step: "enter-phone",
              phoneNumber: props.state.phoneNumber,
            })
          }
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Изменить номер
        </button>
      </div>
    </Card>
  );
}

function PasswordStep(props: {
  state: Extract<AuthState, { step: "enter-password" }>;
  setState: (s: AuthState) => void;
  onComplete: () => void;
}) {
  const [password, setPassword] = useState(props.state.password);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/telegram/auth/sign-in-password",
        { body: { password } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      if (d.status === "sign_in_complete") props.onComplete();
      else if (d.status === "password_invalid")
        setError("Неверный пароль");
    },
  });

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Двухфакторный пароль</h1>
        <p className="text-center text-sm text-zinc-600">
          У вашего аккаунта включён cloud-password.
        </p>
        <input
          autoFocus
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && password) submit.mutate();
          }}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-center text-base focus:border-emerald-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {submit.error && (
          <p className="text-sm text-red-600">{errorMessage(submit.error)}</p>
        )}
        <button
          type="button"
          disabled={!password || submit.isPending}
          onClick={() => submit.mutate()}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submit.isPending ? "Проверка…" : "Войти"}
        </button>
      </div>
    </Card>
  );
}

function SyncSettings(props: {
  user: {
    tgUserId: string;
    tgUsername: string | null;
    firstName: string | null;
    phoneNumber: string | null;
  };
}) {
  const qc = useQueryClient();
  const folders = useQuery({
    queryKey: QK.folders,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/telegram/folders");
      if (error) throw error;
      return data;
    },
  });
  // Configs обновляются после toggle + по polling если есть pending sync (без
  // lastSyncAt) — чтобы юзер увидел момент завершения первичной синхронизации.
  const configs = useQuery({
    queryKey: QK.configs,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/telegram/sync-configs");
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.lastSyncAt === null) ? POLL_MS : false,
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
  });

  const [pickerFolder, setPickerFolder] = useState<{
    id: number;
    title: string;
  } | null>(null);

  // Если sync импортировал контакты — kanban / список / контакт-карточки
  // должны это увидеть. Сбрасываем все contacts-каше workspace'а.
  const invalidateContacts = (workspaceId: string) => {
    qc.invalidateQueries({ queryKey: ["contacts", workspaceId] });
    qc.invalidateQueries({ queryKey: QK.configs });
  };

  const enableSync = useMutation({
    mutationFn: async (args: {
      folderId: number;
      folderTitle: string;
      workspaceId: string;
    }) => {
      const { error } = await api.POST("/v1/telegram/sync-configs", {
        body: args,
      });
      if (error) throw error;
      return args.workspaceId;
    },
    onSuccess: (wsId) => {
      invalidateContacts(wsId);
      setPickerFolder(null);
    },
  });

  const disableSync = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE(
        "/v1/telegram/sync-configs/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: QK.configs }),
  });

  const triggerSync = useMutation({
    mutationFn: async (args: { id: string; workspaceId: string }) => {
      const { error } = await api.POST(
        "/v1/telegram/sync-configs/{id}/sync",
        { params: { path: { id: args.id } } },
      );
      if (error) throw error;
      return args.workspaceId;
    },
    onSuccess: (wsId) => invalidateContacts(wsId),
  });

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/v1/telegram/sign-out");
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: QK.status }),
  });

  // folder.id → config (если sync включён)
  const configByFolder = new Map(
    (configs.data ?? []).map((c) => [c.folderId, c]),
  );
  const wsById = new Map((workspaces.data ?? []).map((w) => [w.id, w]));

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <Card>
        <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">
          <TelegramLogo size={48} />
          <h1 className="text-lg font-semibold">
            {props.user.firstName || props.user.tgUsername || "Telegram"}
          </h1>
          {props.user.tgUsername && (
            <p className="text-sm text-zinc-500">@{props.user.tgUsername}</p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Личный аккаунт CRM — для импорта существующих чатов и работы из
            интерфейса. Для холодных рассылок заводите отдельные аккаунты в
            «Рассылках».
          </p>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4">
          <div className="mb-3 text-sm font-semibold">Папки для импорта</div>
          {folders.isLoading && (
            <p className="text-sm text-zinc-500">Загрузка папок…</p>
          )}
          {folders.error && (
            <p className="text-sm text-red-600">
              {errorMessage(folders.error)}
            </p>
          )}
          {folders.data && folders.data.length === 0 && (
            <p className="text-sm text-zinc-500">
              В Telegram нет настроенных папок. Создайте папку в Telegram и
              обновите страницу.
            </p>
          )}
          <ul className="divide-y divide-zinc-100">
            {folders.data?.map((f) => {
              const config = configByFolder.get(f.id);
              const ws = config && wsById.get(config.workspaceId);
              const isSyncing = !!config && config.lastSyncAt === null;
              return (
                <li key={f.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div
                      className={
                        "text-sm " +
                        (f.supported ? "text-zinc-900" : "text-zinc-400")
                      }
                    >
                      {f.title}
                      {!f.supported && (
                        <span
                          className="ml-2 text-xs text-zinc-400"
                          title="Папка с авто-правилами (Personal, Контакты и т.п.) импортирует слишком много случайных чатов. Создайте папку с конкретными чатами вручную."
                        >
                          (динамическая)
                        </span>
                      )}
                    </div>
                    {ws && (
                      <div className="mt-0.5 text-xs text-zinc-500">
                        → {ws.name}
                        {isSyncing && " · синхронизация…"}
                        {config?.lastSyncAt && !isSyncing && (
                          <>
                            {" · "}
                            {typeof config.lastSyncImported === "number"
                              ? config.lastSyncImported > 0
                                ? `+${config.lastSyncImported} новых`
                                : "без новых"
                              : null}
                            {" · "}обновлено {formatTimeAgo(config.lastSyncAt)}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {config && !isSyncing && (
                    <button
                      type="button"
                      onClick={() =>
                        triggerSync.mutate({
                          id: config.id,
                          workspaceId: config.workspaceId,
                        })
                      }
                      disabled={triggerSync.isPending}
                      title="Синхронизировать сейчас"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                  <Toggle
                    disabled={!f.supported || enableSync.isPending}
                    checked={!!config}
                    onChange={(on) => {
                      if (on) {
                        if ((workspaces.data ?? []).length === 1) {
                          enableSync.mutate({
                            folderId: f.id,
                            folderTitle: f.title,
                            workspaceId: workspaces.data![0]!.id,
                          });
                        } else {
                          setPickerFolder({ id: f.id, title: f.title });
                        }
                      } else {
                        if (config) disableSync.mutate(config.id);
                      }
                    }}
                  />
                </li>
              );
            })}
          </ul>
          {(folders.data?.length ?? 0) > 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              Авто-синхронизации пока нет. Жмите{" "}
              <RefreshCw size={11} className="inline-block align-middle" />{" "}
              чтобы подтянуть новые чаты.
            </p>
          )}
        </div>
      </Card>

      <button
        type="button"
        onClick={() => {
          if (confirm("Выйти из Telegram? Сохранённая сессия будет удалена.")) {
            signOut.mutate();
          }
        }}
        disabled={signOut.isPending}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {signOut.isPending ? "Выход…" : "Выйти из Telegram"}
      </button>

      {pickerFolder && (
        <WorkspacePicker
          folderTitle={pickerFolder.title}
          workspaces={workspaces.data ?? []}
          onCancel={() => setPickerFolder(null)}
          onPick={(workspaceId) =>
            enableSync.mutate({
              folderId: pickerFolder.id,
              folderTitle: pickerFolder.title,
              workspaceId,
            })
          }
        />
      )}
    </div>
  );
}

function Toggle(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
      className={
        "inline-flex h-6 w-11 items-center rounded-full transition-colors " +
        (props.disabled
          ? "cursor-not-allowed bg-zinc-200"
          : props.checked
            ? "bg-emerald-500"
            : "bg-zinc-300")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform " +
          (props.checked ? "translate-x-5" : "translate-x-0.5")
        }
      />
    </button>
  );
}

function WorkspacePicker(props: {
  folderTitle: string;
  workspaces: { id: string; name: string }[];
  onCancel: () => void;
  onPick: (workspaceId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={props.onCancel}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3">
          <div className="text-base font-semibold">
            Папка <span className="text-emerald-600">{props.folderTitle}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Куда импортировать контакты из этой папки?
          </p>
        </div>
        <ul className="divide-y divide-zinc-100">
          {props.workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => setSelected(w.id)}
                className={
                  "flex w-full items-center justify-between px-1 py-3 text-left text-sm hover:bg-zinc-50 " +
                  (selected === w.id ? "font-medium" : "")
                }
              >
                <span>{w.name}</span>
                <span
                  className={
                    "h-4 w-4 rounded-full border-2 " +
                    (selected === w.id
                      ? "border-emerald-600 bg-emerald-600"
                      : "border-zinc-300")
                  }
                />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && props.onPick(selected)}
          className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Включить синхронизацию
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const d = Math.floor(hr / 24);
  return `${d} дн назад`;
}

function Card(props: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {props.children}
    </div>
  );
}

function TelegramLogo({ size = 48 }: { size?: number }) {
  // Простой круглый логотип Telegram через lucide Send + sky-фон. Не настоящий
  // лого, но узнаваемо. В будущем можно заменить на SVG-asset.
  return (
    <div
      className="flex items-center justify-center rounded-full bg-sky-500 text-white"
      style={{ width: size, height: size }}
    >
      <Send size={size * 0.5} className="ml-1" />
    </div>
  );
}

function CenteredLoading() {
  return (
    <div className="grid h-[60vh] place-items-center text-sm text-zinc-500">
      Загрузка…
    </div>
  );
}

function CenteredError({ message }: { message: string }) {
  return (
    <div className="grid h-[60vh] place-items-center text-sm text-red-600">
      {message}
    </div>
  );
}
