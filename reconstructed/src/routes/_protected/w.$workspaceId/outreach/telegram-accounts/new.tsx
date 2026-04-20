import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { collection, doc } from "firebase/firestore";
import { AnimatePresence, MotionProps, m } from "motion/react";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { parsePhoneNumber } from "react-phone-number-input";
import { toast } from "sonner";

import { DistributiveOmit, TelegramAccountAuthState } from "@repo/core/types";
import { isLegacyPlan } from "@repo/core/utils";
import { normalizePhoneNumber } from "@repo/core/utils/phone";

import telegramIcon from "@/assets/telegram-logo.svg";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import Loader from "@/components/ui/loader";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCanCreateTelegramAccount } from "@/hooks/subscription";
import { useUserCountryCode } from "@/hooks/useUserCountryCode";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { firestore } from "@/lib/firebase";
import {
  useActiveSubscription,
  useCurrentOrganization,
  useCurrentWorkspace,
} from "@/lib/store";
import { getPlatform } from "@/lib/telegram";
import { RouterInput, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/telegram-accounts/new"
)({
  component: RouteComponent,
});

const stepMotionProps: MotionProps = {
  initial: { opacity: 0, x: 100 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -100 },
  transition: { type: "spring", bounce: 0, duration: 0.6 },
};

function OrgLimitRedirect() {
  const { t } = useTranslation();
  useEffect(() => {
    toast.error(t("web.outreach.telegramAccounts.orgLimitReached"));
  }, [t]);
  return <Navigate from={Route.fullPath} to=".." replace />;
}

type State = TelegramAccountAuthState;
type AuthFnParams = DistributiveOmit<
  RouterInput["telegram"]["account"]["auth"],
  "workspaceId" | "accountId"
>;
type AuthFn = (params: AuthFnParams) => Promise<void>;

