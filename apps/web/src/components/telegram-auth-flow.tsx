import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { errorMessage } from "../lib/errors";

// Унифицированный auth-флоу TG-аккаунта. Используется и для user-scoped TG-sync
// (settings/telegram-sync), и для workspace-scoped outreach-аккаунта
// (outreach/accounts/new). Различается endpoint'ами, передаваемыми через `api`.
//
// State-машина: scan-qr (default) | enter-phone | enter-code | enter-password.

export type TgAuthSignInResult =
  | { status: "sign_in_complete"; accountId?: string }
  | { status: "password_needed" }
  | { status: "phone_code_invalid" }
  | { status: "user_not_found" };

export type TgAuthSignInPasswordResult =
  | { status: "sign_in_complete"; accountId?: string }
  | { status: "password_invalid" };

export type TgAuthApi = {
  qrStreamUrl: string;
  sendCode: (phoneNumber: string) => Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
  }>;
  signIn: (args: {
    phoneNumber: string;
    phoneCode: string;
    phoneCodeHash: string;
  }) => Promise<TgAuthSignInResult>;
  signInPassword: (password: string) => Promise<TgAuthSignInPasswordResult>;
};

type QrState =
  | { status: "scan-qr-code"; token: string }
  | { status: "password_needed" }
  | { status: "success"; accountId?: string };

type AuthState =
  | { step: "scan-qr" }
  | { step: "enter-phone"; phoneNumber: string }
  | {
      step: "enter-code";
      phoneNumber: string;
      phoneCodeHash: string;
      isCodeViaApp: boolean;
      phoneCode: string;
    }
  | { step: "enter-password" };

export function TelegramAuthFlow(props: {
  api: TgAuthApi;
  onComplete: (result: { accountId?: string }) => void;
}) {
  const [state, setState] = useState<AuthState>({ step: "scan-qr" });

  return (
    <div className="mx-auto max-w-md">
      {state.step === "scan-qr" && (
        <ScanQrStep
          api={props.api}
          setState={setState}
          onComplete={props.onComplete}
        />
      )}
      {state.step === "enter-phone" && (
        <PhoneStep api={props.api} state={state} setState={setState} />
      )}
      {state.step === "enter-code" && (
        <CodeStep
          api={props.api}
          state={state}
          setState={setState}
          onComplete={props.onComplete}
        />
      )}
      {state.step === "enter-password" && (
        <PasswordStep
          api={props.api}
          setState={setState}
          onComplete={props.onComplete}
        />
      )}
    </div>
  );
}

function ScanQrStep(props: {
  api: TgAuthApi;
  setState: (s: AuthState) => void;
  onComplete: (r: { accountId?: string }) => void;
}) {
  const [qrState, setQrState] = useState<QrState | null>(null);

  useEffect(() => {
    const es = new EventSource(props.api.qrStreamUrl, {
      withCredentials: true,
    });
    const onState = (e: MessageEvent) => {
      setQrState(JSON.parse(e.data) as QrState);
    };
    es.addEventListener("state", onState);
    return () => {
      es.removeEventListener("state", onState);
      es.close();
    };
  }, [props.api.qrStreamUrl]);

  const { onComplete, setState } = props;
  useEffect(() => {
    if (qrState?.status === "success") {
      onComplete({ accountId: qrState.accountId });
    }
    if (qrState?.status === "password_needed") {
      setState({ step: "enter-password" });
    }
  }, [qrState, onComplete, setState]);

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Войти в Telegram</h1>

        <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-zinc-200 bg-white">
          {qrState?.status === "scan-qr-code" ? (
            <QrImage token={qrState.token} />
          ) : (
            <div className="text-sm text-zinc-400">Загрузка QR…</div>
          )}
        </div>

        <ol className="ml-5 list-decimal self-start space-y-1 text-sm text-zinc-700">
          <li>Откройте Telegram на телефоне</li>
          <li>«Настройки» → «Устройства»</li>
          <li>«Подключить устройство» — отсканируйте QR</li>
        </ol>

        <div className="my-2 flex w-full items-center gap-2 text-xs text-zinc-400">
          <hr className="flex-1 border-zinc-200" />
          <span>или</span>
          <hr className="flex-1 border-zinc-200" />
        </div>

        <button
          type="button"
          onClick={() =>
            props.setState({ step: "enter-phone", phoneNumber: "" })
          }
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          Войти по номеру телефона
        </button>
      </div>
    </Card>
  );
}

// Telegram-deep-link для QR: tg://login?token={base64url(token)}.
// QR-генератор без либы — внешний сервис api.qrserver.com (для MVP норм).
function QrImage({ token }: { token: string }) {
  const tgUrl = `tg://login?token=${token}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(
    tgUrl,
  )}`;
  return <img src={qrSrc} alt="Telegram QR" className="h-56 w-56" />;
}

function PhoneStep(props: {
  api: TgAuthApi;
  state: Extract<AuthState, { step: "enter-phone" }>;
  setState: (s: AuthState) => void;
}) {
  const [phone, setPhone] = useState(props.state.phoneNumber);
  const send = useMutation({
    mutationFn: async () => {
      const phoneNumber = phone.replace(/[^\d+]/g, "");
      const data = await props.api.sendCode(phoneNumber);
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
  api: TgAuthApi;
  state: Extract<AuthState, { step: "enter-code" }>;
  setState: (s: AuthState) => void;
  onComplete: (r: { accountId?: string }) => void;
}) {
  const [code, setCode] = useState(props.state.phoneCode);
  const [error, setError] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: async (phoneCode: string) => {
      return props.api.signIn({
        phoneNumber: props.state.phoneNumber,
        phoneCodeHash: props.state.phoneCodeHash,
        phoneCode,
      });
    },
    onSuccess: (d) => {
      if (d.status === "sign_in_complete")
        props.onComplete({ accountId: d.accountId });
      else if (d.status === "password_needed")
        props.setState({ step: "enter-password" });
      else if (d.status === "phone_code_invalid")
        setError("Неверный код, попробуйте ещё раз");
      else if (d.status === "user_not_found")
        setError(
          "Пользователь не найден. Зарегистрируйтесь в Telegram сначала",
        );
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
  api: TgAuthApi;
  setState: (s: AuthState) => void;
  onComplete: (r: { accountId?: string }) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => props.api.signInPassword(password),
    onSuccess: (d) => {
      if (d.status === "sign_in_complete")
        props.onComplete({ accountId: d.accountId });
      else if (d.status === "password_invalid") setError("Неверный пароль");
    },
  });

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-6 py-8">
        <TelegramLogo size={48} />
        <h1 className="text-lg font-semibold">Двухфакторный пароль</h1>
        <p className="text-center text-sm text-zinc-600">
          У этого аккаунта включён cloud-password.
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

function Card(props: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {props.children}
    </div>
  );
}

function TelegramLogo({ size = 48 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full bg-sky-500 text-white"
      style={{ width: size, height: size }}
    >
      <Send size={size * 0.5} className="ml-1" />
    </div>
  );
}
