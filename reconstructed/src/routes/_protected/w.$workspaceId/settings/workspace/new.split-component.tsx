import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { usePostHog } from "posthog-js/react";
import { sleep } from "radashi";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useAppForm } from "@/hooks/app-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/workspace/new"
)({
  component: CreateWorkspace,
  validateSearch: z.object({
    organizationId: z.string().optional(),
  }),
});

const FormSchema = z.object({
  name: z.string().trim().min(1, "t:web.common.error.shouldNotEmpty"),
});

export function NewWorkspaceForm({
  organizationId,
}: {
  organizationId?: string;
}) {
  useFormFeatures();
  const trpc = useTRPC();
  const { t } = useTranslation();
  const posthog = usePostHog();

  const router = useRouter();
  const { mutateAsync: createWorkspace } = useMutation(
    trpc.workspace.createWorkspace.mutationOptions()
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: FormSchema,
    },
    onSubmit: async (data) => {
      try {
        const workspace = await createWorkspace({
          ...data.value,
          organizationId,
        });
        posthog.capture("workspace_created", {
          $groups: {
            workspace: workspace.id,
          },
        });
        posthog.capture("$groupidentify", {
          $group_type: "workspace",
          $group_key: workspace.id,
          $group_set: {
            name: workspace.name,
            contacts_count: 0,
          },
        });

        // !![dirty hack alert]!!
        // avoid 404 page by waiting for the workspace to be loaded
        await sleep(1000);
        router.navigate({
          to: "/w/$workspaceId/settings/workspace",
          params: { workspaceId: workspace.id },
          replace: true,
        });
        toast(t("web.workspace.new.switchToNewToast"));
      } catch (err) {
        if (err instanceof TRPCClientError) {
          toast.error(err.message);
        }
      }
    },
  });

  return (
    <Form form={form} className="flex flex-col justify-center space-y-6">
      <form.AppField
        name="name"
        children={(field) => (
          <field.FormField
            label={t("web.workspace.nameLabel")}
            description={t("web.workspace.new.nameDescription")}
          >
            <field.TextInput
              autoFocus
              placeholder={t("web.workspace.namePlaceholder")}
            />
          </field.FormField>
        )}
      />

      <form.SubmitMainButton>
        {t("web.workspace.new.createButton")}
      </form.SubmitMainButton>
    </Form>
  );
}

function CreateWorkspace() {
  const searchOrganizationId = Route.useSearch().organizationId;
  const currentOrganizationId = useCurrentWorkspace((w) => w?.organizationId);
  const organizationId = searchOrganizationId ?? currentOrganizationId;

  return (
    <MiniAppPage workspaceSelector={false}>
      <NewWorkspaceForm organizationId={organizationId} />
    </MiniAppPage>
  );
}
