import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { WorkspaceRoleSchema } from "@repo/core/types";

import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppForm } from "@/hooks/app-form";
import { useCanUseTeamFeatures } from "@/hooks/subscription";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import {
  useCurrentOrganization,
  useCurrentWorkspace,
  useWorkspaceStore,
} from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/workspace/invite"
)({
  component: InviteMember,
});

const FormSchema = z.object({
  telegramUsername: z
    .string()
    .trim()
    .min(1, "t:web.common.error.shouldNotEmpty"),
  role: WorkspaceRoleSchema,
});

function InviteMember() {
  useFormFeatures();
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((store) => store.id);
  const hasTelegramAccounts = useWorkspaceStore(
    (s) => s.telegramAccounts.length > 0
  );

  const canUseTeamFeatures = useCanUseTeamFeatures();
  const showWarning = hasTelegramAccounts;
  const willBeChargedNotification = useCurrentOrganization(
    (o) => (o.membersCount ?? 0) >= 3 && o.subscription?.active
  );

  const navigateBack = useNavigateBack();
  const { mutateAsync: inviteWorkspaceMember } = useMutation(
    trpc.workspace.inviteWorkspaceMember.mutationOptions()
  );

  const form = useAppForm({
    defaultValues: {
      telegramUsername: "",
      role: "member",
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: FormSchema,
    },
    onSubmit: async (e) => {
      const data = FormSchema.parse(e.value);
      try {
        await inviteWorkspaceMember({ ...data, workspaceId });
        navigateBack({
          fallback: {
            to: "/w/$workspaceId/settings/workspace",
            params: { workspaceId },
          },
        });
        toast.success(t("web.workspace.invite.successToast"));
      } catch (err) {
        if (err instanceof TRPCClientError) {
          toast.error(err.message);
        }
      }
    },
  });

  if (!canUseTeamFeatures) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/subscription"
        params={{ workspaceId }}
        search={{ minPlan: "team" }}
        replace
      />
    );
  }

  return (
    <MiniAppPage>
      <Form form={form} className="flex flex-col justify-center gap-3">
        {showWarning && (
          <Alert className="mb-3">
            <AlertDescription>
              {t("web.workspace.invite.chatsWarning")}
            </AlertDescription>
          </Alert>
        )}

        <form.AppField
          name="telegramUsername"
          children={(field) => (
            <field.FormField
              label={t("web.workspace.invite.telegramUsernameLabel")}
              description={t(
                "web.workspace.invite.telegramUsernameDescription"
              )}
            >
              <field.TextInput
                autoFocus
                placeholder={t(
                  "web.workspace.invite.telegramUsernamePlaceholder"
                )}
              />
            </field.FormField>
          )}
        />

        <form.AppField
          name="role"
          children={(field) => (
            <field.FormField label={t("web.workspace.invite.roleLabel")}>
              <field.ComboboxInput
                options={WorkspaceRoleSchema.options.map((role) => ({
                  label: t(`web.role.${role}`),
                  value: role,
                }))}
              />
            </field.FormField>
          )}
        />

        <form.SubmitMainButton className="mt-3">
          {t("web.workspace.invite.inviteButton")}
        </form.SubmitMainButton>
        {willBeChargedNotification && (
          <p className="text-muted-foreground text-center text-xs">
            <Trans
              t={t}
              i18nKey="web.workspace.invite.willBeChargedNotification"
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
      </Form>
    </MiniAppPage>
  );
}