function RouteComponent() {
  const { t } = useTranslation();
  const canCreateTelegramAccount = useCanCreateTelegramAccount();
  const trpc = useTRPC();
  const [phoneNumber, setPhoneNumber] = useState("");
  const workspaceId = useCurrentWorkspace((state) => state.id);

  const [isStarted, setIsStarted] = useState(false);

  // Pre-assign the Firestore-style id so the backend can route every auth
  // call to the same dc-proxy pod (the one that will own this bucket).
  const accountId = useMemo(() => doc(collection(firestore, "id")).id, []);

  const { data: state } = useQuery(
    trpc.telegram.account.authState.queryOptions(
      {
        accountId,
        workspaceId,
      },
      {
        enabled: !!normalizePhoneNumber(phoneNumber) && isStarted,
        refetchInterval: 2000,
        placeholderData: {
          type: "idle",
          status: "idle",
        } satisfies State as any,
      }
    )
  );

  const authMutation = useMutation(
    trpc.telegram.account.auth.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );
  const auth = useCallback(
    (params: AuthFnParams) =>
      authMutation.mutateAsync({
        ...params,
        workspaceId,
        accountId,
      }),
    [authMutation, workspaceId, accountId]
  );

  useEffect(() => {
    authMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const { members } = useWorkspaceMembers();
  const subscriptionPlan = useActiveSubscription((s) => s.plan);

  const showWarning =
    members?.length &&
    members.length === 0 &&
    (subscriptionPlan === "team" || subscriptionPlan === "outreach");

  if (!canCreateTelegramAccount.allowed) {
    if (canCreateTelegramAccount.reason === "orgLimit") {
      return <OrgLimitRedirect />;
    }
    return (
      <Navigate
        from={Route.fullPath}
        to="../../../settings/subscription"
        search={{ minPlan: "team" }}
        replace
      />
    );
  }

  return (
    <MiniAppPage className="flex flex-col gap-4">
      <OutreachTabNavigation />
      <AnimateChangeInHeight className="bg-card text-card-foreground rounded-lg border shadow-sm">
        <CardHeader className="flex flex-col items-center gap-4">
          <m.div
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <img src={telegramIcon} alt="Telegram icon" className="size-20" />
          </m.div>
        </CardHeader>
        <CardContent className="relative">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.div key={state?.type ?? "loading"} {...stepMotionProps}>
              {state ? (
                state.type === "idle" ? (
                  <PhoneStep
                    state={state}
                    auth={auth}
                    phoneNumber={phoneNumber}
                    setPhoneNumber={setPhoneNumber}
                    setIsStarted={setIsStarted}
                    useWsTransport
                  />
                ) : state.type === "codeSent" ? (
                  <CodeStep state={state} auth={auth} />
                ) : state.type === "passwordNeeded" ? (
                  <PasswordStep state={state} auth={auth} />
                ) : state.type === "success" ? (
                  <SuccessStep state={state} />
                ) : null
              ) : (
                <div className="flex justify-center">
                  <Loader />
                </div>
              )}
            </m.div>
          </AnimatePresence>
          {showWarning && (
            <Alert className="mt-4">
              <AlertDescription>
                {t("web.outreach.telegramAccounts.new.teamWarning")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </AnimateChangeInHeight>
    </MiniAppPage>
  );
}

function PhoneStep({
  state,
  auth,
  phoneNumber,
  setPhoneNumber,
  setIsStarted,
  useWsTransport,
}: {
  state: State & { type: "idle" };
  auth: AuthFn;
  phoneNumber: string;
  setPhoneNumber: (phoneNumber: string) => void;
  setIsStarted: (isStarted: boolean) => void;
  useWsTransport: boolean;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [proxyCountry, setProxyCountry] = useState<string>();
  const userCountry = useUserCountryCode();
  const { data: proxyCountries, isPending: proxyCountriesLoading } = useQuery(
    trpc.proxy.getCountries.queryOptions(void 0, {
      trpc: { context: { skipBatch: true } },
    })
  );
  const [isLoading, setIsLoading] = useState(false);
  const willBeChargedNotification = useCurrentOrganization(
    (o) =>
      (o.activeTelegramAccountsCount ?? 0) >= 1 &&
      o.subscription?.active &&
      !isLegacyPlan(o.subscription)
  );

  const submit = async () => {
    if (isLoading) return;

    const proxyCountryCode =
      proxyCountry ??
      proxyCountries?.find((c) => c.countryCode === "nl")?.countryCode ??
      proxyCountries?.[0]?.countryCode ??
      "";

    setIsLoading(true);
    setIsStarted(true);
    await auth({
      action: "start",
      phoneNumber,
      proxyCountryCode,
      device: {
        platform: getPlatform(),
        userAgent: navigator.userAgent,
        langCode: "en",
        systemLangCode: "en-US",
      },
      ...(useWsTransport ? { transport: "ws" as const } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-center text-sm">
        <h1 className="text-xl font-semibold">
          {t("web.outreach.telegramAccounts.new.phone.title")}
        </h1>
        <p className="text- text-muted-foreground">
          {t("web.outreach.telegramAccounts.new.phone.prompt")}
        </p>
      </div>
      <PhoneInput
        autoFocus
        value={phoneNumber}
        onChange={setPhoneNumber}
        placeholder={t(
          "web.outreach.telegramAccounts.new.phone.inputPlaceholder"
        )}
        international
        defaultCountry={userCountry as any}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit();
          }
        }}
      />
      <ProxyCountrySelector
        phoneNumber={phoneNumber}
        countries={proxyCountries}
        countryCode={proxyCountry}
        setCountryCode={setProxyCountry}
        loading={proxyCountriesLoading}
      />
      <ErrorMessage error={state.error} />

      <Button
        className="w-full gap-2"
        onClick={submit}
        disabled={isLoading || proxyCountriesLoading}
      >
        {isLoading ? (
          <>
            <Loader className="size-4" />
            <span>
              {t(
                `web.outreach.telegramAccounts.new.phone.loading.${state.status}`,
                t("web.outreach.telegramAccounts.new.phone.loading.connecting")
              )}
            </span>
          </>
        ) : (
          t("web.outreach.telegramAccounts.new.phone.sendCodeButton")
        )}
      </Button>
      {willBeChargedNotification && (
        <p className="text-muted-foreground text-center text-xs">
          <Trans
            t={t}
            className="text-xs"
            i18nKey="web.outreach.telegramAccounts.new.phone.willBeChargedNotification"
            components={[
              <a
                href={t("web.subscriptionPage.switchPlanDialog.pricingUrl")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              />,
            ]}
          />
        </p>
      )}
    </div>
  );
}

function ProxyCountrySelector({
  phoneNumber,
  countries,
  countryCode,
  setCountryCode,
  disabled,
  loading,
}: {
  phoneNumber: string;
  countries: { countryCode: string; name: string }[] | undefined;
  countryCode: string | undefined;
  setCountryCode: (countryCode: string | undefined) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const userCountry = useUserCountryCode();

  useEffect(() => {
    if (!countries || !userCountry) return;

    const country = countries.find((c) => c.countryCode === userCountry);
    if (country) {
      setCountryCode(country.countryCode);
    }
  }, [countries, userCountry, setCountryCode]);

  useEffect(() => {
    const parsed = parsePhoneNumber(phoneNumber);
    if (parsed?.country) {
      let parsedCountryCode = parsed.country.toLowerCase();
      // Kazakhstan accounts should use ru proxies
      if (parsedCountryCode === "kz") {
        parsedCountryCode = "ru";
      }
      const proxyCountryExists = countries?.some(
        (c) => c.countryCode === parsedCountryCode
      );

      if (proxyCountryExists) {
        setCountryCode(parsedCountryCode);
      }
    }
  }, [phoneNumber, setCountryCode, countries]);
  const country = countries?.find((c) => c.countryCode === countryCode);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="text-muted-foreground group mx-1 flex justify-center gap-1 text-xs"
        disabled={disabled}
      >
        <span className="shrink-0 border-b border-transparent">
          {t("web.outreach.telegramAccounts.new.phone.proxyLocationLabel")}
        </span>
        {loading ? (
          <Loader className="size-4" />
        ) : (
          <span
            className={cn(
              "underline",
              !disabled && "group-hover:text-primary",
              countryCode && "text-primary"
            )}
          >
            {country?.name ??
              t("web.outreach.telegramAccounts.new.phone.proxyLocationAuto")}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {countries === undefined && (
          <DropdownMenuItem disabled>
            {t("web.outreach.telegramAccounts.new.phone.proxyLoading")}
          </DropdownMenuItem>
        )}
        <DropdownMenuRadioGroup
          value={countryCode ?? ""}
          onValueChange={(v) => setCountryCode(v || undefined)}
        >
          <DropdownMenuRadioItem value="">
            {t("web.outreach.telegramAccounts.new.phone.proxyLocationAuto")}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {countries?.map((country) => (
            <DropdownMenuRadioItem
              key={country.countryCode}
              value={country.countryCode}
            >
              {country.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CodeStep({
  state,
  auth,
}: {
  state: State & { type: "codeSent" };
  auth: AuthFn;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [countdown, setCountdown] = useState(state.timeout ?? 0);

  useEffect(() => {
    setIsLoading(false);
    setIsResending(false);
  }, [state.type, state.error]);

  // Reset countdown when state updates (e.g. after resend)
  useEffect(() => {
    setCountdown(state.timeout ?? 0);
  }, [state.timeout, state.method]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const submit = async (_code: string) => {
    if (isLoading) return;

    setIsLoading(true);
    await auth({
      action: "submitPhoneCode",
      phoneCode: _code,
    });
  };

  const resend = async () => {
    if (isResending || countdown > 0) return;
    setIsResending(true);
    setCode("");
    await auth({ action: "resendCode" });
  };

  const codeLength = state.codeLength || 5;
  const nextMethodName = state.nextType
    ? t(
        `web.outreach.telegramAccounts.new.code.nextMethod.${state.nextType}`,
        ""
      )
    : "";
  const showResend =
    state.nextType && state.nextType !== "none" && nextMethodName;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-muted-foreground text-center text-sm">
        {t(
          `web.outreach.telegramAccounts.new.code.prompt.${state.method}`,
          t("web.outreach.telegramAccounts.new.code.prompt.default")
        )}
      </div>
      <InputOTP
        autoFocus
        maxLength={codeLength}
        value={code}
        onChange={(_code) => {
          setCode(_code);
          if (_code.length === codeLength) {
            submit(_code);
          }
        }}
        disabled={isLoading}
      >
        <InputOTPGroup>
          {Array.from({ length: codeLength }).map((_, index) => (
            <InputOTPSlot key={index} index={index} className="bg-card" />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {isLoading && <Loader />}
      <ErrorMessage error={state.error} />
      {showResend && (
        <button
          type="button"
          className="text-muted-foreground hover:text-primary text-xs disabled:opacity-50"
          onClick={resend}
          disabled={isResending || countdown > 0}
        >
          {isResending
            ? t("web.outreach.telegramAccounts.new.code.resendLoading")
            : countdown > 0
              ? t("web.outreach.telegramAccounts.new.code.resendCountdown", {
                  method: nextMethodName,
                  seconds: countdown,
                })
              : t("web.outreach.telegramAccounts.new.code.resendButton", {
                  method: nextMethodName,
                })}
        </button>
      )}
    </div>
  );
}

function PasswordStep({
  state,
  auth,
}: {
  state: State & { type: "passwordNeeded" };
  auth: AuthFn;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    setIsLoading(false);
  }, [state.type, state.error]);

  const submit = async () => {
    if (isLoading) return;

    setIsLoading(true);
    await auth({
      action: "submitPassword",
      password,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground text-center text-sm">
        {t("web.outreach.telegramAccounts.new.password.prompt")}
      </div>
      <div>
        <Input
          autoFocus
          type="password"
          placeholder={t(
            "web.outreach.telegramAccounts.new.password.inputPlaceholder"
          )}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit();
            }
          }}
        />
        {state.hint && (
          <div className="text-muted-foreground mx-3 mt-1 text-left text-xs">
            {t("web.outreach.telegramAccounts.new.password.passwordHint", {
              hint: state.hint,
            })}
          </div>
        )}
      </div>
      <ErrorMessage error={state.error} />
      <Button className="w-full" onClick={submit} disabled={isLoading}>
        {isLoading ? (
          <Loader className="size-4" />
        ) : (
          t("web.outreach.telegramAccounts.new.password.submitButton")
        )}
      </Button>
    </div>
  );
}

function SuccessStep({ state }: { state: State & { type: "success" } }) {
  const { t } = useTranslation();
  const posthog = usePostHog();
  const hasCaptured = useRef(false);

  useEffect(() => {
    if (!hasCaptured.current) {
      posthog.capture("telegram_account_connected");
      hasCaptured.current = true;
    }
  }, [posthog]);

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4 flex flex-col gap-2 text-center text-sm">
        <h1 className="text-xl font-semibold">
          {t("web.outreach.telegramAccounts.new.success.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("web.outreach.telegramAccounts.new.success.description")}
        </p>
      </div>

      <Button className="w-full" asChild>
        <Link
          from={Route.fullPath}
          to={`../$accountId`}
          params={{ accountId: state.accountId }}
          replace
        >
          {t("web.outreach.telegramAccounts.new.success.viewAccountButton")}
        </Link>
      </Button>
    </div>
  );
}

function ErrorMessage({ error }: { error: State["error"] }) {
  const { t } = useTranslation();

  if (!error) {
    return null;
  }

  return (
    <div className="text-destructive text-center text-sm">
      {t(`web.outreach.telegramAccounts.new.error.${error.code}`, {
        ...error.params,
        defaultValue: error.code,
      })}
    </div>
  );
}
