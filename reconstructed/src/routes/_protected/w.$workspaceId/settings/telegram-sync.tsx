import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { deleteField } from "firebase/firestore";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { usePostHog } from "posthog-js/react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dispatch,
  SetStateAction,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import { lazyWithPreload } from "react-lazy-with-preload";
import { toast } from "sonner";

import { User } from "@repo/core/types";

import telegramLogoQr from "@/assets/telegram-logo-qr.svg";
import telegramIcon from "@/assets/telegram-logo.svg";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import Loader from "@/components/ui/loader";
import { RadioButton } from "@/components/ui/radio-button";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { SeparatorWithText } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { useHasReachedContactLimit } from "@/hooks/subscription";
import { useUser } from "@/hooks/useUser";
import { useUserCountryCode } from "@/hooks/useUserCountryCode";
import { updateUser } from "@/lib/db/users";
import { useCurrentWorkspace } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { isDesktopWebApp, webApp } from "@/lib/telegram";
import { RouterOutput, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PhoneInput = lazyWithPreload(async () => ({
  default: (await import("@/components/ui/phone-input")).PhoneInput,
}));
PhoneInput.preload();

type TelegramSyncConfig = NonNullable<
  NonNullable<User["telegramSync"]>["config"]
>;
type TelegramSyncConfigEntry = TelegramSyncConfig[string];
type TelegramFolder = RouterOutput["telegram"]["client"]["getFolders"][number];

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/telegram-sync"
)({
  component: TelegramSync,
});

type AuthState =
  | { step: "initial" }
  | {
      step: "scan-qr";
      qrData: string;
    }
  | {
      step: "enter-phone-number";
      phoneNumber: string;
    }
  | {
      step: "enter-code";
      phoneNumber: string;
      phoneCodeHash: string;
      phoneCode: string;
      isCodeViaApp: boolean;
    }
  | {
      step: "enter-password";
      password: string;
    }
  | {
      step: "complete";
    };

function TelegramSync() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState>({
    step: "initial",
  });

  const {
    data: account,
    isPending,
    isError,
  } = useQuery(trpc.telegram.client.status.queryOptions());
  const country = useUserCountryCode();

  if (isPending) {
    return (
      <MiniAppPage className="grid h-[60vh] place-items-center">
        <Loader />
      </MiniAppPage>
    );
  }

  if (isError) {
    return (
      <MiniAppPage className="grid h-[60vh] place-items-center">
        <div className="flex max-w-[200px] flex-col items-center justify-center space-y-4">
          <TriangleAlert className="text-destructive size-12" />
          <p className="text-center">{t("web.telegramSync.error")}</p>
        </div>
      </MiniAppPage>
    );
  }

  if (account?.status === "authorized") {
    return <SyncSettings {...account.user} />;
  }

  return (
    <MiniAppPage workspaceSelector={false}>
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={state.step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {state.step === "initial" && (
            <InitialStep state={state} setState={setState} />
          )}
          {state.step === "scan-qr" && (
            <ScanQRStep state={state} setState={setState} />
          )}
          {state.step === "enter-phone-number" && (
            <PhoneNumberStep
              state={state}
              setState={setState}
              country={country}
            />
          )}
          {state.step === "enter-code" && (
            <CodeStep state={state} setState={setState} />
          )}
          {state.step === "enter-password" && (
            <PasswordStep state={state} setState={setState} />
          )}
          {state.step === "complete" && (
            <CompleteStep state={state} setState={setState} />
          )}
        </m.div>
      </AnimatePresence>
    </MiniAppPage>
  );
}

