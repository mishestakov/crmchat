import { createFileRoute } from "@tanstack/react-router";
import { arrayRemove, arrayUnion } from "firebase/firestore";

import { appFeatures } from "@repo/core/types";

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
import { updateWorkspace } from "@/lib/db/workspaces";
import { useCurrentWorkspace } from "@/lib/store";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/feature-flags"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const user = useUser();
  const workspaceId = useCurrentWorkspace((w) => w.id);
  const currentWorkspaceFeatures = useCurrentWorkspace((w) => w.features ?? []);
  const currentUserFeatures = user?.features ?? [];
  return (
    <MiniAppPage className="space-y-6">
      <Section>
        <SectionHeader>Workspace-level Features</SectionHeader>
        <SectionItems>
          {appFeatures.map((feature) => (
            <SectionItem
              asChild
              icon={null}
              onClick={() => {
                updateWorkspace(workspaceId, {
                  features: currentWorkspaceFeatures.includes(feature)
                    ? arrayRemove(feature)
                    : arrayUnion(feature),
                });
              }}
            >
              <label>
                <SectionItemTitle>{feature}</SectionItemTitle>
                <SectionItemValue>
                  <Switch
                    checked={currentWorkspaceFeatures.includes(feature)}
                  />
                </SectionItemValue>
              </label>
            </SectionItem>
          ))}
        </SectionItems>
      </Section>

      {user?.id && (
        <Section>
          <SectionHeader>User-level Features</SectionHeader>
          <SectionItems>
            {appFeatures.map((feature) => (
              <SectionItem
                asChild
                icon={null}
                onClick={() => {
                  updateUser(user.id, {
                    features: currentUserFeatures.includes(feature)
                      ? arrayRemove(feature)
                      : arrayUnion(feature),
                  });
                }}
              >
                <label>
                  <SectionItemTitle>{feature}</SectionItemTitle>
                  <SectionItemValue>
                    <Switch checked={currentUserFeatures.includes(feature)} />
                  </SectionItemValue>
                </label>
              </SectionItem>
            ))}
          </SectionItems>
        </Section>
      )}
    </MiniAppPage>
  );
}
