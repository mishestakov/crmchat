import { revalidateLogic } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useAppForm } from "@/hooks/app-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { updateOrganization } from "@/lib/db/organizations";
import { getOrganizationName } from "@/lib/organization";
import { useWorkspacesStore } from "@/lib/store/workspaces";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/organization/$organizationId"
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <MiniAppPage>
      <OrganizationNameForm />
    </MiniAppPage>
  );
}

const formSchema = z.object({
  name: z.string().min(1, "t:web.organization.nameRequiredError").trim(),
});

function OrganizationNameForm() {
  useFormFeatures();
  const { t } = useTranslation();
  const { organizationId } = Route.useParams();
  const organization = useWorkspacesStore(
    (store) => store.organizationsById[organizationId]
  );
  const form = useAppForm({
    defaultValues: { name: organization?.name ?? "" },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: formSchema,
    },
    onSubmit: async (e) => {
      const data = formSchema.parse(e.value);
      await updateOrganization(organizationId, { name: data.name });
      toast.success(t("web.organization.saveNameSuccess"));
      form.reset({ name: data.name });
    },
  });

  useEffect(() => {
    form.reset({ name: organization?.name ?? "" });
  }, [form, organization?.name]);

  if (!organization) {
    return null;
  }

  return (
    <Form form={form} className="flex flex-col justify-center">
      <form.AppField
        name="name"
        children={(field) => (
          <field.FormField label={t("web.organization.nameLabel")}>
            <field.TextInput placeholder={getOrganizationName(organization)} />
          </field.FormField>
        )}
      />
      <form.SubmitButton className="mt-3 w-full">
        {t("web.organization.saveNameButton")}
      </form.SubmitButton>
    </Form>
  );
}