function TelegramLogo({ className }: { className?: string }) {
  return (
    <m.img
      layoutId="telegram-logo"
      src={telegramIcon}
      alt="Telegram icon"
      className={cn("size-20", className)}
    />
  );
}
function SyncSettings({ firstName }: { firstName?: string }) {
  const trpc = useTRPC();
  const user = useUser();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { data: folders } = useQuery(
    trpc.telegram.client.getFolders.queryOptions()
  );
  const selectedFoldersCount = Object.keys(
    user?.telegramSync?.config ?? {}
  ).length;

  const { mutateAsync: triggerSync, isPending: isSyncing } = useMutation(
    trpc.telegram.client.triggerSync.mutationOptions()
  );

  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  const pendingFolder = useMemo(
    () => folders?.find((f) => f.id === pendingFolderId),
    [folders, pendingFolderId]
  );

  const enableSync = async (folderId: string, workspaceId: string) => {
    if (!user) return;

    await updateUser(user.id, {
      [`telegramSync.config.${folderId}`]: {
        toWorkspaceId: workspaceId,
      } satisfies TelegramSyncConfigEntry,
    });

    setPendingFolderId(null);

    toast(t("web.telegramSync.syncInProgressToast.title"), {
      description: t("web.telegramSync.syncInProgressToast.description"),
      action: {
        label: t("web.telegramSync.syncInProgressToast.action"),
        onClick: () => {
          navigate({ to: "/w/$workspaceId/contacts", params: { workspaceId } });
        },
      },
      duration: 10_000,
    });

    await triggerSync({ folderId });
  };

  const disableSync = async (folderId: string) => {
    if (!user) return;
    await updateUser(user.id, {
      [`telegramSync.config.${folderId}`]: deleteField(),
    });
  };

  const hasReachedContactLimit = useHasReachedContactLimit();

  const onFolderSelect = async (folderId: string, selected: boolean) => {
    if (selected) {
      if (hasReachedContactLimit) {
        toast(t("web.contacts.limitReached"), {
          action: {
            label: t("web.contacts.upgrade"),
            onClick: () =>
              navigate({
                to: "/w/$workspaceId/settings/subscription",
                params: { workspaceId },
                search: { minPlan: "pro" },
              }),
          },
        });
        return;
      }
      setPendingFolderId(folderId);
    } else {
      await disableSync(folderId);
    }
  };

  const foldersCount = folders?.length ?? 0;

  return (
    <MiniAppPage
      className="flex flex-col justify-center"
      workspaceSelector={false}
    >
      <Card className="w-full">
        <CardHeader className="flex items-center text-center">
          <TelegramLogo className="mb-4 size-12" />
          <CardTitle>{t("web.telegramFolderSync")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-8 text-center text-sm">
          {foldersCount === 0 ? (
            <Trans t={t} i18nKey="web.telegramSync.noFolders" parent="p" />
          ) : selectedFoldersCount === 0 ? (
            <Trans
              t={t}
              i18nKey="web.telegramSync.greeting"
              values={{ name: firstName }}
              components={{
                hl: <span className="text-primary" />,
              }}
              parent="p"
            />
          ) : (
            <Trans
              t={t}
              i18nKey="web.telegramSync.syncEnabled"
              values={{ count: selectedFoldersCount }}
              components={{
                hl: <span className="text-primary" />,
              }}
              parent="p"
            />
          )}

          <AnimateChangeInHeight>
            <SectionItems>
              {folders?.map((folder) =>
                folder.supported ? (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    configEntry={user?.telegramSync?.config?.[folder.id]}
                    onSelect={onFolderSelect}
                  />
                ) : (
                  <Tip
                    key={folder.id}
                    content={t("web.telegramSync.dynamicFoldersNotSupported")}
                  >
                    <div>
                      <FolderItem folder={folder} onSelect={() => {}} />
                    </div>
                  </Tip>
                )
              )}
            </SectionItems>
          </AnimateChangeInHeight>
          <div
            className={cn(
              "text-muted-foreground flex items-center justify-center space-x-1",
              {
                invisible: !isSyncing,
              }
            )}
          >
            <Loader className="size-4" />{" "}
            <span>{t("web.telegramSync.syncingChats")}</span>
          </div>
        </CardContent>
      </Card>

      <SignOutButton />

      <SelectWorkspaceDrawer
        folder={pendingFolder}
        onClose={() => setPendingFolderId(null)}
        onEnable={enableSync}
      />
    </MiniAppPage>
  );
}

function FolderItem({
  configEntry,
  folder,
  onSelect,
}: {
  configEntry?: TelegramSyncConfigEntry;
  folder: TelegramFolder;
  onSelect: (folderId: string, selected: boolean) => void;
}) {
  const workspace = useWorkspacesStore(
    (store) => store.workspacesById[configEntry?.toWorkspaceId ?? "-"]
  );
  const { t } = useTranslation();

  return (
    <SectionItem
      key={folder.id}
      asChild
      className={cn(
        "hover:text-muted-foreground transition-colors",
        folder.supported
          ? "cursor-pointer"
          : "text-muted-foreground cursor-not-allowed"
      )}
      icon={
        <Switch
          disabled={!folder.supported}
          checked={!!configEntry && !!workspace}
          onCheckedChange={(selected) => onSelect(folder.id, selected)}
          aria-label={t("web.telegramSync.toggleFolderSync", {
            folderTitle: folder.title,
          })}
        />
      }
    >
      <label>
        <SectionItemTitle>{folder.title}</SectionItemTitle>
        {workspace && <SectionItemValue>{workspace.name}</SectionItemValue>}
      </label>
    </SectionItem>
  );
}

function SelectWorkspaceDrawer({
  folder,
  onClose,
  onEnable,
}: {
  folder?: TelegramFolder;
  onClose: () => void;
  onEnable: (folderId: string, workspaceId: string) => void;
}) {
  const workspaces = useWorkspacesStore((store) => store.workspaces);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  );
  const { t } = useTranslation();

  useEffect(() => {
    setSelectedWorkspaceId(
      workspaces.length === 1 && workspaces[0] ? workspaces[0].id : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id]);

  return (
    <Drawer open={!!folder} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <span className="text-primary">{folder?.title}</span>{" "}
            {t("web.telegramSync.folderLabel")}
          </DrawerTitle>
          <DrawerDescription>
            {t("web.telegramSync.syncToWorkspaceDesc")}
          </DrawerDescription>
        </DrawerHeader>

        <div className="mx-3 my-4 space-y-6">
          <Section>
            <SectionItems>
              {workspaces.map((workspace) => (
                <SectionItem
                  key={workspace.id}
                  icon={
                    <RadioButton
                      checked={selectedWorkspaceId === workspace.id}
                      aria-label={t("web.telegramSync.selectWorkspace", {
                        workspaceName: workspace.name,
                      })}
                    />
                  }
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                >
                  <SectionItemTitle>{workspace.name}</SectionItemTitle>
                </SectionItem>
              ))}
            </SectionItems>
          </Section>
          <Button
            className="w-full"
            disabled={!selectedWorkspaceId}
            onClick={() => {
              if (folder && selectedWorkspaceId) {
                onEnable(folder.id, selectedWorkspaceId);
              }
            }}
          >
            {t("web.telegramSync.enableSyncButton")}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function SignOutButton() {
  const trpc = useTRPC();
  const [isPending, setIsPending] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { mutateAsync: signOut } = useMutation(
    trpc.telegram.client.signOut.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(trpc.telegram.client.pathFilter()),
    })
  );
  return (
    <Button
      variant="link"
      className="text-muted-foreground mt-6 space-x-1"
      type="button"
      disabled={isPending}
      onClick={() => {
        signOut();
        setIsPending(true);
      }}
    >
      {isPending && <Loader className="size-4" />}{" "}
      <span>{t("web.signOut")}</span>
    </Button>
  );
}

type StepProps<Step extends AuthState["step"], T = object> = {
  state: AuthState & { step: Step };
  setState: Dispatch<SetStateAction<AuthState>>;
} & T;

function InitialStep({ setState }: StepProps<"initial">) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card className="w-full">
        <CardHeader className="flex items-center">
          <m.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
          >
            <TelegramLogo className="mb-6 size-24" />
          </m.div>
          <CardTitle className="text-center">
            {t("web.telegramFolderSync")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-8 text-center text-sm">
          {t("web.telegramSync.initial.description")}
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            className="w-full"
            onClick={() =>
              !webApp || isDesktopWebApp
                ? setState({ step: "scan-qr", qrData: "" })
                : setState({ step: "enter-phone-number", phoneNumber: "" })
            }
          >
            {t("web.telegramSync.initial.signInButton")}
          </Button>
        </CardFooter>
      </Card>
      <Card className="w-full">
        <CardHeader className="flex items-center">
          <CardTitle className="flex items-center space-x-2 text-xl">
            <ShieldCheck className="size-6 text-green-600" />
            <span>{t("web.telegramSync.initial.privacyTitle")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-8 text-sm">
          <ol className="ml-4 list-decimal space-y-3">
            <li>
              <strong>
                {t("web.telegramSync.initial.privacyItem1Title")}:
              </strong>{" "}
              {t("web.telegramSync.initial.privacyItem1Desc")}
            </li>
            <li>
              <strong>
                {t("web.telegramSync.initial.privacyItem2Title")}:
              </strong>{" "}
              {t("web.telegramSync.initial.privacyItem2Desc")}
            </li>
            <li>
              <strong>
                {t("web.telegramSync.initial.privacyItem3Title")}:
              </strong>{" "}
              {t("web.telegramSync.initial.privacyItem3Desc")}
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function PhoneNumberStep({
  state,
  setState,
  country,
}: StepProps<"enter-phone-number", { country: string | undefined }>) {
  const trpc = useTRPC();
  const { mutateAsync: sendCode, isPending } = useMutation(
    trpc.telegram.client.sendCode.mutationOptions()
  );
  const [error, setError] = useState("");
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6">
      <TelegramLogo />
      <div className="text-center">{t("web.telegramSync.phone.prompt")}</div>
      <Suspense fallback={<Loader />}>
        <PhoneInput
          className="w-full max-w-60"
          autoFocus
          value={state.phoneNumber ? `+${state.phoneNumber}` : ""}
          onChange={(phoneNumber) =>
            setState((s) => ({
              ...s,
              phoneNumber: phoneNumber.replace(/^\+/, ""),
            }))
          }
          placeholder={t("web.telegramSync.phone.placeholder")}
          international
          defaultCountry={country as any}
        />
        {error && <div className="text-destructive text-sm">{error}</div>}
      </Suspense>
      <Button
        disabled={isPending}
        onClick={async () => {
          try {
            const result = await sendCode({ phoneNumber: state.phoneNumber });
            if (result.status === "sent") {
              setState({
                step: "enter-code",
                phoneNumber: state.phoneNumber,
                phoneCodeHash: result.phoneCodeHash,
                isCodeViaApp: result.isCodeViaApp,
                phoneCode: "",
              });
            } else if (result.status === "phone_number_invalid") {
              setError(t("web.telegramSync.phone.errorInvalid"));
            }
          } catch (e) {
            console.error(e);
            setError(t("web.telegramSync.phone.errorFailed"));
          }
        }}
      >
        {t("web.telegramSync.nextButton")}
      </Button>
      <Loader className={isPending ? "visible" : "invisible"} />
    </div>
  );
}

function ScanQRStep({ setState }: StepProps<"scan-qr">) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { data } = useQuery(
    trpc.telegram.client.getQrState.queryOptions(void {}, {
      refetchInterval: 2000,
    })
  );

  useEffect(() => {
    if (data?.status === "success") {
      setState({ step: "complete" });
    } else if (data?.status === "password_needed") {
      setState({ step: "enter-password", password: "" });
    }
  }, [data, setState]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-4">
      {data && data.status === "scan-qr-code" ? (
        <QRCodeSVG
          className="size-60 rounded-lg"
          value={`tg://login?token=${data.token}`}
          marginSize={2}
          size={120}
          level="Q"
          imageSettings={{
            src: telegramLogoQr,
            height: 24,
            width: 24,
            excavate: true,
          }}
        />
      ) : (
        <Skeleton className="size-60 rounded-lg" />
      )}
      <div className="text-center text-lg font-semibold">
        {t("web.telegramSync.scanQr.prompt")}
      </div>
      <ol className="marker:text-muted-foreground ml-4 list-decimal space-y-3 text-sm">
        <li>{t("web.telegramSync.scanQr.step1Title")}</li>
        <li>{t("web.telegramSync.scanQr.step2Title")}</li>
        <li>{t("web.telegramSync.scanQr.step3Title")}</li>
      </ol>
      <SeparatorWithText text={t("web.or")} className="my-4 w-full" />
      <Button
        variant="ghost"
        onClick={() =>
          setState({ step: "enter-phone-number", phoneNumber: "" })
        }
      >
        {t("web.telegramSync.scanQr.usePhoneNumber")}
      </Button>
    </div>
  );
}

function CodeStep({ state, setState }: StepProps<"enter-code">) {
  const trpc = useTRPC();
  const { mutateAsync: signIn, isPending } = useMutation(
    trpc.telegram.client.signIn.mutationOptions()
  );
  const [error, setError] = useState("");
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6">
      <TelegramLogo />
      <div className="text-center">
        <p>
          {t("web.telegramSync.code.check", {
            context: state.isCodeViaApp ? "app" : "sms",
          })}
        </p>
        <p className="text-muted-foreground mt-4 text-sm">
          {t("web.telegramSync.code.sentTo", {
            context: state.isCodeViaApp ? "app" : "sms",
            phoneNumber: state.phoneNumber,
          })}
        </p>
      </div>
      <InputOTP
        autoFocus
        maxLength={5}
        value={state.phoneCode}
        onChange={async (v) => {
          setState((s) => ({ ...s, phoneCode: v }));
          if (v.length === 5) {
            const result = await signIn({
              phoneNumber: state.phoneNumber,
              phoneCode: v,
              phoneCodeHash: state.phoneCodeHash,
            });
            // eslint-disable-next-line unicorn/prefer-switch
            if (result.status === "sign_in_complete") {
              setState({ step: "complete" });
            } else if (result.status === "password_needed") {
              setState({ step: "enter-password", password: "" });
            } else if (result.status === "user_not_found") {
              console.warn("User not found");
              setError(
                t("web.telegramSync.code.errorUserNotFound", {
                  phoneNumber: state.phoneNumber,
                })
              );
            } else if (result.status === "phone_code_invalid") {
              setError(t("web.telegramSync.code.errorInvalid"));
            }
          }
        }}
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} className="bg-card" />
          <InputOTPSlot index={1} className="bg-card" />
          <InputOTPSlot index={2} className="bg-card" />
          <InputOTPSlot index={3} className="bg-card" />
          <InputOTPSlot index={4} className="bg-card" />
        </InputOTPGroup>
      </InputOTP>
      {error && <div className="text-destructive text-sm">{error}</div>}
      <Loader className={isPending ? "visible" : "invisible"} />
    </div>
  );
}

