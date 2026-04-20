import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { UserWithId } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import { RadioButton } from "@/components/ui/radio-button";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { useUser } from "@/hooks/useUser";
import { updateUser } from "@/lib/db/users";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/locale"
)({
  component: LocaleSettings,
});

function LocaleSettings() {
  const user = useUser();
  const { i18n, t } = useTranslation();

  const handleLocaleChange = async (value: "en" | "ru") => {
    if (!user?.id) return;

    try {
      i18n.changeLanguage(value);
      await updateUser(user.id, {
        locale: value,
      });
    } catch (error) {
      console.error("Error updating locale:", error);
      toast.error("Failed to update language", {
        description: "Please try again later",
      });
    }
  };

  const locales: { value: NonNullable<UserWithId["locale"]>; label: string }[] =
    [
      { value: "en", label: t("text.locale", { lng: "en" }) },
      { value: "ru", label: t("text.locale", { lng: "ru" }) },
    ];

  return (
    <MiniAppPage className="flex flex-col gap-5">
      <Section>
        <SectionHeader>{t("web.selectLanguage")}</SectionHeader>
        <SectionItems>
          {locales.map((locale) => (
            <SectionItem
              key={locale.value}
              icon={
                <RadioButton
                  checked={locale.value === (user?.locale || "en")}
                />
              }
              onClick={() => handleLocaleChange(locale.value)}
            >
              <SectionItemTitle>{locale.label}</SectionItemTitle>
            </SectionItem>
          ))}
        </SectionItems>
      </Section>
    </MiniAppPage>
  );
}
