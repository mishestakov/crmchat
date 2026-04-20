import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { UserWithId } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/hooks/useUser";
import { updateUser } from "@/lib/db/users";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/notifications"
)({
  component: NotificationsSettings,
});

function NotificationsSettings() {
  const user = useUser();
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <MiniAppPage>
      <Section>
        <SectionHeader>{t("web.notificationSettings.title")}</SectionHeader>
        <SectionItems>
          <InvertedNotificationSetting
            label={t("web.notificationSettings.monthlyUpdates")}
            property="unsubscribedFromUpdates"
          />
          <InvertedNotificationSetting
            label={t("web.notificationSettings.dailyDigest")}
            property="unsubscribedFromDailyDigest"
          />
          <InvertedNotificationSetting
            label={t("web.notificationSettings.chatNotifications")}
            property="unsubscribedFromChatNotifications"
          />
        </SectionItems>
      </Section>
    </MiniAppPage>
  );
}

function InvertedNotificationSetting({
  label,
  property,
}: {
  label: string;
  property: keyof UserWithId;
}) {
  const user = useUser();

  return (
    <SectionItem asChild icon={null} className="min-h-10 py-0">
      <label>
        <SectionItemTitle>{label}</SectionItemTitle>
        <SectionItemValue>
          <Switch
            checked={!user?.[property]}
            onCheckedChange={async (value) => {
              if (!user) return;
              await updateUser(user.id, {
                [property]: !value,
              });
            }}
          />
        </SectionItemValue>
      </label>
    </SectionItem>
  );
}