function PasswordStep({ state, setState }: StepProps<"enter-password">) {
  const trpc = useTRPC();
  const { mutateAsync: signInWithPassword, isPending } = useMutation(
    trpc.telegram.client.signInWithPassword.mutationOptions()
  );
  const [error, setError] = useState("");
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6">
      <TelegramLogo />
      <div className="text-center">{t("web.telegramSync.password.prompt")}</div>
      <Input
        className="w-full max-w-60"
        autoFocus
        type="password"
        value={state.password}
        onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
        placeholder={t("web.telegramSync.password.placeholder")}
      />
      {error && <div className="text-destructive text-sm">{error}</div>}
      <Button
        disabled={isPending}
        onClick={async () => {
          try {
            const result = await signInWithPassword({
              password: state.password,
            });
            if (result.status === "sign_in_complete") {
              setState({ step: "complete" });
            } else if (result.status === "password_invalid") {
              setError(t("web.telegramSync.password.errorInvalid"));
            }
          } catch (e) {
            console.error(e);
            setError(t("web.telegramSync.password.errorFailed"));
          }
        }}
      >
        {t("web.telegramSync.signInButton")}
      </Button>
      <Loader className={isPending ? "visible" : "invisible"} />
    </div>
  );
}

function CompleteStep({ setState }: StepProps<"complete">) {
  const trpc = useTRPC();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.invalidateQueries(trpc.telegram.client.pathFilter());
    setState({ step: "initial" });
    posthog.capture("telegram_sync_auth_complete");
  }, [trpc, setState, posthog, queryClient]);
  return null;
}
